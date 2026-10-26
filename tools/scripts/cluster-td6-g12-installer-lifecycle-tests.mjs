#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const ts = createRequire(import.meta.url)('typescript');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function load(file) {
 const js=ts.transpileModule(readFileSync(join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),Buffer,process,Date,JSON,Math,Set,Map},{filename:file});return module.exports;
}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const dir=mkdtempSync(join(tmpdir(),'cluster-g12-'));let checked=0;
function test(name,fn){fn();checked++;console.log('PASS',name)}
function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++){c^=bytes[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function zipOne(name,payload){const n=Buffer.from(name), l=Buffer.alloc(30), c=Buffer.alloc(46), e=Buffer.alloc(22), crc=crc32(payload);
 l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);l.writeUInt32LE(payload.length,18);l.writeUInt32LE(payload.length,22);l.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(payload.length,20);c.writeUInt32LE(payload.length,24);c.writeUInt16LE(n.length,28);
 e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(c.length+n.length,12);e.writeUInt32LE(l.length+n.length+payload.length,16);
 return Buffer.concat([l,n,payload,c,n,e]);}
const payload=Buffer.alloc(5*1024*1024,0x5a);
Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]).copy(payload);
const zip=zipOne('installer/editor.msi',payload), zipPath=join(dir,'installer.zip'), installer={kind:'windows-msi',path:'installer/editor.msi',sha256:sha(payload),scope:'user',productCode:'{12345678-1234-ABCD-ABCD-1234567890AB}',productVersion:'1.0.0'};
writeFileSync(zipPath,zip);writeFileSync(join(dir,'msi.json'),JSON.stringify(installer));
const keys=generateKeyPairSync('ed25519'), key=join(dir,'key.pem'),out=join(dir,'signed.json');
writeFileSync(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));
const sign=(installerFile) => spawnSync(process.execPath,[join(root,'tools/scripts/cluster-package-sign.mjs'),key,zipPath,'studio-kit','1.1.0','windows-x64',out,'-',...(installerFile?[installerFile]:[])],{encoding:'utf8'});
test('standard Package ceiling stays at 4 MiB',()=>assert.equal(policy.packageArtifactLimit({}),4*1024*1024));
test('signed MSI ceiling is exactly 32 MiB',()=>assert.equal(policy.packageArtifactLimit({installer}),32*1024*1024));
test('non-installer signer refuses 5 MiB ZIP',()=>assert.notEqual(sign(null).status,0));
test('MSI signer accepts 5 MiB ZIP',()=>{const result=sign(join(dir,'msi.json'));assert.equal(result.status,0,result.stderr)});
const envelope=JSON.parse(readFileSync(out,'utf8'));
test('server accepts signed 5 MiB MSI and ZIP CRC',()=>{
 const validated=policy.validateSignedPackage({...envelope,publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'})});
 assert.equal(validated.manifestJson.includes('windows-msi'),true);
});
test('non-installer cannot bypass 4 MiB via manifest metadata',()=>{
 const bare={...envelope.manifest}; delete bare.installer;
 assert.throws(()=>policy.validateSignedPackage({...envelope,manifest:bare,publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'})}),/PACKAGE_MANIFEST_INVALID/);
});
test('signed MSI hash tampering fails closed',()=>{
 const changed={...envelope.manifest,installer:{...installer,sha256:'f'.repeat(64)}};
 assert.throws(()=>policy.validateSignedPackage({...envelope,manifest:changed,publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'})}),/PACKAGE_INSTALLER_BYTES_INVALID/);
});
test('server publishing has expanded bounded JSON contract',()=>{
 const routes=readFileSync(join(root,'apps/server/src/domains/inventory/managed-package-routes.ts'),'utf8');
 const admission=readFileSync(join(root,'apps/server/src/core/request-workload.ts'),'utf8');
 assert.match(routes,/bodyLimit: 46_000_000/);assert.match(routes,/z\.string\(\)\.max\(44_800_000\)/);
 assert.match(admission,/46 \* MIB/);
});
test('Qt and web recipient enforce signed MSI cap independently',()=>{
 const qt=readFileSync(join(root,'apps/desktop-qt/src/NativeCapabilityBroker.cpp'),'utf8');
 const web=readFileSync(join(root,'packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),'utf8');
 assert.match(qt,/MaxPackageKitBytes = 32 \* 1024 \* 1024/);
 assert.match(web,/manifest\.installer \? 32 : 4/); assert.match(web,/downloadPackageSegments/);
});
test('MSI evidence is read-only in native, Qt and renderer',()=>{
 const cli=readFileSync(join(root,'tools/native/package-stager-go/msi_attempt_status.go'),'utf8');
 const broker=readFileSync(join(root,'apps/desktop-qt/src/NativeCapabilityBroker.cpp'),'utf8');
 const panel=readFileSync(join(root,'packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),'utf8');
 assert.match(cli,/RetryAuthorized: false/);assert.match(cli,/directoryNoLinks/);
 assert.match(broker,/package\.msiAttemptStatus/);assert.match(panel,/inspectNativeMSIAttempt/);
});
console.log(`${checked}/${checked} G12 installer size and recovery contract checks passed`);
