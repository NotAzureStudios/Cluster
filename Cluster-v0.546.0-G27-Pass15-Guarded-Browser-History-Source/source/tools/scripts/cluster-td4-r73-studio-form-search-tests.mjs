/** TD4 R73: admin-only Studio Form and submission Search/admission/navigation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); } })();
const src = file => readFileSync(file,'utf8');
function load(file, imports={}) {
  const emitted=ts.transpileModule(src(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(emitted.diagnostics?.length||0,0);
  const mod={exports:{}};
  vm.runInNewContext(emitted.outputText,{module:mod,exports:mod.exports,require(id){if(!(id in imports))throw Error('Unexpected import '+id);return imports[id]},Date,Map,Set,Error,Boolean,Number,String,Array,Promise,Object,JSON,console},{filename:file});
  return mod.exports;
}
const index=load('apps/server/src/domains/search/search-index-builder.ts',{'@cluster/shared':{CLUSTER_WORKFLOW_RELATIONSHIP_META:{},clusterResourceAddressFromEntity:()=>null},'../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({skills:[]})}});
const {createSearchLiveAdmission}=load('apps/server/src/domains/search/search-live-admission.ts');
const T='2026-10-16T07:00:00.000Z', AFTER='2026-10-16T07:01:00.000Z';
const form=(extra={})=>({id:'form1',key:'studio-feedback',title:'Studio feedback',purpose:'general',status:'active',updatedAt:T,createdAt:T,...extra});
const submission=(extra={})=>({id:'response1',formId:'form1',status:'submitted',submittedAt:T,updatedAt:T,form:{id:'form1',title:'Studio feedback',purpose:'general',status:'active',updatedAt:T},...extra});
const corpus=(forms=[form()],responses=[submission()])=>({projects:[],users:[],cards:[],timelineItems:[],calendarEvents:[],cardComments:[],activityEvents:[],projectFiles:[],videoAssets:[],deliveryRecords:[],sourceReviews:[],sourceCommits:[],projectRelationships:[],packetDefinitions:[],studioPolicies:[],studioForms:forms,formSubmissions:responses,accessRules:[]});
const all=()=>index.buildIndex(corpus()).items;
const hit=(kind)=>all().find((item)=>item.kind===kind);
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name)};
await check('Form has canonical Studio resource address',()=>{const r=hit('studio_form');assert(r);assert.equal(r.resource.kind,'studio_form');assert.equal(r.resource.id,'form1');assert.equal(r.projectId,undefined)});
await check('Submission has canonical Studio resource address',()=>{const r=hit('form_submission');assert(r);assert.equal(r.resource.kind,'form_submission');assert.equal(r.resource.id,'response1')});
await check('Form title and key discoverable by Studio admin',()=>{const r=hit('studio_form');assert.match(r.normalizedText,/studio feedback/);assert.match(r.normalizedText,/studio feedback/);assert.match(r.normalizedText,/studio/)});
await check('Submission indexes only form title, status and stable ID',()=>{const r=hit('form_submission');assert.equal(r.title,'Response to Studio feedback');assert.equal(r.status,'submitted');assert.equal(r.facets.id[0],'response1')});
await check('Submission must never disclose respondent or answer fields',()=>{const x=submission({respondentName:'DO_NOT_INDEX_NAME',respondentEmail:'private@example.com',answersJson:'DO_NOT_INDEX_ANSWER'});const r=index.buildIndex(corpus([],[x])).items.find(row=>row.kind==='form_submission');assert(r);const contents=JSON.stringify(r);for(const secret of ['DO_NOT_INDEX_NAME','private@example.com','DO_NOT_INDEX_ANSWER'])assert(!contents.includes(secret))});
await check('Public application submissions excluded even if caller supplied them',()=>{const r=index.buildIndex(corpus([],[submission({form:{...submission().form,purpose:'application'}})])).items;assert(!r.some(x=>x.kind==='form_submission'))});
await check('Form/submission corpus survives unrelated Project refresh',()=>{const existing=corpus(),incoming={...corpus([],[]),projects:[]};const merged=index.mergeProjectCorpus(existing,incoming,'p1');assert.equal(merged.studioForms.length,1);assert.equal(merged.formSubmissions.length,1)});
function fixture(options={}){const calls=[];const prisma={
 studioForm:{findMany:async({where})=>{calls.push(['form',where]);if(options.throwForm)throw Error('db unavailable');return (options.forms??[form()]).filter(x=>where.id.in.includes(x.id))}},
 studioFormSubmission:{findMany:async({where})=>{calls.push(['response',where]);if(options.throwResponse)throw Error('db unavailable');return (options.responses??[submission()]).filter(x=>where.id.in.includes(x.id))}},
 };return {adapter:createSearchLiveAdmission(prisma),calls};}
const admit=async(kind, opts={})=>{const f=fixture(opts),r=hit(kind);await f.adapter.prepareBatch([r]);return f.adapter.admit(r)};
await check('Fresh form admitted',async()=>assert.equal(await admit('studio_form'),true));
await check('Removed form denied',async()=>assert.equal(await admit('studio_form',{forms:[]}),false));
await check('Form revision change denied',async()=>assert.equal(await admit('studio_form',{forms:[form({updatedAt:AFTER})]}),false));
await check('Form title change denied even without updatedAt advance',async()=>assert.equal(await admit('studio_form',{forms:[form({title:'Hidden new title'})]}),false));
await check('Form key change denied',async()=>assert.equal(await admit('studio_form',{forms:[form({key:'renamed-key'})]}),false));
await check('Form purpose change denied',async()=>assert.equal(await admit('studio_form',{forms:[form({purpose:'application'})]}),false));
await check('Form status change denied',async()=>assert.equal(await admit('studio_form',{forms:[form({status:'archived'})]}),false));
await check('Fresh submitted response admitted',async()=>assert.equal(await admit('form_submission'),true));
await check('Removed submission denied',async()=>assert.equal(await admit('form_submission',{responses:[]}),false));
await check('Submission revision change denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({updatedAt:AFTER})]}),false));
await check('Review status transition denied before refreshed index',async()=>assert.equal(await admit('form_submission',{responses:[submission({status:'approved'})]}),false));
await check('Submission reassigned to different form denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({formId:'form2'})]}),false));
await check('Deleted parent form denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({form:null})]}),false));
await check('Parent renamed without timestamp advance denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({form:{...submission().form,title:'Private renamed form'}})]}),false));
await check('Parent audience/config revision change denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({form:{...submission().form,updatedAt:AFTER}})]}),false));
await check('Converted submission into application denied',async()=>assert.equal(await admit('form_submission',{responses:[submission({form:{...submission().form,purpose:'application'}})]}),false));
await check('Unprepared response fails closed',()=>assert.equal(fixture().adapter.admit(hit('form_submission')),false));
await check('Database lookup failure rejects response',async()=>{await assert.rejects(()=>fixture({throwResponse:true}).adapter.prepareBatch([hit('form_submission')]),/db unavailable/)});
await check('Batch size bound is enforced',async()=>{const rows=Array.from({length:13},(_,i)=>({...hit('studio_form'),id:`form-${i}`}));await assert.rejects(()=>fixture().adapter.prepareBatch(rows),/batch exceeded/)});
const route=src('apps/server/src/domains/search/search-routes.ts');
await check('Admin authority check executes before admin bypass',()=>{const start=route.indexOf('if (item.kind === "studio_form" || item.kind === "form_submission")');const end=route.indexOf('if (decorated?.isAdmin) return true;',start);assert(start>=0&&end>start);const guard=route.slice(start,end);assert.match(guard,/if \(!decorated\?\.isAdmin\) return false/);assert.match(guard,/tool: "settings"/);assert.match(guard,/minimum: "edit"/)});
const routes=src('apps/server/src/domains/studio-systems/studio-systems-routes.ts');
await check('Exact submission and target routes gate current review authority without disclosing unauthorized targets',()=>{
  const target=routes.slice(routes.indexOf('app.get("/api/studio-systems/submissions/:submissionId/target"'),routes.indexOf('app.get("/api/studio-systems/forms/:formId/deadline-status"'));
  assert.match(target,/resolveAuthorizedStudioFormTarget/);
  assert.match(target,/canReviewForm\(request, formId\)/);
  assert.match(target,/private, no-store/);
  assert.match(target,/reply.code\(404\)/);
  const exact=routes.slice(routes.indexOf('app.get("/api/studio-systems/forms/:formId/submissions/:submissionId"'));
  assert.match(exact.slice(0,400),/requireFormReviewer\(request, reply/);
  assert.match(routes,/return Boolean\(eligibleFormReviewerUser\(user\) && await formReviewGrant\(user.id, formId\)\)/);
});
await check('Exact submission route excludes application and scopes to formId',()=>{const idx=routes.indexOf('app.get("/api/studio-systems/forms/:formId/submissions/:submissionId"');assert.match(routes.slice(idx,idx+850),/formId, form: \{ purpose: \{ not: "application" \} \}/)});
await check('Target lookup never serializes answers or identity',()=>{const from=routes.indexOf('app.get("/api/studio-systems/submissions/:submissionId/target"');const to=routes.indexOf('app.get("/api/studio-systems/forms/:formId/submissions/:submissionId"');const block=routes.slice(from,to);for(const forbidden of ['answersJson','respondentEmail','respondentName'])assert(!block.includes(forbidden))});
await check('Search navigation resolves Studio Forms and submissions',()=>{const s=src('packages/renderer/src/features/workflow/resource-navigation.ts');assert.match(s,/kind === "studio_form"[^\n]+inspectScope: "studio-form"/);assert.match(s,/kind === "form_submission"[^\n]+inspectScope: "form-submission"/)});
await check('App handoff opens actual Studio Systems section',()=>{const s=src('packages/renderer/src/features/application/ClusterApplication.tsx');assert.match(s,/target.screen === "studioSettings"[\s\S]*?setScreen\("studioSettings", \{ section: "studioSystems", discardApproved: true \}\)/)});
await check('Studio Systems resolves exact response to owning form',()=>{const s=src('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx');assert.match(s,/submissions\/\$\{encodeURIComponent\(targetSubmissionId\)\}\/target/);assert.match(s,/setSelectedFormId\(result.formId\)/)});
await check('Review panel loads exact deep-linked response independently from paged queue',()=>{
 const s=src('packages/renderer/src/features/settings/StudioFormSubmissionsPanel.tsx');
 assert.match(s,/setSelectedId\(targetSubmissionId\)/);
 assert.match(s,/submissions\/\$\{encodeURIComponent\(selectedId\)\}/);
 assert.match(s,/detailRequestId\.current/);
 assert.match(s,/setSelectedDetail\(submission\)/);
});
await check('Studio Settings restores all valid sections, not just versioning',()=>{const s=src('packages/renderer/src/features/settings/StudioSettingsPage.tsx');assert.match(s,/STUDIO_SETTINGS_GROUPS.some/);assert.match(s,/!initialSection && recoveredDraft/)});
console.log(`TD4 R73 Studio Forms & submissions: ${checks}/${checks} passed`);
