// Cross-layer contract checks, plus executable TypeScript rollback receipt flow.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
let count=0;
function check(title, fn) {fn();count++;console.log('PASS',title)}
const go=fs.readFileSync('tools/native/package-stager-go/managed_deploy.go','utf8');
const cli=fs.readFileSync('tools/native/package-stager-go/main.go','utf8');
const qt=fs.readFileSync('apps/desktop-qt/src/NativeCapabilityBroker.cpp','utf8');
const desktop=fs.readFileSync('packages/renderer/src/core/desktop.ts','utf8');
const panel=fs.readFileSync('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx','utf8');
check('Qt parses native managed result using Go artifactSha256, not stage archiveSha256',()=>{
 assert.match(qt,/evidence\.value\(managedOperation \|\| auditManaged \|\| fileOperation \? QStringLiteral\("artifactSha256"\) : QStringLiteral\("archiveSha256"\)\)/);
 assert.match(go,/ArtifactSha256\s+string `json:"artifactSha256"`/);
 assert.match(qt,/CLUSTER_MANAGED_CONTENT_RESULT/);
});
check('signed managed audit checks source, copy, pointer and prevents authorization claims',()=>{
 for (const term of [/func auditManagedContent\(/,/verifyInput\(o\)/,/verifyStaged\(root, m, archive, fingerprint\)/,
   /verifyManagedBytes\(contentDir, archive\)/,/after\.Generation != current\.Generation/,
   /o\.Grant != "" \|\| o\.TrustedControlKeySha256 != ""/,/OSAttested:\s*false/]) assert.match(go,term);
 assert.match(cli,/CLUSTER_MANAGED_AUDIT_RESULT/);
});
check('Desktop native audit is read only, selected-target bound and nonattested',()=>{
 assert.match(qt,/package\.auditManaged/);
 assert.match(qt,/QStringLiteral\("audit-managed"\)/);
 assert.match(qt,/CLUSTER_MANAGED_AUDIT_RESULT/);
 assert.match(qt,/verified_managed_content_not_executed/);
 assert.match(desktop,/auditNativeManagedPackage/);
 assert.match(panel,/Audit managed copy…/);
 assert.match(panel,/auditNativeManagedPackage/);
});
const src=fs.readFileSync('packages/renderer/src/features/settings/package-staging-receipts.ts','utf8');
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require,Date,Error,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000000'}},{filename:'package-staging-receipts.ts'});
const {reportNativeManagedSelection,reportNativeManagedRollback}=mod.exports;
const lease={deploymentId:'deploy-1',challenge:'A'.repeat(43),expectedRevision:2,artifactSha256:'b'.repeat(64),
 packageKey:'studio-kit',version:'2.0.0',issuedAt:Date.now()};
let posts=[];
const selected=await reportNativeManagedSelection(lease,async(id,body)=>{
 posts.push({id,body});return{revision:3,nextChallenge:'B'.repeat(43)};
});
check('native selection retains signed challenge chain for later rollback report',()=>{
 assert.equal(selected.rollbackLease.expectedRevision,3);
 assert.equal(selected.rollbackLease.challenge,'B'.repeat(43));
 assert.equal(selected.rollbackLease.artifactSha256,lease.artifactSha256);
 assert.equal(selected.osAttested,false);
});
const restored=await reportNativeManagedRollback(selected.rollbackLease,async(id,body)=>{
 posts.push({id,body});return{revision:4,nextChallenge:'C'.repeat(43)};
});
check('rollback closes original deployment with its original digest and nonattested receipt',()=>{
 assert.equal(posts.length,2);
 assert.equal(posts[1].body.state,'rolled_back');
 assert.equal(posts[1].body.expectedRevision,3);
 assert.equal(posts[1].body.challenge,'B'.repeat(43));
 assert.equal(posts[1].body.observedSha256,lease.artifactSha256);
 assert.equal(restored.osAttested,false);
 assert.match(panel,/rollbackLeases\.current\.get\(managed\.packageKey\)/);
});
await assert.rejects(reportNativeManagedRollback({...selected.rollbackLease,expectedRevision:2},async()=>({revision:4,nextChallenge:'C'.repeat(43)})),/unavailable/);
await assert.rejects(reportNativeManagedRollback({...selected.rollbackLease,issuedAt:0},async()=>({revision:4,nextChallenge:'C'.repeat(43)})),/expired/);
check('stale or nonreplayable rollback receipt lease fails closed',()=>assert.equal(posts.length,2));
console.log(`${count}/${count} WIP525 targeted assertions passed`);
