import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=rel=>readFileSync(new URL('../../'+rel,import.meta.url),'utf8');
const compiled=ts.transpileModule(read('packages/renderer/src/features/settings/msi-rollback-review.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
Function('module','exports',`'use strict';${compiled}`)(module,module.exports);
const verify=module.exports.validMSIRollbackReview;
assert.equal(typeof verify,'function');let count=1;
const sha=(c)=>c.repeat(64);
const base={schema:1,packageKey:'studio-core',state:'reviewable_not_authorized',readOnly:true,osAttested:false,mutationAuthorized:false,rollbackAuthorized:false,
 priorReceiptSha256:sha('a'),upgradeJournalSha256:sha('b'),predecessorMsiSha256:sha('c'),successorMsiSha256:sha('d'),
 predecessorProductVersion:'1.4.2',successorProductVersion:'1.5.0',knownDependents:[],settledDependents:[],outstandingDependents:[],recoveryOrder:['studio-core'],blockers:[],
 warnings:['external_os_dependents_not_excluded','windows_installer_downgrade_semantics_unverified','application_health_not_attested','independent_rollback_grant_required']};
const clone=()=>structuredClone(base);
assert.equal(verify(base,'studio-core'),true);count++;
const dependent=clone();dependent.state='blocked';dependent.knownDependents=['studio-project','studio-editor'];dependent.outstandingDependents=['studio-project','studio-editor'];dependent.recoveryOrder=['studio-project','studio-editor','studio-core'];dependent.blockers=['dependent_packages_require_separate_ordered_disposition'];
assert.equal(verify(dependent,'studio-core'),true);count++;
for(const [name,mutate] of Object.entries({
 'foreign key':x=>x.packageKey='foreign','schema':x=>x.schema=2,'unsafe state':x=>x.state='ready_to_rollback',
 'authorizes':x=>x.rollbackAuthorized=true,'mutation':x=>x.mutationAuthorized=true,'attests':x=>x.osAttested=true,
 'not readonly':x=>x.readOnly=false,'missing ancestor receipt':x=>delete x.priorReceiptSha256,
 'invalid journal':x=>x.upgradeJournalSha256='!','forged original installer':x=>x.predecessorMsiSha256='BAD',
 'forged successor installer':x=>x.successorMsiSha256=sha('Z'),
 'bad predecessor version':x=>x.predecessorProductVersion='1.999999.2',
 'downgrade in forward journal':x=>x.successorProductVersion='1.4.1',
 'different major':x=>x.successorProductVersion='2.0.0',
 'equal version':x=>x.successorProductVersion='1.4.2',
 'missing order':x=>delete x.recoveryOrder,
 'empty order':x=>x.recoveryOrder=[],
 'order wrong target':x=>x.recoveryOrder=['foreign'],
 'repeated node':x=>{x.recoveryOrder=['studio-core','studio-core'];x.knownDependents=['studio-core']},
 'not complete order':x=>x.knownDependents=['studio-editor'],
 'unknown dependency order':x=>{x.recoveryOrder=['studio-editor','studio-core'];x.knownDependents=['other']},
 'unauthorized state with blocker':x=>x.blockers=['unexpected_record'],
 'block without reason':x=>x.state='blocked',
 'bad reason type':x=>{x.state='blocked';x.blockers=[true]},
 'bad warning type':x=>x.warnings=[{}],
 'bad warning token':x=>x.warnings=['<script>'],
 'no warnings':x=>x.warnings=[],
 'nonarray dependents':x=>x.knownDependents='studio-editor',
 'oversized order':x=>{x.recoveryOrder=Array.from({length:65},(_,i)=>`key-${i}`);x.recoveryOrder[64]='studio-core';x.knownDependents=x.recoveryOrder.slice(0,64)}
})) {const x=clone();mutate(x);assert.equal(verify(x,'studio-core'),false,name);count++}
const files={go:read('tools/native/package-stager-go/msi_rollback_review.go'),cli:read('tools/native/package-stager-go/main.go'),
 executable:read('tools/native/package-stager-go/msi_upgrade_execution.go'),qt:read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),
 desktop:read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),bridge:read('packages/renderer/src/core/desktop.ts'),
 journal:read('tools/native/package-stager-go/msi_repair.go'),reader:read('tools/native/package-stager-go/msi_repair_status.go')};
const checks={
 go:['rollbackDependencyOrder','knownMSIDependencyEdges','reviewMSIRollbackWithProfile','predecessor_installer_integrity_missing','successor_installer_integrity_missing','dependent_packages_require_separate_ordered_disposition','MutationAuthorized: false','RollbackAuthorized: false'],
 cli:['case "msi-rollback-review":','CLUSTER_MSI_ROLLBACK_REVIEW','inspectMSIRollbackReview'],
 executable:['MSIPath:','status.Receipt.MSIPath != m.Installer.Path'],
 qt:['package.msiRollbackReview','CLUSTER_MSI_ROLLBACK_REVIEW','mutationAuthorized','rollbackAuthorized','recoveryOrder'],
 desktop:['validMSIRollbackReview(report, target.package.key)','Review MSI rollback readiness…','inspectNativeMSIRollbackReview'],
 bridge:['package.msiRollbackReview','ClusterNativeMSIRollbackReview','inspectNativeMSIRollbackReview'],
 journal:['MSIPath','msiPath,omitempty'],reader:['receipt.MSIPath != ""']};
for(const [name,needles] of Object.entries(checks))for(const needle of needles){assert(files[name].includes(needle),`${name}: ${needle}`);count++}
console.log(`${count}/${count} Pass43 executable Desktop rollback-review validator and cross-layer contracts passed`);
