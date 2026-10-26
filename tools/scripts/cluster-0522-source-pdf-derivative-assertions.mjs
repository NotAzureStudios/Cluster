import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const digest=data=>createHash('sha256').update(data).digest('hex');
const assertions=[];
async function test(name,fn){await fn(); assertions.push(name);}
const original=Buffer.from('%PDF-1.7\nMock source with confidential annotation\n%%EOF');
let pages=2, attachments=null, actions=null, rendered=0, watermarks=[];
const fakePdfjs={ getDocument:()=>({promise:Promise.resolve({numPages:pages,getAttachments:async()=>attachments,getJSActions:async()=>actions,getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:120*scale}),render:()=>({promise:Promise.resolve().then(()=>rendered++)}),cleanup(){}})}),destroy:async()=>{}}) };
const fakeCanvas={createCanvas:(width,height)=>({getContext:()=>({fillRect(){},getImageData:()=>({data:new Uint8ClampedArray(width*height*4)}),set fillStyle(_v){} })})};
const fakeSharp=()=>({flatten(){return this},jpeg(){return this},toBuffer:async()=>Buffer.alloc(40,3)});
const fakePdfLib={StandardFonts:{Helvetica:'H'},rgb:()=>({}),PDFDocument:{create:async()=>({setTitle(){},setCreator(){},setProducer(){},setCreationDate(){},setModificationDate(){},embedFont:async()=>({widthOfTextAtSize:v=>v.length*4}),addPage:()=>({drawImage(){},drawText:v=>watermarks.push(v)}),embedJpg:async()=>({}),save:async()=>Buffer.from('%PDF-1.7\nnew detached flattened PDF\n%%EOF')})}};
function load(file,mocks={}){
 const src=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.equal(src.diagnostics?.length,0);
 const module={exports:{}};
 vm.runInNewContext(src.outputText,{module,exports:module.exports,require:n=>mocks[n]??require(n),Buffer,Uint8Array,Uint8ClampedArray,Date,Map,Set,Error,JSON,Number},{filename:file});
 return module.exports;
}
const shared=load('apps/server/src/domains/library/packet-verified-file.ts');
const pdf=load('apps/server/src/domains/library/packet-file-pdf-derivative.ts',{
 './packet-verified-file.js':shared,'./packet-pdf-derivative.js':{validatePacketPdfWatermark:v=>v},
 'pdfjs-dist/legacy/build/pdf.mjs':fakePdfjs,'@napi-rs/canvas':fakeCanvas,'sharp':{default:fakeSharp,__esModule:true},'pdf-lib':fakePdfLib,
});
const root=mkdtempSync(join(tmpdir(),'cluster-srcpdf-'));mkdirSync(join(root,'files'));writeFileSync(join(root,'files','design.pdf'),original);
const item={id:'doc',type:'file',fileName:'design.pdf',extension:'pdf',mimeType:'application/pdf',classification:'internal',sizeBytes:original.length,checksumSha256:digest(original),revision:3};
const manifest=JSON.stringify({schema:1,sourceItems:[{sourceId:'doc',checksumSha256:item.checksumSha256,revision:item.revision}]});
try {
 await test('flattened PDF does not relay original bytes',async()=>{
  const [one]=await pdf.buildPacketFilePdfDerivatives(manifest,[item],join(root,'files'),[],'AUTHORIZED COPY');
  assert.equal(one.position,1);assert.equal(one.format,'pdf');assert.equal(one.sha256,digest(one.content));assert.ok(one.content.includes('flattened'));
  assert.ok(!one.content.includes('confidential'));assert.equal(rendered,2);assert.ok(watermarks.includes('AUTHORIZED COPY'));
 });
 await test('restricted and non-PDF files never become deliverables',async()=>{
  for(const field of [{classification:'restricted'},{mimeType:'application/javascript'},{extension:'txt'}])
   assert.equal((await pdf.buildPacketFilePdfDerivatives(manifest,[{...item,...field}],join(root,'files'))).length,0);
 });
 await test('revision mismatch and checksum tampering block publication',async()=>{
  await assert.rejects(pdf.buildPacketFilePdfDerivatives(manifest,[{...item,revision:4}],join(root,'files')),/SOURCE_CHANGED/);
  await assert.rejects(pdf.buildPacketFilePdfDerivatives(manifest,[{...item,checksumSha256:'0'.repeat(64)}],join(root,'files')),/SOURCE_CHANGED/);
 });
 await test('path traversal and links are rejected',async()=>{
  await assert.rejects(pdf.buildPacketFilePdfDerivatives(manifest,[{...item,fileName:'../outside.pdf'}],join(root,'files')),/PATH_UNSAFE/);
  symlinkSync(join(root,'files','design.pdf'),join(root,'files','fake.pdf'));
  await assert.rejects(pdf.buildPacketFilePdfDerivatives(manifest,[{...item,fileName:'fake.pdf'}],join(root,'files')),/PATH_UNSAFE/);
 });
 await test('PDF JavaScript actions and embedded attachments reject source',async()=>{
  actions={OpenAction:['bad']};await assert.rejects(pdf.flattenPacketSourcePdf(original),/UNSAFE/);actions=null;
  attachments={malicious:{}};await assert.rejects(pdf.flattenPacketSourcePdf(original),/UNSAFE/);attachments=null;
 });
 await test('excessive page count is refused before rendering',async()=>{
  pages=7;await assert.rejects(pdf.flattenPacketSourcePdf(original),/UNSAFE/);pages=2;
 });
 await test('no fallback to raw source on malformed PDF',async()=>{
  await assert.rejects(pdf.flattenPacketSourcePdf(Buffer.from('%PDF-pretend')),/INVALID/);
 });
 await test('derivative size bounds permit raster PDF without relaxing other formats',()=>{
  const source=readFileSync('apps/server/src/domains/library/packet-publication.ts','utf8');
  assert.match(source,/artifact\.format === "pdf" \? 400_000 : 65_536/);
 });
 await test('publication, author UI, dependency and recipient support wired',()=>{
  const route=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
  const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
  const deps=JSON.parse(readFileSync('apps/server/package.json','utf8')).dependencies;
  assert.match(route,/buildPacketFilePdfDerivatives/);assert.match(route,/sourcePdfDerivatives/);
  assert.match(route,/snapshot\.manifestSha256 !== preparedSnapshot\.manifestSha256/);
  assert.match(ui,/Publish \+ PDF &amp; images/);
  assert.ok(deps['@napi-rs/canvas']&&deps['pdfjs-dist']&&deps.sharp&&deps['pdf-lib']);
 });
 console.log(`PASS ${assertions.length}/${assertions.length} source PDF rasterization checks (PDF engine, canvas and image encoder mocked)`);
} finally{rmSync(root,{recursive:true,force:true});}
