import { createWriteStream, constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import type { StorageObjectStat, StorageProvider, StorageProviderCapabilities, StorageReadRange } from "./storage-types.js";
import { throwIfAborted } from "../operation-cancellation.js";

function normalizeKey(value: string) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Invalid storage key.");
  return normalized;
}

// Managed blob roots may be configured on a shared filesystem. A lexical
// root-prefix check does not stop a parent junction/symlink from redirecting
// reads and writes outside that root. Reject existing links at *every* parent.
// This is a source-level guard, not a kernel-held Windows/SMB directory lease.
export async function assertRealDirectoryChain(directory: string) {
  const resolved = path.resolve(directory);
  const filesystemRoot = path.parse(resolved).root;
  const segments = path.relative(filesystemRoot, resolved).split(path.sep).filter(Boolean);
  let current = filesystemRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let entry;
    try { entry = await lstat(current); }
    catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") continue;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error("Storage path contains a symbolic-link or junction parent.");
    if (!entry.isDirectory()) throw new Error("Storage path contains a non-directory parent.");
  }
}

export async function prepareRealDirectory(directory: string) {
  await assertRealDirectoryChain(directory);
  await mkdir(directory, { recursive: true });
  await assertRealDirectoryChain(directory);
}

function sameFileIdentity(left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }, right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export class LocalStorageProvider implements StorageProvider {
  readonly id: string;
  readonly kind: string;
  readonly durable = true;
  readonly sharedAcrossNodes: boolean;
  readonly capabilities: StorageProviderCapabilities;

  constructor(private readonly root: string, options: { id?: string; kind?: string; sharedAcrossNodes?: boolean } = {}) {
    this.id = String(options.id || "local");
    this.kind = String(options.kind || "filesystem");
    this.sharedAcrossNodes = Boolean(options.sharedAcrossNodes);
    this.capabilities = {
      streamingReads: true,
      rangeReads: true,
      streamingWrites: true,
      sharedAcrossNodes: this.sharedAcrossNodes,
      objectStorage: false,
      multipartUploads: false,
    };
  }

  private resolve(key: string) {
    const normalized = normalizeKey(key);
    const fullPath = path.resolve(this.root, ...normalized.split("/"));
    const base = path.resolve(this.root);
    if (fullPath !== base && !fullPath.startsWith(`${base}${path.sep}`)) throw new Error("Storage key escaped provider root.");
    return fullPath;
  }

  private async guardedObject(key: string) {
    const objectPath = this.resolve(key);
    await assertRealDirectoryChain(path.dirname(objectPath));
    const entry = await lstat(objectPath);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Managed object is not a regular file.");
    return { objectPath, entry };
  }

  private async guardedWriteTarget(key: string) {
    const target = this.resolve(key);
    await prepareRealDirectory(path.dirname(target));
    try {
      const entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Managed write target is not a regular file.");
    } catch (error) {
      if ((error as { code?: string })?.code !== "ENOENT") throw error;
    }
    return target;
  }

  async putFile(key: string, sourcePath: string, options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    const target = await this.guardedWriteTarget(key);
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      await copyFile(sourcePath, partial);
      throwIfAborted(options.signal);
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
    return this.stat(key);
  }

  async putStream(key: string, stream: Readable, input: { size: number; checksumSha256?: string | null; signal?: AbortSignal }) {
    throwIfAborted(input.signal);
    const target = await this.guardedWriteTarget(key);
    const expectedChecksum = input.checksumSha256?.toLowerCase() || null;
    if (expectedChecksum && !/^[0-9a-f]{64}$/.test(expectedChecksum)) throw new Error("Invalid expected SHA-256 checksum.");
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    const hash = createHash("sha256");
    const digestStream = new Transform({
      transform(chunk: Uint8Array, _encoding: string, callback: (error?: Error | null, data?: Uint8Array) => void) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    let actualChecksum: string;
    try {
      const output = createWriteStream(partial, { flags: "wx", mode: 0o600 });
      if (input.signal) await pipeline(stream as any, digestStream, output, { signal: input.signal });
      else await pipeline(stream as any, digestStream, output);
      throwIfAborted(input.signal);
      const info = await stat(partial);
      if (info.size !== input.size) throw new Error(`Storage stream length mismatch: expected ${input.size}, received ${info.size}.`);
      actualChecksum = hash.digest("hex");
      if (expectedChecksum && expectedChecksum !== actualChecksum) throw new Error("Storage stream SHA-256 checksum mismatch.");
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
    return { ...(await this.stat(key)), checksumSha256: actualChecksum };
  }

  async materializeToFile(key: string, targetPath: string, input: { signal?: AbortSignal } = {}) {
    throwIfAborted(input.signal);
    const { objectPath: source, entry: before } = await this.guardedObject(key);
    const target = path.resolve(targetPath);
    if (source === target) throw new Error("A managed object cannot materialize over itself.");
    await prepareRealDirectory(path.dirname(target));
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    // Hold the source inode rather than re-opening a name after an lstat. On
    // platforms supporting O_NOFOLLOW this also rejects a leaf-symlink swap.
    const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFileIdentity(before, opened)) throw new Error("Managed source changed before materialization.");
      const output = createWriteStream(partial, { flags: "wx", mode: 0o600 });
      if (input.signal) await pipeline(handle.createReadStream({ autoClose: false }), output, { signal: input.signal });
      else await pipeline(handle.createReadStream({ autoClose: false }), output);
      throwIfAborted(input.signal);
      const copiedInfo = await stat(partial);
      const after = await this.guardedObject(key);
      if (!sameFileIdentity(before, after.entry) || copiedInfo.size !== opened.size) {
        throw new Error("Managed source changed during materialization.");
      }
      await assertRealDirectoryChain(path.dirname(target));
      await rename(partial, target);
      return { size: copiedInfo.size, modifiedAt: copiedInfo.mtime, method: "copy" as const };
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  async openRead(key: string, range?: StorageReadRange) {
    const { objectPath, entry } = await this.guardedObject(key);
    const handle = await open(objectPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFileIdentity(entry, opened)) throw new Error("Managed source changed before opening read stream.");
      return handle.createReadStream({ ...(range ? { start: range.start, end: range.end } : {}), autoClose: true });
    } catch (error) { await handle.close(); throw error; }
  }

  async stat(key: string): Promise<StorageObjectStat> {
    const { entry } = await this.guardedObject(key);
    return { size: entry.size, modifiedAt: entry.mtime };
  }

  async delete(key: string) {
    const target = this.resolve(key);
    await assertRealDirectoryChain(path.dirname(target));
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Managed delete target is not a regular file.");
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") return;
      throw error;
    }
    // This does not authorize disposition of canonical content; callers are
    // still responsible for governance, ownership and provider fencing.
    await rm(target, { force: true });
  }

  async list(prefix: string) {
    const baseKey = normalizeKey(prefix);
    const basePath = this.resolve(baseKey);
    await assertRealDirectoryChain(path.dirname(basePath));
    const baseInfo = await lstat(basePath).catch((error: unknown) => {
      if ((error as { code?: string })?.code === "ENOENT") return null;
      throw error;
    });
    if (baseInfo?.isSymbolicLink()) throw new Error("Storage inventory prefix must not be a symbolic link.");
    if (baseInfo && !baseInfo.isDirectory()) throw new Error("Storage inventory prefix is not a directory.");
    const results: string[] = [];
    const walk = async (directory: string, relative: string) => {
      await assertRealDirectoryChain(directory);
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as { code?: string })?.code === "ENOENT") throw new Error("Storage inventory changed during traversal.", { cause: error });
        throw error;
      });
      for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const childPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Storage inventory contains a symbolic link.");
        if (entry.isDirectory()) await walk(childPath, childRelative);
        else if (entry.isFile() && !entry.name.includes(".partial-")) results.push(`${baseKey}/${childRelative}`);
        else if (!entry.isFile()) throw new Error("Storage inventory contains an unsupported file type.");
      }
    };
    if (baseInfo) await walk(basePath, "");
    return results;
  }

  async health() {
    try {
      await prepareRealDirectory(this.root);
      const info = await statfs(this.root);
      return { ok: true, freeBytes: Number(info.bavail) * Number(info.bsize) };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Storage provider unavailable.", freeBytes: null };
    }
  }
}
