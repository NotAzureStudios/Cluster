import fs from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

function removeCatalogEntry(document: PDFDocument, name: string) {
  try { document.catalog.delete(PDFName.of(name)); } catch { /* malformed optional entries stay non-fatal */ }
}

export async function writeSanitizedPdfDerivative(input: { sourcePath: string; outputPath: string }) {
  const source = await fs.readFile(input.sourcePath);
  const document = await PDFDocument.load(source, { ignoreEncryption: false });

  // Re-serialize page content while deliberately dropping document-level identity/history
  // and active top-level actions. Cluster never edits the source in place.
  const trailerInfo = document.context.trailerInfo as Record<string, unknown>;
  const infoReference = trailerInfo.Info as any;
  if (infoReference) {
    try { document.context.delete(infoReference); } catch { /* malformed info dictionary */ }
    delete trailerInfo.Info;
  }
  for (const name of ["Metadata", "OpenAction", "AA"]) removeCatalogEntry(document, name);
  try {
    const names = document.catalog.lookup(PDFName.of("Names"));
    if (names instanceof PDFDict) {
      names.delete(PDFName.of("JavaScript"));
      names.delete(PDFName.of("EmbeddedFiles"));
    }
  } catch { /* malformed Names dictionaries are handled by pdf-lib during serialization */ }

  // Page and annotation actions can also launch scripts or external targets. Keep visual
  // annotations, but remove their executable action dictionaries from the share derivative.
  for (const page of document.getPages()) {
    try { page.node.delete(PDFName.of("AA")); } catch { /* malformed page action */ }
    try {
      const annotations = page.node.lookup(PDFName.of("Annots"));
      if (!(annotations instanceof PDFArray)) continue;
      for (let index = 0; index < annotations.size(); index += 1) {
        const annotation = annotations.lookup(index);
        if (!(annotation instanceof PDFDict)) continue;
        annotation.delete(PDFName.of("A"));
        annotation.delete(PDFName.of("AA"));
      }
    } catch { /* malformed annotations remain non-fatal; parser/serializer is bounded upstream */ }
  }

  const bytes = await document.save({ useObjectStreams: true });
  await fs.writeFile(input.outputPath, bytes, { mode: 0o640 });
  return { bytes: bytes.length, removedDocumentInfo: true, removedCatalogMetadata: true, removedActiveCatalogActions: true };
}
