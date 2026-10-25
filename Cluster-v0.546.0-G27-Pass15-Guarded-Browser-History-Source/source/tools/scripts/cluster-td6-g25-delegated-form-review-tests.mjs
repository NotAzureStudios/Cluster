/** G25 source-level reviewer lifecycle / permission integration. Controlled route and Prisma environment. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..'), require=createRequire(import.meta.url), ts=require('typescript');
const read=p=>readFileSync(resolve(root,p),'utf8');
const source=read('apps/server/src/domains/studio-systems/studio-systems-routes.ts');
const schema=new Proxy({parse:x=>x},{get:(_t,k)=>k==='parse'?x=>x:()=>schema});
const z=new Proxy({object:()=>schema,coerce:{number:()=>schema}},{get:(t,k)=>t[k]||(()=>schema)});
const sharedKeys=['PACKET_COMPLIANCE_DATA_FIELDS','POLICY_COMPLIANCE_DATA_FIELDS','STUDIO_FORM_TEMPLATES','projectVisibleStudioFormAnswers','studioAudienceSchema','studioFormCreateSchema','studioFormTemplateCreateSchema','studioFormSubmissionSchema','studioFormVersionCreateSchema','studioPolicyAcceptanceSchema','studioPolicyCreateSchema','studioPolicyVersionCreateSchema'];
const modules={
 'node:crypto':require('node:crypto'),
 '@cluster/shared':Object.fromEntries(sharedKeys.map(k=>[k,k==='projectVisibleStudioFormAnswers'?((_fields,answers)=>answers):schema])),
 zod:{z},'../../core/data-query.js':{normalizeClusterDataQuery:x=>x},
 '../access/studio-audience.js':{parseStudioJson:(raw,fallback)=>{try{return JSON.parse(raw)}catch{return fallback}},studioAudienceMatchesUser:async()=>true,parseStudioAudience:()=>({mode:'all'}),loadStudioAudienceUserContext:async()=>({}),studioAudienceMatchesContext:()=>true},
 './studio-form-runtime.js':{serializeStudioForm:x=>x,serializeStudioFormVersion:x=>x,validateStudioFormAnswers:()=>({ok:true})},
 './studio-knowledge-runtime.js':{},'./studio-knowledge-evidence.js':{},'./studio-knowledge-compliance.js':{},
};
const script=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};vm.runInNewContext(script,{module:mod,exports:mod.exports,require:n=>{if(n in modules)return modules[n];throw Error('Unexpected import '+n)},Date,JSON,Array,Map,Set,Promise,String,Number,Error,console},{filename:'studio-systems-routes.ts'});
const handlers=new Map(),app=Object.fromEntries(['get','post','put','patch','delete'].map(m=>[m,(p,h)=>handlers.set(m.toUpperCase()+' '+p,h)]));
const users={admin:{id:'admin',accountState:'ACTIVE'},reviewer:{id:'reviewer',accountState:'ACTIVE',username:'Reviewer',displayName:'Reviewer'},outsider:{id:'outsider',accountState:'ACTIVE'},inactive:{id:'inactive',accountState:'DISABLED'}};
let actor=users.admin,grant=null,formPurpose='general',formStatus='active',writes=0,audits=[],submitted='submitted',ts0=new Date('2026-10-20T00:00:00Z'),grantRevocationDuringTx=false;
const form=()=>({id:'form',purpose:formPurpose,status:formStatus,title:'Safety sign-off'});
const submission=()=>({id:'response',formId:'form',form:{purpose:formPurpose},formVersion:{version:1,schemaJson:'{"fields":[]}'},status:submitted,updatedAt:ts0,submittedAt:ts0,userId:'outsider',respondentName:'Private member',respondentEmail:'private@example.test',answersJson:'{"private":"SECRET"}',reviewNote:null});
const matchGrant=(where)=>grant&&grant.formId===where.formId_userId.formId&&grant.userId===where.formId_userId.userId;
const db={
 studioFormReviewer:{
  findUnique:async({where})=>matchGrant(where)?({...grant,form:form()}):null,
  findMany:async({where})=>grant&&(!where.userId||where.userId===grant.userId)&&(!where.status||where.status===grant.status)?[{...grant,user:users[grant.userId],form:form()}]:[],
  create:async({data})=>{grant={id:'grant',...data,status:'active',revision:1,updatedAt:new Date()};return grant},
  updateMany:async({where,data})=>{if(!grant||grant.formId!==where.formId||grant.userId!==where.userId||grant.revision!==where.revision||where.status&&where.status!==grant.status)return {count:0};grant.status=data.status;grant.revision++;return {count:1}},
 },
 studioForm:{findUnique:async()=>form()},
 user:{findUnique:async({where})=>users[where.id]||null},
 studioFormSubmission:{
  findMany:async({where})=>where.formId==='form'?[submission()]:[],
  findFirst:async({where})=>where.id==='response'&&where.formId==='form'?submission():null,
  updateMany:async({where,data})=>{if(submitted!=='submitted'&&submitted!=='under_review'||ts0.getTime()!==new Date(where.updatedAt).getTime())return {count:0};writes++;submitted=data.status;ts0=new Date(ts0.getTime()+1000);return {count:1}},
  findUniqueOrThrow:async()=>({id:'response',userId:'outsider',status:submitted,updatedAt:ts0,reviewNote:null}),
 },
 $transaction:async(fn)=>{if(grantRevocationDuringTx){grant.status='revoked';grant.revision++;grantRevocationDuringTx=false;}return fn(db)},
};
const authorization={
 authorize:async(_r,_act,target)=>({allowed:actor.id==='admin'&&target.kind==='tool'&&target.tool==='settings'}),
 requireTool:async(_r,reply)=>{if(actor.id==='admin')return actor;reply.code(403).send({ok:false,code:'FORBIDDEN'});return null},
};
mod.exports.registerStudioSystemsRoutes({app,prisma:db,authorization,getCurrentUser:async()=>actor,logActivity:async a=>audits.push(a)});
const urls={grants:'/api/studio-systems/forms/:formId/reviewers',grant:'/api/studio-systems/forms/:formId/reviewers/:userId',discovery:'/api/forms/review-assignments',list:'/api/studio-systems/forms/:formId/submissions',detail:'/api/studio-systems/forms/:formId/submissions/:submissionId',review:'/api/studio-systems/forms/:formId/submissions/:submissionId/review',followup:'/api/studio-systems/forms/:formId/submissions/:submissionId/project-followups'};
const reply=()=>({status:200,headers:{},code(status){this.status=status;return this},header(k,v){this.headers[k]=v;return this},send(value){this.body=value;return value}});
async function call(method,path,body={},q={}){const h=handlers.get(method+' '+path);assert.ok(h,path);const r=reply();const outcome=await h({params:{formId:'form',userId:'reviewer',submissionId:'response'},body,query:q},r);return {status:r.status,body:r.body??outcome,headers:r.headers}}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS G25 scoped review '+name)}
await test('unauthorized reviewer cannot enumerate grants or form submissions',async()=>{actor=users.outsider;let r=await call('GET',urls.grants);assert.equal(r.status,403);r=await call('GET',urls.list);assert.equal(r.status,403);r=await call('GET',urls.detail);assert.equal(r.status,403)});
await test('admin can list reviewer grants without answer payloads',async()=>{actor=users.admin;const r=await call('GET',urls.grants,{}, {page:1,limit:25});assert.equal(r.status,200);assert.deepEqual(r.body.reviewers,[]);assert.equal(r.headers['Cache-Control'],'private, no-store')});
await test('grant must reference active member and non-application form',async()=>{formPurpose='application';assert.equal((await call('PUT',urls.grant,{expectedRevision:0})).status,404);formPurpose='general';formStatus='draft';assert.equal((await call('PUT',urls.grant,{expectedRevision:0})).status,404);formStatus='active';assert.equal(grant,null)});
await test('admin first grant is explicit and revisioned',async()=>{const r=await call('PUT',urls.grant,{expectedRevision:0});assert.equal(r.body.status,'active');assert.equal(r.body.revision,1);assert.equal(grant.userId,'reviewer')});
await test('duplicate first grant and stale revocation both fail',async()=>{assert.equal((await call('PUT',urls.grant,{expectedRevision:0})).status,409);assert.equal((await call('DELETE',urls.grant,{expectedRevision:5})).status,409);assert.equal(grant.revision,1)});
await test('delegated discovery is narrow and never exports responses',async()=>{actor=users.reviewer;const r=await call('GET',urls.discovery);assert.equal(r.body.forms[0].title,'Safety sign-off');assert.equal(JSON.stringify(r.body).includes('SECRET'),false);assert.equal(r.headers['Cache-Control'],'private, no-store')});
await test('delegate may list and inspect authorized response only',async()=>{let r=await call('GET',urls.list,{}, {page:1,limit:25});assert.equal('answers' in r.body.submissions[0],false);assert.equal(JSON.stringify(r.body).includes('SECRET'),false);r=await call('GET',urls.detail);assert.equal(r.body.submission.answers.private,'SECRET');assert.equal(r.body.submission.id,'response');assert.equal(r.headers['Cache-Control'],'private, no-store')});
await test('review rejects without a reason and never writes',async()=>{const r=await call('PATCH',urls.review,{expectedUpdatedAt:ts0.toISOString(),status:'rejected',note:''});assert.equal(r.status,400);assert.equal(writes,0)});
await test('authorized delegate records revision-guarded decision',async()=>{const r=await call('PATCH',urls.review,{expectedUpdatedAt:ts0.toISOString(),status:'under_review',note:'Investigating'});assert.equal(r.body.status,'under_review');assert.equal(writes,1);assert.equal(audits.at(-1).entityType,'studio_form_submission')});
await test('stale decision does not overwrite updated response',async()=>{const r=await call('PATCH',urls.review,{expectedUpdatedAt:'2026-10-20T00:00:00Z',status:'approved',note:''});assert.equal(r.status,409);assert.equal(writes,1)});
await test('delegate cannot read or create admin Project followups',async()=>{const r=await call('GET',urls.followup);assert.equal(r.status,403);assert.equal(r.body.code,'FORBIDDEN')});
await test('CAS revocation strips response access immediately',async()=>{actor=users.admin;assert.equal((await call('DELETE',urls.grant,{expectedRevision:1})).body.ok,true);actor=users.reviewer;let r=await call('GET',urls.list);assert.equal(r.status,403);r=await call('GET',urls.discovery);assert.equal(r.body.forms.length,0);r=await call('PATCH',urls.review,{expectedUpdatedAt:ts0.toISOString(),status:'approved',note:''});assert.equal(r.status,403)});
await test('CAS restore recovers review access, without broader settings',async()=>{actor=users.admin;assert.equal((await call('PUT',urls.grant,{expectedRevision:2})).body.revision,3);actor=users.reviewer;assert.equal((await call('GET',urls.detail)).status,200);assert.equal((await call('GET',urls.grants)).status,403)});
await test('suspended reviewer and unpublished form lose review access',async()=>{users.reviewer.accountState='DISABLED';assert.equal((await call('GET',urls.list)).status,403);users.reviewer.accountState='ACTIVE';formStatus='draft';assert.equal((await call('GET',urls.list)).status,403);formStatus='active';formPurpose='application';assert.equal((await call('GET',urls.list)).status,403);formPurpose='general'});
await test('transaction revocation recheck prevents a competing review write',async()=>{grant.status='active';grantRevocationDuringTx=true;const before=writes;const r=await call('PATCH',urls.review,{expectedUpdatedAt:ts0.toISOString(),status:'approved',note:''});assert.equal(r.status,409);assert.equal(writes,before);grantRevocationDuringTx=false;grant.status='active'});
await test('schema, privacy, UI, and scoped routing are integrated',async()=>{
 assert.match(read('apps/server/prisma/schema.prisma'),/model StudioFormReviewer/);
 assert.match(read('apps/server/prisma/migrations/20261023200000_td6_g25_form_review_delegation/migration.sql'),/ON DELETE CASCADE/);
 assert.match(read('apps/server/src/core/privacy-erasure.ts'),/studioFormReviewer/);
 assert.match(read('apps/server/src/domains/legal/privacy-data-routes.ts'),/formReviewGrants/);
 const submissions=read('packages/renderer/src/features/settings/StudioFormSubmissionsPanel.tsx');assert.match(submissions,/delegatedReview/);assert.match(submissions,/!delegatedReview && <section/);assert.match(submissions,/detailRequestId/);assert.match(source,/queue is not a bulk export of private response answers/);
 assert.match(read('packages/renderer/src/features/settings/MyFormsPanel.tsx'),/review-assignments/);
 assert.match(read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx'),/StudioFormReviewersPanel/);
 assert.match(read('packages/renderer/src/features/settings/settings-workspace.css'),/@container \(max-width: 740px\)/);
});
console.log(`${count}/${count} G25 scoped delegated Form reviewer tests passed`);
