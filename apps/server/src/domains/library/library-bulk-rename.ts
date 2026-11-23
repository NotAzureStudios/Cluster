/** Pure, bounded title-only rename planning. No stored blob paths are rewritten. */
export type LibraryBulkRenameRule = {
  mode: "replace" | "prefix" | "suffix" | "number" | "case" | "regex" | "unreal-prefix";
  text?: string;
  replacement?: string;
  start?: number;
  padding?: number;
};
export type RenamableLibraryItem = { id: string; title: string; revision: number; parentId: string | null; type: string; mimeType?: string | null; extension?: string | null; originalName?: string | null };
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

// Split "Hero Concept.v2.png" into the name and its extension so rules
// never touch the extension.
function splitExtension(title: string) {
  const dot = title.lastIndexOf(".");
  return dot > 0 && title.length - dot <= 10 ? [title.slice(0, dot), title.slice(dot)] : [title, ""];
}

function words(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-.]+/).filter(Boolean);
}

const CASES: Record<string, (name: string) => string> = {
  lower: (name) => name.toLowerCase(),
  upper: (name) => name.toUpperCase(),
  title: (name) => words(name).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" "),
  snake: (name) => words(name).map((word) => word.toLowerCase()).join("_"),
  kebab: (name) => words(name).map((word) => word.toLowerCase()).join("-"),
  pascal: (name) => words(name).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(""),
};

// Common Unreal naming-convention prefixes by asset kind.
const UNREAL_MODEL = /\.(fbx|obj|gltf|glb|dae|3ds|blend|usd|usdz|abc)$/i;
export function unrealPrefix(item: RenamableLibraryItem) {
  const name = `${item.originalName || ""} ${item.title}`;
  const mime = String(item.mimeType || "").toLowerCase();
  if (UNREAL_MODEL.test(name) || mime.startsWith("model/")) return "SM_";
  if (mime.startsWith("image/") || /\.(tga|dds|exr|hdr|psd)$/i.test(name)) return "T_";
  if (mime.startsWith("audio/")) return "A_";
  if (mime.startsWith("video/")) return "MV_";
  return null;
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
  if (rule.mode === "case" && !CASES[text])
    throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Choose a letter case.");
  let pattern: RegExp | null = null;
  if (rule.mode === "regex") {
    if (!text) throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "Enter a pattern.");
    try { pattern = new RegExp(text, "g"); } catch { throw new LibraryBulkRenameError("LIBRARY_BULK_RENAME_INVALID_RULE", "That pattern is not a valid regular expression."); }
  }
  const ordered = [...items].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const result = ordered.map((item, index) => {
    let title = item.title;
    if (rule.mode === "replace") title = title.split(text).join(rule.replacement || "");
    if (rule.mode === "prefix") title = `${text}${title}`;
    if (rule.mode === "suffix") {
      const dot = title.lastIndexOf(".");
      title = dot > 0 ? `${title.slice(0, dot)}${text}${title.slice(dot)}` : `${title}${text}`;
    }
    if (rule.mode === "case" || rule.mode === "regex" || rule.mode === "unreal-prefix") {
      const [name, ext] = splitExtension(title);
      if (rule.mode === "case") title = `${CASES[text](name) || name}${ext}`;
      if (rule.mode === "regex") title = `${name.replace(pattern!, rule.replacement || "")}${ext}`;
      if (rule.mode === "unreal-prefix") {
        const prefix = unrealPrefix(item);
        title = prefix && !/^[A-Z]{1,4}_/.test(name) ? `${prefix}${CASES.pascal(name) || name}${ext}` : title;
      }
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
