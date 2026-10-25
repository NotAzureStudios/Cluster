import {validateMSILifecyclePlans,withMSILifecyclePlans} from "./cluster-g26-msi-lifecycle-test-support.mjs";
// Exercise the production Desktop validator against signed-receipt boot anchor
// evidence. These tests cannot make an MSI execute or clear any lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const panel=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const ast=ts.createSourceFile('panel.tsx',panel,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const methods=new Set(['verifyMSIBootObservation','verifyReadOnlyMSIEvidence','verifyReadOnlyMSIProfile']);
const functions=new Map();
function walk(n){if(ts.isFunctionDeclaration(n)&&methods.has(n.name?.text)) functions.set(n.name.text,n.getText(ast));ts.forEachChild(n,walk)}
walk(ast);assert.equal(functions.size,3);
const js=ts.transpileModule([...functions.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const verify=Function('validateMSILifecyclePlans',`"use strict";${js};return {verifyReadOnlyMSIEvidence,verifyReadOnlyMSIProfile}`)(validateMSILifecyclePlans);
const code='{12345678-1234-ABCD-ABCD-1234567890AB}';
const anchor={observedAt:'2026-10-24T10:00:01Z',uptimeMilliseconds:36000000};
const boot={state:'reboot_indicated_unverified',readOnly:true,osAttested:false,rebootConfirmed:false,
 anchorRecorded:true,observedAt:'2026-10-25T15:10:00Z',estimatedBootAt:'2026-10-25T14:10:00Z',uptimeMilliseconds:3600000};
const report={schema:1,packageKey:'studio-tools',state:'msi_restart_required_not_os_attested',hasReceipt:true,
 lockPresent:false,admissionLockPresent:false,manualReviewRequired:true,retryAuthorized:false,readOnly:true,osAttested:false,
 receiptSha256:'a'.repeat(64),bootObservation:boot,registrationTransition:'historical_receipt_no_transition_evidence',registrationDrift:'no_post_exit_baseline',
 attempt:{state:'msi_restart_required_not_os_attested',packageKey:'studio-tools',version:'1.0.0',
  artifactSha256:'b'.repeat(64),msiSha256:'c'.repeat(64),productCode:code,productVersion:'1.0.0',osAttested:false,
  bootAnchor:anchor},
 product:{state:'registered_version_match',productCode:code,expectedVersion:'1.0.0',reportedVersion:'1.0.0',
  readOnly:true,osAttested:false,probeScope:'current_user_and_machine',probeComplete:true,versionMatches:true}};
let count=0;
verify.verifyReadOnlyMSIEvidence(report,'studio-tools');count++;
verify.verifyReadOnlyMSIEvidence({...report,attempt:{...report.attempt,bootAnchor:undefined},bootObservation:{...boot,anchorRecorded:false}},'studio-tools');count++;
const unavailable={...boot,state:'os_uptime_unavailable',observedAt:undefined,estimatedBootAt:undefined,uptimeMilliseconds:undefined};
verify.verifyReadOnlyMSIEvidence({...report,bootObservation:unavailable},'studio-tools');count++;
for(const bad of [
 {...report,bootObservation:{...boot,anchorRecorded:false}},
 {...report,bootObservation:{...boot,rebootConfirmed:true}},
 {...report,attempt:{...report.attempt,bootAnchor:undefined}},
 {...report,attempt:{...report.attempt,bootAnchor:{...anchor,observedAt:'???'}}},
 {...report,attempt:{...report.attempt,bootAnchor:{...anchor,uptimeMilliseconds:-1}}},
 {...report,attempt:{...report.attempt,bootAnchor:{...anchor,uptimeMilliseconds:Infinity}}},
 {...report,attempt:{...report.attempt,bootAnchor:{...anchor,uptimeMilliseconds:315360000001}}},
 {...report,bootObservation:{...unavailable,estimatedBootAt:'2026-10-25T14:10:00Z'}}
]){assert.throws(()=>verify.verifyReadOnlyMSIEvidence(bad,'studio-tools'),/MSI recovery evidence/);count++}
const profile=withMSILifecyclePlans({schema:1,state:'msi_profile_manual_review',readOnly:true,osAttested:false,
 retryAuthorized:false,complete:true,manualReviewRequired:true,admissionLockPresent:false,records:[report],lifecycleRecords:[],lifecycleMutationAuthorized:false,dependencyEdges:[]});
verify.verifyReadOnlyMSIProfile(profile);count++;
assert.throws(()=>verify.verifyReadOnlyMSIProfile({...profile,records:[{...report,bootObservation:{...boot,anchorRecorded:false}}]}),/MSI recovery evidence/);count++;
for(const [text,markers] of [
 [read('../native/package-stager-go/msi_boot_observation.go'),['captureMSIBootAnchor','validateMSIBootAnchor','previousBoot :=','AnchorRecorded','anchorAt.Add(msiBootComparisonMargin)']],
 [read('../native/package-stager-go/msi_installer.go'),['BootAnchor            *msiBootAnchor','bootAnchor := captureMSIBootAnchor()','BootAnchor: bootAnchor']],
 [read('../native/package-stager-go/msi_attempt_status.go'),['validateMSIBootAnchor(receipt.BootAnchor, receipt.StartedAt)']],
 [read('../native/package-stager-go/msi_boot_anchor_test.go'),['TestMSIBootAnchorContinuityAndRestartIndication','TestMSIBootAnchorCorruptionFailsClosed']],
 [read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp'),['validNativeMSIBootAnchor','QStringLiteral("anchorRecorded")','QStringLiteral("bootAnchor")']],
 [read('../native/package-stager-go/msi_registration_continuity.go'),['readMSIRegistrationForRecovery','sameMSIRegistrationObservation','firstQueryOK == secondQueryOK']],
 [read('../native/package-stager-go/msi_registration_continuity_test.go'),['TestMSIRegistrationReadOnlySnapshotsFailClosed']],
 [read('../native/package-stager-go/msi_profile_status.go'),['final read-only registration pass refuses mixed-epoch OS evidence','Windows Installer registration changed during MSI profile inventory']],
 [read('../native/package-stager-go/msi_attempt_status.go'),['firstOK := readMSIRegistrationForRecovery','secondOK := readMSIRegistrationForRecovery','!sameMSIRegistrationObservation']],
 [read('../../packages/renderer/src/core/desktop.ts'),['anchorRecorded: boolean','bootAnchor?:']]
]){for(const marker of markers){assert.ok(text.includes(marker),`source contract ${marker}`);count++}}
console.log(`${count}/${count} Pass30 MSI boot-anchor source and executed renderer assertions passed`);
