// Files from a drop, with dropped folders walked recursively. A folder from
// `dataTransfer.files` is a fake 0-byte file; read entries instead and keep
// each file's path in `webkitRelativePath` so uploads rebuild the folders.

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void; createReader?: () => { readEntries: (ok: (entries: Entry[]) => void, fail: (error: unknown) => void) => void } };

function withPath(file: File, path: string) {
  try { Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true }); } catch { /* keep the bare name */ }
  return file;
}

async function walk(entry: Entry, out: File[]) {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push(withPath(file, entry.fullPath.replace(/^\//, "")));
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  // readEntries returns batches; keep reading until it returns none.
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await walk(child, out);
  }
}

export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() || null);
  if (!entries.length || entries.some((entry) => !entry)) return Array.from(transfer.files || []);
  const out: File[] = [];
  for (const entry of entries) await walk(entry!, out);
  return out;
}
