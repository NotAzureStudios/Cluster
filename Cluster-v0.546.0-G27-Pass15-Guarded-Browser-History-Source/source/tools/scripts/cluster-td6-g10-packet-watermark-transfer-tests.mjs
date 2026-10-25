import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const src = 'apps/server/src/domains/library/packet-file-image-derivative.ts';
const route = readFileSync('apps/server/src/domains/library/packet-routes.ts', 'utf8');
const renderer = readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx', 'utf8');
const payload = Buffer.from('opaque verified source');
const sha256 = x => createHash('sha256').update(x).digest('hex');
const out = Buffer.alloc(32);
out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(24, 4); out.write('WEBP', 8, 'ascii');
let dimensions = { width: 300, height: 140 };
let overlays = [];
let output = out;
const fakeSharp = (_data, opts) => {
  assert.ok(opts.limitInputPixels <= 20_000_000);
  const result = {
    metadata: async () => ({ format: 'png', pages: 1, ...dimensions }),
    rotate: () => result, resize: () => result, png: () => result,
    composite: layers => { overlays.push(layers); return result; },
    webp: () => result, toBuffer: async () => output,
  };
  return result;
};
const transpiled = ts.transpileModule(readFileSync(src,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, reportDiagnostics: true });
assert.equal(transpiled.diagnostics?.length, 0);
const mod = { exports: {} };
vm.runInNewContext(transpiled.outputText, {
  module: mod, exports: mod.exports, Buffer, Error, JSON, Set, Map,
  require: key => key === 'sharp' ? { default: fakeSharp, __esModule: true } :
    key === './packet-verified-file.js' ? { readPacketVerifiedSourceFile: async () => payload } : require(key)
}, { filename: src });
const { buildPacketFileImageDerivatives: build } = mod.exports;
const item = { id: 'img', fileName: 'verified.png', type: 'file', extension: 'png', mimeType: 'image/png', classification: 'internal', sizeBytes: payload.length, checksumSha256: sha256(payload), revision: 3 };
const manifest = JSON.stringify({ schema: 1, sourceItems: [{ sourceId: item.id, revision: 3, checksumSha256: item.checksumSha256 }] });
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
await test('image publishes unchanged metadata-free derivative when watermark not configured', async () => {
  overlays=[];
  const [artifact]=await build(manifest,[item],'/ignored',[], '');
  assert.equal(artifact.sha256,sha256(out)); assert.equal(overlays.length,0);
});
await test('opt-in image watermark is burned into a fresh reencoded derivative', async () => {
  overlays=[];
  const [artifact]=await build(manifest,[item],'/ignored',[], 'Studio copy <private> & trusted');
  assert.equal(artifact.format,'webp'); assert.equal(overlays.length,1);
  const layer=overlays[0][0]; assert.equal(layer.gravity,'south');
  const xml=layer.input.toString('utf8');
  assert.match(xml,/Studio copy &lt;private&gt; &amp; trusted/);
  assert.doesNotMatch(xml,/<private>/); assert.match(xml,/fill-opacity="0\.78"/);
});
await test('watermark label is bounded and printable', async () => {
  await assert.rejects(build(manifest,[item],'/ignored',[], '\u0000danger'),/WATERMARK_INVALID/);
  await assert.rejects(build(manifest,[item],'/ignored',[], 'X'.repeat(61)),/WATERMARK_INVALID/);
  await assert.rejects(build(manifest,[item],'/ignored',[], '☃'),/WATERMARK_INVALID/);
});
await test('tiny image cannot silently lose its watermark', async () => {
  dimensions={width:60,height:35};
  await assert.rejects(build(manifest,[item],'/ignored',[], 'Internal copy'),/WATERMARK_TOO_SMALL/);
  dimensions={width:300,height:140};
});
await test('watermarked output still obeys the strict artifact size ceiling', async () => {
  output=Buffer.alloc(65_537);
  await assert.rejects(build(manifest,[item],'/ignored',[], 'Internal'),/OUTPUT_INVALID/);
  output=out;
});
await test('Packet author controls send label for both PDF and image, never for audio-only publication', async () => {
  assert.match(renderer,/pdfDerivatives \|\| sourcePdfDerivatives \|\| imageDerivatives \? \{ watermarkLabel: publicationWatermarkLabel \}/);
  assert.match(route,/!pdfDerivatives && !sourcePdfDerivatives && !imageDerivatives/);
  assert.match(route,/buildPacketFileImageDerivatives\([^\n]+textOrPdf, watermarkLabel\)/);
  assert.match(renderer,/This label is shared by recipients, not person-specific/);
});
await test('Packet downloads register browser handoffs rather than claiming delivery completion', async () => {
  assert.match(renderer,/recordBrowserDownloadHandoff\(\{ fileName: "packet-deliveries\.zip"/);
  assert.match(renderer,/recordBrowserDownloadHandoff\(\{ fileName: `packet-derivative-/);
  const transfer = readFileSync('packages/renderer/src/core/browser-download-transfers.ts','utf8');
  assert.match(transfer,/state: "handed-off"/);
  const status = readFileSync('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx','utf8');
  assert.match(status,/Browser-managed progress is not available to Cluster/);
});
await test('publication manifest freezes mark, catalogue discloses it, and source hashes remain unchanged', async () => {
  const pubSrc='apps/server/src/domains/library/packet-publication.ts';
  const js=ts.transpileModule(readFileSync(pubSrc,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const publication={exports:{}};
  vm.runInNewContext(js,{module:publication,exports:publication.exports,require,Buffer,Error,Set,Map,JSON,Date,Number},{filename:pubSrc});
  const {buildPacketReleaseManifest,packetRecipientCatalog}=publication.exports;
  const definition={id:'def',versionLabel:'v1',kind:'knowledge',audienceJson:'{\"mode\":\"all\",\"targets\":[]}',completionMode:'none',required:false};
  const source=[{...item,title:'Internal image',parentId:'p',status:'active'}];
  const ordinary=buildPacketReleaseManifest({id:'p'},definition,source);
  const marked=buildPacketReleaseManifest({id:'p'},definition,source,'Copy & Review');
  assert.notEqual(ordinary.manifestSha256,marked.manifestSha256);
  const parsed=JSON.parse(marked.manifestJson);
  assert.equal(parsed.publicationWatermarkLabel,'Copy & Review');
  assert.equal(parsed.sourceItems[0].checksumSha256,sha256(payload));
  const catalog=packetRecipientCatalog({id:'r',versionLabel:'v1',manifestJson:marked.manifestJson,manifestSha256:marked.manifestSha256,publishedAt:new Date()},new Map([[1,'webp']]));
  assert.equal(catalog.publicationWatermarkLabel,'Copy & Review');
  assert.equal(catalog.contents[0].downloadable,true);
  assert.equal(catalog.contents[0].sourceId,undefined);
  const bundleSrc=readFileSync('apps/server/src/domains/library/packet-bundle.ts','utf8');
  assert.match(bundleSrc,/publicationWatermarkLabel: catalog.publicationWatermarkLabel/);
  assert.match(renderer,/Published watermark: {publishedCatalog.publicationWatermarkLabel}/);
  assert.match(route,/preparedSources, watermarkLabel/);
  assert.match(route,/const snapshot = buildPacketReleaseManifest\(packetAtCommit, current, all, watermarkLabel\)/);
});
await test('invalid mark or absent eligible visual derivative cannot publish a falsely watermarked release', async () => {
  assert.match(route,/PACKET_WATERMARK_NO_VISUAL_DERIVATIVES/);
  assert.match(route,/!derivatives.some\(\(item\) => item.format === \"pdf\" \|\| item.format === \"webp\"\)/);
});
console.log(`${passed}/${passed} G10 source-level checks passed; image decoder/encoder mocked, actual Sharp output and browser downloads not runtime-certified`);
