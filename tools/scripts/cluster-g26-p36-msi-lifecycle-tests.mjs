// Execute the production TypeScript lifecycle projector and validator, with
// tampered profile evidence. A rendered status is not an MSI command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const path=new URL('../../packages/renderer/src/features/settings/msi-lifecycle-planning.ts',import.meta.url);
const exports={};
Function('exports',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports);
const {expectedMSILifecyclePlans,validateMSILifecyclePlans}=exports;
let checks=0;
const ok=(label,fn)=>{assert.doesNotThrow(fn,label);checks++};
const bad=(label,fn)=>{assert.throws(fn,/MSI lifecycle|MSI lifecycle review/,label);checks++};
const sha=s=>s.repeat(64);
const exact=(key)=>({schema:1,packageKey:key,hasReceipt:true,receiptSha256:sha('a'),lockPresent:false,admissionLockPresent:false,
 state:'msi_exit_zero_not_os_attested',registrationDrift:'registration_unchanged_since_exit',
 attempt:{preLaunchRegistration:{state:'not_registered_for_user'},postExitRegistration:{state:'registered_version_match'}},
 product:{state:'registered_version_match',versionMatches:true,probeComplete:true,probeScope:'current_user_and_machine'}});
const one=exact('editor-core');
const two=exact('project-editor');
const edge={dependentPackageKey:two.packageKey,dependencyPackageKey:one.packageKey,recordedReceiptMatches:true};
const profile={records:[one,two],lifecycleRecords:[],dependencyEdges:[edge],admissionLockPresent:false};
profile.lifecyclePlans=expectedMSILifecyclePlans(profile);
ok('stable dependency creates three protected plans',()=>{
 assert.equal(profile.lifecyclePlans.length,6);
 assert.equal(profile.lifecyclePlans[0].state,'blocked');
 assert(profile.lifecyclePlans[0].blockers.includes('known_dependent_packages_present'));
 assert.equal(profile.lifecyclePlans[3].state,'requires_operator_review');
 assert(profile.lifecyclePlans.every(p=>p.mutationAuthorized===false&&p.readOnly===true));
 validateMSILifecyclePlans(profile);
});
for(const [name,mutate] of Object.entries({
 'forged authorization':p=>{p.lifecyclePlans[0].mutationAuthorized=true},
 'forged attestation':p=>{p.lifecyclePlans[0].osAttested=true},
 'forged operation':p=>{p.lifecyclePlans[0].operation='install'},
 'omitted known dependent':p=>{p.lifecyclePlans[0].knownDependents=[]},
 'removed blocker':p=>{p.lifecyclePlans[0].blockers=[]},
 'made blocked plan ready':p=>{p.lifecyclePlans[0].state='requires_operator_review'},
 'omitted warning':p=>{p.lifecyclePlans[0].warnings=[]},
 'replaced receipt identity':p=>{p.lifecyclePlans[0].recordedReceiptSha256=sha('b')},
 'reordered plans':p=>{p.lifecyclePlans.reverse()},
 'removed plans':p=>{p.lifecyclePlans=[]},
 'unknown extra plan':p=>{p.lifecyclePlans.push(p.lifecyclePlans[0])},
 })) {
 const clone=structuredClone(profile);mutate(clone);bad(name,()=>validateMSILifecyclePlans(clone));
}
const changed=structuredClone(profile);changed.records[0].registrationDrift='registration_changed_since_exit';
bad('changing OS observation without reprojecting plans',()=>validateMSILifecyclePlans(changed));
changed.lifecyclePlans=expectedMSILifecyclePlans(changed);
ok('changed OS observation remains blocked',()=>{
 validateMSILifecyclePlans(changed);
 assert(changed.lifecyclePlans[0].blockers.includes('exact_windows_registration_not_verified'));
});
const locked=structuredClone(profile);locked.admissionLockPresent=true;locked.records.forEach(r=>{r.admissionLockPresent=true;r.lockPresent=true});
locked.lifecyclePlans=expectedMSILifecyclePlans(locked);
ok('global lock blocks all lifecycle review candidates',()=>{
 validateMSILifecyclePlans(locked);
 assert(locked.lifecyclePlans.every(p=>p.blockers.includes('profile_installation_lock_present')));
});
const source=fs.readFileSync(new URL('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp',import.meta.url),'utf8');
const native=fs.readFileSync(new URL('../native/package-stager-go/msi_profile_status.go',import.meta.url),'utf8');
assert(source.includes('validNativeMSILifecyclePlans(value)')&&native.includes('planMSILifecycle(out.Records, graph, out.AdmissionLockPresent)'));
checks++;
console.log(`${checks}/${checks} executed Pass 36 lifecycle projection, tamper and Qt/native boundary checks passed`);
