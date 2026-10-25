// Exercise the actual production Desktop repair functions under controlled
// asynchronous dependencies, with tampered native evidence. No MSI runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const path=new URL('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx',import.meta.url);
const source=fs.readFileSync(path,'utf8');
const ast=ts.createSourceFile('DesktopDevicePackagesPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const bodies=new Map();
(function visit(node){if(ts.isFunctionDeclaration(node) && ['runMSIRepair','verifyReadOnlyMSIRepairEvidence'].includes(node.name?.text))bodies.set(node.name.text,node.getText(ast));ts.forEachChild(node,visit)})(ast);
assert.equal(bodies.size,2);
const js=ts.transpileModule([...bodies.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const keys=['available','busy','grantBusy','msiGrantPending','msiGrantOwner','trust','controlTrust','supervisedMsiRepairEnabled','nativeStage','platform','generation','setGrantBusy','setError','setNotice','api','channel','inspectNativeMSIProfile','inspectNativeMSIRepair','verifyReadOnlyMSIProfile','setMsiProfileEvidence','setMsiRepairEvidence','runNativeSupervisedMSIRepair','setNativeStage'];
const build=Function(...keys,`"use strict"; ${js}; return {runMSIRepair,verifyReadOnlyMSIRepairEvidence}`);
const sha=(ch)=>ch.repeat(64);
const code='{AABBCCDD-1234-5678-ABCD-1234567890AB}';
const target={package:{id:'pkg-1',key:'studio-editor'},release:{id:'rel-1',version:'2.4.1',artifactSha256:sha('a')},manifest:{installer:{sha256:sha('b'),productCode:code,productVersion:'2.4.1'}}};
const clean={schema:1,packageKey:'studio-editor',state:'no_recorded_repair',hasReceipt:false,readOnly:true,osAttested:false,retryAuthorized:false,manualReviewRequired:false};
const old={...clean,state:'repair_exit_zero_not_os_attested',hasReceipt:true,manualReviewRequired:true,receiptSha256:sha('d'),receipt:{schema:1,operation:'repair',packageKey:'studio-editor',version:'2.4.1',artifactSha256:sha('a'),msiSha256:sha('b'),productCode:code,productVersion:'2.4.1',priorReceiptSha256:sha('c'),state:'repair_exit_zero_not_os_attested',startedAt:'2026-10-24T00:00:00Z',osAttested:false}};
let checks=0;
const runtime=()=>build(...keys.map((k)=>({available:true,busy:false,grantBusy:false,msiGrantPending:{current:false},msiGrantOwner:{current:0},trust:{configured:true},controlTrust:{configured:true},supervisedMsiRepairEnabled:true,nativeStage:{state:'idle'},platform:'windows-x64',generation:{current:1},setGrantBusy(){},setError(){},setNotice(){},api(){},channel:'stable',inspectNativeMSIProfile(){},inspectNativeMSIRepair(){},verifyReadOnlyMSIProfile(){},setMsiProfileEvidence(){},setMsiRepairEvidence(){},runNativeSupervisedMSIRepair(){},setNativeStage(){}})[k]));
const validator=runtime().verifyReadOnlyMSIRepairEvidence;
for(const valid of [clean,old]){assert.doesNotThrow(()=>validator(valid,'studio-editor'));checks++}
for(const [name,change] of Object.entries({
 'forged OS attestation':x=>x.osAttested=true,
 'forged repair replay grant':x=>x.retryAuthorized=true,
 'not read only':x=>x.readOnly=false,
 'other Package':x=>x.packageKey='other-package',
 'false clean state':x=>x.state='repair_exit_zero_not_os_attested',
 'clean with receipt':x=>x.receiptSha256=sha('a'),
 'clean marked for review':x=>x.manualReviewRequired=true,
 'unknown operation':x=>x.receipt.operation='install',
 'wrong original receipt':x=>x.receipt.priorReceiptSha256='garbage',
 'different MSI ProductCode':x=>x.receipt.productCode='{invalid}',
 'different repair state':x=>x.receipt.state='repair_started_outcome_unknown',
 'forged journal state':x=>x.state='repair_restarted',
 'forged receipt attestation':x=>x.receipt.osAttested=true,
 'forged journal package':x=>x.receipt.packageKey='another-package',
 'invalid artifact digest':x=>x.receipt.artifactSha256='bad',
 'missing receipt digest':x=>x.receiptSha256=undefined,
 'bad journal timestamp':x=>x.receipt.startedAt='garbage',
})){const x=structuredClone(name.includes('clean')||name==='false clean state'?clean:old);change(x);assert.throws(()=>validator(x,'studio-editor'),/repair journal/,name);checks++}
const profile={records:[{packageKey:'studio-editor',hasReceipt:true,receiptSha256:sha('c'),attempt:{artifactSha256:sha('a'),version:'2.4.1',msiSha256:sha('b'),productCode:code,productVersion:'2.4.1'}}],lifecyclePlans:[{packageKey:'studio-editor',operation:'repair',state:'requires_operator_review',blockers:[],recordedReceiptSha256:sha('c')}]};
async function scenario({prior=clean,blocked=false,serverEnabled=true,targetChanged=false,grantBad=false,shiftAt='',profileOverride=profile}={}){
 const calls=[],errors=[],stages=[],gen={current:1},pending={current:false};
 const env={available:true,busy:false,grantBusy:false,msiGrantPending:pending,msiGrantOwner:{current:0},trust:{configured:true},controlTrust:{configured:true},supervisedMsiRepairEnabled:true,nativeStage:{state:'idle'},platform:'windows-x64',generation:gen,setGrantBusy:()=>{},setError:v=>errors.push(v),setNotice:()=>{},channel:'stable',setMsiProfileEvidence:()=>{},setMsiRepairEvidence:()=>{},setNativeStage:v=>stages.push(v),
 api:async (_,opts)=>{if(!opts){calls.push('targets');if(shiftAt==='targets')gen.current++;return {nativeRepairAvailable:serverEnabled,targets:targetChanged?[]:[target]}} calls.push('grant');if(shiftAt==='grant')gen.current++;return grantBad?{purpose:'supervised_user_msi_install',grant:{expiresAt:Date.now()/1000+50}}:{purpose:'supervised_user_msi_repair',grant:{expiresAt:Date.now()/1000+50}}},
 inspectNativeMSIProfile:async ()=>{calls.push('profile');if(shiftAt==='profile')gen.current++;return profileOverride},
 inspectNativeMSIRepair:async ()=>{calls.push('repair-status');return prior},
 verifyReadOnlyMSIProfile:()=>{if(blocked)throw Error('unsafe profile')},
 runNativeSupervisedMSIRepair:async ()=>{calls.push('execute');return {accepted:true,operationId:'op-id'}}};
 const instance=build(...keys.map(k=>env[k]));await instance.runMSIRepair(target);
 return {calls,errors,stages,pending:pending.current};
}
let r=await scenario();assert.deepEqual(r.calls,['targets','profile','repair-status','grant','execute']);assert.equal(r.pending,false);assert.equal(r.errors.at(-1),'');assert.equal(r.stages[0].state,'verifying');checks+=4;
for(const [name,opts,expected] of [
 ['prior repair journal',{prior:old},['targets','profile','repair-status']],
 ['server switch disabled',{serverEnabled:false},['targets']],
 ['release changed',{targetChanged:true},['targets']],
 ['profile evidence rejected',{blocked:true},['targets','profile','repair-status']],
 ['rejected lifecycle plan',{profileOverride:{...profile,lifecyclePlans:[{...profile.lifecyclePlans[0],state:'blocked',blockers:['missing_install_receipt']}]}},['targets','profile','repair-status']],
 ['grant purpose changed',{grantBad:true},['targets','profile','repair-status','grant']],
 ['profile generation stale',{shiftAt:'profile'},['targets','profile','repair-status']],
 ['grant generation stale',{shiftAt:'grant'},['targets','profile','repair-status','grant']],
 ]){
 r=await scenario(opts);assert.deepEqual(r.calls,expected,name);assert.equal(r.pending,false,name);assert(!r.calls.includes('execute'),name);checks+=3;
}
const server=fs.readFileSync(new URL('../../apps/server/src/domains/inventory/managed-package-routes.ts',import.meta.url),'utf8');
const grants=fs.readFileSync(new URL('../../apps/server/src/domains/inventory/managed-package-grants.ts',import.meta.url),'utf8');
const qt=fs.readFileSync(new URL('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp',import.meta.url),'utf8');
const go=fs.readFileSync(new URL('../native/package-stager-go/msi_repair.go',import.meta.url),'utf8');
for(const value of ['CLUSTER_ALLOW_SUPERVISED_MSI_REPAIR','supervised_user_msi_repair','priorReceiptSha256']){assert(server.includes(value));checks++}
for(const value of ['priorReceiptSha256','operation === "repair"']){assert(grants.includes(value));checks++}
for(const value of ['package.repairMsi','package.msiRepairStatus','CLUSTER_MSI_REPAIR_RESULT ','QStringLiteral("REPAIR ")','repair-msi']){assert(qt.includes(value));checks++}
for(const value of ['writeFirstMSIRepairReceipt','requireRepairOfExactKnownMSI','acquireMSIInstallLock','runWindowsUserMSIRepair']){assert(go.includes(value));checks++}
console.log(`${checks}/${checks} executed Pass37 repair authorization, journal validation and cross-layer gates passed`);
