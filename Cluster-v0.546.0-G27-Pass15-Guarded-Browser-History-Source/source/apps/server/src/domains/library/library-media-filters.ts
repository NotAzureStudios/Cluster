/** Canonical Library media-group filtering, used by Explorer and saved Smart Collections. */
export function libraryMimeFilter(group?: string) {
    if (!group || group === "all") return undefined;
    if (["image", "video", "audio"].includes(group)) return { startsWith: `${group}/` };
    if (group === "pdf") return { equals: "application/pdf" };
    if (group === "model") return { extension: { in: ["obj", "stl", "ply", "gltf", "glb", "fbx", "dae", "3ds", "blend"] } };
    if (group === "text") return { OR: [{ mimeType: { startsWith: "text/" } }, { mimeType: { in: ["application/json", "application/xml", "application/javascript", "application/typescript", "application/yaml", "application/x-yaml", "application/toml", "application/sql"] } }, { extension: { in: ["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "toml", "sql", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm", "py", "c", "cpp", "h", "hpp", "cs", "java", "rs", "go", "sh", "bat", "ps1", "ini", "cfg", "env"] } }] };
    if (group === "office") return { extension: { in: ["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "pptx", "pptm", "potx", "potm", "odt", "ods", "odp", "rtf", "csv", "tsv"] } };
    if (group === "ebook") return { extension: { in: ["epub"] } };
    if (group === "archive") return { extension: { in: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"] } };
    if (group === "files") return { not: null };
    return undefined;
  }

