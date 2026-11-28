import { api, API_URL } from "../../core/api";
import { downloadAuthenticatedClusterFile } from "../../core/browser-download-transfers";
import type { LibraryItem } from "./library-types";

type CloNode = { type: string; title: string; file?: { name: string; mimeType: string; base64: string } | null; children?: CloNode[] };

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
const safeName = (title: string) => (title || "item").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) || "item";

/** .clo export: the item and everything needed to rebuild it elsewhere. */
export function exportClo(item: LibraryItem) {
  return downloadAuthenticatedClusterFile({ url: `${API_URL}/api/library/${item.id}/clo`, fileName: `${safeName(item.title)}.clo` });
}

/** Download in the item's own format: files as themselves, notes as
 *  Markdown, and anything without a native file (boards, whiteboards,
 *  links, forms, folders) as a .clo. */
export async function downloadNative(item: LibraryItem, downloadFile: (item: LibraryItem) => void) {
  if (item.type === "file" && item.hasFile) { downloadFile(item); return; }
  if (item.type === "note") {
    const full = await api<LibraryItem>(`/api/library/${item.id}`);
    save(new Blob([`# ${full.title}\n\n${full.body || ""}`], { type: "text/markdown;charset=utf-8" }), `${safeName(full.title)}.md`);
    return;
  }
  await exportClo(item);
}

/** Import a .clo under parentId. Structured items are rebuilt by the server;
 *  embedded files go through the normal upload into the folders it made. */
export async function importClo(file: File, parentId: string | null, upload: (files: File[], parentId: string | null) => Promise<void>) {
  const document = JSON.parse(await file.text());
  const result = await api<{ createdId: string | null; files: Array<{ parentId: string | null; path: number[] }> }>("/api/library/import-clo", { method: "POST", body: JSON.stringify({ parentId, document }) });
  for (const pending of result.files) {
    let node: CloNode = document.item;
    for (const index of pending.path) node = node.children![index];
    if (!node.file) continue;
    const bytes = Uint8Array.from(atob(node.file.base64), (char) => char.charCodeAt(0));
    await upload([new File([bytes], node.file.name, { type: node.file.mimeType })], pending.parentId);
  }
  return result.createdId;
}
