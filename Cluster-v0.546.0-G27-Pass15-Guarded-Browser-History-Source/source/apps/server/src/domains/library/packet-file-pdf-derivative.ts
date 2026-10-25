import { createHash } from "node:crypto";
import { readPacketVerifiedSourceFile } from "./packet-verified-file.js";
import { validatePacketPdfWatermark } from "./packet-pdf-derivative.js";

/** Opt-in, source-free PDF delivery. Render the pages in an isolated document
 * pipeline, then create a NEW PDF from flattened, re-encoded JPEG pixels.
 * No source PDF objects, scripts, annotations, attachments, links, metadata,
 * embedded files or source bytes become part of the delivered PDF.
 * Requires pdfjs-dist, @napi-rs/canvas, sharp, and pdf-lib at runtime.
 */
const SOURCE_LIMIT = 1_048_576;
const MAX_DOCUMENTS = 3;
const MAX_PAGES = 6;
const MAX_DERIVATIVE = 400_000;
const MAX_TOTAL = 1_048_576;
let working = 0;

export async function flattenPacketSourcePdf(bytes: Buffer, watermarkLabel = ""): Promise<Buffer> {
  const watermark = validatePacketPdfWatermark(watermarkLabel);
  if (bytes.length < 20 || bytes.length > SOURCE_LIMIT || bytes.toString("ascii", 0, 5) !== "%PDF-" ||
      !bytes.subarray(-1024).toString("latin1").includes("%%EOF")) throw new Error("PACKET_SOURCE_PDF_INVALID");
  if (working >= 2) throw new Error("PACKET_PDF_CONVERSION_BUSY");
  working++;
  let task: any;
  try {
    // Late import keeps signed-out startup and unrelated Packet operations lean.
    const [{ getDocument }, { createCanvas }, sharpModule, { PDFDocument, StandardFonts, rgb }] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"), import("@napi-rs/canvas"), import("sharp"), import("pdf-lib"),
    ]);
    const sharp = sharpModule.default;
    task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
      disableAutoFetch: true, disableStream: true, stopAtErrors: true, useSystemFonts: false,
      maxImageSize: 4_000_000 });
    const src: any = await task.promise;
    const attachments = await src.getAttachments();
    const actions = await src.getJSActions();
    if (src.numPages < 1 || src.numPages > MAX_PAGES ||
        (attachments && Object.keys(attachments).length > 0) || (actions && Object.keys(actions).length > 0))
      throw new Error("PACKET_SOURCE_PDF_UNSAFE");
    const output = await PDFDocument.create();
    output.setTitle("Cluster detached Packet PDF");
    output.setCreator("Cluster");
    output.setProducer("Cluster flattened Packet delivery");
    output.setCreationDate(new Date("2000-01-01T00:00:00Z"));
    output.setModificationDate(new Date("2000-01-01T00:00:00Z"));
    const font = await output.embedFont(StandardFonts.Helvetica);
    if (watermark && font.widthOfTextAtSize(watermark, 8) > 500) throw new Error("PACKET_PDF_WATERMARK_INVALID");
    for (let index = 1; index <= src.numPages; index++) {
      const page = await src.getPage(index);
      const base = page.getViewport({ scale: 1 });
      if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width < 1 || base.height < 1 ||
          base.width > 6000 || base.height > 6000) throw new Error("PACKET_SOURCE_PDF_UNSAFE");
      const viewport = page.getViewport({ scale: Math.min(1, 640 / base.width, 820 / base.height) });
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
      if (!width || !height || width * height > 800_000) throw new Error("PACKET_SOURCE_PDF_UNSAFE");
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context as any, viewport, canvas: canvas as any, background: "#ffffff" }).promise;
      const raw = context.getImageData(0, 0, width, height);
      const jpeg = await sharp(Buffer.from(raw.data), { raw: { width, height, channels: 4 }, limitInputPixels: 800_000 })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 56 }).toBuffer();
      if (jpeg.length > 160_000) throw new Error("PACKET_SOURCE_PDF_TOO_LARGE");
      const image = await output.embedJpg(jpeg);
      const outPage = output.addPage([width, height + 28]);
      outPage.drawImage(image, { x: 0, y: 28, width, height });
      outPage.drawText("Cluster detached copy - no Library source access", { x: 8, y: 15, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
      if (watermark) outPage.drawText(watermark, { x: 8, y: 5, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
      page.cleanup();
    }
    const detached = Buffer.from(await output.save({ useObjectStreams: false }));
    if (detached.length < 20 || detached.length > MAX_DERIVATIVE) throw new Error("PACKET_SOURCE_PDF_TOO_LARGE");
    return detached;
  } catch (error: any) {
    if (/^PACKET_/.test(String(error?.message || ""))) throw error;
    throw new Error("PACKET_SOURCE_PDF_INVALID");
  } finally {
    try { await task?.destroy(); } catch { /* Do not replace the actual failure. */ }
    working--;
  }
}

export async function buildPacketFilePdfDerivatives(manifestJson: string, sources: any[], libraryFilesRoot: string,
  prior: { position: number; sizeBytes: number }[] = [], watermarkLabel = "") {
  const manifest = JSON.parse(manifestJson);
  if (manifest?.schema !== 1 || !Array.isArray(manifest.sourceItems)) throw new Error("PACKET_RELEASE_INVALID");
  const byId = new Map(sources.map(item => [String(item.id), item]));
  const used = new Set(prior.map(row => row.position));
  let total = prior.reduce((sum, row) => sum + row.sizeBytes, 0);
  const candidates: { entry: any; item: any; position: number }[] = [];
  for (const [index, entry] of manifest.sourceItems.entries()) {
    const position = index + 1;
    const item: any = byId.get(String(entry.sourceId));
    if (!item?.fileName || used.has(position) || item.type === "folder") continue;
    if (!["public", "internal"].includes(String(item.classification || "internal")) ||
        String(item.extension || "").toLowerCase() !== "pdf" ||
        String(item.mimeType || "").toLowerCase() !== "application/pdf") continue;
    if (entry.revision !== item.revision || entry.checksumSha256 !== item.checksumSha256 ||
        !/^[a-f0-9]{64}$/.test(String(entry.checksumSha256 || ""))) throw new Error("PACKET_FILE_SOURCE_CHANGED");
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 20 || item.sizeBytes > SOURCE_LIMIT) continue;
    candidates.push({ item, entry, position });
  }
  if (candidates.length > MAX_DOCUMENTS) throw new Error("PACKET_SOURCE_PDF_LIMIT");
  const derivatives: { position: number; format: "pdf"; content: Buffer; sha256: string; sizeBytes: number }[] = [];
  for (const { item, entry, position } of candidates) {
    const original = await readPacketVerifiedSourceFile(libraryFilesRoot, entry, item, SOURCE_LIMIT);
    const content = await flattenPacketSourcePdf(original, watermarkLabel);
    total += content.length;
    if (total > MAX_TOTAL) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    derivatives.push({ position, format: "pdf", content, sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex") });
  }
  return derivatives;
}
