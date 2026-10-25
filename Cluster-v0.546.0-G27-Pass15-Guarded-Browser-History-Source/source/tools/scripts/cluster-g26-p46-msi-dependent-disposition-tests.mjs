import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
function load(path, symbol) {
  const module={exports:{}};
  Function('module','exports',`'use strict';${ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText}`)(module,module.exports);
  return module.exports[symbol];
}
const validCascade=load('packages/renderer/src/features/settings/msi-rollback-cascade.ts','validMSIRollbackCascade');
const validRollback=load('packages/renderer/src/features/settings/msi-rollback-review.ts','validMSIRollbackReview');
const hash=c=>c.repeat(64);let checks=0;
const check=(cond,message)=>{assert.ok(cond,message);checks++};
const workflow={schema:1,packageKey:'studio-core',state:'independent_dispositions_required',readOnly:true,osAttested:false,
  mutationAuthorized:false,automaticExecution:false,priorReceiptSha256:hash('a'),upgradeJournalSha256:hash('b'),
  warnings:['unknown_external_dependents_not_excluded','separate_signed_grant_required_per_package','no_automatic_cascade_or_retry','windows_and_application_health_not_attested'],
  blockers:[],manualRecoveryRequired:false,manualReviewPackages:[],nextReviewablePackageKey:'studio-editor',recoveryOrder:['studio-project','studio-editor','studio-core'],steps:[
    {index:0,packageKey:'studio-project',operation:'uninstall',state:'observed_uninstall_registration_absent',recordedReceiptSha256:hash('c'),waitingFor:[],blockers:[],dispositionObserved:true,separateAuthorizationRequired:true,mutationAuthorized:false,lifecycleJournalSha256:hash('e'),lifecycleJournalState:'uninstall_exit_zero_not_os_attested',recoveryAction:'preserve_completed_disposition'},
    {index:1,packageKey:'studio-editor',operation:'uninstall',state:'independent_operator_review_required',recordedReceiptSha256:hash('d'),waitingFor:['studio-project'],blockers:[],dispositionObserved:false,separateAuthorizationRequired:true,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'request_independent_authorization'},
    {index:2,packageKey:'studio-core',operation:'msi-rollback',state:'awaiting_prior_dispositions',recordedReceiptSha256:hash('a'),waitingFor:['studio-project','studio-editor'],blockers:[],dispositionObserved:false,separateAuthorizationRequired:true,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'wait_for_independent_dispositions'}
  ]};
const cloned=()=>structuredClone(workflow);
check(validCascade(workflow,'studio-core'),'one dependent disposed');
const all=cloned();all.steps[1].dispositionObserved=true;all.steps[1].state='observed_uninstall_registration_absent';all.steps[1].lifecycleJournalSha256=hash('f');all.steps[1].lifecycleJournalState='uninstall_exit_zero_not_os_attested';all.steps[1].recoveryAction='preserve_completed_disposition';all.steps[2].state='independent_operator_review_required';all.steps[2].recoveryAction='request_independent_authorization';all.nextReviewablePackageKey='studio-core';
check(validCascade(all,'studio-core'),'all dependents disposed with root independently reviewable');
const none=cloned();none.steps[0].dispositionObserved=false;none.steps[0].state='independent_operator_review_required';none.steps[0].lifecycleJournalSha256='';none.steps[0].lifecycleJournalState='not_recorded';none.steps[0].recoveryAction='request_independent_authorization';none.steps[1].state='awaiting_prior_dispositions';none.steps[1].recoveryAction='wait_for_independent_dispositions';none.nextReviewablePackageKey='studio-project';
check(validCascade(none,'studio-core'),'no dependents disposed');
for(const [label,mutate] of Object.entries({
  'fake completed state':x=>x.steps[1].state='observed_uninstall_registration_absent',
  'fake completed boolean':x=>x.steps[1].dispositionObserved=true,
  'missing completion field':x=>delete x.steps[0].dispositionObserved,
  'completion wrong type':x=>x.steps[0].dispositionObserved='true',
  'mutated completion':x=>x.steps[0].mutationAuthorized=true,
  'authorized root':x=>x.steps[2].mutationAuthorized=true,
  'completed root':x=>{x.steps[2].dispositionObserved=true;x.steps[2].state='observed_uninstall_registration_absent'},
  'first step not marked settled':x=>x.steps[0].dispositionObserved=false,
  'blocked yet settled':x=>{x.steps[0].blockers=['tampered'];x.steps[0].state='blocked';x.state='blocked';x.blockers=['studio-project:review_blocked']},
  'later ready too early':x=>x.steps[2].state='independent_operator_review_required',
  'later waits despite predecessor complete':x=>x.steps[1].state='awaiting_prior_dispositions',
  'duplicate observed identity':x=>{x.recoveryOrder[1]='studio-project';x.steps[1].packageKey='studio-project'},
  'wrong original digest':x=>x.steps[0].recordedReceiptSha256='garbage',
  'removed independent gate':x=>x.steps[0].separateAuthorizationRequired=false,
  'inverted waiting order':x=>x.steps[2].waitingFor.reverse(),
  'forged absence attestation':x=>x.osAttested=true,
  'automatic removal':x=>x.automaticExecution=true,
  'transport authorizes mutation':x=>x.mutationAuthorized=true,
  'forged step operation':x=>x.steps[1].operation='msi-rollback',
  'missing blockers envelope':x=>delete x.blockers,
  'changed requested root':x=>x.packageKey='studio-editor',
  'missing predecessor receipt':x=>x.priorReceiptSha256='',
  'invalid recorded journal':x=>x.upgradeJournalSha256='?',
  'wrong version':x=>x.schema=2
})) {const forged=cloned();mutate(forged);check(!validCascade(forged,'studio-core'),label);}
const r={schema:1,packageKey:'studio-core',state:'reviewable_not_authorized',readOnly:true,osAttested:false,mutationAuthorized:false,rollbackAuthorized:false,
 priorReceiptSha256:hash('a'),upgradeJournalSha256:hash('b'),predecessorMsiSha256:hash('c'),successorMsiSha256:hash('d'),
 predecessorProductVersion:'1.4.2',successorProductVersion:'1.5.0',recoveryOrder:['studio-project','studio-editor','studio-core'],
 knownDependents:['studio-project','studio-editor'],settledDependents:['studio-project','studio-editor'],outstandingDependents:[],blockers:[],
 warnings:['external_os_dependents_not_excluded','windows_installer_downgrade_semantics_unverified','application_health_not_attested','independent_rollback_grant_required']};
