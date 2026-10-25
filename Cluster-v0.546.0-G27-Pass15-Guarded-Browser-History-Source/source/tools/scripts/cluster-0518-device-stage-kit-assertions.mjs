import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const file='packages/renderer/src/features/settings/package-staging-kit.ts';
const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(out,{module,exports:module.exports,require,Blob,TextEncoder,Uint8Array,DataView,Error},{filename:file});
const {buildPackageStagingKit}=module.exports;
const sha=data=>createHash('sha256').update(data).digest('hex');
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0)}return(n^0xffffffff)>>>0}
function sampleZip(){const contents=Buffer.from('Staging is not installation\n');const name=Buffer.from('payload/NOTICE.txt');const crc=crc32(contents);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(contents.length,18);local.writeUInt32LE(contents.length,22);local.writeUInt16LE(name.length,26);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(contents.length,20);central.writeUInt32LE(contents.length,24);central.writeUInt16LE(name.length,28);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+contents.length,16);return Buffer.concat([local,name,contents,central,name,end]);}
const dir=mkdtempSync(join(tmpdir(),'cluster-0518-'));
const checks=[];
function ok(name,fn){fn();checks.push(name);console.log('PASS',name);}
try {
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const archive=sampleZip();
 const manifest={schema:1,packageKey:'sample-package',version:'1.0.0',platform:'linux-x64',artifactSha256:sha(archive),artifactSize:archive.length,filename:'sample.zip'};
 const signatureBase64=sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(manifest)),privateKey).toString('base64');
 const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
 const kitInput={archive:new Uint8Array(archive),filename:'sample.zip',manifest,signatureBase64,publicKeyPem};
 const kit=buildPackageStagingKit(kitInput);
 const kitPath=join(dir,'handoff.zip');writeFileSync(kitPath,Buffer.from(await kit.arrayBuffer()));
 ok('Staging handoff is a genuine ZIP containing exactly five fixed entries',()=>{
  const list=execFileSync('unzip',['-Z','-1',kitPath],{encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(list,['release.zip','manifest.json','signature.txt','public-key.pem','README.txt']);
  assert.match(execFileSync('unzip',['-t',kitPath],{encoding:'utf8'}),/No errors detected/);
 });
 const entries={};for(const name of ['release.zip','manifest.json','signature.txt','public-key.pem','README.txt']){
  entries[name]=execFileSync('unzip',['-p',kitPath,name]);
 }
 ok('ZIP release is byte-identical and all signed metadata survived the handoff',()=>{
  assert.deepEqual(entries['release.zip'],archive);
  assert.deepEqual(JSON.parse(entries['manifest.json'].toString()),manifest);
  assert.equal(entries['signature.txt'].toString().trim(),signatureBase64);
  assert.equal(entries['public-key.pem'].toString(),publicKeyPem);
  assert.match(entries['README.txt'].toString(),/NOT an independent trust root/);
 });
 ok('Receipt challenge, cookies, bearer tokens and plaintext trust pin excluded',()=>{
  const all=readFileSync(kitPath).toString('latin1');
  for (const secret of ['X-Cluster-Package-Receipt-Challenge','sessionCookie','token=', 'trusted-key-sha256 0123'])assert.equal(all.includes(secret),false);
 });
 const files={archive:join(dir,'release.zip'),manifest:join(dir,'manifest.json'),signature:join(dir,'signature.txt'),publicKey:join(dir,'public-key.pem'),root:join(dir,'staged')};
 for(const [name,path] of [['release.zip',files.archive],['manifest.json',files.manifest],['signature.txt',files.signature],['public-key.pem',files.publicKey]]) writeFileSync(path,entries[name]);
 const pin=sha(publicKey.export({format:'der',type:'spki'}));
 const args=['run','.','--archive',files.archive,'--manifest',files.manifest,'--signature',files.signature,'--public-key',files.publicKey,'--root',files.root];
 ok('Native Go stager refuses the kit without an independently supplied key pin',()=>{
  assert.throws(()=>execFileSync('go',args,{cwd:'tools/native/package-stager-go',stdio:'pipe'}));
  assert.equal(existsSync(files.root),false);
 });
 ok('Native Go stager refuses a mismatched independent key pin',()=>{
  assert.throws(()=>execFileSync('go',[...args,'--trusted-key-sha256','0'.repeat(64)],{cwd:'tools/native/package-stager-go',stdio:'pipe'}));
  assert.equal(existsSync(join(files.root,'staged',manifest.artifactSha256)),false);
 });
 ok('Native Go stager accepts the independently pinned signed handoff, but never installs',()=>{
  const output=execFileSync('go',[...args,'--trusted-key-sha256',pin],{cwd:'tools/native/package-stager-go',encoding:'utf8'});
  assert.match(output,/Verified, staged, not installed/);
  assert.equal(JSON.parse(readFileSync(join(files.root,'staged',manifest.artifactSha256,'.cluster-package-stage.json'),'utf8')).state,'verified_staged_not_installed');
 });
 ok('Corrupt size, unsafe filenames and fake signature sidecars are rejected',()=>{
  assert.throws(()=>buildPackageStagingKit({...kitInput,manifest:{...manifest,artifactSize:12345}}));
  assert.throws(()=>buildPackageStagingKit({...kitInput,filename:'../../bad.zip'}));
  assert.throws(()=>buildPackageStagingKit({...kitInput,signatureBase64:'garbage'}));
 });
 const ui=readFileSync('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx','utf8');
 const account=readFileSync('packages/renderer/src/features/settings/AccountSettingsPage.tsx','utf8');
 ok('Device UI uses proof-aware canonical API, on-demand targeting, hash checks and no installation claims',()=>{
  assert.match(ui,/clusterApiFetch\(endpoint/);assert.match(ui,/"X-Cluster-Device-Id": installationDeviceId\(\)/);
  assert.match(ui,/crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(ui,/prepare staging kit|staging kit/i);
  assert.match(ui,/not install or activate software/);
  assert.match(account,/<DesktopDevicePackagesPanel available=/);
  assert.doesNotMatch(ui,/setInterval\(/);
 });
 console.log(`Cluster 0.518 staging kit integration: ${checks.length}/${checks.length} checks passed`);
} finally {rmSync(dir,{recursive:true,force:true});}
