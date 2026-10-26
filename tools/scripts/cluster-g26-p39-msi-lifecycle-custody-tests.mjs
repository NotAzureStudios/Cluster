// Execute the actual production Desktop inventory validator and native lifecycle
// projector. Mutations here model attacker-controlled helper output; no MSI runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const ui=fs.readFileSync(new URL('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('DesktopDevicePackagesPanel.tsx',ui,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let verifier='';
(function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='verifyReadOnlyMSIProfile')verifier=node.getText(ast);ts.forEachChild(node,visit)})(ast);
assert(verifier);
const projectorCode=ts.transpileModule(fs.readFileSync(new URL('../../packages/renderer/src/features/settings/msi-lifecycle-planning.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exposed={};Function('exports',projectorCode)(exposed);
const js=ts.transpileModule(verifier,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const verifyModule={};
const upgradeValidator=ts.transpileModule(fs.readFileSync(new URL('../../packages/renderer/src/features/settings/msi-upgrade-recovery.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
Function('exports',upgradeValidator)(verifyModule);
const check=Function('validateMSILifecyclePlans','verifyReadOnlyMSIEvidence','validUpgradeRecoveryEvidence',`"use strict";${js};return verifyReadOnlyMSIProfile`)(exposed.validateMSILifecyclePlans,()=>{},verifyModule.validUpgradeRecoveryEvidence);
const sha=x=>x.repeat(64);
const entry={schema:1,packageKey:'studio-core',state:'repair_prepared_not_launched',hasReceipt:true,readOnly:true,osAttested:false,retryAuthorized:false,manualReviewRequired:true,receiptSha256:sha('d'),
 receipt:{schema:1,operation:'repair',packageKey:'studio-core',version:'2.1.0',artifactSha256:sha('a'),msiSha256:sha('b'),productCode:'{12345678-1234-ABCD-ABCD-1234567890AB}',productVersion:'2.1.0',priorReceiptSha256:sha('c'),state:'repair_prepared_not_launched',startedAt:'2026-10-24T01:00:00Z',osAttested:false}};
const base={schema:1,state:'msi_profile_manual_review',readOnly:true,osAttested:false,retryAuthorized:false,complete:true,manualReviewRequired:true,admissionLockPresent:false,records:[],lifecycleRecords:[entry],lifecycleMutationAuthorized:false,lifecyclePlans:[],dependencyEdges:[]};
let checks=0;assert.doesNotThrow(()=>check(base));checks++;
const blocked=(name,fn)=>{const x=structuredClone(base);fn(x);assert.throws(()=>check(x),/MSI|inventory|lifecycle/,name);checks++};
for(const [name,mutate] of Object.entries({
 'missing lifecycle array':p=>delete p.lifecycleRecords,
 'silent manual review':p=>p.manualReviewRequired=false,
 'false clean profile':p=>p.state='no_recorded_msi_attempts',
 'forged mutation grant':p=>p.lifecycleMutationAuthorized=true,
 'false no receipt':p=>p.lifecycleRecords[0].hasReceipt=false,
 'false no manual review':p=>p.lifecycleRecords[0].manualReviewRequired=false,
 'forged attestation':p=>p.lifecycleRecords[0].osAttested=true,
 'forged replay':p=>p.lifecycleRecords[0].retryAuthorized=true,
 'forged receipt attestation':p=>p.lifecycleRecords[0].receipt.osAttested=true,
 'unknown lifecycle operation':p=>p.lifecycleRecords[0].receipt.operation='upgrade',
 'bad original receipt binding':p=>p.lifecycleRecords[0].receipt.priorReceiptSha256='broken',
 'corrupt package':p=>p.lifecycleRecords[0].receipt.packageKey='different',
 'invalid journal state':p=>p.lifecycleRecords[0].receipt.state='repair_started_outcome_unknown',
 'new unrecognized state':p=>p.lifecycleRecords[0].state='repair_certified',
 'bad MSI SHA':p=>p.lifecycleRecords[0].receipt.msiSha256='bad',
 'bad ProductCode':p=>p.lifecycleRecords[0].receipt.productCode='{not-a-product}',
 'bad ProductVersion':p=>p.lifecycleRecords[0].receipt.productVersion='1.2.3.4',
 'duplicate journal':p=>p.lifecycleRecords.push(structuredClone(entry)),
 'unsorted journal':p=>p.lifecycleRecords.unshift({...entry,packageKey:'zebra-key',receipt:{...entry.receipt,packageKey:'zebra-key'}}),
}))blocked(name,mutate);
// Execute the deterministic lifecycle projector against a recorded package and
// tampered appended blocker, never allowing the stale install receipt to pass.
const record={schema:1,packageKey:'studio-core',state:'msi_exit_zero_not_os_attested',hasReceipt:true,manualReviewRequired:true,receiptSha256:sha('c'),lockPresent:false,admissionLockPresent:false,
 attempt:{preLaunchRegistration:{state:'not_registered_for_user'},postExitRegistration:{state:'registered_version_match'}},product:{state:'registered_version_match',probeComplete:true,versionMatches:true,probeScope:'current_user_and_machine'},registrationDrift:'registration_unchanged_since_exit'};
const profile={...base,records:[record]};
profile.lifecyclePlans=exposed.expectedMSILifecyclePlans(profile);
assert.equal(profile.lifecyclePlans.length,3);assert(profile.lifecyclePlans.every(x=>x.state==='blocked'&&x.blockers.includes('prior_lifecycle_operation_recorded')));checks++;
assert.doesNotThrow(()=>check(profile));checks++;
blocked('fake plan with no prior operation blocker',p=>{p.records=[record];p.lifecyclePlans=exposed.expectedMSILifecyclePlans({...p,lifecycleRecords:[]});});
const qt=fs.readFileSync(new URL('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp',import.meta.url),'utf8');
const native=fs.readFileSync(new URL('../native/package-stager-go/msi_profile_status.go',import.meta.url),'utf8');
for(const token of ['lifecycleRecords.size() <= 64','prior_lifecycle_operation_recorded','validLifecycleRecords','lifecycleSha.match(receipt.value']){assert(qt.includes(token),token);checks++}
for(const token of ['readMSILifecycleInventory(abs, start.lifecycleNames)','sameMSIProfileSnapshot(start, terminal)','prior_lifecycle_operation_recorded']){assert(native.includes(token),token);checks++}
console.log(`${checks}/${checks} executed Pass39 MSI lifecycle custody, profile tamper, and independent Qt/native checks passed`);
