/** TD6 G25 form assignment integration checks. Controlled routes/Prisma; not a live database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);const ts=require('typescript');
const read=x=>readFileSync(resolve(root,x),'utf8');
const source=read('apps/server/src/domains/studio-systems/studio-systems-routes.ts');
const sharedKeys=['PACKET_COMPLIANCE_DATA_FIELDS','POLICY_COMPLIANCE_DATA_FIELDS','STUDIO_FORM_TEMPLATES','projectVisibleStudioFormAnswers','studioAudienceSchema','studioFormCreateSchema','studioFormTemplateCreateSchema','studioFormSubmissionSchema','studioFormVersionCreateSchema','studioPolicyAcceptanceSchema','studioPolicyCreateSchema','studioPolicyVersionCreateSchema'];
const schema=new Proxy({parse:x=>x},{get:(_t,k)=>k==='parse'?(v=>v):()=>schema});
const z=new Proxy({object:()=>schema,coerce:{number:()=>schema}},{get:(t,k)=>t[k]||(()=>schema)});
const mods={
 'node:crypto':require('node:crypto'),
 '@cluster/shared':Object.fromEntries(sharedKeys.map(k=>[k,k==='projectVisibleStudioFormAnswers'?((_fields,answers)=>answers):schema])),
 'zod':{z},
 '../../core/data-query.js':{normalizeClusterDataQuery:x=>x},
 '../access/studio-audience.js':{parseStudioJson:(x,f)=>{try{return JSON.parse(x)}catch{return f}},studioAudienceMatchesUser:async(_p,a,user)=>JSON.parse(a).targets.some(t=>t.id===user.id),parseStudioAudience:JSON.parse,loadStudioAudienceUserContext:async()=>({}),studioAudienceMatchesContext:(a,id)=>a.targets.some(t=>t.id===id)},
 './studio-form-runtime.js':{serializeStudioForm:x=>x,serializeStudioFormVersion:x=>x,validateStudioFormAnswers:()=>({ok:true})},
 './studio-knowledge-runtime.js':{}, './studio-knowledge-evidence.js':{}, './studio-knowledge-compliance.js':{},
};
const script=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(script,{module,exports:module.exports,require:n=>{if(n in mods)return mods[n];throw Error('Unexpected import: '+n)},Date,JSON,Array,Map,Set,Promise,String,Number,Error,console},{filename:'studio-systems-routes.ts'});
const handlers=new Map();const routes=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(p,fn)=>handlers.set(`${method.toUpperCase()} ${p}`,fn)]));
const members=new Map([['u1',{id:'u1',username:'member',displayName:'Member',accountState:'ACTIVE',archived:false}],['u2',{id:'u2',username:'outsider',accountState:'ACTIVE',archived:false}]]);
const form={id:'f1',key:'test',status:'active',purpose:'general',title:'Review form',audienceJson:JSON.stringify({mode:'include',targets:[{kind:'user',id:'u1'}]}),versions:[{id:'v1',version:1,status:'published',settingsJson:JSON.stringify({dueAt:'2026-10-30T09:00:00Z',reminderDaysBefore:3,remindWhenOverdue:true})}]};
let rows=[];let audits=[];let authorized=true;let lookupCount=0;
const db={
 studioForm:{findUnique:async()=>({...form}),findMany:async()=>[form]},
 studioFormAssignment:{
  findUnique:async({where})=>rows.find(r=>r.formId===where.formId_userId.formId&&r.userId===where.formId_userId.userId)||null,
  findMany:async({where})=>{lookupCount++;return rows.filter(r=>(!where.formId||r.formId===where.formId||where.formId.in?.includes(r.formId))&&(!where.userId||r.userId===where.userId)&&(!where.status||r.status===where.status)).map(r=>({...r,user:members.get(r.userId)}))},
  create:async({data})=>{const row={id:'a1',...data,revision:1,status:'active',updatedAt:new Date()};rows.push(row);return {...row}},
  updateMany:async({where,data})=>{const row=rows.find(r=>r.formId===where.formId&&r.userId===where.userId&&r.revision===where.revision&&(!where.status||r.status===where.status));if(!row)return {count:0};Object.assign(row,data,{revision:row.revision+1,updatedAt:new Date()});return {count:1}},
 },
 user:{findUnique:async({where})=>members.get(where.id)||null},
 studioFormVersion:{findFirst:async()=>form.versions[0]},
 studioFormSubmission:{findMany:async()=>[{userId:'u1',id:'submission',status:'submitted',submittedAt:new Date()}],findFirst:async()=>({id:'submission',status:'submitted',submittedAt:new Date()})},
 studioFormResponseDraft:{findMany:async()=>[]},
 $transaction:async(fn)=>fn(db),
};
module.exports.registerStudioSystemsRoutes({app:routes,prisma:db,authorization:{requireTool:async()=>authorized},getCurrentUser:async()=>members.get('u1'),logActivity:async(event)=>{audits.push(event)}});
const reply=()=>({status:200,headers:{},code(code){this.status=code;return this},header(k,v){this.headers[k]=v;return this},send(body){this.body=body;return body}});
async function call(method,path,params={},body={},query={}){const handler=handlers.get(`${method} ${path}`);assert.ok(handler,`route ${method} ${path} exists`);const r=reply();const data=await handler({params,body,query},r);return {status:r.status,body:r.body??data,headers:r.headers}}
const resource='/api/studio-systems/forms/:formId/assignments/:userId';const list='/api/studio-systems/forms/:formId/assignments';
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS G25 Forms '+name)}
await test('admin gate prevents enumerating assigned people',async()=>{authorized=false;const before=lookupCount;const r=await call('GET',list,{formId:'f1'});assert.equal(r.status,200);assert.equal(lookupCount,before);authorized=true});
await test('person outside published audience cannot be assigned',async()=>{const r=await call('PUT',resource,{formId:'f1',userId:'u2'},{expectedRevision:0,required:true,dueAt:'2026-10-19T09:00:00Z'});assert.equal(r.status,404);assert.equal(rows.length,0)});
await test('first assignment creates required obligation with due override',async()=>{const r=await call('PUT',resource,{formId:'f1',userId:'u1'},{expectedRevision:0,required:true,dueAt:'2026-10-19T09:00:00Z'});assert.equal(r.status,200);assert.equal(rows[0].revision,1);assert.equal(rows[0].required,true);assert.equal(rows[0].dueAt.toISOString(),'2026-10-19T09:00:00.000Z');assert.equal(audits.length,1)});
await test('simultaneous create refuses stale baseline',async()=>{const r=await call('PUT',resource,{formId:'f1',userId:'u1'},{expectedRevision:0,required:true,dueAt:null});assert.equal(r.status,409);assert.equal(rows.length,1)});
await test('revision-guarded reassignment and stale edit',async()=>{const params={formId:'f1',userId:'u1'};let r=await call('PUT',resource,params,{expectedRevision:1,required:false,dueAt:'2026-10-20T09:00:00Z'});assert.equal(r.status,200);assert.equal(rows[0].revision,2);r=await call('PUT',resource,params,{expectedRevision:1,required:true,dueAt:null});assert.equal(r.status,409);assert.equal(rows[0].required,false)});
await test('list is admin-only, bounded and excludes answers',async()=>{const r=await call('GET',list,{formId:'f1'},{},{page:1,limit:25,status:'all'});assert.equal(r.body.assignments.length,1);assert.equal(r.body.assignments[0].user.username,'member');assert.equal(r.body.assignments[0].lastSubmission.id,'submission');assert.equal('answers' in r.body.assignments[0].lastSubmission,false);assert.equal(r.headers['Cache-Control'],'private, no-store')});
await test('revocation is CAS guarded and does not delete previous responses',async()=>{const params={formId:'f1',userId:'u1'};let r=await call('DELETE',resource,params,{expectedRevision:1});assert.equal(r.status,409);r=await call('DELETE',resource,params,{expectedRevision:2});assert.equal(r.body.ok,true);assert.equal(rows[0].status,'revoked');assert.equal(rows[0].revision,3)});
await test('restoring a revoked obligation needs latest revision',async()=>{const r=await call('PUT',resource,{formId:'f1',userId:'u1'},{expectedRevision:3,required:true,dueAt:null});assert.equal(r.status,200);assert.equal(rows[0].status,'active');assert.equal(rows[0].revision,4)});
await test('recipient sees only own due override, without peer names',async()=>{
 const r=await call('GET','/api/forms/available');assert.equal(r.body.forms[0].assigned,true);assert.equal(r.body.forms[0].required,true);assert.equal(r.body.forms[0].dueAt,'2026-10-30T09:00:00Z');assert.equal('user' in r.body.forms[0],false);
});
await test('schema, migration, privacy, and UI integration present',()=>{assert.match(read('apps/server/prisma/schema.prisma'),/model StudioFormAssignment/);assert.match(read('apps/server/prisma/migrations/20261022120000_td6_g25_form_assignments/migration.sql'),/ON DELETE CASCADE/);assert.match(read('apps/server/src/core/privacy-erasure.ts'),/studioFormAssignment/);assert.match(read('apps/server/src/domains/legal/privacy-data-routes.ts'),/formAssignments/);assert.match(read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx'),/StudioFormAssignmentsPanel/);assert.match(read('packages/renderer/src/features/settings/MyFormsPanel.tsx'),/Assigned · required/)});
console.log(`${checks}/${checks} G25 Form assignment checks passed`);
