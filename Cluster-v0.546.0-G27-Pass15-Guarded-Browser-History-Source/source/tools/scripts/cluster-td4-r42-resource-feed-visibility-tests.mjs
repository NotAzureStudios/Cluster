import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const code = ts.transpileModule(fs.readFileSync('apps/server/src/domains/changes/resource-change-routes.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const zString={regex(){return this},optional(){return this}};
const seqSchema={parse:(q)=>({ after: String(q.after??0), limit: Number(q.limit??100) })};
const changes = [];
let latest = 0n;
let role='member';
let active=true;
let revoked=false;
let libraryAclUnavailable=false;
let failRules=false;
let protectedIds=[];
let libraryItems=[];
let canSee = () => false;
let targetAccess=true;
let checkCalendar=()=>true;
let boardRows=[];
const project={id:'P1',archived:false};
const user={id:'U1',archived:false,accountState:'ACTIVE',accessExpiresAt:null};
const requests={};
const module={exports:{}};
vm.runInNewContext(code, {
  module,exports:module.exports,require:(id)=>{
    if (id==='zod') return {z:{object:()=>({parse:q=>q}),coerce:{string:()=>zString},}};
    if (id==='@cluster/shared') return {CLUSTER_ACCESS_TARGET_KINDS:['project','library','board','card','file'],clusterResourceChangesQuerySchema:seqSchema};
    if (id==='../../core/api-response.js') return {apiError:(_req,reply,status,code)=>{reply.code(status);return {ok:false,code}}};
    if (id==='../../core/resource-change-runtime.js') return {
      resourceChangeWindow:async()=>({floor:0n,latest}),
      readResourceChanges:async(_db,after,limit)=>changes.filter(x=>BigInt(x.sequence)>after).slice(0,limit),
      resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence:async()=>latest,
    };
    if (id==='./resource-change-tool-lifecycle.js') return {enabledResourceChanges:(changes,isEnabled)=>changes,resourceChangeToolAvailabilityFingerprint:()=>"all-enabled"};
    if (id==='./resource-change-providers.js') {
      const providerCode=ts.transpileModule(fs.readFileSync('apps/server/src/domains/changes/resource-change-providers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const providerModule={exports:{}};
      vm.runInNewContext(providerCode,{module:providerModule,exports:providerModule.exports,
        require:(id)=>id==='../access/studio-audience.js'
          ? {studioAudienceMatchesContext:()=>true} : (()=>{throw Error('Unmocked provider import '+id)})(),
        Map,Set,Promise,Error,String,Array,Boolean});
      return providerModule.exports;
    }
    if (id==='../workforce/workforce-user-authority.js') return {WORKFORCE_USER_AUTHORITY_INCLUDE:{}};
    if (id==='../access/studio-audience.js') return {loadStudioAudienceUserContext:async()=>({departmentId:'',jobRoleId:'',teamIds:new Set(),projectIds:new Set()})};
    if(id==='../planning/calendar-access.js')return {canAccessCalendarEvent:async(...args)=>checkCalendar(...args)};
    throw Error('unmocked '+id);
  },Date,Map,Set,Promise,Number,Math,String,BigInt,JSON,process,console,setInterval,clearInterval,Error,Array,Boolean,
},{filename:'resource-change-routes.ts'});
function change(kind,id,sequence=1,projectId='P1') {return {sequence:String(sequence),eventType:'resource.updated',resource:{kind,id,...(projectId?{projectId}:{})},occurredAt:'2026-10-14T00:00:00Z'};}
function setup() {
 const app={get:(route,handler)=>{requests[route]=handler}};
 const prisma={
 session:{findUnique:async()=>({id:'S1',userId:'U1',revokedAt:revoked?new Date():null,expiresAt:new Date(Date.now()+60_000),authenticationGeneration:1,user:active?{...user}:{...user,accountState:'SUSPENDED'}})},
 libraryItem:{findMany:async()=>libraryItems},
 personnelRecordAttachment:{findMany:async()=>protectedIds.map(libraryItemId=>({libraryItemId}))},
 project:{findMany:async()=>[project]},
 accessRule:{findMany:async()=>{if(failRules)throw new Error('permissions unavailable');return []}},
 calendarEvent:{findMany:async()=>[]},card:{findMany:async()=>boardRows},
 };
 const authorization={identityForRequest:async()=>({user,decorated:{isAdmin:role==='admin'},role}),hasTargetAccess:()=>role==='admin'||targetAccess,hasToolPermission:()=>true};
 const libraryAccess={contextForUser:async()=>{if(libraryAclUnavailable)throw new Error('Library ACL unavailable');return {user}},visibleFor:(_ctx,item)=>canSee(item)};
 module.exports.registerResourceChangeRoutes({app,prisma,authorization,libraryAccess,getCurrentSession:async()=>({id:'S1',userId:'U1'}),decorateUserForClient:async()=>({isAdmin:role==='admin',workspaceRole:role}),isConfigurableToolEnabled:()=>true,changeRuntime:{subscribe:()=>()=>{}}});
}
async function loadFeed(list) {
 changes.length=0;changes.push(...list);latest=BigInt(list.at(-1)?.sequence||0);
 const reply={status:200,headers:{},code(status){this.status=status;return this},header(key,value){this.headers[key]=value;return this}};
 return {data:await requests['/api/changes']({query:{after:'0'},raw:{}},reply),reply};
}
let checks=0;
async function check(label,task){try {await task(); checks++;console.log('PASS',label);}catch(err){console.error('FAIL',label,err.stack);process.exitCode=1;}}
setup();
await check('Library owner/granted collection needs actual Library ACL visibility',async()=>{
 libraryItems=[{id:'L1',projectId:'P1',status:'active'}];protectedIds=[];canSee=()=>false;
 const {data}=await loadFeed([change('library','L1')]);assert.equal(data.changes.length,0);
 canSee=()=>true;
 assert.equal((await loadFeed([change('library','L1')])).data.changes[0].resource.id,'L1');
});
await check('Library provider failure aborts feed rather than sending unfiltered IDs',async()=>{
 libraryAclUnavailable=true; await assert.rejects(loadFeed([change('library','L1')]),/Library ACL unavailable/);libraryAclUnavailable=false;
});
await check('file alias uses same Library access authority',async()=>{
 canSee=()=>true;
 assert.equal((await loadFeed([change('file','L1')])).data.changes.length,1);
});
await check('Personnel Records never leak via administrator Library invalidations',async()=>{
 role='admin'; libraryItems=[{id:'L1',projectId:'P1',status:'active'}];protectedIds=['L1'];
 assert.equal((await loadFeed([change('library','L1')])).data.changes.length,0);
 role='member';protectedIds=[];
});
await check('Personnel Records references always denied to non-admin',async()=>{
 protectedIds=['L1'];assert.equal((await loadFeed([change('library','L1')])).data.changes.length,0);protectedIds=[];
});
await check('unmatched Library IDs cannot leak through project permissions',async()=>{
 libraryItems=[];assert.equal((await loadFeed([change('library','GHOST')])).data.changes.length,0);
});
await check('resource project identity must agree with canonical Library record',async()=>{
 libraryItems=[{id:'L1',projectId:'P1',status:'active'}];
 assert.equal((await loadFeed([change('library','L1',1,'P2')])).data.changes.length,0);
});
await check('failed access-rule query propagates instead of clearing denies',async()=>{
 failRules=true;
 await assert.rejects(loadFeed([change('project','P1')]),/permissions unavailable/);
 failRules=false;
});
await check('suspended account stops change delivery with auth-required',async()=>{
 active=false;const {data,reply}=await loadFeed([change('library','L1')]);assert.equal(reply.status,401);assert.equal(data.code,'AUTH_REQUIRED');active=true;
});
await check('live role downgrade removes administrator bypass',async()=>{
 targetAccess=false;role='admin';assert.equal((await loadFeed([change('project','P1')])).data.changes.length,1);
 role='member';assert.equal((await loadFeed([change('project','P1')])).data.changes.length,0);
 targetAccess=true;
});
await check('revoked session stops change delivery',async()=>{
 revoked=true;const {data,reply}=await loadFeed([change('library','L1')]);assert.equal(reply.status,401);assert.equal(data.code,'AUTH_REQUIRED');revoked=false;
});
await check('expired account stops change delivery',async()=>{
 user.accessExpiresAt=new Date(0).toISOString();const {data,reply}=await loadFeed([change('library','L1')]);assert.equal(reply.status,401);assert.equal(data.code,'AUTH_REQUIRED');user.accessExpiresAt=null;
});
await check('card event project mismatch is denied',async()=>{
 boardRows=[{id:'C1',workItemKind:'card',list:{board:{id:'B1',project}}}];assert.equal((await loadFeed([change('card','C1',1,'P2')])).data.changes.length,0);
 assert.equal((await loadFeed([change('card','C1')])).data.changes.length,1);
});
await check('filtered change still advances cursor so feed does not retry hidden events',async()=>{
 libraryItems=[];const {data}=await loadFeed([change('library','L1',1),change('project','P1',2)]);assert.equal(data.cursor,'2');assert.equal(data.changes.length,1);
});
await check('strict Library access context refuses failed folder or Access Rule reads',async()=>{
 const content=ts.transpileModule(fs.readFileSync('apps/server/src/domains/library/library-access-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(content,{module:m,exports:m.exports,require:()=>{throw Error('Unexpected runtime import')},Date,Map,Set,Promise,Number,Math,String,Array,Error},{filename:'library-access-service.ts'});
 const db={accessRule:{findMany:async()=>[]},folderPermission:{findMany:async()=>{throw new Error('folder store unavailable')}},libraryItem:{findMany:async()=>[]}};
 const service=m.exports.createLibraryAccessService({prisma:db,getCurrentUser:async()=>user,decorateUserForClient:async()=>({isAdmin:false}),hasTargetAccess:()=>true});
 await assert.rejects(service.contextForUser(user,undefined,{strict:true}),/folder store unavailable/);
 db.folderPermission.findMany=async()=>[];
 db.accessRule.findMany=async()=>{throw new Error('access rules unavailable')};
 await assert.rejects(service.contextForUser(user,undefined,{strict:true}),/access rules unavailable/);
});
console.log(`${checks}/15 resource feed visibility checks passed`);
if(checks!==15)process.exitCode=1;
