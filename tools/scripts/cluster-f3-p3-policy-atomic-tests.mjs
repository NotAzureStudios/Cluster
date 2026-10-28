import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);let ts;
try{ts=require('typescript')}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
const root=new URL('../../',import.meta.url);
const read=(name)=>fs.readFileSync(new URL(name,root),'utf8');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const compiled=ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(compiled.diagnostics?.length||0,0);const exports={};cache.set(name,exports);vm.runInNewContext(compiled.outputText,{exports,require:(specifier)=>{if(!specifier.startsWith('.'))throw Error(specifier);return load(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier.replace(/\.js$/,'.ts'))))},Date,Math,Number,String,Boolean,JSON,Set,Map,Error,Promise,Object}, {filename:name});return exports}
const {commitOperationsAlertPolicyBatch}=load('apps/server/src/core/operations-incident-alert-policies.ts');
const {defaultAlertPolicy}=load('apps/server/src/core/operations-incident-alert-routing.ts');
let n=0;const eq=(a,b,m)=>{assert.equal(a,b,m);n++};const check=(a,m)=>{assert.ok(a,m);n++};
const policies=new Map();let txCount=0;
const prisma={$transaction:async(callback)=>{
 txCount++;const copy=new Map([...policies].map(([k,v])=>[k,{...v}]));
 const tx={operationsAlertPolicy:{
  create:async({data})=>{if(copy.has(data.key))throw Object.assign(Error('duplicate'),{code:'P2002'});const value={...data,revision:1};copy.set(data.key,value);return {...value}},
  updateMany:async({where,data})=>{const before=copy.get(where.key);if(!before||before.revision!==where.revision)return {count:0};copy.set(where.key,{...before,...data,revision:before.revision+1});return {count:1}},
  findUnique:async({where})=>copy.get(where.key)||null,
 }};
 const output=await callback(tx);
 policies.clear();for(const [k,v] of copy)policies.set(k,v);
 return output;
}};
const a={...defaultAlertPolicy('cluster:dependency:storage'),expectedRevision:0};
const b={...defaultAlertPolicy('cluster:dependency:background-tasks'),expectedRevision:0};
let created=await commitOperationsAlertPolicyBatch(prisma,[a,b],'admin01');
eq(created.length,2,'two policies created atomically');
eq(policies.size,2,'two persisted');
check([...policies.values()].every(x=>x.revision===1),'initial revision');
check([...policies.values()].every(x=>x.updatedById==='admin01'),'actor attribution');
let updated=await commitOperationsAlertPolicyBatch(prisma,[{...a,expectedRevision:1,reminderMinutes:5},{...b,expectedRevision:1,recipientType:'user',recipientId:'admin02'}],'admin02');
eq(updated.length,2,'two policies updated');
eq(policies.get(a.key).reminderMinutes,5,'first changed');
eq(policies.get(b.key).recipientId,'admin02','second changed');
eq(policies.get(a.key).revision,2,'revision incremented');
let oldTx=txCount;await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[{...a,expectedRevision:2,reminderMinutes:2},{...b,expectedRevision:1}],'admin02'),/OPERATIONS_ALERT_POLICY_CONFLICT/);n++;
eq(txCount,oldTx+1,'conflicting transaction attempted');
eq(policies.get(a.key).reminderMinutes,5,'first write rolled back on second policy conflict');
eq(policies.get(a.key).revision,2,'first revision unchanged on rollback');
eq(policies.get(b.key).revision,2,'second revision unchanged');
await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[{...a,expectedRevision:0},{...b,expectedRevision:0}],'admin01'),e=>e?.code==='P2002');n++;
eq(policies.size,2,'create conflict rolls back');
oldTx=txCount;await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[a,a],'admin01'),/INVALID_BATCH/);n++;
await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[{...a,key:'attacker:custom'}],'admin01'),/INVALID_BATCH/);n++;
await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[],'admin01'),/INVALID_BATCH/);n++;
await assert.rejects(()=>commitOperationsAlertPolicyBatch(prisma,[{...a,expectedRevision:-1}],'admin01'),/INVALID_BATCH/);n++;
eq(txCount,oldTx,'bad input never entered transaction');
const routes=read('apps/server/src/domains/operations/operations-incident-routes.ts');
check(routes.indexOf('await deps.verifyUserPin(admin, body.securityPin')<routes.indexOf('updated = await commitOperationsAlertPolicyBatch'),'PIN verification before write');
check(routes.includes('new Set(body.policies.map')&&routes.includes('policyMutationSchema.omit'), 'batch checks duplicate keys and is strict');
check(routes.includes('await deps.logSecurityEvent?.({ event: "operations.alert_policy.update_batch"'),'post-commit audit invoked');
const ui=read('packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx');
check(ui.includes('Save alert settings')&&ui.includes('securityPin: pin')&&ui.includes('requestSecurityPin('),'UI offers one save + authenticated PIN pad');
check(ui.includes('recipientType: policy.recipientType')&&ui.includes('expectedRevision: policy.revision'),'UI sends explicit allowlisted fields and expected revision');
console.log(`Cluster F3 P3 Atomic Alert Policy Save: ${n}/${n} assertions passed`);
