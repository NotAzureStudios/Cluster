import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha=data=>createHash('sha256').update(data).digest('hex');
const cwd='tools/native/package-stager-go';
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0)}return(n^0xffffffff)>>>0}
function zip(){
 const content=Buffer.from('no execution permitted\n');const name=Buffer.from('payload/README.txt');const crc=crc32(content);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+content.length,16);
 return Buffer.concat([local,name,content,central,name,end]);
}
const tmp=mkdtempSync(join(tmpdir(),'cluster-native-stage-'));
try {
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');const der=publicKey.export({format:'der',type:'spki'});const archive=zip();
 const manifest={schema:1,packageKey:'test-package',version:'1.2.3',platform:'linux-x64',artifactSha256:sha(archive),artifactSize:archive.length,filename:'test-package.zip'};
 const signature=sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(manifest)),privateKey).toString('base64');
 const files={archive:join(tmp,'archive.zip'),manifest:join(tmp,'manifest.json'),signature:join(tmp,'signature.txt'),key:join(tmp,'trusted.pem'),root:join(tmp,'root')};
 for(const [path,value] of [[files.archive,archive],[files.manifest,JSON.stringify(manifest)],[files.signature,signature],[files.key,publicKey.export({format:'pem',type:'spki'})]])writeFileSync(path,value);
 const args=['run','.','--archive',files.archive,'--manifest',files.manifest,'--signature',files.signature,'--public-key',files.key,'--trusted-key-sha256',sha(der),'--root',files.root];
 const output=execFileSync('go',args,{cwd,encoding:'utf8',env:process.env});
 assert.match(output,/Verified, staged, not installed/);
 assert.equal(readFileSync(join(files.root,'staged',manifest.artifactSha256,'payload/README.txt'),'utf8'),'no execution permitted\n');
 assert.equal(JSON.parse(readFileSync(join(files.root,'staged',manifest.artifactSha256,'.cluster-package-stage.json'),'utf8')).state,'verified_staged_not_installed');
 console.log('PASS Node-produced Ed25519 signed archive stages in Go without execution');

 // A separate opt-in selection step never executes or installs the archive.
 const go=(action,options=[])=>execFileSync('go',['run','.','--action',action,...options],{cwd,encoding:'utf8',env:process.env});
 const signedOptions=(x)=>['--archive',x.archive,'--manifest',x.manifest,'--signature',x.signature,'--public-key',x.key,'--trusted-key-sha256',sha(der),'--root',x.root];
 const chosen=JSON.parse(go('activate',signedOptions(files)));
 assert.equal(chosen.generation,1);
 assert.equal(chosen.active.version,'1.2.3');
 assert.equal(chosen.state,'content_selected_not_installed');
 const observed=JSON.parse(go('status',['--root',files.root,'--package-key','test-package']));
 assert.equal(observed.active.archiveSha256,manifest.artifactSha256);
 assert.throws(()=>go('activate',signedOptions(files)));
 console.log('PASS signed content selection is atomic, recorded and not executable installation');
 const secondVersion={...manifest,version:'2.0.0'};
 const secondZip=(()=>{const content=Buffer.from('new package contents\n'); const name=Buffer.from('payload/CHANGELOG.txt'); const crc=crc32(content); const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(name.length,26); const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(name.length,28); const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+content.length,16);return Buffer.concat([local,name,content,central,name,end])})();
 secondVersion.artifactSha256=sha(secondZip);secondVersion.artifactSize=secondZip.length;
 const nextFiles={archive:join(tmp,'second.zip'),manifest:join(tmp,'second.json'),signature:join(tmp,'second.sig'),key:files.key,root:files.root};
 writeFileSync(nextFiles.archive,secondZip);writeFileSync(nextFiles.manifest,JSON.stringify(secondVersion));writeFileSync(nextFiles.signature,sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(secondVersion)),privateKey).toString('base64'));
 assert.match(go('stage',signedOptions(nextFiles)),/Verified, staged, not installed/);
 const advanced=JSON.parse(go('activate',signedOptions(nextFiles)));
 assert.equal(advanced.generation,2);assert.equal(advanced.active.version,'2.0.0');assert.equal(advanced.previous.version,'1.2.3');
 assert.throws(()=>go('rollback',signedOptions(nextFiles)));
 const reverted=JSON.parse(go('rollback',signedOptions(files)));
 assert.equal(reverted.generation,3);assert.equal(reverted.active.version,'1.2.3');assert.equal(reverted.previous.version,'2.0.0');
 console.log('PASS Node-signed releases stage, select, and roll back in Go without executing them');

 const runWrong=()=>execFileSync('go',[...args.slice(0,-3),'--trusted-key-sha256','0'.repeat(64),'--root',join(tmp,'bad')],{cwd,encoding:'utf8',env:process.env,stdio:'pipe'});
 assert.throws(runWrong);
 assert.equal(existsSync(join(tmp,'bad','staged',manifest.artifactSha256)),false);
 console.log('PASS independently mismatched pinned signing key cannot stage');
} finally {rmSync(tmp,{recursive:true,force:true})}
