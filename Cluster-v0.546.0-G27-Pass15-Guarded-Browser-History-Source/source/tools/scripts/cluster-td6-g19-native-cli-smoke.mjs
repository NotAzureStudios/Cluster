#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(tmpdir(), 'cluster-g19-retained-'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
let checks = 0;
try {
 const exe = join(temp, 'stager');
 const build = spawnSync('go', ['build', '-o', exe, '.'], { cwd:join(root,'tools/native/package-stager-go'), encoding:'utf8', timeout:120000 });
 assert.equal(build.status, 0, build.stderr);
 const archive = join(temp, 'source.zip');
 // Native tests already exercise arbitrary valid ZIP archives; build a small
 // separate-process fixture for CLI flag and stdin-envelope integration.
 const writeZip = spawnSync('python3', ['-c', `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('asset.txt','retained archive content')`,archive], {encoding:'utf8'});
 assert.equal(writeZip.status,0,writeZip.stderr);
 const bytes = readFileSync(archive), digest=sha(bytes);
 const {privateKey, publicKey} = generateKeyPairSync('ed25519');
 const pubDer = publicKey.export({type:'spki',format:'der'});
 const pubPem = publicKey.export({type:'spki',format:'pem'});
 const pin = sha(pubDer);
 const manifest={schema:1,packageKey:'retained-test',version:'1.0.0',platform:process.platform==='win32'?'windows-x64':process.platform==='darwin'?'macos-arm64':'linux-x64',artifactSha256:digest,artifactSize:bytes.length,filename:'source.zip'};
 const envelope=JSON.stringify({manifest,signatureBase64:sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(manifest)),privateKey).toString('base64'),publicKeyPem:pubPem});
 const privateRoot=join(temp,'private');mkdirSync(privateRoot);
 const args=(action,...more)=>['--action',action,'--root',privateRoot,'--transfer-sha256',digest,...more];
 const run=(action, extra=[],input)=>spawnSync(exe,args(action,...extra),{input,encoding: input===undefined?'utf8':undefined,timeout:30000});
 const command=(action,extra=[],input)=>{const reply=run(action,extra,input);assert.equal(reply.status,0,reply.stderr?.toString());checks++;return reply;};
 command('transfer-begin',['--transfer-size',String(bytes.length)]);
 command('transfer-append',['--transfer-offset','0','--transfer-chunk-size',String(bytes.length)],bytes);
 const target=['--staging-root',privateRoot,'--trusted-key-sha256',pin,'--expected-artifact-sha256',digest,'--expected-package-key','retained-test','--expected-version','1.0.0'];
 let denied=run('transfer-stage',target,Buffer.from(envelope));assert.notEqual(denied.status,0);checks++;
 command('transfer-commit');
 denied=run('transfer-stage',target.map(x=>x===pin?'f'.repeat(64):x),Buffer.from(envelope));assert.notEqual(denied.status,0);checks++;
 denied=run('transfer-stage',target.map(x=>x==='1.0.0'?'2.0.0':x),Buffer.from(envelope));assert.notEqual(denied.status,0);checks++;
 const result=command('transfer-stage',target,Buffer.from(envelope));
 assert.match(result.stdout.toString(),/CLUSTER_STAGE_RESULT /);
 const proof=JSON.parse(result.stdout.toString().split('CLUSTER_STAGE_RESULT ')[1].trim());
 assert.equal(proof.archiveSha256,digest);
 assert.equal(proof.signingKeySha256,pin);
 assert.equal(proof.state,'verified_staged_not_installed');
 denied=run('transfer-stage',target,Buffer.from(envelope));assert.notEqual(denied.status,0);checks++;
 denied=run('transfer-stage',[...target,'--grant','incorrect-authorization'],Buffer.from(envelope));assert.notEqual(denied.status,0);checks++;
 console.log(`${checks}/${checks} G19 compiled native CLI and signed retained-stage checks passed`);
} finally { rmSync(temp,{recursive:true,force:true}); }
