// Exercise the actual Desktop MSI validators extracted from the TSX AST.
// No renderer mock decides what is valid here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=fs.readFileSync(new URL('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('packages.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const funcs=new Map(), names=new Set(['verifyMSIBootObservation','verifyReadOnlyMSIEvidence','verifyReadOnlyMSIProfile']);
function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))funcs.set(node.name.text,node.getText(ast));ts.forEachChild(node,visit)}
visit(ast);assert.equal(funcs.size,3);
const js=ts.transpileModule([...funcs.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const lifecycleSource=fs.readFileSync(new URL('../../packages/renderer/src/features/settings/msi-lifecycle-planning.ts',import.meta.url),'utf8');
const lifecycleExports={};
Function('exports',ts.transpileModule(lifecycleSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(lifecycleExports);
const {expectedMSILifecyclePlans,validateMSILifecyclePlans}=lifecycleExports;
const {verifyReadOnlyMSIEvidence,verifyReadOnlyMSIProfile}=Function('validateMSILifecyclePlans',`"use strict";${js};return {verifyReadOnlyMSIEvidence,verifyReadOnlyMSIProfile}`)(validateMSILifecyclePlans);
let checks=0;
const ok=(label,fn)=>{assert.doesNotThrow(fn,label);checks++};
const bad=(label,fn)=>{assert.throws(fn,/MSI (?:recovery evidence|profile inventory)/,label);checks++};
const digest=(s)=>s.repeat(64);
const msi=(i)=>`{${String(i).repeat(8)}-1234-ABCD-ABCD-1234567890AB}`;
const boot={state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false};
const make=(key,code,version='2.0.0',sha=digest('a'))=>{
 const before={state:'not_registered_for_user',productCode:code,expectedVersion:'2.0.0',versionMatches:false,readOnly:true,osAttested:false,probeComplete:true,probeScope:'current_user_and_machine'};
 const after={...before,state:'registered_version_match',reportedVersion:'2.0.0',versionMatches:true};
 const attempt={packageKey:key,state:'msi_exit_zero_not_os_attested',version,artifactSha256:sha,msiSha256:digest('b'),productCode:code,productVersion:'2.0.0',osAttested:false,startedAt:'2026-10-24T12:00:00Z',launchCommittedAt:'2026-10-24T12:00:01Z',finishedAt:'2026-10-24T12:03:00Z',preLaunchRegistration:before,postExitRegistration:after};
 return {schema:1,packageKey:key,state:attempt.state,hasReceipt:true,lockPresent:false,admissionLockPresent:false,manualReviewRequired:true,retryAuthorized:false,readOnly:true,osAttested:false,receiptSha256:digest('c'),bootObservation:boot,attempt,product:after,registrationTransition:'matching_registration_observed_after_attempt',registrationDrift:'registration_unchanged_since_exit'};
};
const prerequisite=make('editor-core',msi(1));
const consumer=make('project-editor',msi(2),'3.0.0',digest('d'));
const dep={packageKey:'editor-core',version:'2.0.0',productCode:prerequisite.attempt.productCode,productVersion:'2.0.0',receiptSha256:prerequisite.receiptSha256};
consumer.attempt={...consumer.attempt,dependencies:[dep]};
const edge={dependentPackageKey:'project-editor',dependencyPackageKey:'editor-core',dependencyVersion:'2.0.0',dependencyReceiptSha256:prerequisite.receiptSha256,recordedDependencyPresent:true,recordedReceiptMatches:true};
const withPlans=p=>({...p,lifecycleRecords:p.lifecycleRecords||[],lifecyclePlans:expectedMSILifecyclePlans({...p,lifecycleRecords:p.lifecycleRecords||[]})});
const profile=withPlans({schema:1,state:'msi_profile_manual_review',readOnly:true,osAttested:false,retryAuthorized:false,complete:true,manualReviewRequired:true,admissionLockPresent:false,records:[prerequisite,consumer],lifecycleRecords:[],lifecycleMutationAuthorized:false,dependencyEdges:[edge]});
ok('single receipt with installed dependencies',()=>verifyReadOnlyMSIEvidence(consumer,'project-editor'));
ok('profile projects exact known edges',()=>verifyReadOnlyMSIProfile(profile));
const missing=withPlans({...profile,records:[consumer],dependencyEdges:[{...edge,recordedDependencyPresent:false,recordedReceiptMatches:false}]});
ok('missing prerequisite is visibly unresolved, not falsely clean',()=>verifyReadOnlyMSIProfile(missing));
const changed=withPlans({...profile,records:[{...prerequisite,receiptSha256:digest('e')},consumer],dependencyEdges:[{...edge,recordedReceiptMatches:false}]});
ok('changed prerequisite receipt remains an explicit mismatch',()=>verifyReadOnlyMSIProfile(changed));
for(const [label,mutation] of Object.entries({
 'wrong read-only ownership':d=>{d.packageKey='project-editor'},
 'reused same Package':d=>{d.packageKey='project-editor'},
 'invalid ProductCode':d=>{d.productCode='not-an-msi-code'},
 'invalid ProductVersion':d=>{d.productVersion='3.0-beta'},
 'corrupt receipt digest':d=>{d.receiptSha256='not-a-digest'},
 'wrong release version':d=>{d.version='v3'},
 'malformed dependency key':d=>{d.packageKey='../injected'},
 })){
 const value={...consumer,attempt:{...consumer.attempt,dependencies:[{...dep}]}};
 mutation(value.attempt.dependencies[0]);
 bad(label,()=>verifyReadOnlyMSIEvidence(value,'project-editor'));
}
bad('non-array dependencies',()=>verifyReadOnlyMSIEvidence({...consumer,attempt:{...consumer.attempt,dependencies:{...dep}}},'project-editor'));
bad('overly large dependencies',()=>verifyReadOnlyMSIEvidence({...consumer,attempt:{...consumer.attempt,dependencies:Array(13).fill(dep)}},'project-editor'));
bad('duplicate dependencies',()=>verifyReadOnlyMSIEvidence({...consumer,attempt:{...consumer.attempt,dependencies:[dep,dep]}},'project-editor'));
bad('forged graph matching flag',()=>verifyReadOnlyMSIProfile({...profile,dependencyEdges:[{...edge,recordedReceiptMatches:false}]}));
bad('forged graph present flag',()=>verifyReadOnlyMSIProfile({...profile,dependencyEdges:[{...edge,recordedDependencyPresent:false}]}));
bad('missing graph edge',()=>verifyReadOnlyMSIProfile({...profile,dependencyEdges:[]}));
bad('invented graph edge',()=>verifyReadOnlyMSIProfile({...profile,dependencyEdges:[edge,edge]}));
bad('unknown graph dependency version',()=>verifyReadOnlyMSIProfile({...profile,dependencyEdges:[{...edge,dependencyVersion:'3.0.0'}]}));
bad('misleading lifecycle authorization',()=>verifyReadOnlyMSIProfile({...profile,lifecycleMutationAuthorized:true}));
bad('missing lifecycle authorization fence',()=>verifyReadOnlyMSIProfile({...profile,lifecycleMutationAuthorized:undefined}));
bad('changed dependency evidence with forged original graph',()=>verifyReadOnlyMSIProfile({...profile,records:[{...prerequisite,receiptSha256:digest('e')},consumer]}));
bad('missing receipt with claimed verified graph',()=>verifyReadOnlyMSIProfile({...profile,records:[consumer]}));
bad('corrupt profile dependency',()=>verifyReadOnlyMSIProfile({...profile,records:[prerequisite,{...consumer,attempt:{...consumer.attempt,dependencies:[{...dep,productCode:'bad'}]}}]}));
console.log(`${checks}/${checks} Pass35 executed production Desktop MSI dependency and profile-graph validators passed`);
