import {validateMSILifecyclePlans,withMSILifecyclePlans} from "./cluster-g26-msi-lifecycle-test-support.mjs";
// Validate the production renderer profile-inventory code path without
// launching an installer or relying on a mock validation implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const renderer=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const ast=ts.createSourceFile('packages.tsx',renderer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['verifyReadOnlyMSIProfile','verifyReadOnlyMSIEvidence','verifyMSIBootObservation']);
const bodies=new Map();
function walk(n){if(ts.isFunctionDeclaration(n)&&names.has(n.name?.text))bodies.set(n.name.text,n.getText(ast));ts.forEachChild(n,walk)}
walk(ast);
assert.equal(bodies.size,3);
const js=ts.transpileModule([...bodies.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const validate=Function('validateMSILifecyclePlans',`"use strict";${js};return verifyReadOnlyMSIProfile`)(validateMSILifecyclePlans);
const base=withMSILifecyclePlans({schema:1,state:'no_recorded_msi_attempts',readOnly:true,osAttested:false,retryAuthorized:false,
 complete:true,manualReviewRequired:false,admissionLockPresent:false,records:[],
 lifecycleRecords:[],lifecycleMutationAuthorized:false,dependencyEdges:[]});
const current={schema:1,packageKey:'alpha-package',state:'interrupted_or_active_without_receipt',
 hasReceipt:false,lockPresent:true,admissionLockPresent:false,manualReviewRequired:true,retryAuthorized:false,
 readOnly:true,osAttested:false,stagedArtifactVerified:false};
const held=withMSILifecyclePlans({...base,state:'msi_profile_manual_review',manualReviewRequired:true,admissionLockPresent:true,
 records:[{...current,admissionLockPresent:true}]});
const waiting=withMSILifecyclePlans({...held,admissionLockPresent:false,records:[current]});
const heldWithoutEntries=withMSILifecyclePlans({...held,records:[]});
let count=1;
for(const report of [base,held,waiting,heldWithoutEntries]){assert.doesNotThrow(()=>validate(report));count++}
for(const bad of [
 {...base,complete:false}, {...base,readOnly:false}, {...base,osAttested:true},
 {...base,retryAuthorized:true}, {...base,admissionLockPresent:undefined},
 {...base,manualReviewRequired:undefined}, {...base,records:undefined},
 {...base,records:[current]}, {...held,records:[{...current,admissionLockPresent:false}]},
 {...held,records:[{...current,manualReviewRequired:false,admissionLockPresent:true}]},
 {...held,records:[{...current,lockPresent:false,admissionLockPresent:true}]},
 {...held,records:[{...current,packageKey:'../escape',admissionLockPresent:true}]},
 {...held,records:[{...current,hasReceipt:true,admissionLockPresent:true}]},
 {...waiting,records:[current,current]},
 {...base,records:Array.from({length:65},(_,i)=>({...current,packageKey:`package-${String(i).padStart(3,'0')}`}))},
 {...held,state:'no_recorded_msi_attempts'},
]){assert.throws(()=>validate(bad),/MSI (?:profile inventory|recovery evidence)/);count++}
for(const marker of ['setMsiProfileEvidence(null)','startingGeneration !== generation.current',
  'verifyReadOnlyMSIProfile(report)','Inspect all local MSI attempts','This inventory does not authorize']){
 assert.ok(renderer.includes(marker),`Desktop inventory ${marker}`);count++;
}
const bridge=read('../../packages/renderer/src/core/desktop.ts');
assert.ok(bridge.includes('"package.msiProfileStatus"'));count++;
assert.ok(bridge.includes('requestNativeCapability<ClusterNativeMSIProfileStatus>("package.msiProfileStatus", {})'));count++;
const qt=read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const section=qt.slice(qt.indexOf('if (capability == QStringLiteral("package.msiProfileStatus"))'),
 qt.indexOf('if (capability == QStringLiteral("package.msiAttemptStatus"))'));
for(const marker of ['msi-profile-status','CLUSTER_MSI_PROFILE_STATUS','const bool validSummary',
 'const bool globalLock','const bool manual','records.size() <= 64','const bool known','QString lastKey','retryAuthorized','osAttested','complete','validRecords']){
 assert.ok(section.includes(marker),`Qt inventory source validation ${marker}`);count++;
}
const go=read('../native/package-stager-go/msi_profile_status.go');
for(const marker of ['maxMSIProfileEntries = 64','Readdirnames(maxMSIProfileEntries + 1)','directoryNoLinks','inspectMSIAttempt(abs, key)','sort.Strings(ordered)','unknown MSI profile custody entry']){
 assert.ok(go.includes(marker),`Go bounded recovery inventory ${marker}`);count++;
}
const main=read('../native/package-stager-go/main.go');
for(const marker of ['case "msi-profile-status"','CLUSTER_MSI_PROFILE_STATUS','MSI profile inventory cannot receive']){
 assert.ok(main.includes(marker));count++;
}
console.log(`${count}/${count} G26 Pass 26 MSI inventory and production validation assertions passed`);
