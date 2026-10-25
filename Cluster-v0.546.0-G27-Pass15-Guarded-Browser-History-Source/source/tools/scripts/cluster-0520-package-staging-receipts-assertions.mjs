import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourcePath='packages/renderer/src/features/settings/package-staging-receipts.ts';
const transpiled=ts.transpileModule(readFileSync(sourcePath,'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true,
});
assert.equal(transpiled.diagnostics?.length,0);
const module={exports:{}};
const fakeCrypto={randomUUID:()=> '00000000-0000-4000-8000-000000000000'};
vm.runInNewContext(transpiled.outputText,{module,exports:module.exports,require,Date,crypto:fakeCrypto,Error}, {filename:sourcePath});
const {readPackageStageReceiptLease,verifiedStageMatchesLease,reportNativePackageStage,reportFailedNativePackageStage}=module.exports;
const target={artifactSha256:'a'.repeat(64),packageKey:'studio-tools',version:'1.0.0'};
const headers={get:(name)=>({'x-cluster-package-deployment-id':'cl0123456789','x-cluster-package-receipt-challenge':'A'.repeat(43)})[name] || null};
const lease=readPackageStageReceiptLease(headers,target,10000);
assert.equal(lease.deploymentId,'cl0123456789');
assert.equal(lease.challenge,'A'.repeat(43));
assert.equal(readPackageStageReceiptLease({get:()=>null},target),null);
assert.equal(readPackageStageReceiptLease({get:n=>n.includes('challenge')?'?' :'cl0123456789'},target),null);
const event={state:'staged_not_installed',evidence:'native_helper_self_report',artifactSha256:target.artifactSha256,packageKey:target.packageKey,version:target.version};
assert.equal(verifiedStageMatchesLease(lease,event,10001),true);
assert.equal(verifiedStageMatchesLease(lease,{...event,artifactSha256:'b'.repeat(64)},10001),false);
assert.equal(verifiedStageMatchesLease(lease,{...event,evidence:'browser_claim'},10001),false);
assert.equal(verifiedStageMatchesLease(lease,{...event,state:'activated'},10001),false);
assert.equal(verifiedStageMatchesLease(lease,event,10000+9*60000),false);
const posts=[];
const report=await reportNativePackageStage(lease,async (id, body)=>{
  posts.push({id,body});
  return {revision:body.expectedRevision+1,nextChallenge:'B'.repeat(43)};
});
assert.equal(posts.length,2);
assert.deepEqual(posts.map(p=>p.body.state),['artifact_verified','staged']);
assert.deepEqual(posts.map(p=>p.body.expectedRevision),[0,1]);
assert.equal(posts[1].body.challenge,'B'.repeat(43));
assert.equal(report.osAttested,false);
assert.ok(posts.every(p=>p.body.observedSha256===target.artifactSha256));
let calls=0;
await assert.rejects(reportNativePackageStage(lease,async()=>{
  calls++;throw new Error('revoked');
}),/revoked/);
assert.equal(calls,1);
const failurePosts=[];
const failed=await reportFailedNativePackageStage(lease,async(id,body)=>{failurePosts.push({id,body});return {revision:1};});
assert.equal(failurePosts.length,1);
assert.equal(failurePosts[0].body.state,'failed');
assert.equal(failurePosts[0].body.expectedRevision,0);
assert.equal(failed.osAttested,false);
const native=readFileSync('apps/desktop-qt/src/NativeCapabilityBroker.cpp','utf8');
const go=readFileSync('tools/native/package-stager-go/main.go','utf8');
const panel=readFileSync('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx','utf8');
for (const marker of ['--expected-artifact-sha256','--expected-package-key','--expected-version','CLUSTER_STAGE_RESULT','signingKeySha256','package.staging.changed'])
  assert.ok(native.includes(marker),`Qt missing ${marker}`);
for (const marker of ['ExpectedArtifactSha256','ExpectedPackageKey','ExpectedVersion','CLUSTER_STAGE_RESULT'])
  assert.ok(go.includes(marker),`Go missing ${marker}`);
for (const marker of ['readPackageStageReceiptLease','verifiedStageMatchesLease','reportNativePackageStage','reportFailedNativePackageStage','stageLeases.current.delete'])
  assert.ok(panel.includes(marker),`Panel missing ${marker}`);
assert.ok(!panel.includes('localStorage.setItem("package'));
console.log('PASS: volatile leases, exact digest matching, native constraints, sequential receipt challenges, failure reports, revocation failure and nonattestation');
