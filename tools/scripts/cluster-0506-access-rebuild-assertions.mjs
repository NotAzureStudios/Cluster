import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); } })();
function load(file,stubs={}) {
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports,require:id=>{if(Object.hasOwn(stubs,id))return stubs[id];throw Error(`Unknown ${id} from ${file}`);},process,performance,Buffer,Date,Map,Set,WeakMap,Promise,Error,Number,Math,console});
  return module.exports;
}
const moduleAuth=load('apps/server/src/domains/access/authorization.ts',{
  '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','board','card','file'],CLUSTER_TOOL_PERMISSION_KEYS:['projects','boards','mywork'],createClusterExplanation:()=>({}),resolveClusterEffectiveState:layers=>({values:Object.assign({},...(layers||[]).map(layer=>layer.values||{}))})},
  '../projects/project-membership.js':{membershipIsLead:()=>false,projectMembershipForUser:()=>null},
  './authorization-decision.js':{decisionResource:r=>r,minimumForAuthorizationAction:()=> 'view'},
  '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:u=>u},
  '../planning/calendar-access.js':{canAccessCalendarEvent:async()=>true},
});
const user={id:'member',username:'member'};
const project={id:'P1',name:'Workspace',memberships:[],archived:false};
const request={raw:{},url:'/api/projects',headers:{}};
function makeAuth(findMany) {
 const prisma={accessRule:{findMany},card:{findUnique:async()=>({id:'card1',workItemKind:'task',list:{board:{id:'board1',project}}})}};
 return moduleAuth.createAuthorizationService({prisma,authRequired:true,getCurrentUser:async()=>user,decorateUserForClient:async()=>({workspaceRole:'member',isAdmin:false}),getStudioPermissionSettings:()=>({}),parseObject:()=>({}),parseLabels:()=>[]});
}
const offline=()=>{throw Error('ACCESS_RULE_STORE_OFFLINE')};
let count=0;
async function check(name,fn){try{await fn();count++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error.stack);process.exitCode=1;}}
await check('individual project decisions do not turn ACL DB failure into inherited allow',async()=>{
 await assert.rejects(makeAuth(offline).authorize({user,decorated:{workspaceRole:'member'}},'view',{kind:'project',project}),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('request-scoped target authorization fails closed when ACL store is unavailable',async()=>{
 await assert.rejects(makeAuth(offline).authorize(request,'view',{kind:'target',targetKind:'board',targetId:'board1',project}),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('target-list filtering never silently ignores deny rules on DB outage',async()=>{
 await assert.rejects(makeAuth(offline).filterTargetsForRequest(request,[{id:'board1'}],'board',project),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('card-list filtering cannot drop ACL denies on DB outage',async()=>{
 await assert.rejects(makeAuth(offline).filterCardsForRequest(request,[{id:'card1',list:{board:{id:'board1'}}}],project),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('realtime activity filtering fails closed on DB outage',async()=>{
 await assert.rejects(makeAuth(offline).filterActivityEventsForUser(user,[{id:'activity',projectId:'P1'}]),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('requireCard fails closed on Access Rule DB outage',async()=>{
 await assert.rejects(makeAuth(offline).requireCard(request,{code(){return this},send(){}},'card1'),/ACCESS_RULE_STORE_OFFLINE/);
});
await check('explicit deny rules still override normal project view access',async()=>{
 const deny={id:'deny',status:'active',targetKind:'project',targetId:'P1',subjectKind:'all',effect:'deny',level:'none',expiresAt:null};
 const auth=makeAuth(async()=>[deny]);
 const decision=await auth.authorize({user,decorated:{workspaceRole:'member'}},'view',{kind:'project',project});
 assert.equal(decision.allowed,false);assert.equal(decision.code,'PROJECT_PERMISSION_DENIED');
});
await check('valid empty ACL query succeeds; errors and malformed responses do not' ,async()=>{
 const auth=makeAuth(async()=>[]);
 assert.equal((await auth.filterTargetsForRequest(request,[{id:'board1'}],'board',project)).length>=0,true);
 await assert.rejects(makeAuth(async()=>null).authorize({user,decorated:{workspaceRole:'member'}},'view',{kind:'project',project}),/invalid response/);
});

class Cache{constructor(){this.map=new Map()}get size(){return this.map.size}get weight(){return this.map.size*128}get(k){return this.map.get(k)}set(k,v){this.map.set(k,v)}clear(){this.map.clear()}}
const serviceModule=load('apps/server/src/domains/search/search-service.ts',{
 '../../core/bounded-cache.js':{BoundedCache:Cache},
 '../access/disclosure.js':{userDisclosureObligations:()=>({}),applyDisclosureObligations:x=>x},
 './search-index-builder.js':{normalize:x=>String(x||'').toLowerCase().replace(/[_-]+/g,' ').trim(),buildIndex:c=>({loadedAt:Date.now(),corpus:c,items:c.items||[],postings:new Map()}),buildPostings:()=>new Map(),mergeProjectCorpus:(old)=>old},
 './search-query-runtime.js':{parseQuery:(q,scope)=>({term:q,operators:{},kinds:[],sort:'relevance'}),candidateIndexes:(snap,q)=>snap.items.map((_,i)=>i).filter(i=>snap.items[i].title.includes(q)),operatorMatches:()=>true,score:()=>({value:100,reason:'title'}),PRIORITY_RANK:{},SEARCH_FULL_REBUILD_MS:300000,SEARCH_STALE_REBUILD_MS:15000},
});
function corpus(id,accessRules=[]){return {items:[{id,title:'alpha',kind:'file',labels:[],categories:[],flags:[],raw:{}}],users:[],projects:[],cards:[],timelineItems:[],calendarEvents:[],cardComments:[],activityEvents:[],projectFiles:[],videoAssets:[],deliveryRecords:[],projectRelationships:[],accessRules};}
function makeSearch(loadCorpus,extra={}){return serviceModule.createSearchService({loadCorpus,serializeUserLite:x=>x,serializeProjectSummary:x=>x,...extra})}
async function search(service,callback=()=>true){return service.search({q:'alpha',scope:'all',limit:3,userId:'u1',canViewItem:callback})}
await check('invalidation during full rebuild retries before publishing stale item',async()=>{
 let resolveFirst;const barrier=new Promise(resolve=>resolveFirst=resolve);let calls=0;
 const service=makeSearch(async()=>{calls++;if(calls===1){await barrier;return corpus('stale')}return corpus('fresh')});
 const pending=search(service);service.invalidate();resolveFirst();
 const result=await pending;assert.equal(result.results[0].id,'fresh');assert.equal(calls,2);assert.equal(service.diagnostics().indexRevision,1);
});
await check('initial in-flight project event causes a fresh full rebuild',async()=>{
 let resolveFirst;const barrier=new Promise(resolve=>resolveFirst=resolve);let calls=0;
 const service=makeSearch(async()=>{calls++;if(calls===1){await barrier;return corpus('stale')}return corpus('fresh')});
 const pending=search(service);service.invalidateChange({projectId:'P1',resource:{kind:'file',id:'F1'}});resolveFirst();
 assert.equal((await pending).results[0].id,'fresh');assert.equal(calls,2);
});
await check('continuous invalidation rejects search rather than publishing known stale data',async()=>{
 let service;let calls=0;
 service=makeSearch(async()=>{calls++;service.invalidate();return corpus('stale')});
 await assert.rejects(search(service),/changed repeatedly/);assert.equal(calls,4);assert.equal(service.diagnostics().dirty,true);
});
await check('access-rule event spellings all reload complete ACL snapshot',async()=>{
 for(const spelling of ['access_rule','access-rule','Access Rule','accessRule','access','access_policy','acl']){
  let count=0;const service=makeSearch(async()=>corpus('item',[{id:'old'}]),{loadAccessRules:async()=>{count++;return [{id:'new'}]}});
  await search(service);service.invalidateChange({projectId:'P1',resource:{kind:spelling,id:'rule1'}});
  const seen=[];await search(service,(_item,_project,rules)=>{seen.push(rules.map(r=>r.id));return true});
  assert.equal(count,1,spelling);assert.equal(seen[0][0],'new',spelling);
 }
});
await check('failed rebuild remains retryable after mutation storm settles',async()=>{
 let service;let calls=0;
 service=makeSearch(async()=>{calls++;if(calls<=4)service.invalidate();return corpus(calls<=4?'stale':'good')});
 await assert.rejects(search(service),/changed repeatedly/);
 assert.equal((await search(service)).results[0].id,'good');
});
console.log(`${count}/13 access/search stability tests passed`);
if(count!==13)process.exitCode=1;
