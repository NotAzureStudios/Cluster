#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url); const ts=require('typescript');
function load(p) {
 const js=ts.transpileModule(readFileSync(join(root,p),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,Buffer,Date,JSON,Number,String,Math,Set,Map,process,require},{filename:p});
 return mod.exports;
}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const grants=load('apps/server/src/domains/inventory/managed-package-grants.ts');
const sha=x=>createHash('sha256').update(x).digest('hex');
let count=0;
function check(name,fn){fn(); count++;console.log('PASS',name);}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function zipOne(name,payload){const n=Buffer.from(name), local=Buffer.alloc(30), central=Buffer.alloc(46),end=Buffer.alloc(22),crc=crc32(payload);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(n.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(payload.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(n.length,28);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+payload.length,16);
 return Buffer.concat([local,n,payload,central,n,end]);}
const dir=mkdtempSync(join(tmpdir(),'cluster-g11-msi-'));
const body=Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.from('not real MSI, signing format fixture')]);
const installer={kind:'windows-msi',path:'install/editor.msi',sha256:sha(body),scope:'user',productCode:'{12345678-1234-ABCD-ABCD-1234567890AB}',productVersion:'1.0.0'};
const zip=zipOne(installer.path,body),zipPath=join(dir,'package.zip'),instPath=join(dir,'msi.json');
writeFileSync(zipPath,zip);writeFileSync(instPath,JSON.stringify(installer));
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const pem=join(dir,'key.pem'),out=join(dir,'signed.json');
writeFileSync(pem,privateKey.export({type:'pkcs8',format:'pem'}));
const signResult=spawnSync(process.execPath,[join(root,'tools/scripts/cluster-package-sign.mjs'),pem,zipPath,'studio-tools','1.0.0','windows-x64',out,'-',instPath],{encoding:'utf8'});
check('offline signer supports optional signed Windows MSI declarations',()=>assert.equal(signResult.status,0,signResult.stderr));
const envelope=JSON.parse(readFileSync(out,'utf8'));
check('server accepts verified installer bytes and signature',()=>{
 const signed=policy.validateSignedPackage({...envelope,publicKeyPem:publicKey.export({format:'pem',type:'spki'})});
 assert.equal(signed.manifestSha256,sha(policy.packageSigningInput(envelope.manifest)));
 assert.equal(envelope.manifest.installer.sha256,sha(body));
});
check('installer manifest is covered by Ed25519 signature',()=>{
 const changed={...envelope.manifest,installer:{...installer,scope:'machine'}};
 assert.equal(verify(null,policy.packageSigningInput(changed),publicKey,Buffer.from(envelope.signatureBase64,'base64')),false);
});
check('wrong member bytes are rejected before publication',()=>{
 const changed=zipOne(installer.path,Buffer.from('not MSI'));
 const candidate={...envelope,manifest:{...envelope.manifest,artifactSize:changed.length,artifactSha256:sha(changed)},artifactBase64:changed.toString('base64')};
 assert.throws(()=>policy.validateSignedPackage({...candidate,publicKeyPem:publicKey.export({format:'pem',type:'spki'})}),/INSTALLER_BYTES/);
});
check('unsafe paths and unsupported MSI scopes are rejected',()=>{
 for(const value of [{...installer,path:'../bad.msi'}, {...installer,path:'install/script.exe'}, {...installer,scope:'machine'}, {...installer,sha256:'b'.repeat(64)}, {...installer,kind:'shell'}]){
  // A wrong SHA is valid declarative syntax; archive consistency catches it.
  if(value.sha256!==installer.sha256) continue;
  assert.throws(()=>policy.validatePackageInstaller({...envelope.manifest,installer:value}),/PACKAGE_INSTALLER_MANIFEST_INVALID/);
 }
});
check('installer declarations are rejected on other platforms',()=>assert.throws(()=>policy.validatePackageInstaller({...envelope.manifest,platform:'linux-x64'}),/PACKAGE_INSTALLER_MANIFEST_INVALID/));
check('standard content-only releases remain valid',()=>assert.equal(policy.validatePackageInstaller({...envelope.manifest,installer:undefined}),null));
check('server signs a distinct, short-lived install grant',()=>{
 const approved=grants.mintPackageDeploymentGrant({operation:'install',packageKey:'studio-tools',version:'1.0.0',platform:'windows-x64',artifactSha256:envelope.manifest.artifactSha256,signingKeySha256:envelope.signingKeyFingerprint,releaseId:'r',registrationId:'d',userId:'u'},privateKey.export({type:'pkcs8',format:'pem'}),Date.now());
 const payload=JSON.parse(Buffer.from(approved.payloadBase64url,'base64url').toString());
 assert.equal(payload.operation,'install');assert.equal(payload.expiresAt-payload.issuedAt,60);
 const signature=Buffer.from(approved.signatureBase64url,'base64url');
 assert.equal(verify(null,Buffer.concat([Buffer.from(grants.PACKAGE_GRANT_CONTEXT),Buffer.from(approved.payloadBase64url,'base64url')]),publicKey,signature),true);
});
check('the native action cannot be confused with deploy-content',()=>{
 const cpp=readFileSync(join(root,'apps/desktop-qt/src/NativeCapabilityBroker.cpp'),'utf8');
 const native=readFileSync(join(root,'tools/native/package-stager-go/main.go'),'utf8');
 const route=readFileSync(join(root,'apps/server/src/domains/inventory/managed-package-routes.ts'),'utf8');
 assert.match(cpp,/package\.installMsi/);assert.match(cpp,/INSTALL %1/);assert.match(native,/case "install-msi"/);
 assert.match(route,/CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL/);assert.match(route,/await admin\(request, reply\)/);
});
console.log(`${count}/${count} TD6 G11 signed installer checks passed`);
