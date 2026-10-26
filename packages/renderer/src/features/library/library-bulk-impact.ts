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
  const names = visible.slice(0, 5).map((item) => `• ${item.title}`).join("\n");
  const remainder = count - Math.min(visible.length, 5);
  const labels: Record<LibraryBulkIntent, string> = {
    move: "Move", archive: "Archive", restore: "Restore", trash: "Move to Trash",
    pin: "Change pinning for", tag: "Tag", untag: "Remove tag from", status: "Change status for",
  };
  const target = detail.trim() ? `\nDestination / change: ${detail.trim()}` : "";
  const folderCount = visible.filter((item) => item.type === "folder").length;
  const descendants = scope
    ? `\nNested contents: ${scope.descendantCount} additional item${scope.descendantCount === 1 ? "" : "s"} (location/status may be affected).\nTotal selected + nested: ${scope.totalAffectedByLocation}.`
    : folderCount ? `\n${folderCount} selected folder${folderCount === 1 ? "" : "s"} may contain descendants not counted here.` : "";
  if (scope && (scope.selectedCount !== count || scope.action !== action)) throw new Error("Library bulk preview no longer matches the selected operation.");
  const caution = action === "trash" ? "\nItems in Trash may be subject to retention or deletion policies." : "";
  return {
    title: `${labels[action]} ${count} Library item${count === 1 ? "" : "s"}?`,
    message: `Affected selected items: ${count}\n${names}${remainder > 0 ? `\n…and ${remainder} more` : ""}${target}${descendants}${caution}\nOnly explicitly selected items will be sent. The server checks revisions and permissions again before writing; nested contents are not individually rewritten.`,
    needsConfirmation: ["move", "archive", "trash", "restore"].includes(action) || count >= 25,
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
