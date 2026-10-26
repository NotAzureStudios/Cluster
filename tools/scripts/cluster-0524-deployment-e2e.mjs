// Runtime integration on this host: TS server signer -> signed artifact ZIP ->
// Go native staging -> one-use authorized managed content selection.
// No executable installation or OS attestation.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const src='apps/server/src/domains/inventory/managed-package-grants.ts';
const tsc=ts.transpileModule(readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const module={exports:{}};
vm.runInNewContext(tsc.outputText,{module,exports:module.exports,require,Buffer,Date}, {filename:src});
const {mintPackageDeploymentGrant}=module.exports;
const dir=mkdtempSync(join(tmpdir(),'cluster-0524-e2e-'));
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
function run(binary,args){return execFileSync(binary,args,{encoding:'utf8',timeout:30_000,maxBuffer:1024*1024});}
try {
 const staged=join(dir,'package.zip'),kit=join(dir,'kit.zip'),root=join(dir,'native'),grantPath=join(dir,'grant.json'),native=join(dir,'stager');
 mkdirSync(root);
 const payload=join(dir,'payload.json');
 writeFileSync(payload,'{"theme":"dark","preset":"studio"}');
 // A real, bounded ZIP produced by the standard library, not fixture mocks.
 const python=`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z: z.write(sys.argv[2],'assets/preset.json')\n`;
 run('python3',['-c',python,staged,payload]);
 const bytes=readFileSync(staged);
 const {privateKey:publisher,publicKey:pub}=generateKeyPairSync('ed25519');
 const pubPem=pub.export({type:'spki',format:'pem'}).toString();
 const fingerprint=hash(pub.export({type:'spki',format:'der'}));
 const platform=process.platform==='linux'&&process.arch==='x64'?'linux-x64':process.platform==='win32'&&process.arch==='x64'?'windows-x64':'unsupported';
 if(platform==='unsupported') {console.log('SKIP unsupported host');process.exit(0);}
 const manifest={schema:1,packageKey:'studio-preset',version:'1.2.3',platform,artifactSha256:hash(bytes),artifactSize:bytes.length,filename:'preset.zip'};
 const signature=sign(null,Buffer.concat([Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'),Buffer.from(JSON.stringify(manifest))]),publisher).toString('base64');
 const signaturePath=join(dir,'signature.txt'), manifestPath=join(dir,'manifest.json'),pubPath=join(dir,'public-key.pem');
 writeFileSync(signaturePath,signature);writeFileSync(manifestPath,JSON.stringify(manifest));writeFileSync(pubPath,pubPem);
 const kitScript=`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:\n for name,path in [('release.zip',sys.argv[2]),('manifest.json',sys.argv[3]),('signature.txt',sys.argv[4]),('public-key.pem',sys.argv[5])]: z.write(path,name)\n z.writestr('README.txt','Staging kit, not an installer')\n`;
 run('python3',['-c',kitScript,kit,staged,manifestPath,signaturePath,pubPath]);
 run('go',['-C','tools/native/package-stager-go','build','-o',native,'.']);
 const common=['--kit',kit,'--trusted-key-sha256',fingerprint,'--root',root];
 const stagedResult=run(native,['--action','stage',...common]);
 assert.match(stagedResult,/CLUSTER_STAGE_RESULT/);
 const {privateKey:control}=generateKeyPairSync('ed25519');
 const grant=mintPackageDeploymentGrant({operation:'deploy',packageKey:manifest.packageKey,version:manifest.version,
  platform,artifactSha256:manifest.artifactSha256,signingKeySha256:fingerprint,
  releaseId:'release-1',registrationId:'verified-device-1',userId:'user-1'},control.export({type:'pkcs8',format:'pem'}).toString());
 writeFileSync(grantPath,JSON.stringify(grant));
 const deploymentArgs=['--action','deploy-content',...common,'--trusted-control-key-sha256',grant.controlKeyFingerprint,'--grant',grantPath];
 const output=run(native,deploymentArgs),line=output.split('\n').find(x=>x.startsWith('CLUSTER_MANAGED_CONTENT_RESULT '));
 assert.ok(line);const result=JSON.parse(line.replace('CLUSTER_MANAGED_CONTENT_RESULT ',''));
 assert.equal(result.state,'managed_content_selected_not_executed');
 assert.equal(result.generation,1);assert.equal(result.executed,false);assert.equal(result.osAttested,false);
 const installed=readFileSync(join(root,'managed',manifest.packageKey,manifest.artifactSha256,'assets','preset.json'),'utf8');
 assert.equal(installed,readFileSync(payload,'utf8'));
 const auditCmd=['--action','audit-managed',...common,'--expected-artifact-sha256',manifest.artifactSha256,
  '--expected-package-key',manifest.packageKey,'--expected-version',manifest.version];
 const auditOutput=run(native,auditCmd);
 const auditLine=auditOutput.split('\n').find(x=>x.startsWith('CLUSTER_MANAGED_AUDIT_RESULT '));
 assert.ok(auditLine,'read-only managed audit must return machine-readable evidence');
 const audit=JSON.parse(auditLine.slice('CLUSTER_MANAGED_AUDIT_RESULT '.length));
 assert.equal(audit.slot,'active');
 assert.equal(audit.state,'verified_managed_content_not_executed');
 assert.equal(audit.artifactSha256,manifest.artifactSha256);
 assert.equal(audit.osAttested,false);assert.equal(audit.executed,false);
 assert.equal(audit.generation,1);
 const auditWrongTarget=spawnSync(native,[...auditCmd.slice(0,-2),'--expected-version','9.9.9'],{encoding:'utf8'});
 assert.notEqual(auditWrongTarget.status,0,'wrong UI target must fail managed audit');
 const corruptPath=join(root,'managed',manifest.packageKey,manifest.artifactSha256,'assets','preset.json');
 const original=readFileSync(corruptPath);
 writeFileSync(corruptPath,Buffer.from('tampered native content'));
 assert.notEqual(spawnSync(native,auditCmd,{encoding:'utf8'}).status,0,'tampered managed copy must fail audit');
 writeFileSync(corruptPath,original);
 assert.match(run(native,auditCmd),/CLUSTER_MANAGED_AUDIT_RESULT/);
 const again=spawnSync(native,deploymentArgs,{encoding:'utf8'});
 assert.notEqual(again.status,0);
 const status=JSON.parse(run(native,['--action','managed-status','--root',root,'--package-key','studio-preset']));
 assert.equal(status.generation,1);
 console.log('PASS end-to-end TypeScript signing -> native signature and independent pins -> managed content copy -> atomic selection -> replay rejection');
 console.log('PASS managed audit verifies signed bytes, refuses wrong target/tampering and never attests OS health');
 console.log('PASS no OS executable installation or attestation claimed');
} finally {rmSync(dir,{recursive:true,force:true});}
