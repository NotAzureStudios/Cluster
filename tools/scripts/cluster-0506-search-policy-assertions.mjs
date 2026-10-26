import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding:'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
function load(file, stubs = {}) {
  const output = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const mod={exports:{}};
  vm.runInNewContext(output, {module:mod,exports:mod.exports,require:id=>{
    if(Object.hasOwn(stubs,id))return stubs[id];
    throw new Error('Unexpected '+id+' in '+file);
  },process,performance,Buffer,Date,Map,Set,WeakMap,Promise,Error,Math,Number,console}, {filename:file});
  return mod.exports;
}
const normalize = value => String(value||'').trim().toLowerCase();
class Cache {
  constructor(){this.map=new Map();} get size(){return this.map.size;} get weight(){return this.map.size*128;}
  get(k){return this.map.get(k);} set(k,v){this.map.set(k,v);} clear(){this.map.clear();}
}
const builder = load('apps/server/src/domains/search/search-index-builder.ts', {
 '@cluster/shared':{CLUSTER_WORKFLOW_RELATIONSHIP_META:{},clusterResourceAddressFromEntity:()=>null},
 '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({})},
});
const fakeBuilder = {
 normalize,
 buildIndex: corpus => ({ loadedAt:Date.now(),corpus,items:corpus.items||[],postings:new Map() }),
 buildPostings: () => new Map(),
 mergeProjectCorpus:builder.mergeProjectCorpus,
};
const serviceModule = load('apps/server/src/domains/search/search-service.ts',{
 '../../core/bounded-cache.js':{BoundedCache:Cache},
 '../access/disclosure.js':{userDisclosureObligations:()=>({}),applyDisclosureObligations:user=>user},
 './search-index-builder.js':fakeBuilder,
 './search-query-runtime.js':{
   parseQuery:(q,scope)=>({term:q,operators:{},kinds:scope==='all'?[]:[scope],sort:'relevance'}),
   candidateIndexes:(snap,q)=>snap.items.map((_,i)=>i).filter(i=>snap.items[i].title.toLowerCase().includes(q)),
   operatorMatches:()=>true,
   score:()=>({value:100,reason:'title'}),
   PRIORITY_RANK:{},SEARCH_FULL_REBUILD_MS:300000,SEARCH_STALE_REBUILD_MS:15000,
 },
});
function item(id,projectId=null,kind='file',title='alpha') {return {id,title,kind,projectId,memberIds:[],authorIds:[],labels:[],categories:[],flags:[],raw:{}};}
function corpus(items,rules=[]) {return {items,projects:[{id:'P1'},{id:'P2'}],users:[],cards:[],timelineItems:[],calendarEvents:[],cardComments:[],activityEvents:[],projectFiles:[],videoAssets:[],deliveryRecords:[],projectRelationships:[],packetDefinitions:[],studioPolicies:[],accessRules:rules};}
function createService(initial,more={}) {return serviceModule.createSearchService({loadCorpus:async()=>initial,serializeUserLite:x=>x,serializeProjectSummary:x=>x,...more});}
async function query(service,canViewItem,q='alpha',limit=2) {return service.search({q,scope:'all',limit,userId:'u1',canViewItem});}
let passed=0;
async function check(label,fn){try{await fn();passed++;console.log('PASS',label);}catch(error){console.error('FAIL',label,error.stack);process.exitCode=1;}}
await check('nonmatching corpus entries never trigger access checks',async()=>{
 const service=createService(corpus([...Array.from({length:500},(_,i)=>item('other'+i,null,'file','unrelated')),item('needle',null,'file','alpha')]));
 let checked=0; const result=await query(service,()=>{checked++;return true;});
 assert.equal(result.results.length,1);assert.equal(checked,1);
});
await check('cache hits reauthorize and immediately hide revoked results',async()=>{
 const service=createService(corpus([item('visible'),item('hidden')]));
 const allow=()=>true;
 const first=await query(service,allow);assert.equal(first.results.length,2);
 const second=await query(service,x=>x.id!=='hidden');
 assert.deepEqual(Array.from(second.results,x=>x.id),['visible']);
 assert.equal(second.meta.cached,true);
 assert.equal(Object.hasOwn(second.meta,'candidateCount'),false);
 assert.equal(Object.hasOwn(second.meta,'totalIndexed'),false);
});
await check('a result limit is filled from visible matches beyond denied matches',async()=>{
 const service=createService(corpus([...Array.from({length:30},(_,i)=>item('denied'+i)),item('A'),item('B')]));
 const response=await query(service,x=>x.id==='A'||x.id==='B');
 assert.deepEqual(Array.from(response.results,x=>x.id),['A','B']);
});
await check('cache contains only ranking indices, no permissioned responses',async()=>{
 const src=fs.readFileSync('apps/server/src/domains/search/search-service.ts','utf8');
 assert.ok(src.includes('rankingCache.set(cacheKey, rankedCandidates'));
 assert.ok(!src.includes('visibilityCache.getOrLoad'));
 assert.ok(!src.includes('resultCache.set('));
});
await check('partial project refresh retains global and other project access rules',async()=>{
 const original=corpus([],[{id:'global'},{id:'p1old',projectId:'P1'},{id:'p2',projectId:'P2'},{id:'p1target',targetKind:'project',targetId:'P1'}]);
 const incoming=corpus([],[{id:'p1new',projectId:'P1'}]);
 const merged=builder.mergeProjectCorpus(original,incoming,'P1');
 assert.deepEqual(Array.from(merged.accessRules,r=>r.id),['global','p2','p1new']);
 assert.deepEqual(Array.from(builder.mergeProjectCorpus(merged,corpus([]),'P1').accessRules,r=>r.id),['global','p2']);
});
await check('project ACL event triggers full access-rules refresh even with projectId',async()=>{
 const current=corpus([item('x','P1')],[{id:'old',projectId:'P1'}]);
 let readCount=0;
 const service=createService(current,{loadAccessRules:async()=>{readCount++;return [{id:'new',projectId:'P1'}];}});
 await query(service,()=>true);
 service.invalidateChange({projectId:'P1',resource:{kind:'access_rule',id:'rule1'}});
 const rulesSeen=[];await query(service,(_item,_project,rules)=>{rulesSeen.push(rules.map(r=>r.id));return true;});
 assert.equal(readCount,1);assert.deepEqual(Array.from(rulesSeen[0]),['new']);
});
await check('project content refresh is awaited rather than serving removed item',async()=>{
 const initial=corpus([item('removed','P1'),item('stable','P2')]);
 let resolveRefresh;const pending=new Promise(resolve=>{resolveRefresh=resolve;});
 const service=createService(initial,{loadProjectCorpus:async()=>{await pending;return corpus([])}});
 await query(service,()=>true);
 service.invalidateChange({projectId:'P1',resource:{kind:'file',id:'removed'}});
 const searching=query(service,()=>true);
 resolveRefresh();const result=await searching;
 assert.deepEqual(Array.from(result.results,x=>x.id),['stable']);
});
await check('user incremental search corpus keeps workforce authority joins',async()=>{
 const code=fs.readFileSync('apps/server/src/domains/search/search-repository.ts','utf8');
 const segment=code.split('async function loadUserCorpus(')[1].split('async function loadAccessRules')[0];
 assert.match(segment,/WORKFORCE_USER_AUTHORITY_INCLUDE/);
});
await check('global invalidation forces the fresh corpus, not stale search titles',async()=>{
 let version=1;
 const service=createService(corpus([item('old',null,'file','alpha old')]),{loadCorpus:async()=>corpus(version===1?[item('old',null,'file','alpha old')]:[item('new',null,'file','alpha new')])});
 const before=await query(service,()=>true);assert.equal(before.results.length,1);
 version=2;service.invalidate();
 const after=await query(service,()=>true,'new');assert.equal(after.results.length,1);
 assert.equal(after.results[0].id,'new');
});
await check('repeated ACL events coalesce then replay the latest rule snapshot',async()=>{
 let finishFirst; const barrier = new Promise(resolve => { finishFirst=resolve; });
 let calls=0;
 const service=createService(corpus([item('matched','P1')],[{id:'base'}]),{
   loadAccessRules:async()=>{ calls++; if(calls===1){await barrier;return [{id:'old'}];} return [{id:'fresh'}]; },
 });
 await query(service,()=>true);
 service.invalidateChange({projectId:'P1',resource:{kind:'access_rule'}});
 service.invalidateChange({projectId:'P1',resource:{kind:'access_rule'}});
 const seen=[];const pending=query(service,(_item,_project,rules)=>{seen.push(rules.map(r=>r.id));return true;});
 finishFirst(); await pending;
 assert.equal(calls,2);
 assert.deepEqual(Array.from(seen.at(-1)),['fresh']);
});
await check('ACL database failure is propagated, never interpreted as empty rules',async()=>{
 const repoModule=load('apps/server/src/domains/search/search-repository.ts',{
  '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
  '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
 });
 const repo=repoModule.createSearchRepository({accessRule:{findMany:async()=>{throw new Error('db offline');}}});
 await assert.rejects(repo.loadAccessRules(),/db offline/);
 const code=fs.readFileSync('apps/server/src/domains/search/search-repository.ts','utf8');
 assert.ok(!code.includes('catch(() => [])'));
});
await check('graph refuses cross-project project subjects',async()=>{
 const graphModule=load('apps/server/src/domains/work/resource-graph-service.ts',{
  '@cluster/shared':{
   CLUSTER_WORKFLOW_RELATIONSHIP_META:{dependency:{category:'dependency',blocking:true}},
   clusterResourceDefinition:k=>({projectScoped:k!=='project'}),
   clusterResourceKindFromEntityType:k=>k,
  },
 });
 const graph=graphModule.createResourceGraphService({projectRelationship:{findMany:async()=>[]}});
 await assert.rejects(graph.neighborhood({subject:{kind:'project',id:'P2'},projectId:'P1'}),/scope conflicts/);
});
await check('graph reports truncation when row cap leaves fetched visible siblings unread',async()=>{
 const graphModule=load('apps/server/src/domains/work/resource-graph-service.ts',{
  '@cluster/shared':{
   CLUSTER_WORKFLOW_RELATIONSHIP_META:{dependency:{category:'dependency',blocking:true}},
   clusterResourceDefinition:()=>({projectScoped:true}),
   clusterResourceKindFromEntityType:k=>k,
  },
 });
 const rows=['one','two'].map(id=>({id,projectId:'P1',sourceType:'board',sourceId:'root',targetType:'board',targetId:id,relationship:'dependency',critical:false,description:null,createdAt:new Date()}));
 const graph=graphModule.createResourceGraphService({projectRelationship:{findMany:async({take,skip})=>rows.slice(skip,skip+take)}});
 const result=await graph.neighborhood({subject:{kind:'board',id:'root',projectId:'P1'},maxEdges:1,depth:1});
 assert.equal(result.edges.length,1);assert.equal(result.truncated,true);
});
console.log(`${passed}/13 search/privacy assertions passed`);
if(passed!==13) process.exitCode=1;
