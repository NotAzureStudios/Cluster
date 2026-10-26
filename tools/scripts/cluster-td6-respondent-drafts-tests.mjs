import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';

const routeSource = fs.readFileSync('apps/server/src/domains/studio-systems/studio-systems-routes.ts', 'utf8');
const jsx = ['packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx', 'packages/renderer/src/features/settings/MyFormsPanel.tsx', 'packages/renderer/src/features/settings/StudioFormSubmissionsPanel.tsx', 'packages/renderer/src/features/studio-systems/StudioFormRunner.tsx'].map(p => fs.readFileSync(p,'utf8'));
const chain={trim(){return this},min(){return this},max(){return this},int(){return this},default(){return this},optional(){return this},nullable(){return this},datetime(){return this},omit(){return this},extend(){return this},parse(v){return v}};
const z={record(){return Object.create(chain)},unknown(){return Object.create(chain)},object(fields){const row=Object.create(chain);row.parse=(v)=>fields?.page?{page:1,limit:25,...v}:v;return row},string(){return Object.create(chain)},boolean(){return Object.create(chain)},number(){return Object.create(chain)},enum(){return Object.create(chain)},coerce:{number(){return Object.create(chain)}}};
const parser = value => typeof value === 'string' ? JSON.parse(value) : value;
const serializeVersion = (row,{publicView=false}={}) => ({...row,schema:{fields:parser(row.schemaJson).fields.map(x=>publicView?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='profileMappingKey')):x)},settings:parser(row.settingsJson),schemaJson:undefined,settingsJson:undefined});
const modules={
  '@cluster/shared': {STUDIO_FORM_TEMPLATES:[],studioAudienceSchema:chain,studioFormCreateSchema:chain,studioFormTemplateCreateSchema:chain,studioFormSubmissionSchema:chain,studioFormVersionCreateSchema:chain,studioPolicyAcceptanceSchema:chain,studioPolicyCreateSchema:chain,studioPolicyVersionCreateSchema:chain,POLICY_COMPLIANCE_DATA_FIELDS:[],PACKET_COMPLIANCE_DATA_FIELDS:[],projectVisibleStudioFormAnswers:(_fields,answers)=>({...answers})},
  'zod': {z},
  '../../core/data-query.js': {normalizeClusterDataQuery:x=>x},
  '../access/studio-audience.js': {parseStudioJson:parser,studioAudienceMatchesUser:async(_db,audience,user)=>!audience.includes('restricted') || user.id==='owner'},
  './studio-form-runtime.js': {serializeStudioFormVersion:serializeVersion,serializeStudioForm:row=>({...row,versions:row.versions?.map(v=>serializeVersion(v))}),validateStudioFormAnswers:(_schema,answers)=>answers.invalid?{ok:false,error:'invalid'}:{ok:true}},
  './studio-knowledge-runtime.js': {reconcileStudioKnowledgeAssignments:async()=>{}},
  './studio-knowledge-evidence.js': {ensureStudioKnowledgePersonnelRecord:async()=>{}},
  './studio-knowledge-compliance.js': {applyStudioKnowledgeComplianceQuery:()=>({}),studioKnowledgeComplianceRows:async()=>[]},
};
const js=ts.transpileModule(routeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const context={module:{exports:{}},require:(name)=>name==='node:crypto'?crypto:modules[name]||(()=>{throw Error(`Unexpected import ${name}`)})(),Date,console,URL,Buffer};context.exports=context.module.exports;
vm.runInNewContext(js,context,{filename:'studio-systems-routes.cjs'});

let forms=[
  {id:'general',key:'general-key',title:'Equipment request',description:'Request accessories',purpose:'equipment',status:'active',audienceJson:'all',updatedAt:new Date('2026-10-10T12:00:00Z')},
  {id:'restricted',key:'restricted-key',title:'Private internal',purpose:'general',status:'active',audienceJson:'restricted'},
  {id:'application',key:'application-key',title:'Public application',purpose:'application',status:'active',audienceJson:'all'},
  {id:'draft',key:'draft-key',title:'Draft work',purpose:'general',status:'draft',audienceJson:'all'},
];
const base= {schemaJson:JSON.stringify({fields:[{id:'reason',label:'Reason',type:'long_text',profileMappingKey:'legalName'}]}),settingsJson:JSON.stringify({allowMultipleSubmissions:false,acceptingResponses:true})};
let versions=[{id:'v1',formId:'general',version:1,status:'published',updatedAt:new Date('2026-10-10T12:00:00Z'),...base},{id:'r1',formId:'restricted',version:1,status:'published',...base},{id:'a1',formId:'application',version:1,status:'published',...base},{id:'d1',formId:'draft',version:1,status:'draft',updatedAt:new Date('2026-10-10T12:00:00Z'),...base}];
let submissions=[];let drafts=[];let draftSeq=0;let sequence=0;let serializable=false;
const db={
  studioFormResponseDraft: {
    findMany:async({where})=>drafts.filter(d=>d.userId===where.userId&&where.formId.in.includes(d.formId)),
    findUnique:async({where})=>drafts.find(d=>d.formId===where.formId_userId.formId&&d.userId===where.formId_userId.userId)||null,
    findUniqueOrThrow:async({where})=>{const d=drafts.find(d=>d.formId===where.formId_userId.formId&&d.userId===where.formId_userId.userId);assert.ok(d);return d},
    create:async({data})=>{if(drafts.some(d=>d.formId===data.formId&&d.userId===data.userId))throw Object.assign(new Error('unique'),{code:'P2002'});const row={...data,id:`draft-${++draftSeq}`,revision:1,updatedAt:new Date()};drafts.push(row);return row},
    updateMany:async({where,data})=>{const row=drafts.find(d=>d.formId===where.formId&&d.userId===where.userId&&d.formVersionId===where.formVersionId&&d.revision===where.revision);if(!row)return {count:0};row.answersJson=data.answersJson;row.revision++;row.updatedAt=new Date();return {count:1}},
    deleteMany:async({where})=>{const before=drafts.length;drafts=drafts.filter(d=>!(d.formId===where.formId&&d.userId===where.userId&&(!where.revision||where.revision===d.revision)));return {count:before-drafts.length}}
  },
  workspaceMember: { findMany: async()=>[{userId:'admin-a'},{userId:'admin-b'}] },
  studioForm: {
    findMany:async({where}={})=>forms.filter(f=>!where?.status||f.status===where.status).filter(f=>!where?.purpose?.not||f.purpose!==where.purpose.not).filter(f=>!where?.versions?.some||versions.some(v=>v.formId===f.id&&v.status==='published')).map(f=>({...f,versions:versions.filter(v=>v.formId===f.id&&v.status==='published').sort((a,b)=>b.version-a.version).slice(0,1)})),
    findUnique:async({where})=>forms.find(f=>f.id===where.id||f.key===where.key)||null,
    update:async({where,data})=>{const f=forms.find(f=>f.id===where.id);Object.assign(f,data);return f},
    updateMany:async({where,data})=>{const f=forms.find(f=>f.id===where.id && +new Date(f.updatedAt)===+new Date(where.updatedAt));if(!f)return {count:0};Object.assign(f,data,{updatedAt:new Date('2026-10-10T12:06:00Z')});return {count:1}},
    findUniqueOrThrow:async({where})=>{const f=forms.find(f=>f.id===where.id);return {...f,versions:versions.filter(v=>v.formId===f.id)}}
  },
  studioFormVersion: {
    findFirst:async({where})=>versions.filter(v=>v.formId===where.formId&&(!where.id||v.id===where.id)&&(!where.status||v.status===where.status)).sort((a,b)=>b.version-a.version)[0]||null,
    findUniqueOrThrow:async({where})=>versions.find(v=>v.id===where.id),
    updateMany:async({where,data})=>{const v=versions.find(v=>v.id===where.id&&v.formId===where.formId&&v.status===where.status&&+new Date(v.updatedAt)===+new Date(where.updatedAt));if(!v)return {count:0};Object.assign(v,data,{updatedAt:new Date('2026-10-10T12:05:00Z')});return {count:1}},
  },
  studioFormSubmission: {
    findMany:async({where={},skip=0,take=100})=>submissions.filter(s=>(!where.userId||s.userId===where.userId)&&(!where.formId||(typeof where.formId==='string'?s.formId===where.formId:where.formId.in.includes(s.formId)))&&(!where.status||(typeof where.status==='string'?s.status===where.status:where.status.in.includes(s.status)))).sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).slice(skip,skip+take).map(s=>({...s,formVersion:versions.find(v=>v.id===s.formVersionId)})),
    findFirst:async({where})=>submissions.find(s=>s.formId===where.formId&&s.userId===where.userId&&where.status.in.includes(s.status))||null,
    create:async({data})=>{const row={...data,id:`submission-${++sequence}`,submittedAt:new Date(),updatedAt:new Date('2026-10-10T12:00:00Z'),reviewNote:null};submissions.push(row);return row},
    updateMany:async({where,data})=>{const s=submissions.find(s=>s.id===where.id&&s.formId===where.formId&&+new Date(s.updatedAt)===+new Date(where.updatedAt)&&(typeof where.status==='string'?s.status===where.status:where.status.in.includes(s.status)));if(!s)return {count:0};Object.assign(s,data,{updatedAt:new Date('2026-10-10T12:03:00Z')});return {count:1}},
    findUniqueOrThrow:async({where})=>submissions.find(s=>s.id===where.id)
  },
  $transaction:async(fn,options)=>{if(options?.isolationLevel==='Serializable')serializable=true;return fn(db)}
};
const events=[];const routes=new Map();let user={id:'member',displayName:'Member',email:'member@studio.test'}, admin=true;
const app={get:(p,fn)=>routes.set(`GET ${p}`,fn),post:(p,fn)=>routes.set(`POST ${p}`,fn),put:(p,fn)=>routes.set(`PUT ${p}`,fn),delete:(p,fn)=>routes.set(`DELETE ${p}`,fn),patch:(p,fn)=>routes.set(`PATCH ${p}`,fn)};
context.module.exports.registerStudioSystemsRoutes({app,prisma:db,authorization:{requireTool:async()=>admin?{id:'admin'}:null},getCurrentUser:async()=>user,logActivity:async row=>events.push(row)});
async function call(method,path,params={},body={},query={}){const fn=routes.get(`${method} ${path}`);assert.ok(fn,`Missing route ${method} ${path}`);const reply={status:200,code(n){this.status=n;return this},header(){return this},send(row){return row}};return {status:reply.status,...(await (async()=>{const value=await fn({params,body,query},reply);return {value}})()),get code(){return reply.status}};}
let checked=0;function check(cond,message){assert.ok(cond,message);checked++;console.log('PASS',message)}
// Draft lifecycle: the API itself is called through its registered server handler.
let draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.value.draft===null,'New authorized respondent has no draft');
user=null;
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.code===401,'Anonymous callers cannot recover an authenticated form draft');
user={id:'member',displayName:'Member',email:'member@studio.test'};
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'X'.repeat(70_000)}});
check(draftResult.code===413,'Draft payloads have a bounded UTF-8 size');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'First section'}});
check(draftResult.value.revision===1&&drafts.length===1,'Initial save creates one owner-private draft');
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.value.draft.answers.reason==='First section'&&!draftResult.value.draft.stale,'Own draft recovers answers');
user={id:'different-member',displayName:'Different person'};
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.value.draft===null,'Other member cannot read the first respondent draft');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'Other member response'}});
check(draftResult.value.revision===1&&drafts.length===2,'Other member has independent draft');
user={id:'member',displayName:'Member',email:'member@studio.test'};
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:1,answers:{reason:'Updated answer'}});
check(draftResult.value.revision===2,'Compare-and-swap advances revision on update');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:1,answers:{reason:'Old writer'}});
check(draftResult.code===409&&draftResult.value.code==='FORM_DRAFT_CONFLICT','Stale writer cannot clobber newer answers');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'Duplicate initial'}});
check(draftResult.code===409,'Second initial create cannot overwrite a draft');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'restricted-key'},{formVersionId:'r1',expectedRevision:null,answers:{reason:'Try'}});
check(draftResult.code===404,'Audience denies unauthorized draft writes');
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'application-key'});
check(draftResult.code===404,'Public application form has no authenticated recovery surface');
const oldSettings=versions[0].settingsJson;
versions[0].settingsJson=JSON.stringify({allowDrafts:false,acceptingResponses:true});
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.code===403,'Form author can disable respondent draft persistence');
versions[0].settingsJson=oldSettings;
versions.push({id:'v2',formId:'general',version:2,status:'published',...base});
draftResult=await call('GET','/api/forms/:formKey/draft',{formKey:'general-key'});
check(draftResult.value.draft.stale===true,'Form republish flags previous version drafts as stale');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:2,answers:{reason:'Unsafe overwrite'}});
check(draftResult.code===409&&draftResult.value.code==='FORM_VERSION_STALE','Old form version cannot write its draft after republish');
versions.pop();
draftResult=await call('DELETE','/api/forms/:formKey/draft',{formKey:'general-key'},{expectedRevision:1});
check(draftResult.code===409,'Stale delete cannot discard another tab newer draft');
draftResult=await call('DELETE','/api/forms/:formKey/draft',{formKey:'general-key'},{expectedRevision:2});
check(draftResult.value.ok===true&&!drafts.some(d=>d.userId==='member'),'Owner can discard matching revision explicitly');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'Completed after recovery'}});
check(draftResult.value.revision===1,'Respondent can start a fresh draft after discard');

