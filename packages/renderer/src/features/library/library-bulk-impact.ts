/** Read-only description of a Library bulk intent. Authorization remains server-side. */
export type LibraryBulkIntent = "move" | "archive" | "restore" | "trash" | "pin" | "tag" | "untag" | "status";
export type LibraryBulkTarget = { id: string; title: string; type: string };
export type LibraryBulkImpact = { title: string; message: string; needsConfirmation: boolean; count: number };
export type LibraryBulkScopePreview = { ok: true; selectedCount: number; descendantCount: number; totalAffectedByLocation: number; action: LibraryBulkIntent; requiresRevalidation: true };
export const MAX_LIBRARY_BULK_IDS = 200; // Matches the server's bulk request schema.
export function describeLibraryBulkImpact(
  action: LibraryBulkIntent, selectedIds: readonly string[], loaded: readonly LibraryBulkTarget[],
  detail = "", scope?: LibraryBulkScopePreview,
): LibraryBulkImpact {
  if (!selectedIds.length || selectedIds.length > MAX_LIBRARY_BULK_IDS || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error(`Select between 1 and ${MAX_LIBRARY_BULK_IDS} distinct Library items.`);
  }
  const count = selectedIds.length;
  const selected = new Set(selectedIds);
  const visible = loaded.filter((item) => selected.has(item.id));
  const labels: Record<LibraryBulkIntent, string> = {
    move: "Move", archive: "Archive", restore: "Restore", trash: "Move to Trash",
    pin: "Change pinning for", tag: "Tag", untag: "Remove tag from", status: "Change status for",
  };
  const folderCount = visible.filter((item) => item.type === "folder").length;
  const nested = scope?.descendantCount ?? 0;
  if (scope && (scope.selectedCount !== count || scope.action !== action)) throw new Error("Library bulk preview no longer matches the selected operation.");
  const lines = [
    count > 1 ? visible.slice(0, 5).map((item) => `• ${item.title}`).join("\n") + (count > 5 ? `\n…and ${count - Math.min(visible.length, 5)} more` : "") : "",
    detail.trim() ? `To: ${detail.trim()}` : "",
    nested ? `Includes ${nested} item${nested === 1 ? "" : "s"} inside.` : folderCount ? "Folders include everything inside them." : "",
    action === "archive" ? "You can restore from Archived." : action === "trash" ? "You can restore from Trash until it is emptied." : "",
  ].filter(Boolean);
  const single = count === 1 && visible[0] ? `“${visible[0].title}”` : `${count} items`;
  const sizable = folderCount > 0 || nested > 0;
  return {
    title: `${labels[action]} ${single}?`,
    message: lines.join("\n"),
    // Archive, restore and moves of plain files are easy to undo, so they only
    // confirm for folders, nested contents or big batches. Trash always asks.
    needsConfirmation: action === "trash" || (["move", "archive", "restore"].includes(action) && (sizable || count >= 10)) || count >= 25,
    count,
  };
}

export function captureLibraryBulkRevisions(ids: readonly string[], loaded: readonly (LibraryBulkTarget & { revision?: number })[]): Record<string, number> {
  const rows = new Map(loaded.map((entry) => [entry.id, entry]));
  const captured: Record<string, number> = Object.create(null);
  for (const id of ids) {
    const revision = rows.get(id)?.revision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error("Selected Library items lack a reliable revision. Refresh the Library before applying a bulk change.");
    captured[id] = Number(revision);
  }
  return captured;
}
