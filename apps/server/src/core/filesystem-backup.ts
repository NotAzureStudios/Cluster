import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { OperationCancelledError, throwIfAborted } from "./operation-cancellation.js";

const TAR_BLOCK = 512;
const MAX_ARCHIVE_ENTRIES = 250_000;
const MAX_TAR_PATH_BYTES = 255;

type FileSnapshot = {
  path: string;
  absolutePath: string;
  size: number;
  mtimeMs: number;
};

export type FilesystemBackupSummary = {
  files: number;
  bytes: number;
  sha256: string;
};

function normalizeArchivePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("\0")) {
    throw new Error(`Unsafe backup archive path: ${value || "(empty)"}`);
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_TAR_PATH_BYTES) throw new Error(`Backup archive path is too long: ${normalized}`);
  return normalized;
}

async function walkFiles(root: string, signal?: AbortSignal) {
  const resolvedRoot = path.resolve(root);
  const files: FileSnapshot[] = [];
  async function visit(directory: string) {
    throwIfAborted(signal);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      throwIfAborted(signal);
      const absolutePath = path.join(directory, entry.name);
      const relative = normalizeArchivePath(path.relative(resolvedRoot, absolutePath));
      if (entry.isSymbolicLink()) throw new Error(`Refusing to back up symbolic link ${relative}.`);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Refusing to back up unsupported filesystem entry ${relative}.`);
      const stat = await fs.stat(absolutePath);
      files.push({ path: relative, absolutePath, size: stat.size, mtimeMs: stat.mtimeMs });
      if (files.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Upload backup exceeds ${MAX_ARCHIVE_ENTRIES} files.`);
    }
  }
  try {
    await visit(resolvedRoot);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return files;
}

function writeOctal(header: Buffer, offset: number, length: number, value: number) {
  const raw = Math.max(0, Math.floor(value)).toString(8);
  if (raw.length > length - 1) throw new Error(`Tar numeric field overflow for value ${value}.`);
  const encoded = `${raw.padStart(length - 1, "0")}\0`;
  header.write(encoded, offset, length, "ascii");
}

function splitTarPath(value: string) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= 100) return { name: value, prefix: "" };
  const parts = value.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(name, "utf8") <= 100 && Buffer.byteLength(prefix, "utf8") <= 155) return { name, prefix };
  }
  throw new Error(`Backup archive path cannot be represented safely in ustar: ${value}`);
}

