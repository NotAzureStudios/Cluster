import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const checks=[];
function load(file,mocks={}){
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:(name)=>name in mocks?mocks[name]:(name === "./managed-package-seat-policy.js" ? {
    packageSeatEligibleIds: async (_db, ids) => ids,
    packageSeatEligibleUsers: async (_db, _pkg, ids) => ids,
    registerManagedPackageSeatRoutes: () => {},
  } : name === "./managed-package-readiness.js" ? {
    registerManagedPackageReadinessRoutes: () => {},
  } : null)||require(name),Buffer,Date,JSON,String,Number,Set,Map,Math},{filename:file});
 return module.exports;
}
function test(name,fn){fn();checks.push(name);console.log('PASS',name)}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const artifactStore = load('apps/server/src/domains/inventory/managed-package-artifact-store.ts', {'./managed-package-policy.js': policy});
const sha=(input)=>createHash('sha256').update(input).digest('hex');
function crc32(data){let crc=~0;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(~crc)>>>0}
function zip(name='install/readme.txt',content=Buffer.from('package')){
 const label=Buffer.from(name), len=content.length,crc=crc32(content);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(len,18);local.writeUInt32LE(len,22);local.writeUInt16LE(label.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(len,20);central.writeUInt32LE(len,24);central.writeUInt16LE(label.length,28);
 const offset=local.length+label.length+len, size=central.length+label.length;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([local,label,content,central,label,end]);
}
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
function envelope(bytes=zip(),key='cluster-tools',version='1.2.3') {
 const manifest={schema:1,packageKey:key,version,platform:'windows-x64',artifactSha256:sha(bytes),artifactSize:bytes.length,filename:'cluster-tools.zip'};
 return {manifest,artifactBase64:bytes.toString('base64'),signatureBase64:sign(null,policy.packageSigningInput(manifest),privateKey).toString('base64'),publicKeyPem,signingKeyFingerprint:policy.packageKeyFingerprint(publicKeyPem)};
}
const signed=envelope();
test('verified Ed25519 signed ZIP and stable canonical manifest',()=>{
 const result=policy.validateSignedPackage(signed);assert.equal(result.keyFingerprint,signed.signingKeyFingerprint);assert.equal(result.manifestJson,JSON.stringify(signed.manifest));assert.equal(result.bytes.length,signed.manifest.artifactSize);
});
test('ZIP index parser returns bounded expansion',()=>assert.equal(policy.inspectManagedPackageZip(zip()).files,1));
test('rejects unsigned artifact mutation',()=>assert.throws(()=>policy.validateSignedPackage({...signed,artifactBase64:zip('wrong.txt').toString('base64')}),/INTEGRITY|ENCODING/));
test('rejects mismatched signature even on a correctly hashed payload',()=>assert.throws(()=>policy.validateSignedPackage({...envelope(zip('valid.txt')),signatureBase64:signed.signatureBase64}),/SIGNATURE/));
test('rejects path traversal in signed ZIP',()=>assert.throws(()=>policy.validateSignedPackage(envelope(zip('../secret.txt'))),/PATH_UNSAFE/));
test('rejects Windows slash path traversal in ZIP',()=>assert.throws(()=>policy.validateSignedPackage(envelope(zip('..\\secret.txt'))),/PATH_UNSAFE/));
test('rejects ZIP pretending to be ZIP with only a magic prefix',()=>assert.throws(()=>policy.validateSignedPackage(envelope(Buffer.from('PK\x03\x04broken'))),/PACKAGE_/));
test('rejects untrusted RSA public key',()=>{const {publicKey:other}=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>policy.packageKeyFingerprint(other.export({format:'pem',type:'spki'})),/UNSUPPORTED/)});
test('rejects invalid package identity and malformed version',()=>assert.throws(()=>policy.validateSignedPackage(envelope(zip(),'oops/evil','1.2.3')),/MANIFEST_INVALID/));
test('rejects archive declaration with zip bomb expansion',()=>{const bad=zip();const central=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.writeUInt32LE(128*1024*1024,central+24);assert.throws(()=>policy.validateSignedPackage(envelope(bad)),/EXPANSION_UNSAFE/)});
test('rejects a ZIP symbolic link',()=>{const bad=zip();const c=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.writeUInt32LE((0xa1ff<<16)>>>0,c+38);assert.throws(()=>policy.validateSignedPackage(envelope(bad)),/SPECIAL_FILE_UNSUPPORTED/)});
test('rejects ZIP encryption',()=>{const bad=zip();const c=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.writeUInt16LE(1,c+8);assert.throws(()=>policy.validateSignedPackage(envelope(bad)),/ENTRY_UNSUPPORTED/)});
test('zero rollout blocks and 100 percent permits',()=>{assert.equal(policy.eligibleForPackageRollout('a','b',0),false);assert.equal(policy.eligibleForPackageRollout('a','b',100),true)});
test('same device always falls in same rollout cohort',()=>assert.equal(policy.eligibleForPackageRollout('abc','dev_777',21),policy.eligibleForPackageRollout('abc','dev_777',21)));
test('rollout rejects fractional percentages',()=>assert.throws(()=>policy.eligibleForPackageRollout('a','b',34.1),/INVALID/));
test('paused rollout fails closed',()=>assert.equal(policy.selectPackageTarget({packageId:'a',deviceId:'dev',platform:'windows-x64',policy:{state:'paused',percentage:100,releaseId:'r'},release:{id:'r',platform:'windows-x64'}}),null));
test('pins override paused rollout only for matching platform',()=>{const input={packageId:'a',deviceId:'dev',platform:'windows-x64',policy:{state:'paused',percentage:0,releaseId:'r'},pinned:{id:'old',platform:'windows-x64'}};assert.equal(policy.selectPackageTarget(input),'old');assert.equal(policy.selectPackageTarget({...input,platform:'macos-arm64'}),null)});
test('revoked rollout release is ineligible',()=>assert.equal(policy.selectPackageTarget({packageId:'a',deviceId:'dev',platform:'windows-x64',policy:{state:'active',percentage:100,releaseId:'r'},release:{id:'r',platform:'windows-x64',revokedAt:new Date()}}),null));
// These assertions prevent registry/UI/schema drift without pretending to exercise PostgreSQL.
const src=fs.readFileSync('apps/server/src/domains/inventory/managed-package-routes.ts','utf8');
const schema=fs.readFileSync('apps/server/prisma/schema.prisma','utf8');
const migration=fs.readFileSync('apps/server/prisma/migrations/20261009040000_managed_package_catalogue/migration.sql','utf8');
test('all publication and mutation routes are under administrative policy',()=>{assert.match(src,/\/api\/admin\/packages\/signing-keys/);assert.match(src,/\/api\/admin\/packages\/:id\/releases/);assert.match(src,/authorization\.requireAdmin/);});
test('OS installation is separately gated and has no server-side executable path',()=>{assert.match(src,/nativeInstallationAvailable: process\.env\.CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL/);assert.match(src,/PACKAGE_MSI_INSTALL_DISABLED/);assert.doesNotMatch(src,/child_process|execFile|spawn\(/)});
test('Prisma schema and migration contain all Package authorities',()=>{for(const name of ['ManagedPackageSigningKey','ManagedPackage','ManagedPackageRelease','ManagedPackageRollout','ManagedPackagePin','ManagedPackageAuditEvent']){assert.match(schema,new RegExp('model '+name+'\\s*\\{'));assert.match(migration,new RegExp('CREATE TABLE "'+name+'"'));}});
test('rollout and pin revisions use compare and swap transactions',()=>{assert.match(src,/isolationLevel: "Serializable"/);assert.match(src,/revision: body\.expectedRevision/);assert.match(src,/PACKAGE_PIN_REVISION_CONFLICT/)});
test('UI integrates Packages in Studio Systems without separate navigation',()=>{const ui=fs.readFileSync('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx','utf8');assert.match(ui,/StudioManagedPackagesPanel/);assert.match(ui,/value: "packages"/)});
console.log(`${checks.length}/${checks.length} managed Package checks passed`);

// Execute the real registered route closures against a small transactional fake.
// This is contract coverage, not a substitute for a live Prisma/PostgreSQL test.
const chain=()=>({min(){return this},max(){return this},regex(){return this},uuid(){return this},trim(){return this},int(){return this},default(){return this},positive(){return this},nullable(){return this},optional(){return this}});
const z={array:()=>chain(),object:()=>({strict(){return this},optional(){return this},parse:v=>v}),string:chain,number:chain,enum:()=>chain(),literal:()=>chain()};
const routeModule=load('apps/server/src/domains/inventory/managed-package-routes.ts',{'./managed-package-artifact-store.js': artifactStore, './managed-package-entitlements.js':{registerManagedPackageEntitlementRoutes:()=>{}},'./managed-package-segments.js': load('apps/server/src/domains/inventory/managed-package-segments.ts'), './managed-package-grants.js': {mintPackageDeploymentGrant:()=>{throw new Error('grant not configured in historical fixture')},readPackageDeploymentPrivateKey:()=>undefined},'zod':{z},'./managed-package-policy.js':policy,'./managed-package-deployments.js':load('apps/server/src/domains/inventory/managed-package-deployments.ts'),'./managed-package-reconciliation.js':{projectPackageReconciliation:()=>({devices:[],counts:{}})},'../sessions/device-proof.js':{requestDeviceProof:()=>null},'./managed-package-device.js':{devicePackageQuery:{channels:['stable','beta','testing'],platforms:['windows-x64','linux-x64','macos-arm64']},readDevicePackageTargets:async()=>[]}});
function fakeDb(){
 const keys=new Map(),pkgs=new Map(),releases=new Map(),rollouts=new Map(),pins=new Map(),devices=new Map(),events=[];
 let sequence=0;const id=()=>String(++sequence);
 const select=(value,keys)=>{if(!value)return null;if(!keys)return value;return Object.fromEntries(Object.keys(keys).filter(k=>k in value).map(k=>[k,value[k]]))};
 const db={
  deviceRegistration:{findUnique:async({where,select:projection})=>select(devices.get(where.id),projection)},
  managedPackageSigningKey:{findUnique:async({where,select:projection})=>select(keys.get(where.fingerprint),projection),findMany:async()=>[...keys.values()],create:async({data,select:projection})=>{const key={...data,disabledAt:null,createdAt:new Date()};keys.set(key.fingerprint,key);return select(key,projection)},updateMany:async({where,data})=>{const current=keys.get(where.fingerprint);if(!current||current.disabledAt)return {count:0};Object.assign(current,data);return {count:1}}},
  managedPackage:{findUnique:async({where,select:projection})=>select(pkgs.get(where.id),projection),findMany:async()=>[...pkgs.values()],create:async({data,select:projection})=>{const row={id:id(),...data,archivedAt:null,createdAt:new Date()};pkgs.set(row.id,row);return select(row,projection)}},
  managedPackageRelease:{findFirst:async({where,select:projection})=>select([...releases.values()].find(r=>r.id===where.id&&r.packageId===where.packageId),projection),findUnique:async({where,select:projection})=>select(releases.get(where.id),projection),findMany:async({where})=>[...releases.values()].filter(r=>r.signingKeyFingerprint===where.signingKeyFingerprint&&!r.revokedAt).map(r=>({id:r.id})),create:async({data,select:projection})=>{const row={id:id(),...data,revokedAt:null,publishedAt:new Date(),revocationReason:null};releases.set(row.id,row);return select(row,projection)},updateMany:async({where,data})=>{let count=0;for(const r of releases.values())if((!where.id||r.id===where.id)&&(!where.packageId||r.packageId===where.packageId)&&(!where.signingKeyFingerprint||r.signingKeyFingerprint===where.signingKeyFingerprint)&&!r.revokedAt){Object.assign(r,data);count++}return {count}}},
  managedPackageRollout:{findUnique:async({where,include})=>{const row=rollouts.get(where.packageId_channel.packageId+'#'+where.packageId_channel.channel)||null;return row&&include?{...row,release:releases.get(row.releaseId)}:row},create:async({data})=>{const row={id:id(),revision:1,...data};rollouts.set(data.packageId+'#'+data.channel,row);return row},updateMany:async({where,data})=>{let count=0;for(const r of rollouts.values())if((!where.id||r.id===where.id)&&(!where.releaseId||where.releaseId===r.releaseId||where.releaseId.in?.includes(r.releaseId))&&(!where.revision||where.revision===r.revision)){for(const [k,v]of Object.entries(data))r[k]=k==='revision'&&v?.increment?r.revision+v.increment:v;count++}return {count}}},
  managedPackagePin:{findUnique:async({where,include})=>{const row=pins.get(where.packageId_deviceId.packageId+'#'+where.packageId_deviceId.deviceId)||null;return row&&include?{...row,release:releases.get(row.releaseId)}:row},create:async({data})=>{const row={id:id(),active:true,revision:1,...data};pins.set(data.packageId+'#'+data.deviceId,row);return row},updateMany:async({where,data})=>{let count=0;for(const pin of pins.values())if((!where.id||pin.id===where.id)&&(!where.packageId||pin.packageId===where.packageId)&&(!where.deviceId||pin.deviceId===where.deviceId)&&(!where.releaseId||where.releaseId.in?.includes(pin.releaseId)||pin.releaseId===where.releaseId)&&(where.active===undefined||pin.active===where.active)&&(!where.revision||where.revision===pin.revision)){for(const [k,v]of Object.entries(data))pin[k]=k==='revision'&&v?.increment?pin.revision+v.increment:v;count++}return {count}}},
  managedPackageAuditEvent:{create:async({data})=>{events.push({...data,createdAt:new Date()});return data},findMany:async()=>events},
  $transaction:async(fn)=>fn(db),
 };
 return {db,keys,pkgs,releases,rollouts,pins,devices,events};
}
const state=fakeDb(),handlers=new Map(), security=[];
const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,options,fn)=>handlers.set('POST '+path,fn||options),put:(path,fn)=>handlers.set('PUT '+path,fn)};
let actingAdmin=true;
routeModule.registerManagedPackageRoutes({app,prisma:state.db,authorization:{requireAdmin:async(_request,reply)=>{if(!actingAdmin){reply.code(403).send({ok:false});return null}return{id:'operator'}}},requireConfirmation:(request,reply,expected)=>{if(request.headers?.['x-cluster-confirmation']!==expected){reply.code(412).send({ok:false});return false}return true},logSecurityEvent:async(event)=>security.push(event)});
const reply=()=>({status:200,body:null,headers:{},code(n){this.status=n;return this},send(v){this.body=v;return this},header(k,v){this.headers[k]=v;return this}});
async function call(method,path,params={},body={},headers={},query={}){const fn=handlers.get(`${method} ${path}`);assert.ok(fn,path);const response=reply();const result=await fn({params,body,headers,query},response);response.body??=result;return response;}
const trustPath='/api/admin/packages/signing-keys',pkgPath='/api/admin/packages';
async function routeTest(label,fn){await fn();checks.push(label);console.log('PASS',label)}
await routeTest('missing confirmation blocks key trust',async()=>{const r=await call('POST',trustPath,{}, {label:'trusted',publicKeyPem});assert.equal(r.status,412);assert.equal(state.keys.size,0)});
await routeTest('non-admin cannot create package',async()=>{actingAdmin=false;const r=await call('POST',pkgPath,{}, {key:'cluster-tools',title:'Cluster Tools'});assert.equal(r.status,403);actingAdmin=true;assert.equal(state.pkgs.size,0)});
await routeTest('trusted key enrollment creates an audited fingerprint',async()=>{const r=await call('POST',trustPath,{},{label:'trusted',publicKeyPem},{'x-cluster-confirmation':'TRUST PACKAGE KEY'});assert.equal(r.status,201);assert.equal(r.body.key.fingerprint,signed.signingKeyFingerprint);assert.equal(state.events.at(-1).action,'key_trusted')});
let pkgId='',releaseId='';
await routeTest('package registration is audited',async()=>{const r=await call('POST',pkgPath,{},{key:'cluster-tools',title:'Cluster Tools',description:''});assert.equal(r.status,201);pkgId=r.body.package.id;assert.equal(state.events.at(-1).action,'package_created')});
const releasePath='/api/admin/packages/:id/releases';
await routeTest('bad signature rejected before database storage',async()=>{const r=await call('POST',releasePath,{id:pkgId},{...signed,signatureBase64:'A'.repeat(86)+'=='});assert.equal(r.status,400);assert.equal(state.releases.size,0)});
await routeTest('valid signed release stores immutable bytes and audit',async()=>{const {publicKeyPem:discard,...body}=signed;const r=await call('POST',releasePath,{id:pkgId},body);assert.equal(r.status,201);releaseId=r.body.release.id;assert.deepEqual(Buffer.from(state.releases.get(releaseId).artifact),Buffer.from(signed.artifactBase64,'base64'));assert.equal(state.events.at(-1).action,'release_published')});
const rolloutPath='/api/admin/packages/:id/rollouts';
await routeTest('rollout requires observed revision',async()=>{const r=await call('PUT',rolloutPath,{id:pkgId},{channel:'stable',releaseId,percentage:100,state:'active',expectedRevision:1});assert.equal(r.status,409);assert.equal(state.rollouts.size,0)});
await routeTest('rollout 0->1 persists active policy',async()=>{const r=await call('PUT',rolloutPath,{id:pkgId},{channel:'stable',releaseId,percentage:100,state:'active',expectedRevision:0});assert.equal(r.body.rollout.revision,1);assert.equal(state.rollouts.size,1)});
await routeTest('stale rollout revision blocked and old state preserved',async()=>{const r=await call('PUT',rolloutPath,{id:pkgId},{channel:'stable',releaseId,percentage:0,state:'paused',expectedRevision:0});assert.equal(r.status,409);assert.equal(state.rollouts.get(pkgId+'#stable').state,'active')});
await routeTest('unknown device preview fails closed',async()=>{const r=await call('GET','/api/admin/packages/:id/targets/:deviceId',{id:pkgId,deviceId:'device_123'}, {},{}, {platform:'windows-x64',channel:'stable'});assert.equal(r.body.selected,null);assert.equal(r.body.trustedDevice,false)});
await routeTest('unverified device cannot acquire a version pin',async()=>{const r=await call('PUT','/api/admin/packages/:id/pins',{id:pkgId},{deviceId:'device_123',releaseId,expectedRevision:0,reason:'Assign a trial device'});assert.equal(r.status,409);assert.equal(r.body.code,'PACKAGE_DEVICE_NOT_VERIFIED')});
await routeTest('verified registration enables preview and pin',async()=>{state.devices.set('device_123',{id:'device_123',proofStatus:'verified',revokedAt:null});const r=await call('GET','/api/admin/packages/:id/targets/:deviceId',{id:pkgId,deviceId:'device_123'}, {},{}, {platform:'windows-x64',channel:'stable'});assert.equal(r.body.selected.id,releaseId);assert.equal(r.body.trustedDevice,true);const pin=await call('PUT','/api/admin/packages/:id/pins',{id:pkgId},{deviceId:'device_123',releaseId,expectedRevision:0,reason:'Required by studio rollout'});assert.equal(pin.body.pin.active,true);assert.equal(state.events.at(-1).action,'pin_changed')});
await routeTest('revoked registration blocks targeting and new pin writes',async()=>{state.devices.get('device_123').revokedAt=new Date();const preview=await call('GET','/api/admin/packages/:id/targets/:deviceId',{id:pkgId,deviceId:'device_123'}, {},{}, {platform:'windows-x64',channel:'stable'});assert.equal(preview.body.selected,null);const pin=await call('PUT','/api/admin/packages/:id/pins',{id:pkgId},{deviceId:'device_123',releaseId,expectedRevision:1,reason:'Should not be permitted'});assert.equal(pin.status,409);assert.equal(pin.body.code,'PACKAGE_DEVICE_NOT_VERIFIED');state.devices.get('device_123').revokedAt=null});
await routeTest('release revocation fails without privileged confirmation',async()=>{const r=await call('POST','/api/admin/packages/:id/releases/:releaseId/revoke',{id:pkgId,releaseId},{reason:'Compromised installer'});assert.equal(r.status,412)});
await routeTest('revocation pauses rollout and blocks target preview',async()=>{const r=await call('POST','/api/admin/packages/:id/releases/:releaseId/revoke',{id:pkgId,releaseId},{reason:'Compromised installer'},{'x-cluster-confirmation':'REVOKE PACKAGE RELEASE'});assert.equal(r.body.ok,true);assert.equal(state.rollouts.get(pkgId+'#stable').state,'paused');const preview=await call('GET','/api/admin/packages/:id/targets/:deviceId',{id:pkgId,deviceId:'device_123'}, {},{}, {platform:'windows-x64',channel:'stable'});assert.equal(preview.body.selected,null)});
await routeTest('revoked release cannot be downloaded',async()=>{const r=await call('GET','/api/admin/packages/:id/releases/:releaseId/artifact',{id:pkgId,releaseId});assert.equal(r.status,404)});
await routeTest('People offboarding drops active device pins within its access-revocation transaction',async()=>{const offboarding=fs.readFileSync('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts','utf8');assert.match(offboarding,/tx\.managedPackagePin\.updateMany/);assert.match(offboarding,/packagePinsRevoked/);assert.match(offboarding,/activePackagePinCount/)});
console.log(`${checks.length}/${checks.length} total managed Package checks passed`);