let result=await call('GET','/api/forms/available');
check(result.value.forms.length===1&&result.value.forms[0].form.id==='general','Available forms enforce audience, publication and application exclusion');
check(result.value.forms[0].savedDraft!==null&&result.value.forms[0].savedDraft.stale===false&&!('answers' in result.value.forms[0].savedDraft),'Assigned form list shows only private draft summary without answers');
check(!('profileMappingKey' in result.value.forms[0].version.schema.fields[0]),'Member form listing strips sensitive application profile mappings');
result=await call('POST','/api/forms/:formKey/submissions',{formKey:'general-key'},{formVersionId:'v1',answers:{reason:'Need stylus'}});
check(result.code===201 && submissions.length===1 && serializable,'Submission committed in serializable transaction');
check(!drafts.some(d=>d.userId==='member')&&drafts.some(d=>d.userId==='different-member'),'Final submission atomically clears only its own draft');
draftResult=await call('PUT','/api/forms/:formKey/draft',{formKey:'general-key'},{formVersionId:'v1',expectedRevision:null,answers:{reason:'Late autosave'}});
check(draftResult.code===409&&draftResult.value.code==='FORM_ALREADY_SUBMITTED','Late autosave cannot resurrect draft after final submission');
result=await call('POST','/api/forms/:formKey/submissions',{formKey:'general-key'},{formVersionId:'v1',answers:{reason:'Again'}});
check(result.code===409 && result.value.code==='FORM_ALREADY_SUBMITTED','One-response rule rejects duplicate submission');
result=await call('GET','/api/forms/available');
check(result.value.forms[0].canSubmit===false && result.value.forms[0].lastSubmission?.id==='submission-1','Recipient sees private submission state and disabled repeat submission');
result=await call('GET','/api/studio-systems/forms/:formId/submissions',{formId:'general'});
check(result.value.submissions.length===1 && result.value.submissions[0].answers.reason==='Need stylus','Admin review queue retrieves versioned answers');
result=await call('GET','/api/studio-systems/forms/:formId/submissions',{formId:'application'});
check(result.code===404,'General review queue does not expose application responses');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{expectedUpdatedAt:'2026-10-10T12:00:00Z',status:'rejected',note:''});
check(result.code===400,'Rejecting a response requires an explanation');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{expectedUpdatedAt:'2026-10-10T12:00:00Z',status:'under_review',note:'Reviewing'});
check(result.value.status==='under_review','Review transitions submitted response into review');
result=await call('GET','/api/forms/available');
check(result.value.forms[0].canSubmit===false,'Under-review responses cannot be submitted twice');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{expectedUpdatedAt:'2026-10-10T12:00:00Z',status:'approved'});
check(result.code===409,'Stale reviewer cannot override another review');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{expectedUpdatedAt:'2026-10-10T12:03:00Z',status:'approved',note:'Done'});
check(result.value.status==='approved','Current reviewer can approve a pending response');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{expectedUpdatedAt:'2026-10-10T12:03:00Z',status:'approved'});
check(result.code===409,'Reviewed decisions cannot be repeated');
check(events.some(row=>row.entityType==='studio_form_submission' && row.type==='submitted' && row.metadata?.notifyInbox===true),'Form submission notifies studio reviewers');
check(events.some(row=>row.entityType==='studio_form_submission' && row.type==='reviewed' && row.metadata?.userIds?.includes('member')),'Final review decision notifies respondent');
const draftData={formId:'draft',versionId:'d1'};
result=await call('PATCH','/api/studio-systems/forms/:formId/versions/:versionId',draftData,{expectedUpdatedAt:'2026-10-10T11:00:00Z',schema:{fields:[]},settings:{},publish:true});
check(result.code===409&&forms.find(f=>f.id==='draft').status==='draft','Stale draft publication is rejected without activation');
result=await call('PATCH','/api/studio-systems/forms/:formId/versions/:versionId',draftData,{expectedUpdatedAt:'2026-10-10T12:00:00Z',schema:{fields:[{id:'title',label:'Title'}]},settings:{allowMultipleSubmissions:false},publish:true});
check(result.value.status==='published'&&forms.find(f=>f.id==='draft').status==='active','Current draft can publish atomically and activate its form');
result=await call('PATCH','/api/studio-systems/forms/:formId',{formId:'general'},{expectedUpdatedAt:'2026-10-10T11:00:00Z',title:'Equipment access',description:'Latest',audience:{mode:'include',targets:[{kind:'user',id:'restricted'}]}});
check(result.code===409,'Stale form audience edit rejected');
result=await call('PATCH','/api/studio-systems/forms/:formId',{formId:'general'},{expectedUpdatedAt:'2026-10-10T12:00:00Z',title:'Equipment access',description:'Latest',audience:{mode:'include',targets:[{kind:'user',id:'restricted'}]}});
check(result.value.title==='Equipment access','Administrator can update the audience and title without republishing form fields');
result=await call('GET','/api/forms/available');
check(!result.value.forms.some(row=>row.form.id==='general'),'Changed audience immediately removes unauthorized form from recipient discovery');
admin=false;
result=await call('GET','/api/studio-systems/forms/:formId/submissions',{formId:'general'});
check(result.value===undefined,'Non-admin cannot enumerate other people’s responses');
result=await call('PATCH','/api/studio-systems/forms/:formId/submissions/:submissionId/review',{formId:'general',submissionId:'submission-1'},{status:'approved'});
check(result.value===undefined,'Non-admin cannot decide a review');
const contracts=['/api/forms/available','/api/studio-systems/forms/:formId/submissions','/versions/:versionId','Serializable','FORM_REVIEW_STALE'];
for(const x of contracts)check(routeSource.includes(x),`Server contract retains ${x}`);
for(const x of ['StudioFormSubmissionsPanel','Save draft','Publish new version','Move up','Move down','Save details & audience'])check(jsx[0].includes(x),`Form authoring UI contains ${x}`);
for(const x of ['My forms','StudioFormRunner','lastSubmission','canSubmit'])check(jsx[1].includes(x),`Member form UI contains ${x}`);
check(jsx[2].includes('expectedUpdatedAt')&&jsx[2].includes('Record decision'),'Review UI binds reviewed revision and decision');
check(jsx[3].includes('submissionLock.current'),'Form runner guards repeated intent before state update');
console.log(`${checked}/${checked} Forms workflow checks passed`);