check(validRollback(r,'studio-core'),'completed dependent partition reviewable');
const partial=structuredClone(r);partial.state='blocked';partial.outstandingDependents=['studio-editor'];partial.settledDependents=['studio-project'];partial.blockers=['dependent_packages_require_separate_ordered_disposition'];
check(validRollback(partial,'studio-core'),'partial disposition must block root');
for(const [label,mutate] of Object.entries({
 'empty partition':x=>x.settledDependents=[],
 'duplicated settlement':x=>x.settledDependents=['studio-project','studio-project'],
 'reordered settlement':x=>x.settledDependents.reverse(),
 'invented settled':x=>x.settledDependents=['studio-project','not-recorded'],
 'invented outstanding':x=>x.outstandingDependents=['studio-editor'],
 'invalid unsettled ready':x=>{x.settledDependents=['studio-project'];x.outstandingDependents=['studio-editor']},
 'reported success despite blocker':x=>{x.blockers=['dependent_packages_require_separate_ordered_disposition']},
 'unauthorized mutation':x=>x.rollbackAuthorized=true,
 'scope attestation':x=>x.osAttested=true,
 'duplicated recovery order':x=>x.recoveryOrder=['studio-project','studio-project','studio-core']
})) {const forged=structuredClone(r);mutate(forged);check(!validRollback(forged,'studio-core'),label);}
const sources={go:read('tools/native/package-stager-go/msi_dependent_disposition.go'),rollback:read('tools/native/package-stager-go/msi_rollback_review.go'),
 cascade:read('tools/native/package-stager-go/msi_rollback_cascade.go'),uninstall:read('tools/native/package-stager-go/msi_uninstall.go'),
 executor:read('tools/native/package-stager-go/msi_rollback_execution.go'),qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),
 ui:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),transport:read('packages/renderer/src/core/desktop.ts')};
for(const [owner,tokens] of Object.entries({
 go:['observedSettledMSIUninstall','not_registered_for_user','current_user_and_machine','ProbeComplete','uninstall_exit_zero_not_os_attested','PriorReceiptSha256 == original.ReceiptSha256'],
 rollback:['SettledDependents','OutstandingDependents','observedSettledMSIUninstall','dependent_packages_require_separate_ordered_disposition'],
 cascade:['DispositionObserved','observed_uninstall_registration_absent','allPriorSettled','SeparateAuthorizationRequired'],
 uninstall:['requireUninstallOfExactKnownMSI','acquireMSIInstallLock'],
 executor:['len(review.OutstandingDependents) != 0','len(review.SettledDependents) != len(review.KnownDependents)','reviewRollbackWithOwnedLocks','consumeGrant'],
 qt:['settledDependents','outstandingDependents','dispositionObserved','allPriorSettled','observed_uninstall_registration_absent'],
 ui:['cascadeEligible','inspectNativeMSIRollbackCascade(saved.packageKey)','fresh.settledDependents','fresh.outstandingDependents','step.dispositionObserved'],
 transport:['outstandingDependents: string[]','settledDependents: string[]','dispositionObserved: boolean']
}))for(const token of tokens)check(sources[owner].includes(token),`${owner}: missing ${token}`);
check(!sources.cascade.includes('consumeGrant(') && !sources.cascade.includes('runWindowsUserMSIRollback('),'read-only workflow must never mutate');
console.log(`${checks}/${checks} Pass46 executable dependent-disposition renderer tamper and native custody checks passed`);
