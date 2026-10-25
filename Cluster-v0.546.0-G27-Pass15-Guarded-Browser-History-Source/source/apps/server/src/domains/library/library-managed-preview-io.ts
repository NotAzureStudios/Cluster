import { randomUUID } from "node:crypto";
import { constants as fileFlags } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { validateManagedDerivativePath } from "./library-derivative-file-safety.js";

/** Managed runtime derivatives are not allowed to change identity between path
 * validation and the point at which Fastify owns their readable descriptor.
 * A held file handle pins the actual file even if a pathname changes later.
 */
export class ManagedPreviewIOError extends Error {
  readonly code: "PREVIEW_UNSAFE" | "THUMBNAIL_BUSY";
  constructor(code: "PREVIEW_UNSAFE" | "THUMBNAIL_BUSY", message: string) {
    super(message);
    this.code = code;
    this.name = "ManagedPreviewIOError";
  }
}

function unsafe(message = "Managed preview storage needs administrator repair."): never {
  throw new ManagedPreviewIOError("PREVIEW_UNSAFE", message);
}

function sameFileEvidence(a: Awaited<ReturnType<typeof fs.stat>>, b: Awaited<ReturnType<typeof fs.stat>>) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
}

/** Open and inspect one descriptor, then stream exactly that descriptor.
 * No pathname-based createReadStream() after permission / path checks.
 */
export type ManagedPreviewFormat = "webp" | "png" | "jpg" | "glb";

/** Check the exact opened bytes, not a MIME header inferred from the path. */
function matchesPreviewHeader(header: Buffer, size: number, format: ManagedPreviewFormat): boolean {
  if (format === "png") return header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (format === "jpg") return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (format === "webp") return header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  return header.toString("ascii", 0, 4) === "glTF" && header.readUInt32LE(4) === 2 &&
    size >= 20 && size <= 0xffffffff && header.readUInt32LE(8) === size;
}

export async function openManagedPreviewStream(root: string, candidate: string,
  maxBytes = Number.MAX_SAFE_INTEGER, format?: ManagedPreviewFormat) {
  const verified = await validateManagedDerivativePath(root, candidate);
  if (!verified) return null;
  const before = await fs.lstat(verified).catch(() => null);
  if (!before || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > maxBytes) return null;
  const flags = fileFlags.O_RDONLY | (fileFlags.O_NOFOLLOW ?? 0);
  const handle = await fs.open(verified, flags).catch(() => null);
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    const header = Buffer.alloc(12);
    if (format) {
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length || !matchesPreviewHeader(header, opened.size, format)) {
        await handle.close();
        return null;
      }
    }
    const current = await fs.lstat(verified).catch(() => null);
    if (!opened.isFile() || opened.nlink !== 1 || !current || !sameFileEvidence(before, opened) ||
        !sameFileEvidence(opened, current) ||
        await validateManagedDerivativePath(root, verified) !== verified) {
      await handle.close();
      return null;
    }
    return { size: opened.size, stream: handle.createReadStream({ autoClose: true }) };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

const extensions = ["webp", "png", "jpg"] as const;
export type ModelThumbnailExtension = typeof extensions[number];

async function assertManagedThumbnailRoot(root: string) {
  const resolved = path.resolve(root);
  const stat = await fs.lstat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) unsafe();
}

async function assertSafeExistingFile(file: string) {
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) unsafe();
}

/** Serializes writes for one item across server processes via a fail-closed
 * filesystem lock. Interrupted operations leave their lock for manual review;
 * a second request must never guess that it is safe to steal the lock.
 */
export async function saveManagedModelThumbnail(root: string, itemId: string, extension: ModelThumbnailExtension, bytes: Buffer) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId) || !extensions.includes(extension) ||
      !Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.length > 4 * 1024 * 1024 ||
      !matchesPreviewHeader(bytes.subarray(0, 12), bytes.length, extension)) unsafe("Invalid model thumbnail request.");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertManagedThumbnailRoot(root);
  const lockPath = path.join(root, `${itemId}.thumbnail.lock`);
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ManagedPreviewIOError("THUMBNAIL_BUSY", "A thumbnail update is already running or requires recovery.");
    }
    throw error;
  }
  const destination = path.join(root, `${itemId}.${extension}`);
  const temporary = path.join(root, `${itemId}.${randomUUID()}.tmp`);
  try {
    // Check all previous variants before touching canonical output. A crafted
    // symlink / hardlink should not be used as a deletion or overwrite target.
    for (const ext of extensions) await assertSafeExistingFile(path.join(root, `${itemId}.${ext}`));
    const handle = await fs.open(temporary, fileFlags.O_CREAT | fileFlags.O_EXCL | fileFlags.O_WRONLY | (fileFlags.O_NOFOLLOW ?? 0), 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertManagedThumbnailRoot(root);
    await assertSafeExistingFile(temporary);
    for (const ext of extensions) await assertSafeExistingFile(path.join(root, `${itemId}.${ext}`));
    await fs.rename(temporary, destination);
    for (const ext of extensions) {
      if (ext !== extension) await fs.unlink(path.join(root, `${itemId}.${ext}`)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return destination;
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await fs.rmdir(lockPath);
  }
}
