import { constants } from "node:fs";
import fs from "node:fs/promises";

const MAX_LIBRARY_PDF_INDEX_BYTES = 64 * 1024 * 1024;

/**
 * Bound PDF text-indexing input to the opened descriptor's verified size.
 * Never follow a concurrent append as FileHandle.readFile() does. This is a
 * local-file snapshot check, not remote-provider generation fencing.
 */
export async function readLibraryPdfSnapshot(filePath: string, maxBytes = MAX_LIBRARY_PDF_INDEX_BYTES): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_LIBRARY_PDF_INDEX_BYTES) {
    throw new Error("LIBRARY_PDF_SOURCE_LIMIT_INVALID: invalid PDF indexing limit.");
  }
  const currentPath = await fs.lstat(filePath);
  if (!currentPath.isFile() || currentPath.isSymbolicLink() || currentPath.nlink !== 1) {
    throw new Error("LIBRARY_PDF_SOURCE_UNSAFE: PDF source must be a private regular file.");
  }
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes ||
      before.dev !== currentPath.dev || before.ino !== currentPath.ino) {
      throw new Error("LIBRARY_PDF_SOURCE_LIMIT: PDF exceeds its verified indexing budget or changed identity.");
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(4 * 1024 * 1024, bytes.length - offset), offset);
      if (!bytesRead) throw new Error("LIBRARY_PDF_SOURCE_CHANGED: PDF was truncated during the read.");
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, bytes.length);
    const after = await handle.stat();
    if (extraBytes !== 0 || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1) {
      throw new Error("LIBRARY_PDF_SOURCE_CHANGED: PDF changed during the indexing snapshot.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
