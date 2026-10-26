import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const checks=[];
function load(file,imports={}) {
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:name=>name in imports?imports[name]:(name === "./managed-package-seat-policy.js" ? {
    packageSeatEligibleIds: async (_db, ids) => ids,
    packageSeatEligibleUsers: async (_db, _pkg, ids) => ids,
    registerManagedPackageSeatRoutes: () => {},
  } : name === "./managed-package-readiness.js" ? {
    registerManagedPackageReadinessRoutes: () => {},
  } : null)||require(name),Buffer,Date,JSON,String,Number,Set,Map,Math,Promise,process},{filename:file});
 return module.exports;
}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const artifactStore = load('apps/server/src/domains/inventory/managed-package-artifact-store.ts', {'./managed-package-policy.js': policy});
const delivery=load('apps/server/src/domains/inventory/managed-package-device.ts',{'./managed-package-policy.js':policy});
const receipts=load('apps/server/src/domains/inventory/managed-package-deployments.ts');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function crc32(data){let crc=~0;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(~crc)>>>0}
function zip(name='payload/install.txt',content=Buffer.from('trusted bytes')){
 const label=Buffer.from(name),size=content.length,crc=crc32(content);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);local.writeUInt16LE(label.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);central.writeUInt16LE(label.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+label.length,12);end.writeUInt32LE(local.length+label.length+size,16);
 return Buffer.concat([local,label,content,central,label,end]);
}
async function test(name,fn){await fn();checks.push(name);console.log('PASS',name)}
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
const fingerprint=policy.packageKeyFingerprint(publicKeyPem);
const bytes=zip();
const manifest={schema:1,packageKey:'studio-tools',version:'2.3.4',platform:'windows-x64',artifactSha256:sha(bytes),artifactSize:bytes.length,filename:'studio-tools.zip'};
const signature=sign(null,policy.packageSigningInput(manifest),privateKey).toString('base64');
const samplePkg={id:'p1',key:'studio-tools',title:'Studio Tools',description:'',archivedAt:null};
const sampleRelease={id:'r1',packageId:'p1',version:'2.3.4',platform:'windows-x64',filename:'studio-tools.zip',artifactSize:bytes.length,artifactSha256:sha(bytes),manifestSha256:sha(policy.packageSigningInput(manifest)),manifestJson:JSON.stringify(manifest),signature,signingKeyFingerprint:fingerprint,publishedAt:new Date(),revokedAt:null,artifact:bytes};
const key={fingerprint,publicKeyPem,disabledAt:null};
let recipientEntitled=true;
let pkg={...samplePkg},release={...sampleRelease},signingKey={...key},policyRow={packageId:'p1',releaseId:'r1',state:'active',percentage:100,channel:'stable'},pin=null;
let device={id:'device-db-1',userId:'user-1',deviceId:'00000000-0000-4000-8000-000000000001',platform:'desktop',proofStatus:'verified',proofKeyFingerprint:'sha256:known',revokedAt:null};
const events=[];
const deployments=[];
const receiptEvents=[];
const db={
 user:{findUnique:async({where})=>where.id==='user-1'?{id:'user-1',accountState:'ACTIVE',archived:false,accessExpiresAt:null}:null},
 managedPackageEntitlement:{findMany:async()=>recipientEntitled?[{packageId:'p1'}]:[]},
 managedPackage:{findMany:async({where})=>(pkg&&!pkg.archivedAt&&(!where.id||where.id.in.includes(pkg.id))?[pkg]:[])},
 managedPackageRollout:{findMany:async({where})=>policyRow&&where.channel===policyRow.channel?[policyRow]:[]},
 managedPackagePin:{findMany:async({where})=>pin&&pin.active&&pin.deviceId===where.deviceId?[pin]:[]},
 managedPackageRelease:{findMany:async({where})=>release&&!release.revokedAt&&where.id.in.includes(release.id)?[release]:[],findUnique:async({where})=>where.id===release?.id?release:null},
 managedPackageSigningKey:{findMany:async()=>signingKey&&!signingKey.disabledAt?[signingKey]:[]},
 deviceRegistration:{findUnique:async({where})=>('id'in where?device?.id===where.id:device?.userId===where.userId_deviceId.userId&&device?.deviceId===where.userId_deviceId.deviceId)?device:null},
 managedPackageAuditEvent:{create:async({data})=>{events.push(data);return data}},
 managedPackageDeviceDeployment:{
  count:async({where})=>deployments.filter(x=>x.deviceRegistrationId===where.deviceRegistrationId&&x.offeredAt>=where.offeredAt.gte).length,
  create:async({data})=>{const row={...data,id:'deployment-'+(deployments.length+1),revision:0,recoveryCount:0,offeredAt:new Date()};deployments.push(row);return row},
  findUnique:async({where})=>deployments.find(x=>x.id===where.id)||null,
  updateMany:async({where,data})=>{const row=deployments.find(x=>x.id===where.id&&(where.revision===undefined||x.revision===where.revision)&&x.challengeHash===where.challengeHash&&x.state===where.state&&(where.recoveryCount===undefined||x.recoveryCount<where.recoveryCount.lt));if(!row)return{count:0};if(data.state!==undefined)row.state=data.state;if(data.recoveryCount)row.recoveryCount+=data.recoveryCount.increment;else row.revision+=1;row.challengeHash=data.challengeHash;row.challengeExpiresAt=data.challengeExpiresAt;row.lastReportedAt=data.lastReportedAt;return{count:1}},
  findMany:async({where})=>deployments.filter(x=>x.deviceRegistrationId===where.deviceRegistrationId&&(!where.userId||x.userId===where.userId)).reverse(),
 },
 managedPackageDeviceReceipt:{create:async({data})=>{receiptEvents.push(data);return data}},
 $transaction:async fn=>fn(db),
};
const feedInput={userId:'user-1',deviceRegistrationId:'device-db-1',platform:'windows-x64',channel:'stable'};
await test('signed verified rollout appears in device feed',async()=>{const targets=await delivery.readDevicePackageTargets(db,feedInput);assert.equal(targets.length,1);assert.equal(targets[0].release.id,'r1');assert.equal(targets[0].installationState,'unknown');assert.equal(targets[0].signingPublicKeyPem,publicKeyPem);assert.equal(JSON.stringify(targets).includes('artifactBase64'),false)});
await test('without recipient entitlement rollout and pin confer no access',async()=>{recipientEntitled=false;assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);pin={packageId:'p1',deviceId:'device-db-1',releaseId:'r1',active:true};assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);pin=null;recipientEntitled=true});
await test('rollout percentage 0 blocks device',async()=>{policyRow.percentage=0;assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);policyRow.percentage=100});
await test('paused rollout blocks device',async()=>{policyRow.state='paused';assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);policyRow.state='active'});
await test('trusted pin overrides paused rollout',async()=>{policyRow.state='paused';pin={packageId:'p1',deviceId:'device-db-1',releaseId:'r1',active:true};const t=await delivery.readDevicePackageTargets(db,feedInput);assert.equal(t[0].selection,'device_pin');pin=null;policyRow.state='active'});
await test('wrong platform denied',async()=>assert.equal((await delivery.readDevicePackageTargets(db,{...feedInput,platform:'linux-x64'})).length,0));
await test('revoked release denied',async()=>{release.revokedAt=new Date();assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);release.revokedAt=null});
await test('disabled trusted signing key denied',async()=>{signingKey.disabledAt=new Date();assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);signingKey.disabledAt=null});
await test('tampered release manifest rejected from feed',async()=>{release.manifestJson=JSON.stringify({...manifest,version:'9.9.9'});assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);release.manifestJson=JSON.stringify(manifest)});
await test('mismatched source package identity rejected',async()=>{release.packageId='other';assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);release.packageId='p1'});
await test('archived packages excluded',async()=>{pkg.archivedAt=new Date();assert.equal((await delivery.readDevicePackageTargets(db,feedInput)).length,0);pkg.archivedAt=null});
const chain=()=>({min(){return this},max(){return this},regex(){return this},uuid(){return this},trim(){return this},int(){return this},default(){return this},positive(){return this},nullable(){return this},optional(){return this}});
const z={array:()=>chain(),object:()=>({...chain(),strict(){return this},parse:v=>v}),string:chain,number:chain,enum:()=>chain(),literal:()=>chain()};
const routes=load('apps/server/src/domains/inventory/managed-package-routes.ts',{'./managed-package-artifact-store.js': artifactStore, './managed-package-entitlements.js':{registerManagedPackageEntitlementRoutes:()=>{}},'./managed-package-segments.js': load('apps/server/src/domains/inventory/managed-package-segments.ts'), './managed-package-grants.js': {mintPackageDeploymentGrant:()=>{throw new Error('grant not configured in historical fixture')},readPackageDeploymentPrivateKey:()=>undefined},'zod':{z},'../sessions/device-proof.js':{requestDeviceProof:r=>r.proof},'./managed-package-policy.js':policy,'./managed-package-device.js':delivery,'./managed-package-deployments.js':receipts,'./managed-package-reconciliation.js':{projectPackageReconciliation:()=>({devices:[],counts:{}})}});
const handlers=new Map();
const app={get:(url,fn)=>handlers.set('GET '+url,fn),post:(url,first,second)=>handlers.set('POST '+url,second||first),put:(url,fn)=>handlers.set('PUT '+url,fn)};
routes.registerManagedPackageRoutes({app,prisma:db,getCurrentSession:async r=>r.session||null,authorization:{requireAdmin:async()=>null},requireConfirmation:()=>false,logSecurityEvent:async()=>null});
function reply(){return{status:200,headers:{},body:null,code(n){this.status=n;return this},header(k,v){this.headers[k]=v;return this},send(v){this.body=v;return this}}}
async function call(method,path,request={}){const handler=handlers.get(method+' '+path);assert.ok(handler,path);const rep=reply();const result=await handler({...request,session:request.session===undefined?{id:'session-1',userId:'user-1',deviceId:device.deviceId}:request.session,proof:request.proof===undefined?{verified:true,deviceId:device.deviceId,keyFingerprint:device.proofKeyFingerprint}:request.proof,query:request.query||{},body:request.body||{},params:request.params||{},headers:request.headers||{}},rep);if(rep.body===null)rep.body=result;return rep}
const feed='/api/me/packages/targets';const download='/api/me/packages/:id/releases/:releaseId/download';
const query={channel:'stable',platform:'windows-x64'};
await test('device feed refuses missing session',async()=>{const r=await call('GET',feed,{session:null,query});assert.equal(r.status,401)});
await test('device feed refuses missing proof',async()=>{const r=await call('GET',feed,{proof:null,query});assert.equal(r.status,403)});
await test('device feed refuses mismatched session binding',async()=>{const r=await call('GET',feed,{session:{id:'s',userId:'user-1',deviceId:'different'},query});assert.equal(r.status,403)});
await test('device feed refuses another user device',async()=>{const r=await call('GET',feed,{session:{userId:'another',deviceId:device.deviceId},query});assert.equal(r.status,403)});
await test('device feed refuses browser registration',async()=>{device.platform='web';const r=await call('GET',feed,{query});assert.equal(r.status,403);device.platform='desktop'});
await test('device feed refuses revoked registration',async()=>{device.revokedAt=new Date();const r=await call('GET',feed,{query});assert.equal(r.status,403);device.revokedAt=null});
await test('device feed refuses rotated proof key mismatch',async()=>{const r=await call('GET',feed,{proof:{verified:true,deviceId:device.deviceId,keyFingerprint:'rotated'},query});assert.equal(r.status,403)});
await test('device feed returns release without archive bytes',async()=>{const r=await call('GET',feed,{query});assert.equal(r.status,200);assert.equal(r.body.targets[0].release.id,'r1');assert.equal(r.body.nativeInstallationAvailable,false);assert.equal(r.body.targets[0].artifact,undefined)});
await test('signed device download returns exactly verified immutable ZIP and audit',async()=>{const before=events.length;const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'application/zip');assert.ok(Buffer.from(r.body).equals(bytes));assert.equal(r.headers['X-Cluster-Package-SHA256'],sha(bytes));assert.equal(events.length,before+1);assert.equal(events.at(-1).action,'artifact_device_offered');assert.ok(r.headers['X-Cluster-Package-Receipt-Challenge']);assert.ok(r.headers['X-Cluster-Package-Deployment-ID'])});
const resumeDownload='/api/me/packages/:id/releases/:releaseId/download/resume';
await test('G15 first ranged request creates one offer and returns exact verified bytes',async()=>{
 const previous=deployments.length;
 const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query,headers:{range:`bytes=0-${Math.min(31,bytes.length-1)}`}});
 assert.equal(r.status,206);assert.equal(r.headers['Content-Range'],`bytes 0-${Math.min(31,bytes.length-1)}/${bytes.length}`);
 assert.ok(Buffer.from(r.body).equals(bytes.subarray(0,Math.min(32,bytes.length))));
 assert.equal(deployments.length,previous+1);
 const base={params:{id:'p1',releaseId:'r1'},body:{...query,
  deploymentId:r.headers['X-Cluster-Package-Deployment-ID'],challenge:r.headers['X-Cluster-Package-Receipt-Challenge'],
  start:1,end:Math.min(31,bytes.length-1)}};
 const offers=deployments.length;
 const resumed=await call('POST',resumeDownload,base);
 assert.equal(resumed.status,206);assert.equal(resumed.headers['Content-Range'],`bytes 1-${base.body.end}/${bytes.length}`);
 assert.ok(Buffer.from(resumed.body).equals(bytes.subarray(1,base.body.end+1)));
 assert.equal(deployments.length,offers,'continuation must not create a new offer');
 recipientEntitled=false;
 const revoked=await call('POST',resumeDownload,base); assert.equal(revoked.status,404); recipientEntitled=true;
 device.revokedAt=new Date();
 const detached=await call('POST',resumeDownload,base);assert.equal(detached.status,403);device.revokedAt=null;
 release.revokedAt=new Date();
 const withdrawn=await call('POST',resumeDownload,base);assert.equal(withdrawn.status,404);release.revokedAt=null;
 const oldExpiry=deployments.at(-1).challengeExpiresAt;
 deployments.at(-1).challengeExpiresAt=new Date(Date.now()-1);
 const expired=await call('POST',resumeDownload,base);assert.equal(expired.status,403);
 deployments.at(-1).challengeExpiresAt=oldExpiry;
 const corrupt=await call('POST',resumeDownload,{...base,body:{...base.body,challenge:'A'.repeat(43)}});
 assert.equal(corrupt.status,403);
 const tooBig=await call('POST',resumeDownload,{...base,body:{...base.body,end:5*1024*1024}});
 assert.equal(tooBig.status,416);
 const missing=await call('POST',resumeDownload,{...base,body:{...base.body,deploymentId:'other-record'}});
 assert.equal(missing.status,403);
});
await test('G16 restart recovery reissues a challenge on the SAME device-bound deployment',async()=>{
 const issued=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query,headers:{range:'bytes=0-20'}});
 assert.equal(issued.status,206);
 const deploymentId=issued.headers['X-Cluster-Package-Deployment-ID'],oldChallenge=issued.headers['X-Cluster-Package-Receipt-Challenge'];
 const count=deployments.length;
 const recovered=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
  params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId,artifactSha256:sha(bytes)}});
 assert.equal(recovered.status,200);assert.equal(recovered.body.deploymentId,deploymentId);
 assert.notEqual(recovered.body.receiptChallenge,oldChallenge);assert.equal(deployments.length,count);
 const candidate={...query,deploymentId,start:1,end:20};
 const stale=await call('POST',resumeDownload,{params:{id:'p1',releaseId:'r1'},body:{...candidate,challenge:oldChallenge}});
 assert.equal(stale.status,403);
 const valid=await call('POST',resumeDownload,{params:{id:'p1',releaseId:'r1'},body:{...candidate,challenge:recovered.body.receiptChallenge}});
 assert.equal(valid.status,206);assert.ok(Buffer.from(valid.body).equals(bytes.subarray(1,21)));
 recipientEntitled=false;
 const revoked=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
  params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId,artifactSha256:sha(bytes)}});
 assert.equal(revoked.status,404);recipientEntitled=true;
 const denial=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
  params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId:'other',artifactSha256:sha(bytes)}});
 assert.equal(denial.status,403);
 device.revokedAt=new Date();
 const revokedDevice=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
  params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId,artifactSha256:sha(bytes)}});
 assert.equal(revokedDevice.status,403);device.revokedAt=null;
 for(let n=0;n<4;n++){
  const next=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
    params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId,artifactSha256:sha(bytes)}});
  assert.equal(next.status,200);
 }
 const excessive=await call('POST','/api/me/packages/:id/releases/:releaseId/download/recover',{
  params:{id:'p1',releaseId:'r1'},body:{...query,deploymentId,artifactSha256:sha(bytes)}});
 assert.equal(excessive.status,403);assert.equal(deployments.length,count);
});
await test('revoked user entitlement blocks download and positive device receipt',async()=>{recipientEntitled=false;const before=events.length;const denied=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(denied.status,404);assert.equal(events.length,before);recipientEntitled=true});
await test('wrong release URL cannot bypass rollout',async()=>{const r=await call('POST',download,{params:{id:'p1',releaseId:'attacker'},body:query});assert.equal(r.status,404)});
await test('wrong platform cannot download ZIP',async()=>{const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:{...query,platform:'linux-x64'}});assert.equal(r.status,404)});
await test('paused rollout cannot download ZIP',async()=>{policyRow.state='paused';const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(r.status,404);policyRow.state='active'});
await test('revoked release cannot download ZIP',async()=>{release.revokedAt=new Date();const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(r.status,404);release.revokedAt=null});
await test('stored artifact corruption denies delivery without success audit',async()=>{const before=events.length;release.artifact=Buffer.from('tampered');const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(r.status,409);assert.equal(r.body.code,'PACKAGE_ARTIFACT_INTEGRITY_FAILED');assert.equal(events.length,before);release.artifact=bytes});
await test('registration revoked between proof and transaction denies delivery',async()=>{const previous=db.$transaction;db.$transaction=async fn=>{device.revokedAt=new Date();return fn(db)};const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});assert.equal(r.status,403);db.$transaction=previous;device.revokedAt=null});
await test('signed ZIP rejects central/local method confusion',()=>{const bad=zip();const i=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.writeUInt16LE(8,i+10);assert.throws(()=>policy.inspectManagedPackageZip(bad),/HEADER_CONFLICT/)});
await test('signed ZIP rejects decompressed CRC mismatch',()=>{const bad=zip();bad[30+Buffer.byteLength('payload/install.txt')+1]^=0x01;assert.throws(()=>policy.inspectManagedPackageZip(bad),/PAYLOAD_INTEGRITY_FAILED/)});
await test('signed ZIP rejects flag-based data descriptors',()=>{const bad=zip();const i=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.writeUInt16LE(8,i+8);assert.throws(()=>policy.inspectManagedPackageZip(bad),/ENTRY_UNSUPPORTED/)});
await test('request policy preserves authentication boundary for device feed',()=>{const p=fs.readFileSync('apps/server/src/domains/access/request-policy.ts','utf8');assert.doesNotMatch(p,/\/api\/me\/packages[^\n]*public/);assert.match(fs.readFileSync('apps/server/src/app/cluster-server.ts','utf8'),/registerManagedPackageRoutes\(\{[^}]*getCurrentSession/)});
const receiptPath='/api/me/packages/deployments/:deploymentId/receipts';
let lease;
await test('download creates distinct expiring nonce-backed deployment lease',async()=>{
 const result=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});
 assert.equal(result.status,200);
 lease={id:result.headers['X-Cluster-Package-Deployment-ID'],challenge:result.headers['X-Cluster-Package-Receipt-Challenge'],revision:0};
 assert.ok(lease.id);assert.equal(lease.challenge.length,43);
 assert.equal(deployments.at(-1).challengeHash,receipts.packageReceiptChallengeHash(lease.challenge));
 assert.equal(deployments.at(-1).state,'offered');
});
const receiptInput=(state,other={})=>({...{
 eventId:'00000000-0000-4000-8000-000000000099',state,challenge:lease.challenge,expectedRevision:lease.revision,observedSha256:sha(bytes),detail:''
},...other});
const sendReceipt=(body,request={})=>call('POST',receiptPath,{params:{deploymentId:lease.id},body,...request});
await test('receipt wrong device proof rejected',async()=>{const r=await sendReceipt(receiptInput('artifact_verified'),{proof:null});assert.equal(r.status,403)});
await test('receipt mismatched sha denied without state change',async()=>{const r=await sendReceipt(receiptInput('artifact_verified',{observedSha256:'f'.repeat(64)}));assert.equal(r.status,409);assert.equal(deployments.at(-1).revision,0)});
await test('receipt cannot jump from offered to activated',async()=>{const r=await sendReceipt(receiptInput('activated'));assert.equal(r.status,409);assert.equal(deployments.at(-1).revision,0)});
await test('receipt denies unknown deployment',async()=>{const r=await call('POST',receiptPath,{params:{deploymentId:'another-device'},body:receiptInput('artifact_verified')});assert.equal(r.status,404)});
await test('verified receipt records an immutable device claim and rotates nonce',async()=>{
 const r=await sendReceipt(receiptInput('artifact_verified'));assert.equal(r.status,200);assert.equal(r.body.report.osAttested,false);
 assert.equal(r.body.report.evidence,'device_report');assert.equal(receiptEvents.at(-1).state,'artifact_verified');
 assert.equal(deployments.at(-1).state,'artifact_verified');assert.equal(r.body.revision,1);
 assert.notEqual(r.body.nextChallenge,lease.challenge);lease={...lease,challenge:r.body.nextChallenge,revision:1};
});
await test('used receipt challenge cannot replay',async()=>{const r=await sendReceipt(receiptInput('staged',{challenge:'A'.repeat(43),expectedRevision:0}));assert.equal(r.status,409)});
await test('withdrawn release prevents positive-stage report',async()=>{release.revokedAt=new Date();const r=await sendReceipt(receiptInput('staged'));assert.equal(r.status,409);release.revokedAt=null});
await test('staged report advances one revision',async()=>{const r=await sendReceipt(receiptInput('staged',{eventId:'00000000-0000-4000-8000-000000000100'}));assert.equal(r.status,200);lease={...lease,challenge:r.body.nextChallenge,revision:2};assert.equal(deployments.at(-1).state,'staged')});
await test('device can report failed after rollout paused',async()=>{policyRow.state='paused';const r=await sendReceipt(receiptInput('failed',{eventId:'00000000-0000-4000-8000-000000000101'}));assert.equal(r.status,200);policyRow.state='active';lease={...lease,challenge:r.body.nextChallenge,revision:3};assert.equal(deployments.at(-1).state,'failed')});
await test('failed deployment cannot masquerade as content rollback',async()=>{const r=await sendReceipt(receiptInput('rolled_back',{eventId:'00000000-0000-4000-8000-000000000102'}));assert.equal(r.status,409);assert.equal(deployments.at(-1).state,'failed')});
await test('reported state cannot be mistaken for OS attestation',async()=>{const r=await call('GET','/api/me/packages/deployments');assert.equal(r.status,200);assert.equal(r.body.deployments.at(-1).osAttested,false)});
await test('device delivery rate limit refuses excessive offers',async()=>{
 const before=deployments.length;
 while(deployments.length<20)deployments.push({id:'synthetic-'+deployments.length,deviceRegistrationId:device.id,userId:device.userId,offeredAt:new Date(),state:'offered'});
 const auditBefore=events.length;
 const r=await call('POST',download,{params:{id:'p1',releaseId:'r1'},body:query});
 assert.equal(r.status,429);assert.equal(r.body.code,'PACKAGE_DEVICE_DOWNLOAD_RATE_LIMITED');
 assert.equal(events.length,auditBefore);deployments.splice(before);
});
await test('device target feed annotates claims without attesting OS state',async()=>{
 deployments.push({id:'status-sample',packageId:'p1',releaseId:'r1',deviceRegistrationId:device.id,userId:device.userId,state:'content_selected',revision:3,lastReportedAt:new Date(),offeredAt:new Date()});
 const r=await call('GET',feed,{query});assert.equal(r.status,200);
 assert.equal(r.body.targets[0].installationState,'unknown');
 assert.equal(r.body.targets[0].deviceReported.state,'content_selected');assert.equal(r.body.targets[0].deviceReported.osAttested,false);
 deployments.pop();
});
console.log(`${checks.length}/${checks.length} device Package & ZIP integrity checks passed`);
