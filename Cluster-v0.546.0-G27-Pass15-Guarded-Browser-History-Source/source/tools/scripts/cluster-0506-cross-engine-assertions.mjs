import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
function load(sourcePath, stubs = {}) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, {
    module: mod, exports: mod.exports, require: id => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      throw new Error(`Unexpected dependency: ${id}`);
    }, Buffer, Date, URLSearchParams, String, Number, Map, Set, WeakMap, Error, Promise, console,
  });
  return mod.exports;
}
const idempotency = load('apps/server/src/core/idempotency.ts', {
  'node:crypto': {__esModule:true,default:crypto}, './reliability-context.js': { currentReliabilityContext: () => null },
});
const resource = load('apps/server/src/domains/work/resource-graph-service.ts', {
  '@cluster/shared': {
    CLUSTER_WORKFLOW_RELATIONSHIP_META: { dependency: {category:'dependency', blocking: true}, reference: {category:'reference', blocking: false} },
    clusterResourceDefinition: kind => ({ projectScoped: !['user','project'].includes(kind) }),
    clusterResourceKindFromEntityType: kind => ['project','board','card','control','user'].includes(kind) ? kind : null,
  },
});
let checks=0;
async function check(label, fn) { try { await fn(); checks++; console.log(`PASS ${label}`); } catch (error) { console.error(`FAIL ${label}: ${error.stack}`); process.exitCode=1; } }
const request = (url, method='POST', headers={'x-cluster-idempotency-key':'mutation-0000001'}) => ({url, method, headers, body: { name: 'Example' }, clusterUser:{id:'user1'}, id:'req1',log:{error(){}}});
function fakeApp() {
  const hooks = new Map();
  const app = { addHook: (name, handler) => hooks.set(name, handler) };
  const calls = { create:0, updates:[], receipts:[] };
  const db = { apiMutationReceipt: {
    create: async ({data}) => { calls.create++; const receipt = {id:`receipt-${calls.create}`, ...data}; calls.receipts.push(receipt); return receipt; },
    findFirst: async () => calls.receipts[0] || null,
    updateMany: async ({where,data}) => { if (!where.updatedAt) calls.updates.push(data); return {count:1};},
    deleteMany: async () => ({count:0}),
  } };
  idempotency.registerIdempotencyHooks(app, db);
  const headers = new Map();
  const reply = {
    sent:false, statusCode:200,
    header: (key,value) => {headers.set(key.toLowerCase(),value); return reply;},
    getHeader: (key) => headers.get(key.toLowerCase()),
    code: (value) => {reply.statusCode=value;return reply;},
    send: (value) => value,
  };
  return { hooks, calls, reply };
}
await check('sensitive Context Pack routes do not reserve replay receipts', async()=>{
  for (const pathname of ['/api/context-packs/abc/secret-export','/api/context-packs/abc/apply','/api/context-packs/from-settings-with-secrets']) {
    assert.equal(idempotency.isSensitiveMutationPath(pathname), true);
    const {hooks,calls,reply} = fakeApp();
    const r=request(pathname);
    await hooks.get('preHandler')(r, reply);
    await hooks.get('onSend')(r, reply, '{"token":"secret"}');
    assert.equal(calls.create,0);
    assert.equal(calls.updates.length,0);
  }
});
await check('regular mutations still reserve idempotency receipts', async()=>{
  const {hooks,calls,reply} = fakeApp(); const r=request('/api/projects');
  await hooks.get('preHandler')(r,reply);
  await hooks.get('onSend')(r,reply,'{"ok":true}');
  assert.equal(calls.create,1);
  assert.equal(calls.updates.length,1);
  assert.equal(calls.updates[0].state,'complete');
});
await check('no-store responses cannot persist payload to idempotency receipts', async()=>{
  const {hooks,calls,reply} = fakeApp(); const r=request('/api/sensitive-new-endpoint');
  await hooks.get('preHandler')(r,reply);
  reply.header('Cache-Control','private, no-store, max-age=0');
  await hooks.get('onSend')(r,reply,'{"secret":"do-not-persist"}');
  assert.equal(calls.updates[0].state,'uncertain');
  assert.equal(calls.updates[0].responsePayload,undefined);
  assert.equal(calls.updates[0].failureReason,'private-response-not-stored');
});
const subject = {kind:'board',id:'root',projectId:'P1'};
const edge = (id,sourceId,targetId) => ({id,projectId:'P1',sourceType:'board',sourceId,targetType:'board',targetId,relationship:'dependency',description:null,critical:false,createdAt:new Date(0)});
function graphDb(rows) {
  const calls=[];
  return { calls, projectRelationship: { findMany: async ({where,skip=0,take})=> {
    calls.push({where,skip,take});
    const matching = rows.filter(row => row.projectId===where.projectId && where.OR.some(c => Object.entries(c).every(([k,v])=>row[k]===v)));
    return matching.slice(skip,skip+take);
  } } };
}
await check('graph rejects conflicting subject project scope', async()=>{
  const db=graphDb([]); const graph=resource.createResourceGraphService(db);
  await assert.rejects(graph.neighborhood({subject,projectId:'OTHER'}),/scope conflicts/);
  assert.equal(db.calls.length,0);
});
await check('graph never discloses nodes for a hidden subject', async()=>{
  const db=graphDb([edge('x','root','visible')]); const graph=resource.createResourceGraphService(db);
  const result=await graph.neighborhood({subject,depth:2},{allowResource:r=>r.id!=='root'});
  assert.equal(result.nodes.length,0); assert.equal(result.edges.length,0);assert.equal(db.calls.length,0);
});
await check('graph scans past hidden edges without consuming visible edge budget', async()=>{
  const rows=[...Array.from({length:70},(_,i)=>edge(`hidden-${i}`,'root',`hidden-${i}`)),edge('visible','root','target')];
  const db=graphDb(rows); const graph=resource.createResourceGraphService(db);
  const result=await graph.neighborhood({subject,depth:1,maxEdges:3},{allowResource:r=>!r.id.startsWith('hidden-')});
  assert.deepEqual(Array.from(result.edges,({id})=>id),['visible']);
  assert.equal(result.nodes.length,2);
  assert.ok(db.calls.some(call=>call.skip>0));
});
await check('graph direction and depth bounded with cyclic links', async()=>{
  const db=graphDb([edge('a','root','second'),edge('b','second','root'),edge('c','second','third')]);
  const graph=resource.createResourceGraphService(db);
  const result=await graph.neighborhood({subject,depth:2,direction:'outgoing'});
  assert.equal(new Set(result.edges.map(x=>x.id)).size,result.edges.length);
  assert.deepEqual(Array.from(result.nodes,({resource})=>resource.id).sort(),['root','second','third']);
});
await check('graph scans have a hard upper bound even with many denied relationships', async()=>{
  const rows=Array.from({length:500},(_,i)=>edge(String(i),'root',`hidden-${i}`));
  const db=graphDb(rows); const graph=resource.createResourceGraphService(db);
  const result=await graph.neighborhood({subject,depth:1,maxEdges:1},{allowResource:r=>r.id==='root'});
  assert.equal(result.edges.length,0);
  assert.ok(db.calls.length<=5);
  assert.equal(result.truncated,true);
});
await check('search enforces canonical Calendar visibility before admin fast-path', async()=>{
  const registered=new Map(), checked=[];
  const app={get:(path,handler)=>registered.set(path,handler),post:()=>undefined};
  const search = load('apps/server/src/domains/search/search-routes.ts',{
    './search-sensitive-access.js':{createSearchSensitiveAccess:()=>({evaluate:async()=>null,prepareBatch:async()=>{}})},
    './search-schemas.js':{commandSearchQuerySchema:{parse:()=>({q:'calendar',scope:'all',limit:10})}},
    './search-repository.js':{createSearchRepository:()=>({})},
    './search-service.js':{createSearchService:()=>({
      invalidateChange(){},diagnostics:()=>({indexRevision:1}),rebuild:async()=>({items:[]}),
      search:async opts => {
        const hidden=await opts.canViewItem({kind:'calendar',id:'secret',raw:{visibility:'private'}},null,[]);
        const visible=await opts.canViewItem({kind:'calendar',id:'shared',raw:{visibility:'studio'}},null,[]);
        return {hidden,visible};
      },
    })},
    '../../core/http-errors.js':{createHttpError:(...args)=>new Error(args.join(':'))},
    '../access/studio-audience.js':{loadStudioAudienceUserContext:async()=>({}),studioAudienceMatchesContext:async()=>true},
    '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({})},
    '../planning/calendar-access.js':{canAccessCalendarEvent:async(_auth,_req,event)=>{checked.push(event.visibility);return event.visibility==='studio';}},
  });
  search.registerSearchRoutes({app,prisma:{},getCurrentUser:async()=>({id:'admin'}),decorateUserForClient:async()=>({isAdmin:true,workspaceRole:'owner'}),authorization:{authorize:async()=>({allowed:true})},jobWorker:{register(){}},operations:{}});
  const headers={};
  const result=await registered.get('/api/command/search')({}, {header:(k,v)=>{headers[k]=v;}});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{hidden:false,visible:true});
  assert.deepEqual(checked,['private','studio']);
  assert.equal(headers['Cache-Control'],'private, no-store');
});
console.log(`${checks}/9 cross-engine assertions passed`);
if (checks!==9) process.exitCode=1;