function tarHeader(file: FileSnapshot) {
  const header = Buffer.alloc(TAR_BLOCK, 0);
  const split = splitTarPath(file.path);
  header.write(split.name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, file.size);
  writeOctal(header, 136, 12, Math.floor(file.mtimeMs / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("cluster", 265, 32, "ascii");
  header.write("cluster", 297, 32, "ascii");
  if (split.prefix) header.write(split.prefix, 345, 155, "utf8");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encodedChecksum = `${checksum.toString(8).padStart(6, "0")}\0 `;
  header.write(encodedChecksum, 148, 8, "ascii");
  return header;
}

async function writeAll(handle: FileHandle, buffer: Buffer, signal?: AbortSignal) {
  let offset = 0;
  while (offset < buffer.length) {
    throwIfAborted(signal);
    const result = await handle.write(buffer, offset, buffer.length - offset, null);
    if (result.bytesWritten <= 0) throw new Error("Backup archive write made no progress.");
    offset += result.bytesWritten;
  }
}

export async function createFilesystemBackup(root: string, destination: string, signal?: AbortSignal): Promise<FilesystemBackupSummary> {
  throwIfAborted(signal);
  const files = await walkFiles(root, signal);
  const temp = `${destination}.partial-${process.pid}-${Date.now()}`;
  const output = await fs.open(temp, "wx", 0o600);
  let totalBytes = 0;
  try {
    try {
      for (const file of files) {
        throwIfAborted(signal);
        await writeAll(output, tarHeader(file), signal);
        const stream = createReadStream(file.absolutePath, signal ? { signal } : undefined);
        try {
          for await (const chunk of stream) {
            throwIfAborted(signal);
            await writeAll(output, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), signal);
          }
        } catch (error) {
          if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new OperationCancelledError();
          throw error;
        }
        const padding = (TAR_BLOCK - (file.size % TAR_BLOCK)) % TAR_BLOCK;
        if (padding) await writeAll(output, Buffer.alloc(padding, 0), signal);
        totalBytes += file.size;
      }
      await writeAll(output, Buffer.alloc(TAR_BLOCK * 2, 0), signal);
      await output.sync();
    } finally {
      await output.close();
    }
    throwIfAborted(signal);
    await fs.rename(temp, destination);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await fs.chmod(destination, 0o600).catch(() => undefined);
  return { files: files.length, bytes: totalBytes, sha256: await sha256FilesystemArchive(destination, signal) };
}

function parseOctal(buffer: Buffer, offset: number, length: number) {
  const text = buffer.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid tar octal field: ${JSON.stringify(text)}.`);
  return Number.parseInt(text, 8);
}

function tarEntryPath(header: Buffer) {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
  const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
  return normalizeArchivePath(prefix ? `${prefix}/${name}` : name);
}

function validateHeader(header: Buffer) {
  const storedChecksum = parseOctal(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  let actualChecksum = 0;
  for (const byte of copy) actualChecksum += byte;
  if (storedChecksum !== actualChecksum) throw new Error("Filesystem backup tar header checksum mismatch.");
  const magic = header.subarray(257, 263).toString("ascii");
  if (magic !== "ustar\0") throw new Error("Filesystem backup is not a Cluster ustar archive.");
  const type = header[156];
  if (type !== 0 && type !== "0".charCodeAt(0)) throw new Error("Filesystem backup contains a non-regular-file entry.");
}

async function inspectFilesystemArchive(filePath: string, extractRoot?: string, signal?: AbortSignal): Promise<Omit<FilesystemBackupSummary, "sha256">> {
  const handle = await fs.open(filePath, "r");
  const stat = await handle.stat();
  let offset = 0;
  let files = 0;
  let bytes = 0;
  const seen = new Set<string>();
  try {
    while (offset + TAR_BLOCK <= stat.size) {
      throwIfAborted(signal);
      const header = Buffer.alloc(TAR_BLOCK);
      const read = await handle.read(header, 0, TAR_BLOCK, offset);
      if (read.bytesRead !== TAR_BLOCK) throw new Error("Filesystem backup ended inside a tar header.");
      if (header.every((byte) => byte === 0)) break;
      validateHeader(header);
      const relative = tarEntryPath(header);
      if (seen.has(relative)) throw new Error(`Filesystem backup contains duplicate path ${relative}.`);
      seen.add(relative);
      const size = parseOctal(header, 124, 12);
      const dataOffset = offset + TAR_BLOCK;
      const paddedSize = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
      if (dataOffset + paddedSize > stat.size) throw new Error(`Filesystem backup entry ${relative} extends past the archive boundary.`);
      files += 1;
      bytes += size;
      if (files > MAX_ARCHIVE_ENTRIES) throw new Error(`Filesystem backup exceeds ${MAX_ARCHIVE_ENTRIES} entries.`);
      if (extractRoot) {
        const root = path.resolve(extractRoot);
        const destination = path.resolve(root, relative);
        if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Filesystem restore path escaped the drill directory: ${relative}`);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const out = await fs.open(destination, "wx", 0o600);
        try {
          let remaining = size;
          let cursor = dataOffset;
          const buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, size)));
          while (remaining > 0) {
            throwIfAborted(signal);
            const chunkSize = Math.min(buffer.length, remaining);
            const chunk = await handle.read(buffer, 0, chunkSize, cursor);
            if (chunk.bytesRead !== chunkSize) throw new Error(`Filesystem backup entry ${relative} ended unexpectedly.`);
            await writeAll(out, buffer.subarray(0, chunkSize), signal);
            cursor += chunkSize;
            remaining -= chunkSize;
          }
          await out.sync();
        } finally {
          await out.close();
        }
      }
      offset = dataOffset + paddedSize;
    }
  } finally {
    await handle.close();
  }
  return { files, bytes };
}

export async function sha256FilesystemArchive(filePath: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, signal ? { signal } : undefined);
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      hash.update(chunk);
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new OperationCancelledError();
    throw error;
  }
  return hash.digest("hex");
}

export async function verifyFilesystemBackup(filePath: string, expected?: { files?: number; bytes?: number; sha256?: string | null }, signal?: AbortSignal) {
  throwIfAborted(signal);
  const summary = await inspectFilesystemArchive(filePath, undefined, signal);
  const sha256 = await sha256FilesystemArchive(filePath, signal);
  const mismatches: string[] = [];
  if (typeof expected?.files === "number" && expected.files !== summary.files) mismatches.push(`file count ${summary.files} != ${expected.files}`);
  if (typeof expected?.bytes === "number" && expected.bytes !== summary.bytes) mismatches.push(`byte count ${summary.bytes} != ${expected.bytes}`);
  if (expected?.sha256 && expected.sha256 !== sha256) mismatches.push("SHA-256 mismatch");
  return { ok: mismatches.length === 0, ...summary, sha256, mismatches };
}

export async function drillFilesystemRestore(filePath: string, targetRoot: string, expected?: { files?: number; bytes?: number; sha256?: string | null }, signal?: AbortSignal) {
  throwIfAborted(signal);
  await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const verification = await verifyFilesystemBackup(filePath, expected, signal);
  if (!verification.ok) return { ...verification, extracted: false };
  const restored = await inspectFilesystemArchive(filePath, targetRoot, signal);
  const ok = restored.files === verification.files && restored.bytes === verification.bytes;
  return { ...verification, ok, extracted: true, restoredFiles: restored.files, restoredBytes: restored.bytes, mismatches: ok ? verification.mismatches : [...verification.mismatches, "restored archive counts do not match"] };
}
