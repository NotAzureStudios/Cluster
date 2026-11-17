// Runtime checks for server-side PDF handling. These run the real code against
// real PDFs instead of asserting on source text.
//
// Background: PDF.js builds vector paths with the Path2D of the @napi-rs/canvas
// copy it imports. If the server draws onto a canvas from a second copy of that
// native module, every filled path throws ("Value is non of these types
// `String`, `Path`") and flattened Packet PDFs fail with
// PACKET_SOURCE_PDF_INVALID. The two must resolve to one installed copy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function samplePdf({ text }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const sharp = (await import("sharp")).default;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 87, g: 193, b: 255, alpha: 0.6 } } }).png().toBuffer();
  const image = await doc.embedPng(png);
  for (let index = 1; index <= 3; index += 1) {
    const page = doc.addPage([612, 792]);
    if (text) page.drawText(`Cluster PDF runtime page ${index}`, { x: 72, y: 700, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: 72, y: 500, width: 200, height: 100, color: rgb(0.34, 0.76, 1), opacity: 0.5 });
    page.drawImage(image, { x: 300, y: 500, width: 128, height: 128, opacity: 0.8 });
  }
  doc.setTitle("Cluster runtime sample");
  return Buffer.from(await doc.save());
}

await check("one installed copy of @napi-rs/canvas is shared with PDF.js", async () => {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const copies = Object.keys(lock.packages).filter((key) => key.endsWith("node_modules/@napi-rs/canvas"));
  assert.deepEqual(copies, ["node_modules/@napi-rs/canvas"], "PDF.js and the server must resolve the same @napi-rs/canvas");
});

const { flattenPacketSourcePdf } = await tsImport("../../apps/server/src/domains/library/packet-file-pdf-derivative.ts", import.meta.url);
const { PDFDocument } = await import("pdf-lib");

await check("flattening renders filled shapes and images", async () => {
  const flattened = await flattenPacketSourcePdf(await samplePdf({ text: false }), "CONFIDENTIAL");
  const output = await PDFDocument.load(flattened);
  assert.equal(output.getPageCount(), 3);
  assert.ok(flattened.length > 5_000, "pages contain rendered pixels");
});

await check("flattening renders standard-font text", async () => {
  const flattened = await flattenPacketSourcePdf(await samplePdf({ text: true }), "");
  assert.equal((await PDFDocument.load(flattened)).getPageCount(), 3);
});

await check("flattening rejects bytes that are not a PDF", async () => {
  await assert.rejects(flattenPacketSourcePdf(Buffer.from("not a pdf"), ""), /PACKET_SOURCE_PDF_INVALID/);
});

await check("text extraction and teardown work with the installed PDF.js", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await samplePdf({ text: true })), isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const document = await task.promise;
  const metadata = await document.getMetadata();
  assert.equal(metadata.info.Title, "Cluster runtime sample");
  const page = await document.getPage(2);
  const text = (await page.getTextContent()).items.map((item) => item.str).join(" ");
  assert.match(text, /Cluster PDF runtime page 2/);
  // PDF.js 6 removed PDFDocumentProxy.destroy(); the loading task owns teardown.
  await document.loadingTask.destroy();
  assert.equal(task.destroyed, true);
});

console.log(`${passed}/5 PDF runtime checks passed`);
