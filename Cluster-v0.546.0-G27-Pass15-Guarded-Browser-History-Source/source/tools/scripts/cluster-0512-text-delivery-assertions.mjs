import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.CLUSTER_TYPESCRIPT_PATH || 'typescript');
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`); };
function load(file, mocks={}) {
  const source = fs.readFileSync(file,'utf8');
  const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(transpiled,{module,exports:module.exports,require:(name)=>name in mocks?mocks[name]:require(name),Buffer,Date,console,Set,Map,Number,String,JSON,Math}, {filename:file});
  return module.exports;
}
const helper=load('apps/server/src/domains/library/packet-publication.ts');
const note=(id,body,extras={})=>({id,parentId:'packet1',title:`Title ${id}`,type:'note',body,classification:'internal',revision:1,status:'active',...extras});
const items=[note('a','Actual text'),note('b','Confidential', {classification:'restricted'}),note('c','Other', {fileName:'source.pdf',type:'file',checksumSha256:'f'.repeat(64)}),note('d',''),note('e','Regular text')];
const definition={id:'d1',versionLabel:'5.0',kind:'knowledge',audienceJson:'{"mode":"users","targets":["member"]}',completionMode:'read'};
const base=helper.buildPacketReleaseManifest({id:'packet1'}, definition, items);
const release={id:'release1',versionLabel:'5.0',manifestJson:base.manifestJson,manifestSha256:base.manifestSha256,publishedAt:new Date()};
const derived=helper.buildPacketTextDerivatives(base.manifestJson,items);
await test('Only internal/public non-file notes with content produce derivatives',()=>assert.deepEqual(Array.from(derived, item=>item.position),[1,5]));
await test('Artifacts are independent text bytes',()=>assert.match(derived[0].content.toString(),/Actual text/) );
await test('Artifacts are bounded and hash verified',()=>{ assert.equal(helper.verifyPacketDerivative(derived[0]).toString(),derived[0].content.toString()); });
await test('Mutated bytes are rejected',()=>assert.throws(()=>helper.verifyPacketDerivative({...derived[0],content:Buffer.from('HACK')}),/INTEGRITY/));
await test('Mutated sha is rejected',()=>assert.throws(()=>helper.verifyPacketDerivative({...derived[0],sha256:'0'.repeat(64)}),/INTEGRITY/));
await test('Invalid size is rejected',()=>assert.throws(()=>helper.verifyPacketDerivative({...derived[0],sizeBytes:999}),/INTEGRITY/));
await test('Oversized note is skipped, not truncated',()=>{
  const extra=[note('f','x'.repeat(70000))];
  const m=helper.buildPacketReleaseManifest({id:'packet1'},definition,extra);
  assert.equal(helper.buildPacketTextDerivatives(m.manifestJson,extra).length,0);
});
await test('A snapshot stays valid independently of later source edits',()=>{
  const old=derived[0].content.toString(); items[0].body='CHANGED AFTER PUBLISH';
  assert.equal(derived[0].content.toString(),old); assert.ok(!old.includes('CHANGED AFTER PUBLISH'));
});
await test('Recipient release lists only positions, never source identity',()=>{
  const projection=helper.packetRecipientCatalog(release,new Set([1,5]));
  assert.equal(projection.deliveryStatus,'partially_available');
  assert.equal(projection.contents[0].downloadable,true);
  assert.equal(projection.contents[1].downloadable,false);
  const text=JSON.stringify(projection);
  assert.ok(!text.includes('packet1')&&!text.includes('source.pdf')&&!text.includes('"sourceId"'));
});
await test('Ordinary release without explicit opt-in remains metadata-only',()=>{
  const projection=helper.packetRecipientCatalog(release);
  assert.equal(projection.deliveryStatus,'derivative_required');
  assert.ok(projection.contents.every(item=>!item.downloadable));
});
await test('Tampering release manifest fails closed',()=>assert.throws(()=>helper.packetRecipientCatalog({...release,manifestJson:'{}'},new Set([1])),/INTEGRITY/));
await test('One release cannot impersonate a different version',()=>assert.throws(()=>helper.packetRecipientCatalog({...release,versionLabel:'6.0'}),/INVALID/));
const source=fs.readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
const db=fs.readFileSync('apps/server/prisma/schema.prisma','utf8');
const sql=fs.readFileSync('apps/server/prisma/migrations/20261008233000_packet_text_derivative_delivery/migration.sql','utf8');
await test('Opt-in defaults false at publication boundary',()=>assert.match(source,/textDerivatives: z\.boolean\(\)\.default\(false\)/));
await test('Derived bytes and release created inside same transaction',()=>assert.match(source,/await tx\.packetReleaseDerivative\.createMany\(/));
await test('Recipient route checks both frozen audience and manifest',()=>{
  const start=source.indexOf('app.get("/api/packets/:packetId/deliveries/:releaseId/artifacts/:position"');
  const end=source.indexOf('app.post("/api/packets/:packetId/complete"',start);
  const body=source.slice(start,end);
  assert.ok(start>0);assert.match(body,/packetRecipientCatalog\(release\)/);
  assert.match(body,/studioAudienceMatchesUser\(prisma, frozenAudience, context\.user\)/);
  assert.match(body,/verifyPacketDerivative\(artifact\)/);
  assert.match(body,/Cache-Control", "private, no-store/);
  assert.match(body,/nosniff/);
  assert.ok(!body.includes('libraryFilesRoot')&&!body.includes('fileName:'));
});
await test('Derivative entity has immutable linkage & release/position unique constraint',()=>{
  assert.match(db,/model PacketReleaseDerivative \{/);
  assert.match(db, /@@unique\(\[releaseId, position\]\)/);
  assert.match(sql,/CREATE UNIQUE INDEX "PacketReleaseDerivative_releaseId_position_key"/);
});
await test('UI explicitly exposes opt-in, never a source download',()=>{
  const ui=fs.readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
  assert.match(ui,/Publish \+ text notes/);
  assert.match(ui,/Download \{entry\.format === "pdf"/);
  assert.match(ui,/encodeURIComponent\(publishedCatalog.releaseId\)/);
});
console.log(`${checks}/${checks} Cluster v0.512 detached text delivery assertions passed`);
