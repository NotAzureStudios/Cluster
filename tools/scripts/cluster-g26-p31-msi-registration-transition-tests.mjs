import {validateMSILifecyclePlans,withMSILifecyclePlans} from "./cluster-g26-msi-lifecycle-test-support.mjs";
// Pass31: exercise the production Desktop validator, not a reimplementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const source=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const ast=ts.createSourceFile('DesktopDevicePackagesPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['verifyMSIBootObservation','verifyReadOnlyMSIEvidence','verifyReadOnlyMSIProfile']);
const map=new Map();
function walk(n){if(ts.isFunctionDeclaration(n)&&names.has(n.name?.text))map.set(n.name.text,n.getText(ast));ts.forEachChild(n,walk)}
walk(ast);assert.equal(map.size,3);
const js=ts.transpileModule([...map.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const verify=Function('validateMSILifecyclePlans',`"use strict";${js};return {verifyReadOnlyMSIEvidence,verifyReadOnlyMSIProfile}`)(validateMSILifecyclePlans);
const code='{12345678-1234-ABCD-ABCD-1234567890AB}';
const pre={state:'not_registered_for_user',productCode:code,expectedVersion:'1.0.0',versionMatches:false,readOnly:true,osAttested:false,probeComplete:true,probeScope:'current_user_and_machine'};
const post={...pre,state:'registered_version_match',reportedVersion:'1.0.0',versionMatches:true};
const boot={state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false};
const attempt={packageKey:'studio-tools',state:'msi_exit_zero_not_os_attested',version:'1.0.0',artifactSha256:'a'.repeat(64),msiSha256:'b'.repeat(64),productCode:code,productVersion:'1.0.0',osAttested:false,startedAt:'2026-10-24T12:00:00Z',launchCommittedAt:'2026-10-24T12:00:01Z',finishedAt:'2026-10-24T12:03:00Z',preLaunchRegistration:pre,postExitRegistration:post};
const base={schema:1,packageKey:'studio-tools',state:attempt.state,hasReceipt:true,lockPresent:false,admissionLockPresent:false,manualReviewRequired:true,retryAuthorized:false,readOnly:true,osAttested:false,receiptSha256:'c'.repeat(64),bootObservation:boot,attempt,product:post,registrationTransition:'matching_registration_observed_after_attempt',registrationDrift:'registration_unchanged_since_exit'};
let count=0;
const accept=record=>{assert.doesNotThrow(()=>verify.verifyReadOnlyMSIEvidence(record,'studio-tools'));count++};
const reject=record=>{assert.throws(()=>verify.verifyReadOnlyMSIEvidence(record,'studio-tools'),/MSI recovery evidence/);count++};
accept(base);
accept({...base,product:pre,registrationDrift:'registration_changed_since_exit'});
accept({...base,product:{...post,state:'os_query_unavailable',reportedVersion:undefined,versionMatches:false,probeScope:'',probeComplete:false},registrationDrift:'registration_comparison_unavailable'});
accept({...base,attempt:{...attempt,postExitRegistration:undefined,state:'msi_started_outcome_unknown',finishedAt:undefined},state:'msi_started_outcome_unknown',registrationTransition:'prelaunch_recorded_outcome_unknown',registrationDrift:'no_post_exit_baseline'});
accept({...base,attempt:{...attempt,preLaunchRegistration:undefined,postExitRegistration:undefined},registrationTransition:'historical_receipt_no_transition_evidence',registrationDrift:'no_post_exit_baseline'});
for(const bad of [
 {...base,registrationTransition:'historical_receipt_no_transition_evidence'},
 {...base,registrationDrift:'registration_changed_since_exit'},
 {...base,registrationDrift:'no_post_exit_baseline'},
 {...base,attempt:{...attempt,preLaunchRegistration:undefined}},
 {...base,attempt:{...attempt,postExitRegistration:undefined}},
 {...base,attempt:{...attempt,preLaunchRegistration:{...pre,probeComplete:false}}},
 {...base,attempt:{...attempt,preLaunchRegistration:{...pre,state:'registered_version_match',reportedVersion:'1.0.0',versionMatches:true}}},
 {...base,attempt:{...attempt,postExitRegistration:{...post,productCode:'{00000000-0000-0000-0000-000000000000}'}}},
 {...base,attempt:{...attempt,postExitRegistration:{...post,osAttested:true}}},
 {...base,attempt:{...attempt,postExitRegistration:{...post,reportedVersion:'9.9.9'}}},
 {...base,attempt:{...attempt,postExitRegistration:{...post,probeScope:''}}},
 {...base,attempt:{...attempt,finishedAt:undefined}},
 {...base,attempt:{...attempt,launchCommittedAt:undefined}},
 {...base,product:pre},
 {...base,product:{...post,state:'os_query_unavailable',versionMatches:false,reportedVersion:undefined,probeScope:'',probeComplete:false}},
])reject(bad);
const clean={...base,hasReceipt:false,state:'no_recorded_attempt',manualReviewRequired:false,attempt:undefined,product:undefined,receiptSha256:undefined,bootObservation:undefined,registrationTransition:undefined,registrationDrift:undefined};
accept(clean);reject({...clean,registrationTransition:'historical_receipt_no_transition_evidence'});
const profile=withMSILifecyclePlans({schema:1,state:'msi_profile_manual_review',readOnly:true,osAttested:false,retryAuthorized:false,complete:true,manualReviewRequired:true,admissionLockPresent:false,records:[base],lifecycleRecords:[],lifecycleMutationAuthorized:false,dependencyEdges:[]});
verify.verifyReadOnlyMSIProfile(profile);count++;
assert.throws(()=>verify.verifyReadOnlyMSIProfile({...profile,records:[{...base,registrationDrift:'registration_changed_since_exit'}]}),/MSI recovery evidence/);count++;
for(const [p,markers] of [
 ['../native/package-stager-go/msi_installer.go',['PreLaunchRegistration = &latestProduct','observeMSIPostExitRegistration','PostExitRegistration = &post']],
 ['../native/package-stager-go/msi_registration_transition.go',['validateMSIRegistrationTransition','observeMSIPostExitRegistration','classifyMSIRegistrationDrift','historical_receipt_no_transition_evidence']],
 ['../native/package-stager-go/msi_registration_transition_test.go',['TestMSIRegistrationTransitionIsReadOnlyAndStateBound','TestMSIPostExitRegistrationDoubleSampleRejectsMixedEpoch','TestMSIRegistrationDriftNeverAttestsSoftwareHealth']],
 ['../native/package-stager-go/msi_attempt_status.go',['validateMSIRegistrationTransition','RegistrationDrift = classifyMSIRegistrationDrift','RegistrationTransition = classifyMSIRegistrationTransition']],
 ['../../apps/desktop-qt/src/NativeCapabilityBroker.cpp',['validNativeMSIRegistrationTransition','validNativeMSIRegistrationSample','registrationDrift','preLaunchRegistration','postExitRegistration']],
 ['../../packages/renderer/src/core/desktop.ts',['ClusterNativeMSIRegistrationSample','registrationTransition?:','registrationDrift?:']],
 ['../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx',['verifyRegistrationSample','Registration across this attempt:','Registration since process return:']]
])for(const marker of markers){assert.ok(read(p).includes(marker),`missing ${marker} in ${p}`);count++}
console.log(`${count}/${count} G26 Pass31 MSI registration transition and executed Desktop tamper assertions passed`);
