import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildPacketTextDerivatives } from "./packet-publication.js";

/** Convert eligible detached NOTE text to fresh, bounded PDFs. This never
 * opens or relays an original Library PDF or media source. PDF source
 * sanitization, personalized recipient watermarks and external delivery are
 * separate adapters and are NOT implemented by this converter.
 */
export function validatePacketPdfWatermark(value: string): string {
  if (/[^\x20-\x7e]/.test(value)) throw new Error("PACKET_PDF_WATERMARK_INVALID");
  const trimmed = value.trim();
  if (trimmed.length > 60) throw new Error("PACKET_PDF_WATERMARK_INVALID");
  return trimmed;
}

export async function buildPacketNotePdfDerivatives(manifestJson: string, sources: any[], watermarkLabel = "") {
  return renderPacketTextPdfDerivatives(buildPacketTextDerivatives(manifestJson, sources), watermarkLabel);
}

/** The same deterministic PDF renderer accepts detached, verified uploaded text
 * copies. It never opens raw PDF source files or embeds external attachments. */
export async function renderPacketTextPdfDerivatives(notes: { position: number; content: Buffer }[], watermarkLabel = "") {
  const selectedWatermark = validatePacketPdfWatermark(watermarkLabel);
  if (notes.length > 64) throw new Error("PACKET_PDF_DERIVATIVE_LIMIT");
  const derivatives: { position: number; format: "pdf"; content: Buffer; sha256: string; sizeBytes: number }[] = [];
  let totalBytes = 0;
  for (const note of notes) {
    const text = note.content.toString("utf8").normalize("NFC");
    if (text.length > 22_000) continue; // No truncation or incomplete PDF releases.
    const pdf = await PDFDocument.create();
    pdf.setProducer("Cluster detached Packet delivery");
    pdf.setCreator("Cluster");
    pdf.setTitle("Packet derived note");
    pdf.setCreationDate(new Date("2000-01-01T00:00:00.000Z"));
    pdf.setModificationDate(new Date("2000-01-01T00:00:00.000Z"));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const watermark = "Cluster - derived copy - source access not granted";
    if (selectedWatermark && font.widthOfTextAtSize(selectedWatermark, 8) > 504) throw new Error("PACKET_PDF_WATERMARK_INVALID");
    const markPage = (currentPage: any) => {
      currentPage.drawText(watermark, { x: 54, y: 34, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
      if (selectedWatermark) currentPage.drawText(selectedWatermark, { x: 54, y: 22, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    };
    let page = pdf.addPage([612, 792]), y = 750, pageCount = 1;
    const lines: string[] = [];
    for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (!raw.length) { lines.push(""); continue; }
      let next = raw;
      while (next.length) {
        // Fit the *rendered* glyph width inside 54pt page margins; a fixed character
        // count can still clip wide text and leak incomplete information to readers.
        let width = Math.min(next.length, 85);
        while (width > 1 && font.widthOfTextAtSize(next.slice(0, width), 10.5) > 504) width -= 1;
        if (font.widthOfTextAtSize(next.slice(0, width), 10.5) > 504) { width = 0; break; }
        lines.push(next.slice(0, width));
        next = next.slice(width);
      }
      if (next.length) { lines.length = 1201; break; } // Abort rather than truncate unrenderable text.
    }
    if (lines.length > 1200) continue;
    let unsupported = false;
    for (const line of lines) {
      // StandardFonts is WinAnsi only. Do not silently lose unsupported glyphs.
      try { font.encodeText(line); } catch { unsupported = true; break; }
    }
    if (unsupported) continue;
    for (const line of lines) {
      if (y < 72) {
        markPage(page);
        if (++pageCount > 30) { unsupported = true; break; }
        page = pdf.addPage([612, 792]); y = 750;
      }
      if (line) page.drawText(line, { x: 54, y, size: 10.5, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 15;
    }
    if (unsupported) continue;
    markPage(page);
    const content = Buffer.from(await pdf.save({ useObjectStreams: false }));
    if (content.byteLength > 65_536) continue;
    totalBytes += content.length;
    if (totalBytes > 1_048_576) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    derivatives.push({ position: note.position, format: "pdf", content, sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: content.byteLength });
  }
  return derivatives;
}
