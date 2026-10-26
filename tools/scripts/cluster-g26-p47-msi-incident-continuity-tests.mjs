import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const read = p => readFileSync(new URL('../../'+p,import.meta.url), 'utf8');
const module = {exports:{}};
Function('module','exports',`'use strict';${ts.transpileModule(read('packages/renderer/src/features/settings/msi-rollback-cascade.ts'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText}`)(module,module.exports);
const valid = module.exports.validMSIRollbackCascade;
const hash=c=>c.repeat(64);let checks=0;
const check=(expression,description)=>{assert.equal(expression,true,description);checks++};
const base={schema:1,packageKey:'studio-core',state:'independent_dispositions_required',readOnly:true,osAttested:false,
 mutationAuthorized:false,automaticExecution:false,priorReceiptSha256:hash('a'),upgradeJournalSha256:hash('b'),
 manualRecoveryRequired:false,manualReviewPackages:[],nextReviewablePackageKey:'studio-project',
 warnings:['unknown_external_dependents_not_excluded','separate_signed_grant_required_per_package','no_automatic_cascade_or_retry','windows_and_application_health_not_attested'],
 blockers:[],recoveryOrder:['studio-project','studio-editor','studio-core'],steps:[
 {index:0,packageKey:'studio-project',operation:'uninstall',state:'independent_operator_review_required',recordedReceiptSha256:hash('c'),waitingFor:[],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'request_independent_authorization'},
 {index:1,packageKey:'studio-editor',operation:'uninstall',state:'awaiting_prior_dispositions',recordedReceiptSha256:hash('d'),waitingFor:['studio-project'],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'wait_for_independent_dispositions'},
 {index:2,packageKey:'studio-core',operation:'msi-rollback',state:'awaiting_prior_dispositions',recordedReceiptSha256:hash('a'),waitingFor:['studio-project','studio-editor'],blockers:[],separateAuthorizationRequired:true,dispositionObserved:false,mutationAuthorized:false,lifecycleJournalSha256:'',lifecycleJournalState:'not_recorded',recoveryAction:'wait_for_independent_dispositions'}
 ]};
