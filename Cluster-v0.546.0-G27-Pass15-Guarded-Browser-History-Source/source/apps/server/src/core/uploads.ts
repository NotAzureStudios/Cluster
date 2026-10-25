import path from "node:path";

const OCTET_STREAM = "application/octet-stream";
const WINDOWS_RESERVED_BASENAMES = new Set([
  "con", "prn", "aux", "nul", "clock$",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const EXECUTABLE_EXTENSIONS = new Set([
  ".exe", ".dll", ".msi", ".msp", ".mst", ".com", ".scr", ".pif", ".cpl",
  ".bat", ".cmd", ".ps1", ".ps1xml", ".psc1", ".psd1", ".psm1",
  ".vbs", ".vbe", ".wsf", ".wsh", ".hta", ".reg", ".lnk", ".url", ".scf",
  ".app", ".dmg", ".pkg", ".command", ".run", ".sh", ".apk", ".jar",
]);

const ACTIVE_CONTENT_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".svg", ".xml", ".xsl", ".xslt", ".mhtml", ".mht",
  ".js", ".mjs", ".cjs", ".css", ".hta",
]);

const ACTIVE_CONTENT_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/css",
  "multipart/related",
  "message/rfc822",
]);

const SAFE_INLINE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "application/pdf", "text/plain", "application/json",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".json": "application/json",
};

const ZIP_CONTAINER_MIME_TYPES: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".epub": "application/epub+zip",
};

export function normalizeMimeType(value: unknown) {
  const normalized = String(value || OCTET_STREAM).split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized) ? normalized : OCTET_STREAM;
}

export function safeFileName(name: string) {
  const normalized = String(name || "upload.bin").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "");
  let cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  cleaned = cleaned.replace(/^\.+/, "").replace(/[. ]+$/g, "");
  if (!cleaned) cleaned = "upload.bin";
  const parsed = path.parse(cleaned);
  if (WINDOWS_RESERVED_BASENAMES.has(parsed.name.toLowerCase())) cleaned = `_${cleaned}`;
  return cleaned.slice(0, 120) || "upload.bin";
}

export function safePathSegment(value: string) {
  const cleaned = String(value || "unknown").normalize("NFKC").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 96) || "unknown";
}

export function decodeDataUrl(dataUrl: string, maximumDecodedBytes = Number.POSITIVE_INFINITY) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!match || !match[2]) throw new Error("Upload must be a base64 data URL.");
  const declaredMime = normalizeMimeType(match[1] || OCTET_STREAM);
  const payload = match[3].replace(/\s+/g, "");
  if (!payload) throw new Error("Upload payload is empty.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || /=/.test(payload.slice(0, -2))) throw new Error("Upload payload is not valid base64.");
  const unpadded = payload.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) throw new Error("Upload payload is not valid base64.");
  const normalizedPayload = `${unpadded}${"=".repeat((4 - (unpadded.length % 4)) % 4)}`;
  const estimatedBytes = Math.floor((normalizedPayload.length * 3) / 4) - (normalizedPayload.endsWith("==") ? 2 : normalizedPayload.endsWith("=") ? 1 : 0);
  if (estimatedBytes > maximumDecodedBytes) throw new Error(`Upload exceeds the ${Math.max(1, Math.floor(maximumDecodedBytes / 1024 / 1024))} MB limit.`);
  const buffer = Buffer.from(normalizedPayload, "base64");
  if (!buffer.length) throw new Error("Upload payload is empty.");
  if (buffer.toString("base64").replace(/=+$/, "") !== unpadded) throw new Error("Upload payload is not valid base64.");
  return { buffer, declaredMime };
}

function textPrefix(buffer: Buffer, maximum = 4096) {
  return buffer.subarray(0, Math.min(buffer.length, maximum)).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
}

function appearsUtf8Text(buffer: Buffer) {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 32 * 1024));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return controls / sample.length < 0.01 && !sample.toString("utf8").includes("\uFFFD");
}

