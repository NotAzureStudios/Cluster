import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding:'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
function load(file, stubs) {
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(Object.hasOwn(stubs,id))return stubs[id];throw Error(`Unmocked dependency ${id} from ${file}`);},Date,Map,Set,Promise,Number,Math,String,console},{filename:file});
  return module.exports;
}
const chain = new Proxy(function(){return chain}, {get:()=>()=>chain});
const manifest={project:{projectScoped:false},user:{projectScoped:false},team:{projectScoped:false},board:{projectScoped:true},card:{projectScoped:true},review_asset:{projectScoped:true},build:{projectScoped:true},release:{projectScoped:true},calendar:{projectScoped:true}};
const address=load('packages/shared/src/resource-address.ts',{
  zod:{z:{object:()=>chain,enum:()=>chain,string:()=>chain}},
  './cluster-manifest.js':{CLUSTER_RESOURCE_KINDS:Object.keys(manifest),CLUSTER_RESOURCE_MANIFEST:manifest},
});
const notifications=load('apps/server/src/domains/notifications/notification-service.ts',{
  '@cluster/shared':{clusterResourceAddressFromEntity:address.clusterResourceAddressFromEntity,clusterResourceKindFromEntityType:address.clusterResourceKindFromEntityType,CLUSTER_NOTIFICATION_CATEGORIES:[],CLUSTER_NOTIFICATION_PRIORITIES:[],CLUSTER_NOTIFICATION_SIGNALS:[],CLUSTER_NOTIFICATION_TOOLS:[],CLUSTER_DOMAIN_EVENTS:{}},
  '../../core/cursor-pagination.js':{},'./notification-repository.js':{},'../comments/subscription-service.js':{},'../../core/bounded-cache.js':{},'./notification-policy.js':{},'./notification-lifecycle.js':{},
});
const graph=load('apps/server/src/domains/work/resource-graph-service.ts',{
  '@cluster/shared':{CLUSTER_WORKFLOW_RELATIONSHIP_META:{depends_on:{category:'dependency',blocking:true}},clusterResourceDefinition:kind=>manifest[kind]||{projectScoped:true},clusterResourceKindFromEntityType:address.clusterResourceKindFromEntityType},
});
let count=0;
async function check(label,run){try{await run();count++;console.log('PASS',label)}catch(error){process.exitCode=1;console.error('FAIL',label,error.stack)}}
await check('global person identity is stable regardless of referring project',()=>{
  const resource=address.clusterResourceAddressFromEntity({entityType:'user',entityId:'U1',projectId:'P1'});
  assert.deepEqual(JSON.parse(JSON.stringify(resource)),{kind:'user',id:'U1'});
});
await check('project references are globally scoped but retain their ID',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(address.clusterResourceAddressFromEntity({entityType:'project',entityId:'P2',projectId:'P1'}))),{kind:'project',id:'P2'});
});
await check('project-owned resources preserve their true project ID',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(address.clusterResourceAddressFromEntity({entityType:'board',entityId:'B1',projectId:'P1'}))),{kind:'board',id:'B1',projectId:'P1'});
});
await check('entity aliases do not impersonate parent resources with child IDs',()=>{
  for(const type of ['review_comment','review_version','build_artifact','release_note']){
    assert.equal(address.clusterResourceKindFromEntityType(type),null,type);
    assert.equal(address.clusterResourceAddressFromEntity({entityType:type,entityId:'CHILD',projectId:'P1'}),null,type);
  }
});
await check('malformed or oversized entity addresses are not emitted',()=>{
  for(const id of ['', ' '.repeat(4), 'A'.repeat(201), 111]) assert.equal(address.clusterResourceAddressFromEntity({entityType:'board',entityId:id,projectId:'P1'}),null);
});
await check('review child notification requires verified parent identifier',()=>{
  const raw={entityType:'review_comment',entityId:'COMMENT1',projectId:'P1'};
  assert.equal(notifications.resourceAddressForNotification(raw),null);
  assert.deepEqual(JSON.parse(JSON.stringify(notifications.resourceAddressForNotification(raw,{reviewAssetId:'ASSET1'}))),{kind:'review_asset',id:'ASSET1',projectId:'P1'});
});
await check('build artifact requires a distinct parent build ID',()=>{
  const raw={entityType:'build_artifact',entityId:'ART1',projectId:'P1'};
  assert.equal(notifications.resourceAddressForNotification(raw),null);
  assert.equal(notifications.resourceAddressForNotification(raw,{source:{id:'ART1'}}),null);
  assert.deepEqual(JSON.parse(JSON.stringify(notifications.resourceAddressForNotification(raw,{buildId:'BUILD1'}))),{kind:'build',id:'BUILD1',projectId:'P1'});
});
await check('release note links only when an explicit release ID is present',()=>{
  const raw={entityType:'release_note',entityId:'NOTE1',projectId:'P1'};
  assert.equal(notifications.resourceAddressForNotification(raw),null);
  assert.equal(notifications.resourceAddressForNotification(raw,{sourceId:'NOTE1'}),null);
  assert.deepEqual(JSON.parse(JSON.stringify(notifications.resourceAddressForNotification(raw,{releaseId:'R1'}))),{kind:'release',id:'R1',projectId:'P1'});
});
await check('direct review asset notifications retain canonical identities',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(notifications.resourceAddressForNotification({entityType:'review_asset',entityId:'ASSET1',projectId:'P1'}))),{kind:'review_asset',id:'ASSET1',projectId:'P1'});
});
await check('graph excludes inaccessible and stale endpoints without leaking their edges',async()=>{
  const rows=[
    {id:'1',projectId:'P1',sourceType:'board',sourceId:'root',targetType:'board',targetId:'stale',relationship:'depends_on',createdAt:new Date(0)},
    {id:'2',projectId:'P1',sourceType:'board',sourceId:'root',targetType:'board',targetId:'visible',relationship:'depends_on',createdAt:new Date(0)}
  ];
  const db={projectRelationship:{findMany:async ({where,skip=0,take}) => {
    const matching=rows.filter(row => row.projectId===where.projectId && where.OR.some(clause =>
      Object.entries(clause).every(([k,v]) => row[k]===v)));
    return matching.slice(skip,skip+take);
  }}};
  const visible=await graph.createResourceGraphService(db).neighborhood({subject:{kind:'board',id:'root',projectId:'P1'},depth:1},{allowResource:r=>r.id!=='stale'});
  assert.deepEqual(Array.from(visible.edges,r=>r.id),['2']);
  assert.deepEqual(Array.from(visible.nodes,r=>r.resource.id),['root','visible']);
});
await check('workflow Graph and link response enforce existence in addition to permissions',()=>{
  const code=fs.readFileSync('apps/server/src/domains/projects/project-control-routes.ts','utf8');
  assert.match(code,/async function canReadExistingWorkflowEntity[\s\S]*?await validateWorkflowEntity\(/);
  assert.match(code,/function visibleWorkflowRelationships[\s\S]*?const visibility = new Map/);
  assert.match(code,/allowResource: \(resource\) => canReadExistingWorkflowEntity/);
  assert.match(code,/if \(\(error as any\)\?\.code === "VALIDATION_FAILED" && \(error as any\)\?\.statusCode === 400\) return false/);
});
await check('workflow evidence failures propagate on real database errors',()=>{
  const code=fs.readFileSync('apps/server/src/domains/projects/project-control-routes.ts','utf8');
  const fn=code.split('async function canReadExistingWorkflowEntity')[1].split('async function requireWorkflowEntity')[0];
  assert.ok(fn.includes('throw error;'));
  assert.ok(!fn.includes('catch(() => false)'));
});
await check('large neighborhoods cap query clause counts and report truncation',async()=>{
  const rows=[...Array.from({length:190},(_,i)=>({id:`root-${i}`,projectId:'P1',sourceType:'board',sourceId:'root',targetType:'board',targetId:`n${i}`,relationship:'depends_on',createdAt:new Date(0)})),
    ...Array.from({length:190},(_,i)=>({id:`second-${i}`,projectId:'P1',sourceType:'board',sourceId:`n${i}`,targetType:'board',targetId:`leaf${i}`,relationship:'depends_on',createdAt:new Date(0)}))];
  const calls=[];
  const db={projectRelationship:{findMany:async ({where,skip=0,take})=>{
    calls.push(where.OR.length);
    const matching=rows.filter(row=>row.projectId===where.projectId && where.OR.some(clause=>Object.entries(clause).every(([k,v])=>row[k]===v)));
    return matching.slice(skip,skip+take);
  }}};
  const result=await graph.createResourceGraphService(db).neighborhood({subject:{kind:'board',id:'root',projectId:'P1'},depth:2,maxEdges:500});
  assert.equal(result.truncated,true);
  assert.ok(calls.every(value=>value<=160),`excessive graph OR clauses: ${calls}`);
  assert.ok(result.edges.length<=270);
});
await check('graph scan budget applies across all depth levels',async()=>{
  const calls=[];
  const db={projectRelationship:{findMany:async ({where,skip=0,take})=>{
    calls.push(take);
    const source=where.OR[0]?.sourceId;
    // Root expands one child, deeper levels have many hidden edges that
    // should spend a shared budget, not reset it at each level.
    if(source==='root')return skip===0?[{id:'root-child',projectId:'P1',sourceType:'board',sourceId:'root',targetType:'board',targetId:'child',relationship:'depends_on',createdAt:new Date(0)}]:[];
    if(source==='child')return Array.from({length:take},(_,i)=>({id:`hidden-${skip+i}`,projectId:'P1',sourceType:'board',sourceId:'child',targetType:'board',targetId:`denied-${skip+i}`,relationship:'depends_on',createdAt:new Date(0)}));
    return [];
  }}};
  const result=await graph.createResourceGraphService(db).neighborhood({subject:{kind:'board',id:'root',projectId:'P1'},depth:3,maxEdges:1_000},{allowResource:r=>!r.id.startsWith('denied-')});
  assert.equal(result.edges.length,1);
  assert.equal(result.truncated,true);
  assert.ok(calls.length<=15,`too many pages: ${calls.length}`);
});
console.log(`${count}/14 resource identity/graph checks passed`);
if(count!==14) process.exitCode=1;
