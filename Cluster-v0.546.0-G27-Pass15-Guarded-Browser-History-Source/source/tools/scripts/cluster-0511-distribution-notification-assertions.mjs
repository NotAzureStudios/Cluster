import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.CLUSTER_TYPESCRIPT_PATH || '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
let count=0;
async function test(name,fn){await fn();count+=1;console.log(`PASS ${name}`);}
function loadTs(file,mocks={}){
  const transpiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const ctx={module,exports:module.exports,require:(name)=> name in mocks ? mocks[name]:require(name),Buffer,Date,Intl,Number,Object,JSON,Math,console};
  vm.runInNewContext(transpiled,ctx,{filename:file});
  return module.exports;
}
const packets=loadTs('apps/server/src/domains/library/packet-publication.ts');
const def={id:'def1',versionLabel:'3.0',kind:'onboarding',audienceJson:'{"mode":"users","targets":["person-1"]}',completionMode:'read'};
const entries=[{id:'internal-only-source-id',parentId:'packet1',title:'Onboarding PDF',type:'file',fileName:'s.pdf',checksumSha256:'a'.repeat(64),sizeBytes:321,revision:3,status:'active'}];
const manifest=packets.buildPacketReleaseManifest({id:'packet1'},def,entries);
const release={id:'r1',versionLabel:'3.0',...manifest,publishedAt:new Date('2026-10-08T12:00:00Z')};
const catalog=packets.packetRecipientCatalog(release);
await test('Published Packet catalog is a metadata-only, non-downloadable derivative queue',()=>{
  assert.equal(catalog.deliveryStatus,'derivative_required');
  assert.equal(catalog.contents.length,1);
  assert.equal(catalog.contents[0].downloadable,false);
});
await test('Recipient catalogue never exposes original Library IDs, paths or checksum',()=>{
  const text=JSON.stringify(catalog);
  for(const secret of ['internal-only-source-id','packet1','s.pdf','a'.repeat(64)]) assert.equal(text.includes(secret),false);
  assert.equal('sourceId' in catalog.contents[0],false);
});
await test('Frozen Packet audience is returned without reading mutable current definition',()=>{
  assert.equal(packets.publishedPacketAudience(release),def.audienceJson);
});
await test('Packet tamper detection fails closed',()=>{
  assert.throws(()=>packets.packetRecipientCatalog({...release,manifestJson:release.manifestJson.replace('Onboarding PDF','Changed')}),/PACKET_RELEASE_INTEGRITY_FAILED/);
});
await test('A forged but consistently hashed unsupported manifest cannot be delivered',()=>{
  const bad=JSON.stringify({...JSON.parse(release.manifestJson),distributionPolicy:'direct'});
  assert.throws(()=>packets.packetRecipientCatalog({...release,manifestJson:bad,manifestSha256:crypto.createHash('sha256').update(bad).digest('hex')}),/PACKET_RELEASE_INVALID/);
});
await test('Manifest cannot be misrepresented as another release version',()=>{
  assert.throws(()=>packets.packetRecipientCatalog({...release,versionLabel:'9.0'}),/PACKET_RELEASE_INVALID/);
});
const shared={CLUSTER_NOTIFICATION_PRIORITIES:['normal','medium','high','critical']};
const notifications=loadTs('apps/server/src/domains/notifications/notification-policy.ts',{'@cluster/shared':shared});
const person={workingPattern:{timezone:'America/New_York'},preferences:JSON.stringify({notificationCategoryDelivery:{system:'off',activity:'off'},notificationProjectModes:{p1:'off'},notificationToolModes:{system:'off'},notificationPriorityFloor:'critical',userQuietHoursEnabled:true,userQuietHoursStart:'00:00',userQuietHoursEnd:'23:59',notificationQuietHoursBehavior:'silent'})};
const now=new Date('2026-10-08T13:00:00Z');
await test('Critical System security event bypasses category mute and quiet hours',()=>{
  const policy=notifications.evaluateNotificationPolicy(person,{category:'system',signal:'security',priority:'critical',tool:'system',projectId:'p1',requiresAction:true},now);
  assert.equal(policy.store,true); assert.equal(policy.interruptive,true);assert.equal(policy.deliveryMode,'toast');
});
await test('Nonsecurity routine System activity still honors off preference',()=>{
  assert.equal(notifications.evaluateNotificationPolicy(person,{category:'system',signal:'activity',priority:'normal',tool:'system',projectId:'p1',requiresAction:false},now).store,false);
});
await test('Critical activity outside System does not get mandatory bypass',()=>{
  assert.equal(notifications.evaluateNotificationPolicy(person,{category:'activity',signal:'failure',priority:'critical',tool:'system',requiresAction:false},now).store,false);
});
await test('Notification queries and digest preserve visibility of critical System category',()=>{
  const routes=fs.readFileSync('apps/server/src/domains/notifications/notification-routes.ts','utf8');
  const service=fs.readFileSync('apps/server/src/domains/notifications/notification-service.ts','utf8');
  assert.match(routes,/category === "system" \|\| categoryDelivery\[category\] !== "off"/);
  assert.match(service,/category === "system" \|\| categoryDelivery\[category\] !== "off"/);
});
await test('Only the frozen audience, not mutable Packet settings, determines release visibility',()=>{
  const routes=fs.readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
  assert.match(routes,/studioAudienceMatchesUser\(prisma, frozenAudience, context.user\)/);
  assert.match(routes,/packetRecipientCatalog\(release\)/);
  assert.match(routes,/packetDefinitionId: packet.packetDefinition.id/);
  assert.match(routes,/private, no-store/);
});
await test('Packet UI explains release status without offering a source download',()=>{
  const renderer=fs.readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
  assert.match(renderer,/Published releases/);
  assert.match(renderer,/Text-note and checked plain-text file derivatives can be published/);
  assert.match(renderer,/inspectPublishedRelease/);
});
await test('Publication stores immutable source backlinks in the SAME release transaction',()=>{
  const routes=fs.readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
  assert.match(routes,/await tx\.packetRelease\.create\(/);
  assert.match(routes,/await tx\.libraryBacklink\.createMany\(/);
  assert.match(routes,/sourceResourceKind: "packet_release"/);
  assert.match(routes,/relationKind: "published_source"/);
});
const destruction=loadTs('apps/server/src/domains/library/library-destruction.ts');
await test('Legacy Library destruction cannot bypass published Packet source protections',async()=>{
  let deleted=false;
  const tx={libraryItem:{deleteMany:async()=>{deleted=true;return {count:1}}}};
  const result=await destruction.prepareLibraryDestruction(tx,'source',4,'Important source',true,'owner',()=>({eligible:true}));
  assert.equal(result.error.code,'LIBRARY_DISPOSITION_REVIEW_REQUIRED');assert.equal(deleted,false);
});
console.log(`${count}/${count} Cluster v0.511 publication and notification assertions passed`);
