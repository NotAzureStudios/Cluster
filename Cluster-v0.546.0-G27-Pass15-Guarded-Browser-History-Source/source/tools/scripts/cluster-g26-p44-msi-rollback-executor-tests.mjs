import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const module={exports:{}};
const compiled=ts.transpileModule(read('packages/renderer/src/features/settings/msi-rollback-journal.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
Function('module','exports',`'use strict';${compiled}`)(module,module.exports);
const valid=module.exports.validMSIRollbackJournal;
assert.equal(typeof valid,'function');let n=1;
const digest=x=>x.repeat(64);
const receipt={schema:1,operation:'msi-rollback',packageKey:'studio-core',state:'msi-rollback_exit_zero_not_os_attested',
  version:'1.4.2',artifactSha256:digest('a'),msiSha256:digest('b'),msiPath:'install/studio-core.msi',
  productCode:'{AABBCCDD-1234-5678-ABCD-1234567890AB}',productVersion:'1.4.2',priorProductVersion:'1.5.0',
  priorReceiptSha256:digest('c'),priorMsiSha256:digest('b'),upgradeJournalSha256:digest('d'),successorMsiSha256:digest('e'),
  osAttested:false,startedAt:'2026-10-24T18:00:00Z',launchCommittedAt:'2026-10-24T18:01:00Z',finishedAt:'2026-10-24T18:03:00Z',exitCode:0};
const state={schema:1,packageKey:'studio-core',state:receipt.state,readOnly:true,osAttested:false,retryAuthorized:false,hasReceipt:true,manualReviewRequired:true,
  receiptSha256:digest('f'),receipt,rollbackRecovery:{state:'rollback_predecessor_registered_not_health_attested',readOnly:true,osAttested:false,rollbackConfirmed:false,
  registration:{state:'registered_version_match',productCode:receipt.productCode,expectedVersion:receipt.productVersion,reportedVersion:'1.4.2',
    readOnly:true,osAttested:false,probeComplete:true,probeScope:'current_user_and_machine',versionMatches:true}}};
const clone=()=>structuredClone(state);
assert.equal(valid(state,'studio-core'),true);n++;
for(const [label,change] of Object.entries({
  'wrong product key':s=>s.packageKey='other', 'no inspection schema':s=>s.schema=5,
  'forged OS attestation':s=>s.osAttested=true, 'retry authorized':s=>s.retryAuthorized=true,
  'not readonly':s=>s.readOnly=false,'no manual review':s=>s.manualReviewRequired=false,
  'missing receipt digest':s=>delete s.receiptSha256,'bad operation':s=>s.receipt.operation='upgrade',
  'wrong stored operation':s=>s.receipt.state='msi-rollback_prepared_not_launched',
  'wrong product code':s=>s.receipt.productCode='not-code', 'changed installer':s=>s.receipt.msiSha256=digest('f'),
  'invalid prior digest':s=>s.receipt.priorMsiSha256='invalid', 'missing upgrade digest':s=>s.receipt.upgradeJournalSha256='',
  'forged successor digest':s=>s.receipt.successorMsiSha256='zz'.repeat(32),
  'identical product versions':s=>s.receipt.priorProductVersion='1.4.2',
  'invalid predecessor version':s=>s.receipt.productVersion='1.4.2.999',
  'unsafe path':s=>s.receipt.msiPath='../outside.msi', 'absolute path':s=>s.receipt.msiPath='/install.msi',
  'wrong path suffix':s=>s.receipt.msiPath='file.txt', 'journal says OS attested':s=>s.receipt.osAttested=true,
  'missing registration':s=>delete s.rollbackRecovery.registration,
  'fabricated recovery':s=>s.rollbackRecovery.state='rollback_confirmed',
  'fake recovery attestation':s=>s.rollbackRecovery.osAttested=true,
  'fake rollback success':s=>s.rollbackRecovery.rollbackConfirmed=true,
  'wrong registration product':s=>s.rollbackRecovery.registration.productCode='{FFFFFFFF-1234-5678-ABCD-1234567890AB}',
  'wrong expected registration':s=>s.rollbackRecovery.registration.expectedVersion='1.5.0',
  'incomplete registered scope':s=>s.rollbackRecovery.registration.probeScope='current_user',
  'mismatched registered version':s=>s.rollbackRecovery.registration.reportedVersion='1.5.0',
  'wrong registered-match flag':s=>s.rollbackRecovery.registration.versionMatches=false,
})) {const x=clone();change(x);assert.equal(valid(x,'studio-core'),false,label);n++}
const successor=clone();successor.rollbackRecovery.state='rollback_successor_remains_registered';successor.rollbackRecovery.registration.state='registered_version_mismatch';successor.rollbackRecovery.registration.reportedVersion='1.5.0';successor.rollbackRecovery.registration.versionMatches=false;
assert.equal(valid(successor,'studio-core'),true);n++;
const missing=clone();missing.rollbackRecovery.state='rollback_product_not_registered';missing.rollbackRecovery.registration.state='not_registered_for_user';missing.rollbackRecovery.registration.reportedVersion='';missing.rollbackRecovery.registration.versionMatches=false;
assert.equal(valid(missing,'studio-core'),true);n++;
const unavailable=clone();unavailable.rollbackRecovery.state='rollback_registration_unavailable';unavailable.rollbackRecovery.registration.probeComplete=false;unavailable.rollbackRecovery.registration.versionMatches=false;assert.equal(valid(unavailable,'studio-core'),true);n++;
const absent={schema:1,packageKey:'studio-core',state:'no_recorded_msi-rollback',hasReceipt:false,readOnly:true,osAttested:false,retryAuthorized:false,manualReviewRequired:false};
assert.equal(valid(absent,'studio-core'),true);n++;
const sources={native:read('tools/native/package-stager-go/msi_rollback_execution.go'),win:read('tools/native/package-stager-go/msi_windows.go'),
 cli:read('tools/native/package-stager-go/main.go'),inventory:read('tools/native/package-stager-go/msi_lifecycle_inventory.go'),
 reader:read('tools/native/package-stager-go/msi_repair_status.go'),server:read('apps/server/src/domains/inventory/managed-package-routes.ts'),
 qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),renderer:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),
 transport:read('packages/renderer/src/core/desktop.ts'),package:read('package.json')};