const clone=(x=base)=>structuredClone(x);
check(valid(base,'studio-core'),'baseline with one reviewable step');
const firstSettled=clone();firstSettled.steps[0].dispositionObserved=true;firstSettled.steps[0].state='observed_uninstall_registration_absent';firstSettled.steps[0].lifecycleJournalSha256=hash('e');firstSettled.steps[0].lifecycleJournalState='uninstall_exit_zero_not_os_attested';firstSettled.steps[0].recoveryAction='preserve_completed_disposition';firstSettled.steps[1].state='independent_operator_review_required';firstSettled.steps[1].recoveryAction='request_independent_authorization';firstSettled.nextReviewablePackageKey='studio-editor';
check(valid(firstSettled,'studio-core'),'one settled journal retained with next step');
const bothSettled=clone(firstSettled);bothSettled.steps[1].dispositionObserved=true;bothSettled.steps[1].state='observed_uninstall_registration_absent';bothSettled.steps[1].lifecycleJournalSha256=hash('f');bothSettled.steps[1].lifecycleJournalState='uninstall_exit_zero_not_os_attested';bothSettled.steps[1].recoveryAction='preserve_completed_disposition';bothSettled.steps[2].state='independent_operator_review_required';bothSettled.steps[2].recoveryAction='request_independent_authorization';bothSettled.nextReviewablePackageKey='studio-core';
check(valid(bothSettled,'studio-core'),'both settled, parent reviewable, no automatic execution');
const interrupted=clone(firstSettled);interrupted.steps[1].lifecycleJournalSha256=hash('f');interrupted.steps[1].lifecycleJournalState='uninstall_started_outcome_unknown';interrupted.steps[1].state='blocked';interrupted.steps[1].blockers=['dependent_lifecycle_outcome_unconfirmed'];interrupted.steps[1].recoveryAction='manual_recovery_no_replay';interrupted.nextReviewablePackageKey='';interrupted.manualRecoveryRequired=true;interrupted.manualReviewPackages=['studio-editor'];interrupted.state='blocked';interrupted.blockers=['studio-editor:review_blocked'];
check(valid(interrupted,'studio-core'),'interrupted child remains manual review and blocks root');
for(const state of ['uninstall_prepared_not_launched','uninstall_failed_or_outcome_unknown','uninstall_restart_required_not_os_attested','uninstall_exit_zero_not_os_attested']){
 const incident=clone(interrupted);incident.steps[1].lifecycleJournalState=state;check(valid(incident,'studio-core'),`valid manual review state ${state}`);
}
const missingSource=clone(base);missingSource.steps[0].state='blocked';missingSource.steps[0].blockers=['missing_msi_source'];missingSource.steps[0].recoveryAction='resolve_evidence_blocker';missingSource.nextReviewablePackageKey='';missingSource.state='blocked';missingSource.blockers=['studio-project:review_blocked'];
check(valid(missingSource,'studio-core'),'missing source review is not journaled retry');
for(const [label, mutate] of Object.entries({
 'fake direct grant':x=>x.steps[1].recoveryAction='request_independent_authorization',
 'hides manual flag':x=>x.manualRecoveryRequired=false,
 'hides manual child':x=>x.manualReviewPackages=[],
 'reorders manual child':x=>x.manualReviewPackages=['studio-project'],
 'duplicate manual child':x=>x.manualReviewPackages=['studio-editor','studio-editor'],
 'invented next action':x=>x.nextReviewablePackageKey='studio-editor',
 'wrong journal digest':x=>x.steps[1].lifecycleJournalSha256='xyz',
 'missing journal digest':x=>x.steps[1].lifecycleJournalSha256='',
 'journal marked unrecorded':x=>x.steps[1].lifecycleJournalState='not_recorded',
 'foreign lifecycle state':x=>x.steps[1].lifecycleJournalState='repair_exit_zero_not_os_attested',
 'unknown journal state':x=>x.steps[1].lifecycleJournalState='uninstall_done_healthy',
 'unrecorded state mismatch':x=>x.steps[0].lifecycleJournalState='uninstall_started_outcome_unknown',
 'authorization on child':x=>x.steps[1].mutationAuthorized=true,
 'false disposition':x=>x.steps[1].dispositionObserved=true,
 'impossible root journal':x=>{x.steps[2].lifecycleJournalSha256=hash('f');x.steps[2].lifecycleJournalState='uninstall_exit_zero_not_os_attested'},
 'removes manual action':x=>delete x.steps[1].recoveryAction,
 'action contradiction':x=>x.steps[1].recoveryAction='resolve_evidence_blocker',
 'no journal blocker':x=>x.steps[1].blockers=['registration_failed'],
 'summary pretends ready':x=>x.state='independent_dispositions_required',
 'summary blocker hidden':x=>x.blockers=[],
 'different receipt':x=>x.steps[1].recordedReceiptSha256='broken',
 'wrong wait order':x=>x.steps[2].waitingFor.reverse(),
 'marked attested':x=>x.osAttested=true,
 'automatic execution':x=>x.automaticExecution=true,
 'summary mutates':x=>x.mutationAuthorized=true,
 'wrong SHA type':x=>x.steps[1].lifecycleJournalSha256=42,
 'manual string not array':x=>x.manualReviewPackages='studio-editor',
 'next key as object':x=>x.nextReviewablePackageKey={},
 'root disposition':x=>x.steps[2].dispositionObserved=true,
 'two ready actions':x=>{x.steps[2].state='independent_operator_review_required';x.steps[2].recoveryAction='request_independent_authorization'},
})) { const forged=clone(interrupted); mutate(forged); check(!valid(forged,'studio-core'),`reject ${label}`); }
for(const [label, mutate] of Object.entries({
 'invented manual review from missing source':x=>{x.manualRecoveryRequired=true;x.manualReviewPackages=['studio-project']},
 'pretend no next reviewable':x=>x.nextReviewablePackageKey='',
 'forged next identity':x=>x.nextReviewablePackageKey='studio-core',
 'fake completion without journal':x=>{x.steps[0].dispositionObserved=true;x.steps[0].state='observed_uninstall_registration_absent';x.steps[0].recoveryAction='preserve_completed_disposition'},
 'missing child lifecycle state':x=>delete x.steps[0].lifecycleJournalState,
 'unrecorded SHA':x=>x.steps[1].lifecycleJournalSha256=hash('0'),
 'action says manual without journal':x=>x.steps[0].recoveryAction='manual_recovery_no_replay',
})) {const forged=clone(base);mutate(forged);check(!valid(forged,'studio-core'),`reject ${label}`);}
const sources={native:read('tools/native/package-stager-go/msi_rollback_cascade.go'),review:read('tools/native/package-stager-go/msi_rollback_review.go'),goTests:read('tools/native/package-stager-go/msi_rollback_incident_test.go'),qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),ui:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),transport:read('packages/renderer/src/core/desktop.ts')};
for(const [where,tokens] of Object.entries({
 native:['ManualRecoveryRequired','ManualReviewPackages','NextReviewablePackageKey','LifecycleJournalSha256','LifecycleJournalState','RecoveryAction','manual_recovery_no_replay','duplicate lifecycle journal'],
 review:['observedSettledMSIUninstall','SettledDependents','OutstandingDependents'],
 goTests:['TestCascadeIncidentCustodyAndSingleNextAction','TestCascadeIncidentForgeriesAreRefused','uninstall_started_outcome_unknown'],
 qt:['manualRecoveryRequired','manualReviewPackages','nextReviewablePackageKey','lifecycleJournalSha256','recoveryAction','expectedManualPackages','expectedNextReviewable'],
 ui:['manualRecoveryRequired','nextReviewablePackageKey','lifecycleJournalSha256','manual recovery'],
 transport:['manualReviewPackages: string[]','nextReviewablePackageKey: string','lifecycleJournalState: string','manual_recovery_no_replay']
})) for(const token of tokens) check(sources[where].toLowerCase().includes(token.toLowerCase()),`${where} implements ${token}`);
check(!sources.native.includes('consumeGrant(') && !sources.native.includes('runWindowsUserMSIRollback('),'read-only incident plan never mutates');
console.log(`${checks}/${checks} Pass47 executable incident continuity and tamper assertions passed`);
