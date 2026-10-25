import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
function load(file, stubs) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: id => { if (!(id in stubs)) throw Error(`Unexpected dependency: ${id}`); return stubs[id]; }, Map, Set, Promise, Number, String, Date, Boolean, Error, console, performance }, { filename: file });
  return module.exports;
}
let count = 0;
async function check(label, fn) { try { await fn(); ++count; console.log(`PASS ${label}`); } catch (error) { process.exitCode = 1; console.error(`FAIL ${label}`, error); } }
const root = 'packages/renderer/src';
const policy = load(`${root}/core/api/live-search-authorization.ts`, {});
const manifest = load('packages/shared/src/cluster-manifest.ts', { './product-language.js': { PRODUCT_TERMS: new Proxy({}, { get: (_target, prop) => String(prop) }) } }).CLUSTER_RESOURCE_MANIFEST;
const registry = load(`${root}/core/resource-action-registry.ts`, { '@cluster/shared': { CLUSTER_RESOURCE_MANIFEST: manifest } });

await check('only the authoritative Command Search payload requires fresh admission', () => {
  for (const path of ['/api/command/search', '/api/command/search?q=private', '/api/command/search?scope=all']) assert.equal(policy.requiresFreshSearchAuthorization(path), true);
  for (const path of ['/api/command/search/diagnostics', '/api/projects', '/api/command/search-other', '/api/command/searchx?q=x']) assert.equal(policy.requiresFreshSearchAuthorization(path), false);
});
await check('standalone Whiteboard, Timeline and Calendar contexts retain their resource actions', () => {
  for (const kind of ['whiteboard', 'timeline', 'calendar']) {
    const target = { kind, id: `${kind}-standalone` };
    const actions = registry.resolveClusterResourceActions(target, [{ id: 'copy', resourceKinds: [kind], allowed: () => true, label: 'Copy link', onSelect: () => true }]);
    assert.equal(actions.length, 1, `${kind} action hidden`);
    assert.equal(actions[0].onSelect(), true);
    assert.equal(manifest[kind].projectScoped, true);
    assert.equal(manifest[kind].standaloneAllowed, true);
  }
});
await check('Project-only resources still require Project identity', () => {
  for (const kind of ['board', 'card', 'release', 'source_repository']) {
    const action = { id: 'open', resourceKinds: [kind], allowed: () => true, label: 'Open', onSelect: () => true };
    assert.equal(registry.resolveClusterResourceActions({ kind, id: 'a' }, [action]).length, 0);
    assert.equal(registry.resolveClusterResourceActions({ kind, id: 'a', projectId: 'P1' }, [action]).length, 1);
  }
});
await check('permission denial, empty IDs and mismatched kinds never expose actions', () => {
  assert.equal(registry.resolveClusterResourceActions({ kind: 'whiteboard', id: '' }, [{id:'open',resourceKinds:['whiteboard'],allowed:()=>true,label:'Open',onSelect:()=>true}]).length, 0);
  assert.equal(registry.resolveClusterResourceActions({ kind: 'calendar', id: 'C' }, [{id:'open',resourceKinds:['calendar'],allowed:()=>false,label:'Open',onSelect:()=>true}]).length, 0);
  assert.equal(registry.resolveClusterResourceActions({ kind: 'user', id: 'U' }, [{id:'open',resourceKinds:['project'],allowed:()=>true,label:'Open',onSelect:()=>true}]).length, 0);
});
await check('disabled actions explain why and preserve explicit failure outcomes', async () => {
  const target = {kind:'timeline',id:'T'};
  const actions = registry.resolveClusterResourceActions(target,[
    {id:'pending',resourceKinds:['timeline'],allowed:()=>true,available:()=>false,unavailableReason:'Still saving',label:'Pending',onSelect:()=>false},
    {id:'failed',resourceKinds:['timeline'],allowed:()=>true,label:'Copy',onSelect:async()=>false},
    {id:'failed',resourceKinds:['timeline'],allowed:()=>true,label:'Duplicate',onSelect:()=>true},
  ]);
  assert.equal(actions.length,2);
  assert.equal(actions[0].disabled,true);
  assert.equal(actions[0].description,'Still saving');
  assert.equal(await actions[1].onSelect(),false);
});

const cache = new Map();
let fetches = [];
let durableReads = 0, durableWrites = 0;
const fakeCache = {
  backgroundRevalidations: new Map(), currentSessionCacheGeneration: () => 0,
  queryCache: cache, setQueryCache: (key,value) => cache.set(key,value),
};
const query = load(`${root}/core/api/query.ts`, {
  '../offline-storage': { getOfflineScope: () => 'user1', readCachedResponse: async() => {durableReads++;return null;},writeCachedResponse: async()=>{durableWrites++;} },
  '../performance': { recordPerformanceMetric:()=>{} },
  './transport': {api: async(path) => {fetches.push(path);return {requestNumber:fetches.length};}},
  './errors': {isApiNetworkFailure:()=>false,isOnline:()=>true},
  './cache': fakeCache,
  './live-search-authorization': policy,
});
await check('repeated Search calls reauthorize instead of returning cached results', async () => {
  fetches=[];
  const a=await query.queryApi('/api/command/search?q=secret',{staleMs:5000,maxAgeMs:60000,persist:false,staleWhileRevalidate:true});
  const b=await query.queryApi('/api/command/search?q=secret',{staleMs:5000,maxAgeMs:60000,persist:false,staleWhileRevalidate:true});
  assert.equal(a.requestNumber,1);
  assert.equal(b.requestNumber,2);
  assert.equal(cache.has('user1:/api/command/search?q=secret'), false);
  assert.equal(durableReads,0);
  assert.equal(durableWrites,0);
});
await check('even old cached Search responses are discarded, not served', async () => {
  cache.set('user1:/api/command/search?q=secret',{value:{requestNumber:-100},staleAt:Date.now()+60000,expiresAt:Date.now()+60000});
  const payload=await query.queryApi('/api/command/search?q=secret');
  assert.equal(payload.requestNumber,3);
  assert.equal(cache.has('user1:/api/command/search?q=secret'),false);
});
await check('non-sensitive route caching remains intact', async () => {
  fetches=[];
  const first=await query.queryApi('/api/projects',{staleMs:5000,maxAgeMs:60000,persist:false});
  const second=await query.queryApi('/api/projects',{staleMs:5000,maxAgeMs:60000,persist:false});
  assert.equal(first.requestNumber,1);
  assert.equal(second.requestNumber,1);
  assert.equal(fetches.length,1);
});
await check('all Command Search consumers and palette invalidations use fresh results',()=>{
  const palette=fs.readFileSync(`${root}/features/search/CommandPalette.tsx`,'utf8');
  const whiteboard=fs.readFileSync(`${root}/features/whiteboards/WhiteboardWorkspacePage.tsx`,'utf8');
  assert.match(palette,/useResourceChangeRefresh\(\(\) => \{/);
  assert.match(palette,/setSearchEpoch\(\(value\) => value \+ 1\)/);
  assert.match(palette,/force: true, persist: false, staleWhileRevalidate: false/);
  assert.match(whiteboard,/\/api\/command\/search\?q=/);
  assert.match(whiteboard,/force: true, persist: false, staleWhileRevalidate: false/);
  const registrySource=fs.readFileSync(`${root}/core/resource-action-registry.ts`,'utf8');
  assert.match(registrySource,/resource\.standaloneAllowed/);
});
console.log(`${count}/9 R48 live Search and resource action integration checks passed`);
if(count!==9)process.exitCode=1;
