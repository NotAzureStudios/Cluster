import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** Shared, bounded, pinned-revision read for Packet derivative adapters.
 * The caller must first establish editor authorization and eligibility.
 * Do not return a storage location or original bytes to recipients.
 */
export async function readPacketVerifiedSourceFile(rootPath: string, entry: any, item: any, maxBytes: number): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(String(entry?.checksumSha256 || "")) ||
      entry.checksumSha256 !== item?.checksumSha256 || entry.revision !== item?.revision)
    throw new Error("PACKET_FILE_SOURCE_CHANGED");
  if (!Number.isSafeInteger(item?.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > maxBytes)
    throw new Error("PACKET_FILE_SOURCE_SIZE_INVALID");
  const root = path.resolve(rootPath);
  if (await fs.realpath(root).catch(() => "") !== root) throw new Error("PACKET_FILE_ROOT_UNSAFE");
  if (typeof item.fileName !== "string" || !item.fileName || item.fileName.includes("\0"))
    throw new Error("PACKET_FILE_PATH_UNSAFE");
  const full = path.resolve(root, item.fileName);
  if (!full.startsWith(root + path.sep) || await fs.realpath(full).catch(() => "") !== full)
    throw new Error("PACKET_FILE_PATH_UNSAFE");
  const before = await fs.lstat(full).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink() || before.size !== item.sizeBytes)
    throw new Error("PACKET_FILE_SOURCE_CHANGED");
  const handle = await fs.open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size || opened.ino !== before.ino || opened.dev !== before.dev)
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
    // Reading to EOF is unbounded if another process appends after lstat.
    // Consume only the pinned size in bounded reads, then probe one byte for
    // unexpected growth. Never allocate an attacker-controlled new file size.
    bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!bytesRead) throw new Error("PACKET_FILE_SOURCE_CHANGED");
      offset += bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await handle.read(trailing, 0, 1, offset)).bytesRead !== 0)
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
  } finally { await handle.close(); }
  if (bytes.length !== before.size || createHash("sha256").update(bytes).digest("hex") !== entry.checksumSha256)
    throw new Error("PACKET_FILE_SOURCE_CHANGED");
  return bytes;
}
