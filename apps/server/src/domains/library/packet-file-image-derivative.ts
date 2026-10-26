import { createHash } from "node:crypto";
import { readPacketVerifiedSourceFile } from "./packet-verified-file.js";
import sharp from "sharp";

/** Publish bounded, freshly decoded raster images. Never publish or return source
 * Library bytes/metadata, user-provided filenames, or original access tokens.
 * Deliberately excludes animated media, SVG, PDF, TIFF, and opaque formats.
 */
const SOURCE_MAX = 1_048_576;
const OUTPUT_MAX = 65_536;
const TOTAL_MAX = 1_048_576; // Shared with the Packet ZIP and recipient delivery limit.
const IMAGE_MAX = 12;
const formats = new Map([
  ["jpg", { mime: "image/jpeg", decoded: "jpeg" }],
  ["jpeg", { mime: "image/jpeg", decoded: "jpeg" }],
  ["png", { mime: "image/png", decoded: "png" }],
  ["webp", { mime: "image/webp", decoded: "webp" }],
]);

export async function buildPacketFileImageDerivatives(manifestJson: string, sources: any[], libraryFilesRoot: string,
  prior: { position: number; sizeBytes: number }[] = [], watermarkLabel = "") {
  // Keep image conversion independent of the PDF renderer and its native
  // processing dependencies. The publication API enforces the same cap.
  if (typeof watermarkLabel !== "string" || /[^\x20-\x7e]/.test(watermarkLabel) || watermarkLabel.trim().length > 60)
    throw new Error("PACKET_IMAGE_WATERMARK_INVALID");
  const watermark = watermarkLabel.trim();
  const manifest = JSON.parse(manifestJson);
  if (manifest?.schema !== 1 || !Array.isArray(manifest.sourceItems)) throw new Error("PACKET_RELEASE_INVALID");
  const byId = new Map<string, any>(sources.map(item => [String(item.id), item]));
  const used = new Set(prior.map(item => item.position));
  let total = prior.reduce((value, item) => value + item.sizeBytes, 0);
  const candidates: { item: any; entry: any; position: number; decoded: string }[] = [];
  for (const [index, entry] of manifest.sourceItems.entries()) {
    const position = index + 1;
    const item = byId.get(String(entry.sourceId));
    const format = formats.get(String(item?.extension || "").toLowerCase());
    if (!item?.fileName || used.has(position) || !format || item.type === "folder") continue;
    if (!["public", "internal"].includes(String(item.classification || "internal")) || String(item.mimeType || "").toLowerCase() !== format.mime) continue;
    if (entry.checksumSha256 !== item.checksumSha256 || entry.revision !== item.revision || !/^[a-f0-9]{64}$/.test(String(entry.checksumSha256 || "")))
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > SOURCE_MAX) continue;
    candidates.push({ item, entry, position, decoded: format.decoded });
  }
  if (candidates.length > IMAGE_MAX) throw new Error("PACKET_IMAGE_LIMIT");
  const derivatives: { position: number; format: "webp"; content: Buffer; sha256: string; sizeBytes: number }[] = [];
  for (const { item, entry, position, decoded } of candidates) {
    const bytes = await readPacketVerifiedSourceFile(libraryFilesRoot, entry, item, SOURCE_MAX);
    // A fresh image from decoded pixels intentionally drops EXIF, ICC/XMP,
    // comments, source resolution markers, application metadata and animations.
    // Errors fail the publication; never fall back to shipping original bytes.
    let converted: Buffer;
    try {
      const source = sharp(bytes, { limitInputPixels: 20_000_000, animated: false, failOn: "error" });
      const meta = await source.metadata();
      if (meta.format !== decoded || !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 ||
        (meta.pages ?? 1) !== 1 || meta.width * meta.height > 20_000_000) throw new Error("PACKET_IMAGE_INVALID");
      const raster = sharp(bytes, { limitInputPixels: 20_000_000, animated: false, failOn: "error" })
        .rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true });
      if (watermark) {
        // Re-encode the decoded pixels first. No source EXIF/ICC/XMP is passed
        // into the overlay stage or into the released WebP artifact.
        const clean = await raster.png().toBuffer();
        const size = await sharp(clean, { limitInputPixels: 20_000_000 }).metadata();
        if (!size.width || !size.height || size.width > 768 || size.height > 768 ||
            size.width < 72 || size.height < 36 ||
            size.width < 18 + Math.ceil(watermark.length * 4.5)) throw new Error("PACKET_IMAGE_WATERMARK_TOO_SMALL");
        const fontSize = Math.max(7, Math.min(13, Math.floor((size.width - 18) / (watermark.length * 0.66 || 1))));
        const barHeight = Math.min(32, Math.max(20, fontSize + 12));
        // XML-escape even though only printable ASCII is accepted. Treat the
        // watermark as TEXT, never as SVG markup or a remote image reference.
        const escaped = watermark.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
        const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${barHeight}"><rect width="100%" height="100%" fill="#111" fill-opacity="0.78"/><text x="50%" y="${barHeight / 2}" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${escaped}</text></svg>`);
        converted = await sharp(clean, { limitInputPixels: 20_000_000, failOn: "error" })
          .composite([{ input: overlay, gravity: "south" }])
          .webp({ quality: 72, effort: 4 }).toBuffer();
      } else {
        converted = await raster.webp({ quality: 72, effort: 4 }).toBuffer();
      }
    } catch (error: any) {
      if (error?.message === "PACKET_IMAGE_WATERMARK_TOO_SMALL") throw error;
      throw new Error("PACKET_IMAGE_INVALID");
    }
    if (converted.length < 16 || converted.length > OUTPUT_MAX || converted.toString("ascii", 0, 4) !== "RIFF" || converted.toString("ascii", 8, 12) !== "WEBP")
      throw new Error("PACKET_IMAGE_OUTPUT_INVALID");
    total += converted.length;
    if (total > TOTAL_MAX) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    derivatives.push({ position, format: "webp", content: converted,
      sha256: createHash("sha256").update(converted).digest("hex"), sizeBytes: converted.length });
  }
  return derivatives;
}