const required={native:['rollbackSupervisedMSI','CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION','verifyDeploymentGrant(o, m, signing, "msi-rollback", now)',
  'rollback_'+"\"",'writeFirstMSIRepairReceipt(journalPath, out)','consumeGrant(root, grant)','requireCommittedMSIRollbackJournal','reviewRollbackWithOwnedLocks','acquireMSIFrozenSource','runWindowsUserMSIRollback'],
 win:['func runWindowsUserMSIRollback','requireCommittedMSIRollbackJournal','msiResumeThread.Call','/i '],
 cli:['case "rollback-msi":','case "msi-rollback-status":','CLUSTER_MSI_ROLLBACK_RESULT'],
 inventory:['inspectMSILifecycle','"rollback_"','header.Operation == "msi-rollback"'],
 reader:['inspectMSIRollback','classifyMSIRollbackRecovery','receipt.SuccessorMSISha256 == receipt.MSISha256','receipt.MSISha256 != receipt.PriorMSISha256'],
 server:['CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_GRANTS','CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION','supervised_user_msi_rollback','priorReceiptSha256','successorMsiSha256'],
 qt:['package.rollbackMsi','package.msiRollbackStatus','validNativeMSIRollbackRecovery','ROLLBACK ','upgradeJournalSha256','pendingRollback'],
 renderer:['runMSIRollback(target)','inspectMSIRollbackJournal(target)','validMSIRollbackJournal(item, item.packageKey)','pendingRollback','runNativeSupervisedMSIRollback'],
 transport:['runNativeSupervisedMSIRollback','inspectNativeMSIRollbackStatus','msi_rollback_process_exited','ClusterNativeMSIRollbackStatus'],
 package:['cluster:g26:p44:msi-rollback-executor']};
for(const [name,tokens] of Object.entries(required))for(const token of tokens){assert.ok(sources[name].includes(token),`${name} missing ${token}`);n++;}
assert.ok(!sources.native.includes('runWindowsUserMSIUninstall('),'Rollback executor must not force uninstall');n++;
assert.ok(sources.native.includes('len(late.OutstandingDependents) != 0') && sources.native.includes('len(review.SettledDependents) != len(review.KnownDependents)'), 'Rollback requires each separately disposed dependent; no automatic traversal');n++;
assert.ok(sources.qt.includes('QInputDialog::getText') && sources.renderer.includes('nativeRollbackAvailable !== true'));n+=2;
console.log(`${n}/${n} Pass44 executable rollback journal validator and source custody checks passed`);
