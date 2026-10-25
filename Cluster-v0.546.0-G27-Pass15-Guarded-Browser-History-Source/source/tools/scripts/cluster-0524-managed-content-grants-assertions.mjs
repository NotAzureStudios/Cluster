import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createPublicKey, verify, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const path='apps/server/src/domains/inventory/managed-package-grants.ts';
const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(code.diagnostics?.length,0);
const mod={exports:{}};
vm.runInNewContext(code.outputText,{module:mod,exports:mod.exports,require,Buffer,Date,Error}, {filename:path});
const {mintPackageDeploymentGrant,PACKAGE_GRANT_CONTEXT}=mod.exports;
const {privateKey}=generateKeyPairSync('ed25519');
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
const target={operation:'deploy',packageKey:'studio-kit',version:'1.2.3',platform:'windows-x64',artifactSha256:'a'.repeat(64),signingKeySha256:'b'.repeat(64),releaseId:'release-1',registrationId:'device-1',userId:'person-1'};
let count=0;
function check(label,fn){fn();count++;console.log('PASS',label)}
check('no signing grant without separately provisioned control key',()=>assert.throws(()=>mintPackageDeploymentGrant(target,''),/NOT_CONFIGURED/));
check('issue 60-second bounded signed release-specific grant',()=>{
 const g=mintPackageDeploymentGrant(target,pem,1_790_000_000_000);
 const raw=Buffer.from(g.payloadBase64url,'base64url');
 const p=JSON.parse(raw.toString('utf8'));
 assert.equal(p.expiresAt-p.issuedAt,60);
 assert.equal(p.artifactSha256,target.artifactSha256);
 assert.equal(p.registrationId,target.registrationId);
 assert.equal(p.operation,'deploy');
 assert.equal(verify(null,Buffer.concat([Buffer.from(PACKAGE_GRANT_CONTEXT),raw]),createPublicKey(g.publicKeyPem),Buffer.from(g.signatureBase64url,'base64url')),true);
 const der=createPublicKey(g.publicKeyPem).export({type:'spki',format:'der'});
 assert.equal(g.controlKeyFingerprint,createHash('sha256').update(der).digest('hex'));
 assert.equal(JSON.stringify(g).includes('PRIVATE KEY'),false);
 assert.equal(verify(null,Buffer.concat([Buffer.from(PACKAGE_GRANT_CONTEXT),Buffer.from(JSON.stringify({...p,version:'9.9.9'}))]),createPublicKey(g.publicKeyPem),Buffer.from(g.signatureBase64url,'base64url')),false);
});
check('grants have unique one-use nonces',()=>{
 const a=mintPackageDeploymentGrant(target,pem),b=mintPackageDeploymentGrant(target,pem);
 assert.notEqual(JSON.parse(Buffer.from(a.payloadBase64url,'base64url')).nonce,JSON.parse(Buffer.from(b.payloadBase64url,'base64url')).nonce);
});
check('reject non-Ed25519 control signer',()=>{
 const {privateKey:wrong}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 assert.throws(()=>mintPackageDeploymentGrant(target,wrong.export({type:'pkcs8',format:'pem'}).toString()),/SIGNER_INVALID/);
});
const routes=fs.readFileSync('apps/server/src/domains/inventory/managed-package-routes.ts','utf8');
const native=fs.readFileSync('apps/desktop-qt/src/NativeCapabilityBroker.cpp','utf8');
const go=fs.readFileSync('tools/native/package-stager-go/managed_deploy.go','utf8');
const ui=fs.readFileSync('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx','utf8');
check('device authorization, live entitlement and grant issuance audited',()=>{
 assert.match(routes,/authorize-content/);assert.match(routes,/authorizedDevice\(request, reply\)/);
 assert.match(routes,/readDevicePackageTargets\(tx,/);assert.match(routes,/deployment_grant_issued/);
 assert.match(routes,/PACKAGE_DEPLOYMENT_AUTHORITY_UNCONFIGURED/);
});
check('desktop keeps control pin separate from package signing pin',()=>{
 assert.match(native,/package-control-trust/);assert.match(native,/controlPin == pin/);
 assert.match(native,/package\.provisionControlTrust/);assert.match(native,/QSharedPointer<QTemporaryFile>/);
 assert.match(native,/CLUSTER_MANAGED_CONTENT_RESULT/);
});
check('native deployment verifies server grant then staged integrity before change',()=>{
 assert.match(go,/verifyDeploymentGrant\(o, m, fp, operation, now\)/);
 assert.match(go,/verifyStaged\(root, m, archive, fp\)/);
 assert.match(go,/consumeGrant\(root, grant\)/);
 assert.match(go,/copyToManaged\(root, m.PackageKey, m, archive\)/);
});
check('UI gets short-lived grant only for explicit native user action',()=>{
 assert.match(ui,/authorize-content/);assert.match(ui,/runAuthorizedNativePackageContent/);
 assert.match(ui,/controlTrust\?\.configured/);
 assert.doesNotMatch(ui,/localStorage\.setItem\([^\n]*grant/);
});
const receiptsPath='packages/renderer/src/features/settings/package-staging-receipts.ts';
const receiptsJs=ts.transpileModule(fs.readFileSync(receiptsPath,'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(receiptsJs.diagnostics?.length,0);
const receipts={exports:{}};
vm.runInNewContext(receiptsJs.outputText,{module:receipts,exports:receipts.exports,require,Buffer,Date,Error,
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000000'}},{filename:receiptsPath});
const lease={deploymentId:'deployment-1',challenge:'B'.repeat(43),artifactSha256:'a'.repeat(64),
  packageKey:'studio-kit',version:'1.2.3',issuedAt:Date.now(),expectedRevision:2};
let receiptPosts=[];
const observed=await receipts.exports.reportNativeManagedSelection(lease,async (id,body)=>{
  receiptPosts.push({id,body});return {revision:3,nextChallenge:'C'.repeat(43)};
});
check('post managed selection only as nonattested revision-checked device claim',()=>{
 assert.equal(observed.osAttested,false);assert.equal(observed.state,'content_selected');
 assert.equal(receiptPosts.length,1);assert.equal(receiptPosts[0].body.expectedRevision,2);
 assert.equal(receiptPosts[0].body.observedSha256,lease.artifactSha256);
});
await assert.rejects(receipts.exports.reportNativeManagedSelection({...lease,expectedRevision:0},async()=>({revision:3,nextChallenge:'C'.repeat(43)})),/unavailable/);
await assert.rejects(receipts.exports.reportNativeManagedSelection({...lease,issuedAt:0},async()=>({revision:3,nextChallenge:'C'.repeat(43)})),/expired/);
count++;console.log('PASS rejected stale/mismatched device receipt leases');
console.log(`${count}/${count} managed-content authorization assertions passed`);