const runtimeSource=fs.readFileSync('apps/server/src/domains/studio-systems/studio-form-runtime.ts','utf8');
const runtimeJs=ts.transpileModule(runtimeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const runtimeCtx={module:{exports:{}},require:name=>name==='@cluster/shared'?{studioAudienceSchema:chain,visibleStudioFormFieldIds:(fields)=>new Set(fields.map(f=>f.id))}:{parseStudioJson:parser},URL,Date,console};runtimeCtx.exports=runtimeCtx.module.exports;
vm.runInNewContext(runtimeJs,runtimeCtx);
const validate=runtimeCtx.module.exports.validateStudioFormAnswers;
const definition={fields:[{id:'email',label:'Email',type:'email',required:true},{id:'approval',label:'Approval',type:'acknowledgement',required:true},{id:'choice',label:'Choice',type:'select',options:['yes','no']}]};
check(validate(definition,{email:'test@studio.test',approval:false},{partial:true}).ok===true,'Partial drafts allow incomplete acknowledgement');
check(validate(definition,{approval:true},{partial:true}).ok===true,'Partial drafts omit required fields safely');
check(validate(definition,{email:'invalid'},{partial:true}).ok===true,'Partially typed email may be saved before submission');
check(validate(definition,{email:123},{partial:true}).ok===false,'Partial drafts still validate entered field types');
check(validate(definition,{choice:'wrong'},{partial:true}).ok===false,'Partial drafts reject unauthorized option values');
check(validate(definition,{approval:false}).ok===false,'Final submission still requires true acknowledgement');

check(validate({fields:[{id:'consent',label:'Consent',type:'checkbox',required:true}]},{consent:false}).ok===false,'Final submissions cannot bypass required checkbox by sending false');

check(validate(definition,{email:'incomplete@',approval:false},{partial:true}).ok===true,'Partially entered email survives autosave without final validation');

console.log(`${checked}/${checked} combined server, authorization, validation and source contract assertions passed`);
