import {validateMSILifecyclePlans,withMSILifecyclePlans} from "./cluster-g26-msi-lifecycle-test-support.mjs";
// Focused cross-language safety contract; Go classification tests run separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('../native/package-stager-go/msi_boot_observation.go');
const windows=read('../native/package-stager-go/msi_boot_windows.go');
const other=read('../native/package-stager-go/msi_boot_other.go');
const attempt=read('../native/package-stager-go/msi_attempt_status.go');
const tests=read('../native/package-stager-go/msi_boot_observation_test.go');
const panel=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const types=read('../../packages/renderer/src/core/desktop.ts');
const qt=read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
let count=0;
for(const [source,markers] of [
  [native,['msiBootComparisonMargin','classifyMSIBootObservation','queryMSISystemUptime()',
    'reboot_indicated_unverified','same_boot_indicated_unverified','boot_relation_ambiguous','os_uptime_unavailable',
    'RebootConfirmed','OSAttested','ReadOnly','boot.After(reference.Add(msiBootComparisonMargin))']],
  [windows,['//go:build windows','GetTickCount64','time.Now().UTC()']],
  [other,['//go:build !windows','Windows uptime observation unavailable']],
  [attempt,['BootObservation        *msiBootObservation','inspectMSIBootObservation(receipt)']],
  [tests,['TestMSIBootObservationsDoNotAuthorizeRecovery','TestMSIBootObservationRefusesFutureAndMalformedAttempt']],
  [panel,['verifyMSIBootObservation(report)','boot.rebootConfirmed !== false','OS uptime comparison:',
    'Wall-clock changes can affect this estimate','item.bootObservation?.state']],
  [types,['bootObservation?:','rebootConfirmed: false']],
  [qt,['validNativeMSIBootObservation','validNativeMSIBootObservation(record.value','validNativeMSIBootObservation(value.value',
    'rebootConfirmed','os_uptime_unavailable']]]) {
 for(const marker of markers){assert.ok(source.includes(marker),`missing ${marker}`);count++}
}
const qtChecks = qt.match(/validNativeMSIBootObservation\(/g)?.length || 0;
assert.ok(qtChecks>=5);count++;

// Execute the production renderer validators, with contradictory native data.
import { createRequire } from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const sourceFile=ts.createSourceFile('packages.tsx',panel,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fnNames=new Set(['verifyMSIBootObservation','verifyReadOnlyMSIEvidence','verifyReadOnlyMSIProfile']);
const bodies=new Map();
function walk(node){if(ts.isFunctionDeclaration(node)&&fnNames.has(node.name?.text))bodies.set(node.name.text,node.getText(sourceFile));ts.forEachChild(node,walk)}
walk(sourceFile);
assert.equal(bodies.size,3);count++;
const js=ts.transpileModule([...bodies.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const verify=Function('validateMSILifecyclePlans',`"use strict";${js};return {verifyReadOnlyMSIEvidence,verifyReadOnlyMSIProfile};`)(validateMSILifecyclePlans);
const code='{12345678-1234-ABCD-ABCD-1234567890AB}';
const clean={schema:1,packageKey:'studio-tools',state:'no_recorded_attempt',hasReceipt:false,lockPresent:false,
 admissionLockPresent:false,manualReviewRequired:false,retryAuthorized:false,readOnly:true,osAttested:false};
const boot={state:'reboot_indicated_unverified',readOnly:true,osAttested:false,rebootConfirmed:false,
 anchorRecorded:false,observedAt:'2026-10-25T15:10:00Z',estimatedBootAt:'2026-10-25T14:10:00Z',uptimeMilliseconds:3600000};
const past={...clean, state:'msi_restart_required_not_os_attested',hasReceipt:true,manualReviewRequired:true,
 receiptSha256:'a'.repeat(64),bootObservation:boot,registrationTransition:'historical_receipt_no_transition_evidence',registrationDrift:'no_post_exit_baseline',
 attempt:{state:'msi_restart_required_not_os_attested',packageKey:'studio-tools',version:'1.0.0',
  artifactSha256:'b'.repeat(64),msiSha256:'c'.repeat(64),productCode:code,productVersion:'1.0.0',osAttested:false},
 product:{state:'registered_version_match',productCode:code,expectedVersion:'1.0.0',reportedVersion:'1.0.0',
  readOnly:true,osAttested:false,probeScope:'current_user_and_machine',probeComplete:true,versionMatches:true}};
for(const good of [clean,{...clean,state:'interrupted_or_active_without_receipt',lockPresent:true,manualReviewRequired:true},
 past,{...past,bootObservation:{state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false}},
 {...past,bootObservation:{...boot,state:'same_boot_indicated_unverified'}},
 {...past,bootObservation:{...boot,state:'boot_relation_ambiguous'}}]){
 verify.verifyReadOnlyMSIEvidence(good,'studio-tools');count++;
}
for(const bad of [
 {...clean,bootObservation:boot},{...past,bootObservation:undefined},
 {...past,bootObservation:{...boot,rebootConfirmed:true}},
 {...past,bootObservation:{...boot,osAttested:true}},
 {...past,bootObservation:{...boot,readOnly:false}},
 {...past,bootObservation:{...boot,state:'installed_successfully'}},
 {...past,bootObservation:{...boot,observedAt:'not-a-timestamp'}},
 {...past,bootObservation:{...boot,estimatedBootAt:undefined}},
 {...past,bootObservation:{...boot,uptimeMilliseconds:-1}},
 {...past,bootObservation:{...boot,uptimeMilliseconds:Number.NaN}},
 {...past,bootObservation:{...boot,uptimeMilliseconds:Infinity}},
 {...past,bootObservation:{...boot,uptimeMilliseconds:315360000001}},
 {...past,bootObservation:{state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false,observedAt:boot.observedAt}},
]) {assert.throws(()=>verify.verifyReadOnlyMSIEvidence(bad,'studio-tools'),/MSI recovery evidence/);count++;}
const profile=withMSILifecyclePlans({schema:1,state:'msi_profile_manual_review',readOnly:true,osAttested:false,retryAuthorized:false,
 complete:true,manualReviewRequired:true,admissionLockPresent:false,records:[past],lifecycleRecords:[],lifecycleMutationAuthorized:false,dependencyEdges:[]});
verify.verifyReadOnlyMSIProfile(profile);count++;
assert.throws(()=>verify.verifyReadOnlyMSIProfile({...profile,records:[{...past,bootObservation:{...boot,rebootConfirmed:true}}]}),/MSI recovery evidence/);count++;
console.log(`${count}/${count} Pass29 MSI uptime-advisory and executed Desktop tamper assertions passed`);
