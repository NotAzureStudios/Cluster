import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const viewer = (name) => readFileSync(resolve(root, "packages/renderer/src/features/viewer", name), "utf8");
const { pdfPageOffsets, pdfPageIndexAtOffset, PDF_PAGE_VERTICAL_CHROME } = await import(pathToFileURL(resolve(root, "packages/renderer/src/features/viewer/pdf-page-layout.ts")));
const { readBoundedViewerBlob } = await import(pathToFileURL(resolve(root, "packages/renderer/src/features/viewer/bounded-viewer-blob.ts")));
const pdf = viewer("UnifiedPdfViewer.tsx");
const three = viewer("UnifiedThreeViewer.tsx");
let count = 0;
async function check(label, run) { await run(); console.log("PASS " + label); count++; }

await check("Mixed portrait/landscape page offsets and index", () => {
  const offsets = pdfPageOffsets(4, {width:612,height:792}, {2:{width:920,height:440},3:{width:600,height:990}}, 1, 0);
  assert.deepEqual(offsets, [0, 792+38, 792+440+2*38, 792+440+990+3*38, 792*2+440+990+4*38]);
  assert.equal(pdfPageIndexAtOffset(offsets, offsets[2]-1), 1);
  assert.equal(pdfPageIndexAtOffset(offsets, offsets[2]), 2);
  assert.equal(pdfPageIndexAtOffset(offsets, offsets[4]+500), 3);
});
await check("Rotation, zoom and invalid geometry", () => {
  const dimensions = {width:400,height:900};
  assert.equal(pdfPageOffsets(1,dimensions,{},1,0)[1], 900+38);
  assert.equal(pdfPageOffsets(1,dimensions,{},2,90)[1], 800+38);
  assert.equal(pdfPageOffsets(2,dimensions,{1:{width:NaN,height:0}},1,0)[1],900+38);
  assert.deepEqual(pdfPageOffsets(0,dimensions,{},1,0), [0]);
  assert.equal(pdfPageIndexAtOffset([0],0),0);
});
await check("Virtual PDF navigation uses shared page offsets", () => {
  assert.match(pdf,/pdfPageOffsets\(pageCount, pageSize, pageDimensions, scale, rotation\)/);
  assert.match(pdf,/pdfPageIndexAtOffset\(pageOffsets, node\.scrollTop \+ node\.clientHeight \* 0\.35\)/);
  assert.match(pdf,/top: pageOffsets\[next - 1\]/);
  assert.match(pdf,/height: pageOffsets\[renderStart\]/);
  assert.match(pdf,/pageOffsets\[pageCount\] - pageOffsets\[renderEnd\]/);
  assert.doesNotMatch(pdf,/pageStride/);
});
await check("Visible PDF pages measured and scroll anchored", () => {
  assert.match(pdf,/onPageSize\(pageNumber, \{ width: dimensions\.width, height: dimensions\.height \}\)/);
  assert.match(pdf,/onPageSize=\{recordPageSize\}/);
  assert.match(pdf,/setPageDimensions\(\{\}\)/);
  assert.match(pdf,/previousOffsetsRef\.current = pageOffsets/);
});
await check("PDF canvas cancellation is serialized before repaint", () => {
  assert.match(pdf,/const previous = pendingCanvasRenderRef\.current/);
  assert.match(pdf,/await previous;\s*if \(cancelled\) return/);
  assert.match(pdf,/pendingCanvasRenderRef\.current = render\(\)/);
  assert.match(pdf,/return \(\) => \{ cancelled = true; task\?\.cancel\(\); \}/);
});
await check("Saved 3D viewpoints are keyed to current user and model", () => {
  assert.match(three,/const currentSavedViewKey = assetSession\.session \? savedViewsKey\(/);
  assert.match(three,/const savedViews = currentSavedViewKey && savedViewState\.key === currentSavedViewKey/);
  assert.match(three,/savedViewState\.key !== currentSavedViewKey/);
  assert.match(three,/setSavedViewState\(\{ key: currentSavedViewKey, views: loadSavedViews/);
  assert.doesNotMatch(three,/saveSavedViews\(userId, assetSession\.session\.resource\.source\.id, savedViews\)/);
});
function stream(chunks, headers={}) {
  return new Response(new ReadableStream({start(controller) {
    for(const bytes of chunks) controller.enqueue(new Uint8Array(bytes));
    controller.close();
  }}),{headers});
}
await check("3D response budget enforced during streaming", async () => {
  assert.equal((await readBoundedViewerBlob(stream([[1,2],[3,4]]), 4)).size,4);
  await assert.rejects(readBoundedViewerBlob(stream([[1,2,3],[4,5]]),4),/exceeds/);
  await assert.rejects(readBoundedViewerBlob(stream([[1]],{"content-length":"99"}),4),/exceeds/);
  await assert.rejects(readBoundedViewerBlob(stream([[1]]),0),/Invalid/);
});
await check("3D viewer uses bounded payload reader", () => {
  assert.match(three,/readBoundedViewerBlob\(response, DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes\)/);
  assert.doesNotMatch(three,/const blob = await response\.blob\(\)/);
});
await check("PDF page chrome matches virtual geometry", () => {
  const css=viewer("viewer-shell.css");
  assert.match(css,/\.cluster-static-pdf-page\{line-height:13px;\}/);
  assert.match(css,/\.cluster-static-pdf-paper\{box-sizing:content-box;\}/);
  assert.equal(PDF_PAGE_VERTICAL_CHROME,18+5+13+2);
});
await check("Existing newer release metadata is not replaced by RC73", () => {
  const release=JSON.parse(readFileSync(resolve(root,"config/release-candidate.json"),"utf8"));
  assert.equal(release.release,"1.0.0-rc.50");
  assert.equal(release.certification,"candidate-unverified");
});
console.log(count + "/10 targeted RC73 viewer reconciliation checks passed");
