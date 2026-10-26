import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
const cwd=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch {const proc=spawnSync('npm',['root','-g'],{encoding:'utf8'}); return require(join(proc.stdout.trim(),'typescript'));}})();
function load(path,imports={}){
  const code=ts.transpileModule(readFileSync(join(cwd,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(code,{module:mod,exports:mod.exports,Buffer,Date,JSON,String,Number,Set,Map,Math,Promise,require:name=>imports[name]||(name === "./managed-package-seat-policy.js" ? {
    packageSeatEligibleIds: async (_db, ids) => ids,
    packageSeatEligibleUsers: async (_db, _pkg, ids) => ids,
    registerManagedPackageSeatRoutes: () => {},
  } : name === "./managed-package-readiness.js" ? {
    registerManagedPackageReadinessRoutes: () => {},
  } : null)||require(name)},{filename:path});
  return mod.exports;
}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const device=load('apps/server/src/domains/inventory/managed-package-device.ts',{'./managed-package-policy.js':policy});
const sha=x=>createHash('sha256').update(x).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'});
const fingerprint=policy.packageKeyFingerprint(pem);
const sample=(key,version,deps=[],suffix='')=>{
  const p={id:'id-'+key,key,title:key,archivedAt:null,description:''};
  const manifest={schema:1,packageKey:key,version,platform:'linux-x64',artifactSha256:'a'.repeat(64),artifactSize:200,filename:'assets.zip',...(deps.length?{dependencies:deps}:{})};
  const raw=policy.packageSigningInput(manifest);
  const release={id:'r-'+key+suffix,packageId:p.id,version,platform:'linux-x64',filename:'assets.zip',artifactSha256:manifest.artifactSha256,artifactSize:200,manifestJson:JSON.stringify(manifest),manifestSha256:sha(raw),signature:sign(null,raw,privateKey).toString('base64'),signingKeyFingerprint:fingerprint,publishedAt:new Date(),revokedAt:null};
  const roll={packageId:p.id,channel:'stable',releaseId:release.id,percentage:100,state:'active'};
  return {p,manifest,release,roll};
};
const dep=(packageKey,version)=>({packageKey,version,requirement:"content-selected"});
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name)}
const pick=(rows)=>device.projectDevicePackageTargets({packages:rows.map(x=>x.p),policies:rows.map(x=>x.roll),pins:[],releases:rows.map(x=>x.release),signingKeys:[{fingerprint,publicKeyPem:pem,disabledAt:null}]},{deviceRegistrationId:'device-1',platform:'linux-x64',channel:'stable'}).map(x=>x.package.key);
await test('signed version pins are accepted and visible to native clients',()=>{
 const base=sample('foundation-pkg','1.0.0'), app=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 assert.deepEqual(Array.from(pick([app,base])),['foundation-pkg','editor-tools']);
 assert.equal(app.manifest.dependencies[0].packageKey,'foundation-pkg');
});
await test('missing entitled dependency hides dependent target',()=>{
 const a=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 assert.deepEqual(Array.from(pick([a])),[]);
});
await test('wrong selected prerequisite version denies dependent target',()=>{
 const a=sample('foundation-pkg','2.0.0'),b=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 assert.deepEqual(Array.from(pick([a,b])),['foundation-pkg']);
});
await test('revoked prerequisite blocks dependent release',()=>{
 const a=sample('foundation-pkg','1.0.0'), b=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 a.release.revokedAt=new Date();
 assert.deepEqual(Array.from(pick([a,b])),[]);
});
await test('recursive dependencies order resolves only complete graphs',()=>{
 const a=sample('foundation-pkg','1.0.0'),b=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]),c=sample('studio-bundle','3.0.0',[dep('editor-tools','2.0.0')]);
 assert.deepEqual(Array.from(pick([a,b,c])),['foundation-pkg','editor-tools','studio-bundle']);
 a.roll.state='paused';
 assert.deepEqual(Array.from(pick([a,b,c])),[]);
});
await test('circular signed dependencies fail closed',()=>{
 const a=sample('foundation-pkg','1.0.0',[dep('editor-tools','2.0.0')]),b=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 assert.deepEqual(Array.from(pick([a,b])),[]);
});
await test('no self, repeated, malformed or empty declared dependencies',()=>{
 for(const entries of [[],[dep('studio-tools','1.0.0')],[dep('valid-dep','1.0.0'),dep('valid-dep','1.1.0')],[dep('../escape','1.0.0')],[dep('valid-dep','latest')]]){
  assert.throws(()=>policy.validatePackageDependencies({packageKey:'studio-tools',dependencies:entries}),/PACKAGE_DEPENDENCIES_INVALID/);
 }
});
await test('signed requirement type distinguishes selected content and installed MSI',()=>{
 const base={schema:1,packageKey:'studio-tools',platform:'linux-x64',dependencies:[dep('foundation-pkg','1.0.0')]};
 assert.equal(policy.validatePackageDependencies(base)[0].requirement,'content-selected');
 assert.throws(()=>policy.validatePackageDependencies({...base,dependencies:[{packageKey:'foundation-pkg',version:'1.0.0'}]}),/PACKAGE_DEPENDENCIES_INVALID/);
 assert.throws(()=>policy.validatePackageDependencies({...base,dependencies:[{...dep('foundation-pkg','1.0.0'),requirement:'msi-installed'}]}),/PACKAGE_DEPENDENCIES_INVALID/);
 const win={...base,platform:'windows-x64',installer:{kind:'windows-msi',path:'installer.msi',sha256:'a'.repeat(64),scope:'user',productCode:'{12345678-1234-ABCD-ABCD-1234567890AB}',productVersion:'1.0.0'},dependencies:[{...dep('foundation-pkg','1.0.0'),requirement:'msi-installed'}]};
 assert.equal(policy.validatePackageDependencies(win)[0].requirement,'msi-installed');
 assert.throws(()=>policy.validatePackageDependencies({...win,installer:undefined}),/PACKAGE_DEPENDENCIES_INVALID/);
 assert.throws(()=>policy.validatePackageDependencies({...win,dependencies:[{...win.dependencies[0],requirement:'unverified'}]}),/PACKAGE_DEPENDENCIES_INVALID/);
});
await test('device rollout preserves the signed MSI prerequisite type',()=>{
 const prerequisite=sample('foundation-pkg','2.0.0');
 const child=sample('editor-tools','3.0.0',[{packageKey:'foundation-pkg',version:'2.0.0',requirement:'msi-installed'}]);
 const installer={kind:'windows-msi',path:'setup/editor.msi',sha256:'b'.repeat(64),scope:'user',productCode:'{12345678-1234-ABCD-ABCD-1234567890AB}',productVersion:'2.0.0'};
 const respecify=(item,kind)=>{
   item.manifest.platform='windows-x64';
   if(kind==='msi')item.manifest.installer=installer;
   item.release.platform='windows-x64';
   item.release.manifestJson=JSON.stringify(item.manifest);
   const input=policy.packageSigningInput(item.manifest);
   item.release.manifestSha256=sha(input);
   item.release.signature=sign(null,input,privateKey).toString('base64');
 };
 respecify(prerequisite,'content');respecify(child,'msi');
 const select=rows=>device.projectDevicePackageTargets({packages:rows.map(x=>x.p),policies:rows.map(x=>x.roll),pins:[],releases:rows.map(x=>x.release),signingKeys:[{fingerprint,publicKeyPem:pem,disabledAt:null}]},{deviceRegistrationId:'device-1',platform:'windows-x64',channel:'stable'}).map(x=>x.package.key);
 assert.deepEqual(Array.from(select([prerequisite,child])),['foundation-pkg']);
 respecify(prerequisite,'msi');
 assert.deepEqual(Array.from(select([child,prerequisite])),['foundation-pkg','editor-tools']);
 child.manifest.installer=undefined;respecify(child,'content');
 assert.deepEqual(Array.from(select([prerequisite,child])),['foundation-pkg']);
});
await test('packageId-scoped read considers all entitled prerequisites first',async()=>{
 const a=sample('foundation-pkg','1.0.0'),b=sample('editor-tools','2.0.0',[dep('foundation-pkg','1.0.0')]);
 const set=[a,b];
 const db={user:{findUnique:async()=>({archived:false,accountState:'ACTIVE',accessExpiresAt:null})},
  managedPackageEntitlement:{findMany:async()=>set.map(x=>({packageId:x.p.id}))},
  managedPackage:{findMany:async()=>set.map(x=>x.p)},
  managedPackageRollout:{findMany:async()=>set.map(x=>x.roll)}, managedPackagePin:{findMany:async()=>[]},
  managedPackageRelease:{findMany:async()=>set.map(x=>x.release)},
  managedPackageSigningKey:{findMany:async()=>[{fingerprint,publicKeyPem:pem,disabledAt:null}]},
  managedPackageDeviceDeployment:{findMany:async()=>[]}};
 const targets=await device.readDevicePackageTargets(db,{userId:'user-1',deviceRegistrationId:'device-1',platform:'linux-x64',channel:'stable',packageId:b.p.id});
 assert.equal(targets.length,1);
 assert.equal(targets[0].package.key,'editor-tools');
});
await test('dependency manifest is signed in JS and verified unchanged by Go native',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cluster-g05-deps-'));
 const archive=join(dir,'assets.zip');
 // A minimal valid stored ZIP, preserving the exact ZIP CRC and central index.
 const name=Buffer.from('assets/readme.txt'), payload=Buffer.from('native signed dependency test');
 function crc32(bytes){let crc=~0;for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(~crc)>>>0}
 const crc=crc32(payload), local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(payload.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+payload.length,16);
 writeFileSync(archive,Buffer.concat([local,name,payload,central,name,end]));
 const {privateKey:signingPrivate,publicKey:signingPublic}=generateKeyPairSync('ed25519');
 const pemFile=join(dir,'private.pem'),outfile=join(dir,'release.json'),depsFile=join(dir,'deps.json');
 writeFileSync(pemFile,signingPrivate.export({format:'pem',type:'pkcs8'}));
 writeFileSync(depsFile,JSON.stringify([dep('foundation-pkg','1.0.0')]));
 const output=spawnSync('node',[join(cwd,'tools/scripts/cluster-package-sign.mjs'),pemFile,archive,'editor-tools','2.0.0','linux-x64',outfile,depsFile],{encoding:'utf8'});
 assert.equal(output.status,0,output.stderr);
 const envelope=JSON.parse(readFileSync(outfile,'utf8'));
 const signed=policy.validateSignedPackage({...envelope,publicKeyPem:signingPublic.export({format:'pem',type:'spki'})});
 assert.equal(signed.manifestSha256,sha(policy.packageSigningInput(envelope.manifest)));
 const manifestFile=join(dir,'manifest.json'),sigFile=join(dir,'signature.txt'),pubFile=join(dir,'public.pem');
 writeFileSync(manifestFile,JSON.stringify(envelope.manifest));
 writeFileSync(sigFile,envelope.signatureBase64);writeFileSync(pubFile,signingPublic.export({format:'pem',type:'spki'}));
 mkdirSync(join(dir,'root'));
 const native=spawnSync('go',['run','.','--action','stage','--archive',archive,'--manifest',manifestFile,'--signature',sigFile,'--public-key',pubFile,'--trusted-key-sha256',envelope.signingKeyFingerprint,'--root',join(dir,'root')],{cwd:join(cwd,'tools/native/package-stager-go'),encoding:'utf8',env:{...process.env,GOTOOLCHAIN:'local'}});
 assert.equal(native.status,0,native.stderr);
 assert.match(native.stdout,/verified_staged_not_installed/);
});
console.log(`${count}/${count} TD6 G05 signed dependency integration checks passed`);
