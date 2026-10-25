import path from "node:path";

export type LibraryPreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "model" | "office" | "archive" | "ebook" | "youtube-video" | "youtube-playlist" | "external" | "folder" | "document" | "unsupported";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "toml", "sql", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm", "py", "c", "cpp", "h", "hpp", "cs", "java", "rs", "go", "sh", "bat", "ps1", "ini", "cfg", "env"]);
const MODEL_EXTENSIONS = new Set(["obj", "stl", "ply", "gltf", "glb", "fbx", "dae", "3ds", "blend"]);
const OFFICE_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "pptx", "pptm", "potx", "potm", "odt", "ods", "odp", "rtf", "csv", "tsv"]);
const EBOOK_EXTENSIONS = new Set(["epub"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]);

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/sql"
]);

export function libraryMimeGroup(mimeType?: string | null, extension?: string | null) {
  const mime = String(mimeType || "").trim().toLowerCase();
  const ext = String(extension || "").trim().toLowerCase().replace(/^\./, "");
  if (MODEL_EXTENSIONS.has(ext)) return "model";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (EBOOK_EXTENSIONS.has(ext)) return "ebook";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (isTextPreviewMime(mime)) return "text";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("archive") || mime.includes("tar")) return "archive";
  if (mime.includes("word") || mime.includes("document") || mime.includes("sheet") || mime.includes("excel") || mime.includes("presentation") || mime.includes("powerpoint")) return "office";
  return "other";
}

export function isTextPreviewMime(mimeType?: string | null, extension?: string | null) {
  const mime = String(mimeType || "").trim().toLowerCase();
  const ext = String(extension || "").trim().toLowerCase().replace(/^\./, "");
  return TEXT_EXTENSIONS.has(ext) || TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || TEXT_MIME_TYPES.has(mime);
}

export function libraryPreviewKind(item: { type?: string | null; mimeType?: string | null; extension?: string | null; externalUrl?: string | null; previewText?: string | null }): LibraryPreviewKind {
  if (item.type === "folder") return "folder";
  if (item.type === "youtube-video") return "youtube-video";
  if (item.type === "youtube-playlist") return "youtube-playlist";
  const group = libraryMimeGroup(item.mimeType, item.extension);
  if (["image", "video", "audio", "pdf", "text", "model", "office", "archive", "ebook"].includes(group)) return group as LibraryPreviewKind;
  if (item.mimeType) return item.previewText ? "text" : "unsupported";
  if (item.externalUrl) return "external";
  return "document";
}

export function normalizeLibraryMetadata(value: unknown, maximumKeys = 80): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maximumKeys)) {
    const key = String(rawKey).normalize("NFKC").trim().slice(0, 80);
    if (!key) continue;
    if (rawValue === null || typeof rawValue === "boolean") result[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) result[key] = rawValue;
    else if (typeof rawValue === "string") result[key] = rawValue.normalize("NFC").slice(0, 32_000);
  }
  return result;
}

export function parseLibraryMetadata(value?: string | null): Record<string, string | number | boolean | null> {
  if (!value) return {};
  try {
    return normalizeLibraryMetadata(JSON.parse(value));
  } catch {
    return {};
  }
}

export function libraryFileExtension(originalName?: string | null) {
  const extension = path.extname(String(originalName || "")).replace(/^\./, "").trim().toLowerCase();
  return extension.slice(0, 24) || null;
}

export function libraryDisplayTitle(originalName?: string | null) {
  const base = path.basename(String(originalName || "")).trim();
  const title = base.replace(/\.[^.]+$/, "").trim();
  return (title || base || "Untitled file").slice(0, 240);
}

export function librarySort(sort = "updated-desc") {
  switch (sort) {
    case "custom": return [{ manualOrder: { sort: "asc", nulls: "last" } }, { title: "asc" }, { id: "asc" }] as const;
    case "updated-asc": return [{ updatedAt: "asc" }, { id: "asc" }] as const;
    case "created-desc": return [{ createdAt: "desc" }, { id: "desc" }] as const;
    case "created-asc": return [{ createdAt: "asc" }, { id: "asc" }] as const;
    case "title-asc": return [{ title: "asc" }, { id: "asc" }] as const;
    case "title-desc": return [{ title: "desc" }, { id: "desc" }] as const;
    case "size-desc": return [{ sizeBytes: "desc" }, { id: "desc" }] as const;
    case "size-asc": return [{ sizeBytes: "asc" }, { id: "asc" }] as const;
    default: return [{ updatedAt: "desc" }, { id: "desc" }] as const;
  }
}

export function makeLibraryPreviewText(buffer: Buffer, mimeType?: string | null, maximumBytes = 256 * 1024, extension?: string | null) {
  if (!isTextPreviewMime(mimeType, extension) || buffer.length > maximumBytes) return null;
  const text = buffer.toString("utf8").replace(/\u0000/g, "");
  return text.slice(0, 200_000);
}

export function buildLibraryFolderPath(folders: Array<{ id: string; parentId?: string | null; title: string }>, parentId?: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathItems: Array<{ id: string; title: string }> = [];
  const visited = new Set<string>();
  let currentId = parentId || null;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const item = byId.get(currentId);
    if (!item) break;
    pathItems.unshift({ id: item.id, title: item.title });
    currentId = item.parentId || null;
  }
  return pathItems;
}

export function wouldCreateLibraryCycle(items: Array<{ id: string; parentId?: string | null }>, itemId: string, nextParentId?: string | null) {
  if (!nextParentId) return false;
  if (nextParentId === itemId) return true;
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let currentId: string | null = nextParentId;
  while (currentId) {
    if (currentId === itemId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.parentId || null;
  }
  return false;
}

export function libraryFacetCounts(items: Array<{ type?: string | null; status?: string | null; mimeType?: string | null; extension?: string | null; pinned?: boolean; projectId?: string | null }>) {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byMimeGroup: Record<string, number> = {};
  let pinned = 0;
  let projectLinked = 0;
  for (const item of items) {
    const type = String(item.type || "note");
    const status = String(item.status || "active");
    const mimeGroup = libraryMimeGroup(item.mimeType, (item as any).extension);
    byType[type] = (byType[type] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
    byMimeGroup[mimeGroup] = (byMimeGroup[mimeGroup] || 0) + 1;
    if (item.pinned) pinned += 1;
    if (item.projectId) projectLinked += 1;
  }
  return { total: items.length, pinned, projectLinked, byType, byStatus, byMimeGroup };
}