export function detectedMimeType(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  const head6 = buffer.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) || buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))) return "application/zip";
  if (buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return "application/gzip";
  if (buffer.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return "application/x-7z-compressed";
  if (buffer.subarray(0, 7).toString("ascii") === "Rar!\x1a\x07") return "application/vnd.rar";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "application/ogg";
  if (buffer.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  const prefix = textPrefix(buffer);
  if (/^<svg(?:\s|>)/.test(prefix) || /^<\?xml[^>]*>\s*<svg(?:\s|>)/.test(prefix)) return "image/svg+xml";
  if (/^(?:<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<script(?:\s|>)|<iframe(?:\s|>)|<object(?:\s|>)|<embed(?:\s|>))/.test(prefix)) return "text/html";
  if (/^<\?xml(?:\s|>)/.test(prefix)) return "application/xml";
  return OCTET_STREAM;
}

export function resolvedUploadMime(buffer: Buffer, originalName: string, requestedMime?: string) {
  const detected = detectedMimeType(buffer);
  const requested = normalizeMimeType(requestedMime);
  const extension = path.extname(String(originalName || "")).toLowerCase();
  if (detected === "application/zip") {
    const containerMime = ZIP_CONTAINER_MIME_TYPES[extension];
    if (containerMime && requested === containerMime) return containerMime;
    return detected;
  }
  if (detected !== OCTET_STREAM) return detected;
  if (appearsUtf8Text(buffer)) {
    if (requested === "application/json") {
      try { JSON.parse(buffer.toString("utf8")); return "application/json"; } catch {}
    }
    return "text/plain";
  }
  const extensionMime = EXTENSION_MIME_TYPES[extension];
  if (extensionMime && requested === extensionMime && !ACTIVE_CONTENT_MIME_TYPES.has(extensionMime)) return extensionMime;
  return OCTET_STREAM;
}

export function isExecutablePayload(buffer: Buffer, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  if (EXECUTABLE_EXTENSIONS.has(ext)) return true;
  if (buffer.subarray(0, 2).toString("ascii") === "MZ") return true;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true;
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(magic)) return true;
  }
  const prefix = textPrefix(buffer, 256);
  return /^#!\s*\/(?:usr\/bin\/env\s+)?(?:ba|z|k)?sh\b/.test(prefix);
}

export function isPotentiallyActiveContent(mimeType?: string | null, originalName?: string | null) {
  const mime = normalizeMimeType(mimeType);
  const extension = path.extname(String(originalName || "")).toLowerCase();
  return ACTIVE_CONTENT_MIME_TYPES.has(mime) || ACTIVE_CONTENT_EXTENSIONS.has(extension);
}

export function isSafeInlineUploadMime(mimeType?: string | null, originalName?: string | null) {
  const mime = normalizeMimeType(mimeType);
  if (isPotentiallyActiveContent(mime, originalName)) return false;
  return SAFE_INLINE_MIME_TYPES.has(mime) || mime.startsWith("video/") || mime.startsWith("audio/");
}

export function uploadContentDisposition(mimeType: string | null | undefined, originalName: string | null | undefined, requestedInline = false) {
  return requestedInline && isSafeInlineUploadMime(mimeType, originalName) ? "inline" : "attachment";
}

export function untrustedFileResponseHeaders(mimeType?: string | null, originalName?: string | null) {
  const active = isPotentiallyActiveContent(mimeType, originalName);
  return {
    "X-Content-Type-Options": "nosniff",
    ...(active ? { "Content-Security-Policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'" } : {}),
  };
}

export function mimePatternAllowed(mime: string, csvValue?: string) {
  const normalizedMime = normalizeMimeType(mime);
  const patterns = String(csvValue || "image/*,video/*,audio/*,text/*,application/pdf,application/zip,application/gzip,application/json,application/rtf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.presentation,application/octet-stream")
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((pattern) => pattern === "*/*" || /^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/.test(pattern));
  return patterns.some((pattern) => pattern === "*/*" || pattern === normalizedMime || (pattern.endsWith("/*") && normalizedMime.startsWith(pattern.slice(0, -1))));
}
