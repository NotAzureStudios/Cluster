#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);const ts=require('typescript');
function load(file){const src=readFileSync(join(root,file),'utf8');const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const mod={exports:{}};vm.runInNewContext(js,{module:mod,exports:mod.exports,require,Buffer,Date,JSON,Number,Math,Set,Map,process},{filename:file});return mod.exports;}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const sha=x=>createHash('sha256').update(x).digest('hex');
const guid='{12345678-1234-ABCD-ABCD-1234567890AB}';
const installer={kind:'windows-msi',path:'install/tool.msi',sha256:'a'.repeat(64),scope:'user',productCode:guid,productVersion:'2.3.4'};
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name)}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function zipOne(name,payload){const n=Buffer.from(name),l=Buffer.alloc(30),c=Buffer.alloc(46),e=Buffer.alloc(22),crc=crc32(payload);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);l.writeUInt32LE(payload.length,18);l.writeUInt32LE(payload.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(payload.length,20);c.writeUInt32LE(payload.length,24);c.writeUInt16LE(n.length,28);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(c.length+n.length,12);e.writeUInt32LE(l.length+n.length+payload.length,16);return Buffer.concat([l,n,payload,c,n,e]);}
const payload=Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.from('test fixture only, not installable')]);
installer.sha256=sha(payload);
const dir=mkdtempSync(join(tmpdir(),'cluster-g13-')), zipPath=join(dir,'archive.zip'),keyPath=join(dir,'private.pem'),installerPath=join(dir,'installer.json'),out=join(dir,'envelope.json');
writeFileSync(zipPath,zipOne(installer.path,payload));writeFileSync(installerPath,JSON.stringify(installer));
const keys=generateKeyPairSync('ed25519');writeFileSync(keyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}));
const sign=()=>spawnSync(process.execPath,[join(root,'tools/scripts/cluster-package-sign.mjs'),keyPath,zipPath,'studio-tool','2.3.4','windows-x64',out,'-',installerPath],{encoding:'utf8'});
test('offline signer requires canonical identity and exact MSI version',()=>assert.equal(sign().status,0,sign().stderr));
const envelope=JSON.parse(readFileSync(out,'utf8'));
const pub=keys.publicKey.export({type:'spki',format:'pem'});
test('server verifies signed MSI identity and exact member bytes',()=>{
 const result=policy.validateSignedPackage({...envelope,publicKeyPem:pub});assert.equal(result.manifestSha256,sha(policy.packageSigningInput(envelope.manifest)));assert.equal(envelope.manifest.installer.productCode,guid);
});
test('changing ProductCode or ProductVersion invalidates original signature',()=>{
 for(const update of [{productCode:'{87654321-1234-ABCD-ABCD-1234567890AB}'},{productVersion:'2.3.5'}]){
  const changed={...envelope.manifest,installer:{...envelope.manifest.installer,...update}};
  assert.equal(verify(null,policy.packageSigningInput(changed),keys.publicKey,Buffer.from(envelope.signatureBase64,'base64')),false);
  assert.throws(()=>policy.validateSignedPackage({...envelope,manifest:changed,publicKeyPem:pub}),/PACKAGE_SIGNATURE_INVALID/);
 }
});
test('missing or noncanonical MSI product identity fails closed',()=>{
 for(const mutation of [{productCode:undefined},{productCode:'{12345678-1234-abcd-ABCD-1234567890AB}'},{productCode:'../secret'},{productVersion:'2.3-beta'},{productVersion:undefined},{productVersion:'2.3.4.5'}]){
  assert.throws(()=>policy.validatePackageInstaller({...envelope.manifest,installer:{...installer,...mutation}}),/PACKAGE_INSTALLER_MANIFEST_INVALID/);
 }
});
test('unknown installer manifest keys are rejected',()=>assert.throws(()=>policy.validatePackageInstaller({...envelope.manifest,installer:{...installer,powershell:'yes'}}),/PACKAGE_INSTALLER_MANIFEST_INVALID/));
test('content-only Packages do not acquire installer privileges',()=>assert.equal(policy.validatePackageInstaller({...envelope.manifest,installer:undefined}),null));
test('Go, Qt and Desktop keep OS inventory strictly read-only',()=>{
 const go=readFileSync(join(root,'tools/native/package-stager-go/msi_product_windows.go'),'utf8');const qt=readFileSync(join(root,'apps/desktop-qt/src/NativeCapabilityBroker.cpp'),'utf8');const ui=readFileSync(join(root,'packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),'utf8');
 assert.match(go,/MsiQueryProductStateW/);assert.match(go,/MsiGetProductInfoW/);assert.doesNotMatch(go,/MsiConfigureProduct|MsiInstallProduct/);
 assert.match(qt,/msiProduct/);assert.match(ui,/Local receipt belongs to a different release|local receipt belongs to a different release/);
});
test('non-installer Package grants remain separate from MSI OS inventory',()=>{
 const route=readFileSync(join(root,'apps/server/src/domains/inventory/managed-package-routes.ts'),'utf8');
 assert.match(route,/CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL/);assert.match(route,/z\.string\(\), productVersion: z\.string\(\)/);
});
console.log(`${passed}/${passed} TD6 G13 product-identity integration checks passed`);
