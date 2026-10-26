/** Pure, bounded title-only rename planning. No stored blob paths are rewritten. */
export type LibraryBulkRenameRule = {
  mode: "replace" | "prefix" | "suffix" | "number";
  text?: string;
  replacement?: string;
  start?: number;
  padding?: number;
};
export type RenamableLibraryItem = { id: string; title: string; revision: number; parentId: string | null; type: string };
export type LibraryBulkRenameEntry = { id: string; from: string; to: string; revision: number; parentId: string | null };

export class LibraryBulkRenameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function validatedTitle(value: string): string {
  const next = value.trim();
  // Use portable names: a Library title may later become a physical filename.
  if (!next || next.length > 180 || /[\\/<>:"|?*\x00-\x1f\x7f]/.test(next) || next === "." || next === ".." || /[. ]$/.test(next))
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_TITLE", "A generated title is empty, too long, or contains unsafe filename characters.");
  return next;
}

export function planLibraryBulkRename(items: RenamableLibraryItem[], rule: LibraryBulkRenameRule): LibraryBulkRenameEntry[] {
  if (!items.length || items.length > 200 || items.some((item) => item.type === "folder"))
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_SCOPE", "Select 1 to 200 non-folder Library items. Folder paths must be renamed individually.");
  const text = rule.text || "";
  if (text.length > 160 || (rule.replacement || "").length > 160)
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Rename inputs must be 160 characters or fewer.");
  if (rule.mode === "replace" && !text)
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Enter the exact text to replace.");
  if (["prefix", "suffix"].includes(rule.mode) && !text)
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Enter a prefix or suffix.");
  const start = rule.start ?? 1;
  const padding = rule.padding ?? 3;
  if (!Number.isSafeInteger(start) || start < 0 || start > 999999 || !Number.isInteger(padding) || padding < 1 || padding > 8)
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Invalid sequence start or padding.");
  const ordered = [...items].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const result = ordered.map((item, index) => {
    let title = item.title;
    if (rule.mode === "replace") title = title.split(text).join(rule.replacement || "");
    if (rule.mode === "prefix") title = `${text}${title}`;
    if (rule.mode === "suffix") {
      const dot = title.lastIndexOf(".");
      title = dot > 0 ? `${title.slice(0, dot)}${text}${title.slice(dot)}` : `${title}${text}`;
    }
    if (rule.mode === "number") {
      const dot = title.lastIndexOf(".");
      const ext = dot > 0 ? title.slice(dot) : "";
      title = `${text}${String(start + index).padStart(padding, "0")}${ext}`;
    }
    return { id: item.id, from: item.title, to: validatedTitle(title), revision: item.revision, parentId: item.parentId };
  });
  const destinations = new Set<string>();
  for (const entry of result) {
    const key = `${entry.parentId ?? "ROOT"}\0${entry.to.toLocaleLowerCase("en-US")}`;
    if (destinations.has(key)) throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_COLLISION", "Two selected items would receive the same name in one folder.");
    destinations.add(key);
  }
  return result;
}
