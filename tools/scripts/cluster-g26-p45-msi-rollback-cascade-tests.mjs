import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const module={exports:{}};
const compiled=ts.transpileModule(read('packages/renderer/src/features/settings/msi-rollback-cascade.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
Function('module','exports',`'use strict';${compiled}`)(module,module.exports);
const valid=module.exports.validMSIRollbackCascade;
assert.equal(typeof valid,'function');let n=1;
const sha=c=>c.repeat(64);
const plan={schema:1,packageKey:'studio-core',state:'independent_dispositions_required',readOnly:true,
 osAttested:false,mutationAuthorized:false,automaticExecution:false,priorReceiptSha256:sha('a'),upgradeJournalSha256:sha('b'),
 warnings:['unknown_external_dependents_not_excluded','separate_signed_grant_required_per_package','no_automatic_cascade_or_retry','windows_and_application_health_not_attested'],
 blockers:[],manualRecoveryRequired:false,manualReviewPackages:[],nextReviewablePackageKey:'studio-project',recoveryOrder:['studio-project','studio-editor','studio-core'],
 steps:[
  {index:0,packageKey:'studio-project',operation:'uninstall',state:'independent_operator_review_required',recordedReceiptSha256:sha('c'),waitingFor:[],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'request_independent_authorization'},
  {index:1,packageKey:'studio-editor',operation:'uninstall',state:'awaiting_prior_dispositions',recordedReceiptSha256:sha('d'),waitingFor:['studio-project'],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'wait_for_independent_dispositions'},
  {index:2,packageKey:'studio-core',operation:'msi-rollback',state:'awaiting_prior_dispositions',recordedReceiptSha256:sha('a'),waitingFor:['studio-project','studio-editor'],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'wait_for_independent_dispositions'},
 ]};
const clone=()=>structuredClone(plan);
assert.equal(valid(plan,'studio-core'),true);n++;
const bad={
  'missing root':x=>x.schema=2, 'wrong key':x=>x.packageKey='other', 'invalid key':x=>x.packageKey='../bad',
  'unsafe health':x=>x.osAttested=true,'unsafe mutation':x=>x.mutationAuthorized=true,
  'automatic execution':x=>x.automaticExecution=true,'not readonly':x=>x.readOnly=false,
  'wrong state':x=>x.state='ready_to_execute','wrong receipt hash':x=>x.priorReceiptSha256='BAD',
  'wrong upgrade hash':x=>x.upgradeJournalSha256='BAD', 'missing warnings':x=>x.warnings=[],
  'empty recovery':x=>{x.recoveryOrder=[];x.steps=[]},'swapped order':x=>x.recoveryOrder.reverse(),
  'missing step':x=>x.steps.pop(),'extra order':x=>x.recoveryOrder.push('unrelated'),
  'wrong index':x=>x.steps[0].index=1,'forged step identity':x=>x.steps[0].packageKey='other',
  'forged step operation':x=>x.steps[1].operation='msi-rollback', 'forged target operation':x=>x.steps[2].operation='uninstall',
  'missing child hash':x=>x.steps[0].recordedReceiptSha256='',
  'wrong target receipt':x=>x.steps[2].recordedReceiptSha256='BAD',
  'step authorization':x=>x.steps[1].mutationAuthorized=true,
  'missing separate grant':x=>x.steps[0].separateAuthorizationRequired=false,
  'incorrect wait count':x=>x.steps[1].waitingFor=[],
  'forged wait order':x=>x.steps[2].waitingFor.reverse(),
  'incorrect ready state':x=>x.steps[2].state='independent_operator_review_required',
  'invented block state':x=>x.steps[0].state='blocked',
  'invented summary blocker':x=>x.blockers=['studio-editor:review_blocked'],
  'invented blocked status':x=>x.state='blocked',
  'duplicate Package':x=>{x.recoveryOrder[1]='studio-project';x.steps[1].packageKey='studio-project'},
  'unknown step state':x=>x.steps[0].state='finished',
  'malformed blocker':x=>{x.steps[0].blockers=[5];x.steps[0].state='blocked';x.state='blocked';x.blockers=['studio-project:review_blocked']},
};
for(const [name,change] of Object.entries(bad)){const x=clone();change(x);assert.equal(valid(x,'studio-core'),false,name);n++}
const blocked=clone();blocked.state='blocked';blocked.steps[1].state='blocked';blocked.steps[1].blockers=['exact_windows_registration_not_verified'];blocked.steps[1].recoveryAction='resolve_evidence_blocker';blocked.blockers=['studio-editor:review_blocked'];
assert.equal(valid(blocked,'studio-core'),true);n++;
const single=clone();single.recoveryOrder=['studio-core'];single.steps=[{...single.steps[2],index:0,state:'independent_operator_review_required',recoveryAction:'request_independent_authorization',waitingFor:[]}];single.nextReviewablePackageKey='studio-core';
assert.equal(valid(single,'studio-core'),true);n++;
const root={native:read('tools/native/package-stager-go/msi_rollback_cascade.go'),cli:read('tools/native/package-stager-go/main.go'),qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),ui:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),transport:read('packages/renderer/src/core/desktop.ts'),pkg:read('package.json')};
for(const [which,tokens] of Object.entries({
 native:['planMSIRollbackCascadeWithProfile','reviewMSIRollbackWithProfile','planMSILifecycle','SeparateAuthorizationRequired','MutationAuthorized','verifyRegularDigest','inspectMSIProfile'],
 cli:['case "msi-rollback-cascade":','CLUSTER_MSI_ROLLBACK_CASCADE','result, err := inspectMSIRollbackCascade'],
 qt:['package.msiRollbackCascade','msi-rollback-cascade','CLUSTER_MSI_ROLLBACK_CASCADE','step.value(QStringLiteral("mutationAuthorized"))','waits.at(j).toString() != order.at(j).toString()'],
 ui:['validMSIRollbackCascade','inspectNativeMSIRollbackCascade','Review dependency-ordered MSI recovery','Each entry requires its own supervised authorization'],
 transport:['ClusterNativeMSIRollbackCascade','package.msiRollbackCascade'],pkg:['cluster:g26:p45:msi-rollback-cascade']
}))for(const token of tokens){assert.ok(root[which].includes(token),`${which}: missing ${token}`);n++}
assert.ok(!root.native.includes('runWindowsUserMSIRollback(') && !root.native.includes('consumeGrant('),'cascade may never execute or consume grants');n++;
console.log(`${n}/${n} Pass45 executable cascade contract, Desktop tamper and native source tests passed`);
