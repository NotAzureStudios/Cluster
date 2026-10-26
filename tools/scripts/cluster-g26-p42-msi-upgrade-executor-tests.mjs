import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const code=read('packages/renderer/src/features/settings/msi-upgrade-recovery.ts');
const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
Function('module','exports',`'use strict';${compiled}`)(module,module.exports);
const verify=module.exports.validUpgradeRecoveryEvidence;
assert.equal(typeof verify,'function');
let checks=1;
const prior={operation:'upgrade', productCode:'{AABBCCDD-1234-5678-ABCD-1234567890AB}',productVersion:'1.5.0',priorProductVersion:'1.4.2'};
const record={receipt:prior,upgradeRecovery:{state:'upgrade_target_registered_not_health_attested',readOnly:true,osAttested:false,rollbackAuthorized:false,
  registration:{state:'registered_version_match',productCode:prior.productCode,expectedVersion:'1.5.0',reportedVersion:'1.5.0',versionMatches:true,readOnly:true,osAttested:false,probeComplete:true,probeScope:'current_user_and_machine'}}};
const clone=()=>structuredClone(record);
assert.equal(verify(record),true);checks++;
for(const [name, mutate] of Object.entries({
 'wrong product':r=>r.upgradeRecovery.registration.productCode='other',
 'wrong expected version':r=>r.upgradeRecovery.registration.expectedVersion='1.4.2',
 'forged attestation':r=>r.upgradeRecovery.osAttested=true,
 'forged rollback':r=>r.upgradeRecovery.rollbackAuthorized=true,
 'not read only':r=>r.upgradeRecovery.readOnly=false,
 'registration attestation':r=>r.upgradeRecovery.registration.osAttested=true,
 'incomplete probe':r=>r.upgradeRecovery.registration.probeComplete=false,
 'wrong scope':r=>r.upgradeRecovery.registration.probeScope='current_user',
 'wrong registered revision':r=>r.upgradeRecovery.registration.reportedVersion='1.5.1',
 'inconsistent target':r=>r.upgradeRecovery.state='upgrade_predecessor_remains_registered',
 'wrong matching flag':r=>r.upgradeRecovery.registration.versionMatches=false,
 'missing upgrade observation':r=>delete r.upgradeRecovery,
 'missing registration':r=>delete r.upgradeRecovery.registration,
 'missing source receipt':r=>delete r.receipt,
 'not upgraded operation':r=>r.receipt.operation='repair',
})){const v=clone();mutate(v);assert.equal(verify(v),false, name);checks++;}
const predecessor=clone();predecessor.upgradeRecovery.state='upgrade_predecessor_remains_registered';
predecessor.upgradeRecovery.registration.state='registered_version_mismatch';predecessor.upgradeRecovery.registration.reportedVersion='1.4.2';predecessor.upgradeRecovery.registration.versionMatches=false;
assert.equal(verify(predecessor),true);checks++;
const absent=clone();absent.upgradeRecovery.state='upgrade_product_not_registered';absent.upgradeRecovery.registration.state='not_registered_for_user';absent.upgradeRecovery.registration.reportedVersion='';absent.upgradeRecovery.registration.versionMatches=false;
assert.equal(verify(absent),true);checks++;
const unavailable=clone();unavailable.upgradeRecovery.state='upgrade_registration_unavailable';unavailable.upgradeRecovery.registration.probeComplete=false;unavailable.upgradeRecovery.registration.versionMatches=false;
assert.equal(verify(unavailable),true);checks++;
const paths={
 native:read('tools/native/package-stager-go/msi_upgrade_execution.go'),
 journal:read('tools/native/package-stager-go/msi_repair_status.go'),
 windows:read('tools/native/package-stager-go/msi_windows.go'),
 cli:read('tools/native/package-stager-go/main.go'),
 server:read('apps/server/src/domains/inventory/managed-package-routes.ts'),
 qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),
 renderer:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),
 transport:read('packages/renderer/src/core/desktop.ts'),
};
const required={
 native:['CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION','verifyDeploymentGrant(o, m, signingPin, "upgrade", now)','writeFirstMSIRepairReceipt(journalPath, out)','consumeGrant(root, grant)','reviewUpgradeWithOwnedLocks','acquireMSIFrozenSource(previousPath, grant.PriorMSISha256)','runWindowsUserMSIUpgrade(target, predecessor','requireCommittedMSIUpgradeJournal'],
 journal:['operation != "upgrade"','classifyMSIUpgradeRecovery','compareMSIVersions'],
 windows:['func runWindowsUserMSIUpgrade','predecessor.verify()','requireCommittedMSIUpgradeJournal','msiResumeThread.Call'],
 cli:['case "upgrade-msi":','case "msi-upgrade-status":','CLUSTER_MSI_UPGRADE_RESULT','CLUSTER_MSI_UPGRADE_STATUS'],
 server:['CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS','supervised_user_msi_upgrade','nativeUpgradeAvailable','CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION','priorMsiSha256'],
 qt:['package.upgradeMsi','package.msiUpgradeStatus','installerUpgrade','CLUSTER_MSI_UPGRADE_RESULT','validNativeMSIUpgradeRecovery','UPGRADE existing signed per-user MSI'],
 renderer:['runMSIUpgrade(target)','inspectMSIUpgradeJournal(target)','validUpgradeRecoveryEvidence','priorMsiSha256: snapshot.priorMsiSha256','msiGrantPending.current = true'],
 transport:['runNativeSupervisedMSIUpgrade','inspectNativeMSIUpgrade','msi_upgrade_process_exited','rollbackAuthorized: false'],
};
for(const [name, clauses] of Object.entries(required)) for(const clause of clauses){assert(paths[name].includes(clause),`${name}: missing ${clause}`);checks++;}
// The pre-upgrade installation receipt must never be overwritten by the
// successor operation; persistent journal is stored in a distinct tree.
assert(paths.native.includes('"msi-lifecycle"') && paths.native.includes('"msi-attempts"'));
checks++;
console.log(`${checks}/${checks} Pass42 executed production renderer registration-tamper and cross-layer upgrade admission assertions passed`);
