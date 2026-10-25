/** TD6 G25 Forms→Project privacy-safe follow-up integration. Controlled routes/Prisma, not a live database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const ts=require('typescript');
const read=x=>readFileSync(resolve(root,x),'utf8');
const schema=new Proxy({parse:x=>x},{get:(_t,k)=>k==='parse'?x=>x:()=>schema});
const z=new Proxy({object:()=>schema,coerce:{number:()=>schema}},{get:(t,k)=>t[k]||(()=>schema)});
const sharedKeys=['PACKET_COMPLIANCE_DATA_FIELDS','POLICY_COMPLIANCE_DATA_FIELDS','STUDIO_FORM_TEMPLATES','projectVisibleStudioFormAnswers','studioAudienceSchema','studioFormCreateSchema','studioFormTemplateCreateSchema','studioFormSubmissionSchema','studioFormVersionCreateSchema','studioPolicyAcceptanceSchema','studioPolicyCreateSchema','studioPolicyVersionCreateSchema'];
const modules={
 'node:crypto':require('node:crypto'),
 '@cluster/shared':Object.fromEntries(sharedKeys.map(k=>[k,k==='projectVisibleStudioFormAnswers'?((_f,a)=>a):schema])),
 'zod':{z}, '../../core/data-query.js':{normalizeClusterDataQuery:x=>x},
 '../access/studio-audience.js':{parseStudioJson:()=>({mode:'all'}),studioAudienceMatchesUser:async()=>true,parseStudioAudience:()=>({mode:'all'}),loadStudioAudienceUserContext:async()=>({}),studioAudienceMatchesContext:()=>true},
 './studio-form-runtime.js':{serializeStudioForm:x=>x,serializeStudioFormVersion:x=>x,validateStudioFormAnswers:()=>({ok:true})},
 './studio-knowledge-runtime.js':{},'./studio-knowledge-evidence.js':{},'./studio-knowledge-compliance.js':{},
};
const src=read('apps/server/src/domains/studio-systems/studio-systems-routes.ts');
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:n=>{if(n in modules)return modules[n];throw Error('Unexpected import '+n)},Date,JSON,Array,Map,Set,Promise,String,Number,Error,console},{filename:'studio-systems-routes.ts'});
const handlers=new Map();const app=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(path,fn)=>handlers.set(`${method.toUpperCase()} ${path}`,fn)]));
const actor={id:'admin',isAdmin:true};
const updatedAt='2026-10-20T12:00:00.000Z';
const form={id:'form',purpose:'general'};
const project={id:'project',status:'active',archived:false};
const submission={id:'sub',formId:'form',form:{purpose:'general'},status:'approved',updatedAt:new Date(updatedAt),answersJson:'{"secret":"PRIVATE ANSWER"}',respondentEmail:'private@example.com'};
let allowedStudio=true,allowedProject=true,dbError=false;
let privateRows=[],issueRows=[],auditRows=[],issueWrites=0,txRollbacks=0;
const copy=x=>structuredClone(x);
const db={
 studioFormSubmission:{findFirst:async({where})=>where.id===submission.id&&where.formId===submission.formId&&submission.form.purpose!=='application'&&(!where.updatedAt||new Date(where.updatedAt).getTime()===submission.updatedAt.getTime())&&(!where.status||where.status.in.includes(submission.status))?copy(submission):null},
 studioFormProjectFollowup:{
  findUnique:async({where})=>copy(privateRows.find(x=>x.submissionId===where.submissionId_projectId.submissionId&&x.projectId===where.submissionId_projectId.projectId)||null),
  findMany:async({where})=>copy(privateRows.filter(x=>x.submissionId===where.submissionId)),
  create:async({data,select})=>{
   if(privateRows.some(x=>x.submissionId===data.submissionId&&x.projectId===data.projectId)){const e=Error('unique conflict');e.code='P2002';throw e}
   const row={id:'link'+(privateRows.length+1),createdAt:new Date(),...data};privateRows.push(row);return copy(row);
  },
 },
 project:{findUnique:async({where})=>where.id===project.id?copy(project):null,findFirst:async({where})=>where.id===project.id&&!project.archived&&project.status!=='cancelled'?copy(project):null},
 projectControlRecord:{create:async({data})=>{issueWrites++;if(dbError)throw Error('control write failed');const issue={id:'issue'+(issueRows.length+1),...data};issueRows.push(issue);return copy(issue)}},
 $transaction:async(fn)=>{const priorLinks=copy(privateRows),priorIssues=copy(issueRows);try{return await fn(db)}catch(error){privateRows=priorLinks;issueRows=priorIssues;txRollbacks++;throw error}},
};
mod.exports.registerStudioSystemsRoutes({app,prisma:db,authorization:{requireTool:async()=>allowedStudio,requireProjectResource:async()=>allowedProject},getCurrentUser:async()=>actor,logActivity:async record=>auditRows.push(record)});
const url='/api/studio-systems/forms/:formId/submissions/:submissionId/project-followups';
const reply=()=>({status:200,headers:{},code(x){this.status=x;return this},header(k,v){this.headers[k]=v;return this},send(v){this.body=v;return v}});
async function call(method,body={}){const handler=handlers.get(method+' '+url);assert.ok(handler,'route '+method);const r=reply();const result=await handler({params:{formId:'form',submissionId:'sub'},body},r);return {status:r.status,body:r.body??result,headers:r.headers}}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS G25 Forms Project '+name)}
const valid=()=>({projectId:'project',expectedUpdatedAt:updatedAt,title:'Review follow-up',priority:'high'});
await test('Studio admin authority is required for both create and private lookup',async()=>{allowedStudio=false;assert.equal((await call('POST',valid())).status,200);assert.equal(issueWrites,0);assert.equal((await call('GET')).status,200);allowedStudio=true});
await test('Project contribute permission is separately checked',async()=>{allowedProject=false;await call('POST',valid());assert.equal(issueWrites,0);allowedProject=true});
await test('archived destination denied before any create',async()=>{project.archived=true;assert.equal((await call('POST',valid())).status,404);assert.equal(issueWrites,0);project.archived=false});
await test('completed Project cannot accept a new issue after closeout',async()=>{project.status='completed';assert.equal((await call('POST',valid())).status,404);assert.equal(issueWrites,0);project.status='active'});
await test('form submission must be in review, not just submitted',async()=>{submission.status='submitted';assert.equal((await call('POST',valid())).status,409);assert.equal(issueWrites,0);submission.status='approved'});
await test('stale reviewer evidence rejects, does not create issue',async()=>{assert.equal((await call('POST',{...valid(),expectedUpdatedAt:'2026-10-19T00:00:00.000Z'})).status,409);assert.equal(issueWrites,0)});
await test('transaction failure leaves neither issue nor private mapping',async()=>{dbError=true;await assert.rejects(call('POST',valid()),/control write failed/);dbError=false;assert.equal(issueRows.length,0);assert.equal(privateRows.length,0);assert.equal(txRollbacks,1)});
await test('explicit reviewed response creates neutral issue and private relation atomically',async()=>{
 const r=await call('POST',valid());assert.equal(r.status,201);assert.equal(r.body.alreadyExists,false);
 assert.equal(issueRows.length,1);assert.equal(privateRows.length,1);assert.equal(issueRows[0].projectId,'project');assert.equal(issueRows[0].kind,'issue');assert.equal(issueRows[0].category,'form-review-followup');
 assert.equal(issueRows[0].title,'Review follow-up');assert.equal(issueRows[0].description.includes('PRIVATE'),false);
 assert.equal(JSON.stringify(issueRows).includes('sub'),false);assert.equal(JSON.stringify(issueRows).includes('private@example.com'),false);
 assert.equal(issueRows[0].linkedEntityId,undefined);assert.equal(issueRows[0].payload,'{}');assert.equal(auditRows.length,1);
});
await test('retry is idempotent and does not produce another issue',async()=>{const r=await call('POST',valid());assert.equal(r.body.alreadyExists,true);assert.equal(issueRows.length,1);assert.equal(privateRows.length,1);assert.equal(auditRows.length,1)});
await test('private reviewer GET exposes no answers and cannot be cached',async()=>{const r=await call('GET');assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.body.followups.length,1);assert.equal(JSON.stringify(r.body).includes('PRIVATE'),false)});
await test('schema, migration, UI, and no respondent content in Project issue contract',async()=>{
 assert.match(read('apps/server/prisma/schema.prisma'),/model StudioFormProjectFollowup/);
 assert.match(read('apps/server/prisma/migrations/20261023110000_td6_g25_form_project_followups/migration.sql'),/ON DELETE CASCADE/);
 const ui=read('packages/renderer/src/features/settings/StudioFormSubmissionsPanel.tsx');
 assert.match(ui,/Project follow-up/);assert.match(ui,/respondent identity/);assert.match(ui,/expectedUpdatedAt: selected.updatedAt/);
 assert.match(src,/Studio reviewer requested Project follow-up/);assert.doesNotMatch(src,/description: submission\.answersJson/);
});
console.log(`${count}/${count} G25 Form Project follow-up source checks passed`);
