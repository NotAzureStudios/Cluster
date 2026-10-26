import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
const fakeSchema = new Proxy(function(){ return fakeSchema; }, {get:()=>()=>fakeSchema});
function load(file, dependencies={}, globals={}) {
  const abs = path.join(root,file);
  const js=ts.transpileModule(fs.readFileSync(abs,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports, require:id=> {if (Object.hasOwn(dependencies,id)) return dependencies[id]; throw Error(`Unmocked ${id} for ${file}`);}, URL, Object, Set, String, Array, console, ...globals}, {filename:abs});
  return module.exports;
}
const manifest=load('packages/shared/src/cluster-manifest.ts',{'./product-language.js':{PRODUCT_TERMS:new Proxy({}, {get:(_,name)=>String(name)})}}).CLUSTER_RESOURCE_MANIFEST;
const shared=load('packages/shared/src/resource-address.ts',{
 zod:{z:{object:()=>fakeSchema,enum:()=>fakeSchema,string:()=>fakeSchema}},
 './cluster-manifest.js':{CLUSTER_RESOURCE_KINDS:Object.keys(manifest),CLUSTER_RESOURCE_MANIFEST:manifest},
});
const navigation=load('packages/renderer/src/features/workflow/resource-navigation.ts');
const bridge=load('packages/renderer/src/features/workflow/desktop-deep-link-navigation.ts',{
 '@cluster/shared':{parseClusterDeepLink:shared.parseClusterDeepLink},
 './resource-navigation':navigation,
});
let passed=0;
function test(label,fn){try{fn();passed++; console.log('PASS',label);}catch(e){process.exitCode=1; console.error('FAIL',label,e.stack);}}
function json(x){return JSON.parse(JSON.stringify(x));}
const roundtrip = (kind,id,projectId,expectedScreen,expectedInspect) => {
 const resource = {kind,id,...(projectId?{projectId}:{})};
 const boardId = kind==='card' ? 'board-1' : null;
 const uri=shared.serializeClusterDeepLink({type:'resource',resource,...(boardId?{boardId}:{})});
 assert.ok(uri,kind);
 assert.deepEqual(json(shared.parseClusterDeepLink(uri)),{type:'resource',resource,...(boardId?{boardId}:{})});
 const dest=bridge.desktopDeepLinkNavigation(uri);
 assert.equal(dest?.screen,expectedScreen,uri);
 if(expectedInspect) assert.equal(dest.inspectId,id);
 if(boardId) assert.equal(dest.boardId,boardId);
};
test('project, team member, and privacy-scoped Packet/Policy links roundtrip',()=>{
 roundtrip('project','project-1',null,'project');
 roundtrip('user','u-1',null,'people','u-1');
 roundtrip('packet','packet-1',null,'packets');
 roundtrip('policy','policy-1',null,'packets');
});
test('Project-scoped tickets, cards, QA, releases and Library links roundtrip',()=>{
 for(const [kind,screen] of [['ticket','tickets'],['card','board'],['qa_plan','project'],['qa_session','project'],['build','project'],['release','project'],['control','project'],['file','project'],['library','library'],['source_repository','project']])
   roundtrip(kind,kind+'-id','project-1',screen,kind==='ticket'||kind==='card'||kind==='library'||kind==='file'||kind==='build'||kind==='qa_plan'||kind==='qa_session'||kind==='release'||kind==='control'||kind==='source_repository');
});
test('standalone personal Calendar, Timeline, Whiteboard links roundtrip',()=>{
 roundtrip('calendar','event-1',null,'calendar','event-1');
 roundtrip('timeline','item-1',null,'timeline','item-1');
 roundtrip('whiteboard','wb-1',null,'whiteboard');
});
test('project scope preserved for Board, Whiteboard and Project workspaces',()=>{
 for(const kind of ['board','whiteboard','release','source_commit']){
  const uri=shared.serializeClusterDeepLink({type:'resource',resource:{kind,id:'id-1',projectId:'P-1'}});
  assert.equal(bridge.desktopDeepLinkNavigation(uri)?.projectId,'P-1',uri);
 }
});
test('source-review links roundtrip to existing Project review inspector',()=>{
 roundtrip('source_review','review-1','project-1','project','review-1');
 assert.equal(shared.serializeClusterDeepLink({type:'resource',resource:{kind:'source_review',id:'review-1'}}),null);
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://resource/source_review/review-1'),null);
});
test('strictly Project-scoped links without context fail closed',()=>{
 for(const kind of ['ticket','file','board','build','release','source_repository'])
  assert.equal(shared.serializeClusterDeepLink({type:'resource',resource:{kind,id:'id-1'}}),null,kind);
});
test('Card-only links resolve to authenticated Card admission, without guessing Board',()=>{
 assert.equal(shared.serializeClusterDeepLink({type:'resource',resource:{kind:'card',id:'c-1',projectId:'p-1'}}),'cluster://resource/card/c-1/p-1');
 assert.equal(shared.serializeClusterDeepLink({type:'resource',resource:{kind:'card',id:'c-1'}}),'cluster://resource/card/c-1');
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://resource/card/c-1/p-1')?.boardId,null);
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://resource/card/c-1')?.inspectId,'c-1');
 assert.equal(shared.parseClusterDeepLink('cluster://resource/ticket/t-1/p-1/b-1'),null);
 assert.equal(shared.parseClusterDeepLink('cluster://resource/user/u-1/p-1/b-1'),null);
});
test('authorized approval links roundtrip, but unsupported Resource Actions stay unlinked',()=>{
 roundtrip('approval','approval-1',null,'admin','approval-1');
 for(const kind of ['background_job','integration_connection','onboarding_assignment'])
  assert.equal(shared.serializeClusterDeepLink({type:'resource',resource:{kind,id:'id-1'}}),null,kind);
});
test('legacy Cluster resource hosts still parse and navigate',()=>{
 for(const [uri,kind,screen] of [
  ['cluster://ticket/t-1','ticket','tickets'],['cluster://person/u-1','user','people'],
  ['cluster://project/p-1','project','project'],['cluster://whiteboard/w-1','whiteboard','whiteboard'],
  ['cluster://library/f-1','library','library']]) {
   assert.equal(shared.parseClusterDeepLink(uri)?.resource.kind,kind);
   assert.equal(bridge.desktopDeepLinkNavigation(uri)?.screen,screen);
  }
});
test('reject invalid grammar and injected URI controls',()=>{
 for(const uri of [
  'https://resource/user/a','cluster://resource/__proto__/a','cluster://resource/toString/a',
  'cluster://resource/project','cluster://resource/user/a/P1',
  'cluster://resource/ticket/a/P1/extra','cluster://resource/ticket/%2e%2e/P1',
  'cluster://resource/user/a?admin=1','cluster://resource/user/a#x',
  'cluster://user@resource/user/a','cluster://resource/user/a//P1',
  'cluster://resource/user/a/../P1','cluster://resource/user/abc\\def',
  'cluster://resource/user/a/P1?project=P2'
 ]) {
  assert.equal(shared.parseClusterDeepLink(uri),null,uri);
  assert.equal(bridge.desktopDeepLinkNavigation(uri),null,uri);
 }
});
test('resource navigation does not guess a missing Project for legacy build links',()=>{
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://build/build-1'),null);
});
test('special operations not interpreted as arbitrary routes',()=>{
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://settings/security'),null);
 assert.equal(bridge.desktopDeepLinkNavigation('cluster://repo/r1/commit/abcdef012345'),null);
});
test('renderer dispatches full native URI to verified navigation',()=>{
 const desktop=fs.readFileSync(path.join(root,'packages/renderer/src/core/desktop.ts'),'utf8');
 assert.match(desktop,/desktopDeepLinkNavigation\(value\)/);
 assert.match(desktop,/queueDesktopWorkNavigation\(resource\)/);
 assert.match(desktop,/addEventListener\("cluster:desktop-deep-link"/);
 assert.match(desktop,/bridge\?\.onDeepLink\?\.\(onDeepLink\)/);
 assert.doesNotMatch(desktop,/function routeFromDesktopDeepLink/);
});
test('desktop boot handoff retains intent until authorized and expires safely',()=>{
 const events=[];
 let now=1000;
 const fakeWindow={dispatchEvent:(event)=>events.push(event)};
 const FakeEvent=class {constructor(type,{detail}){this.type=type;this.detail=detail;}};
 const work=load('packages/renderer/src/features/workflow/work-navigation.ts',{},
  {window:fakeWindow, CustomEvent:FakeEvent, Date:{now:()=>now}});
 const target={screen:'people',inspectScope:'person',inspectId:'u1'};
 work.queueDesktopWorkNavigation(target);
 assert.equal(work.readPendingDesktopWorkNavigation(),target);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'cluster:open-work-source');
 assert.equal(events[0].detail,target);
 work.clearPendingDesktopWorkNavigation({screen:'people'});
 assert.equal(work.readPendingDesktopWorkNavigation(),target);
 work.clearPendingDesktopWorkNavigation(target);
 assert.equal(work.readPendingDesktopWorkNavigation(),null);
 work.queueDesktopWorkNavigation(target);
 now+=120001;
 assert.equal(work.readPendingDesktopWorkNavigation(),null);
 const app=fs.readFileSync(path.join(root,'packages/renderer/src/features/application/ClusterApplication.tsx'),'utf8');
 assert.match(app,/readPendingDesktopWorkNavigation\(\)/);
 assert.match(app,/clearPendingDesktopWorkNavigation\(target\)/);
});
test('actual desktop listener dispatches authorized resource navigation and cleans up',()=>{
 const desktop=fs.readFileSync(path.join(root,'packages/renderer/src/core/desktop.ts'),'utf8');
 const snippet=desktop.slice(desktop.indexOf('export function installDesktopDeepLinkRouting()'));
 const compiled=ts.transpileModule(snippet,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const calls=[];const listeners={};let callback=null;let closed=false;
 const fakeWindow={
  clusterDesktop:{onDeepLink:(fn)=>{callback=fn;return()=>{closed=true;}}},
  addEventListener:(name,fn)=>{listeners[name]=fn;},
  removeEventListener:(name,fn)=>{if(listeners[name]===fn) delete listeners[name];},
  location:{pathname:'/',search:'',href:'https://cluster.local/'},
  history:{pushState:(...args)=>calls.push(['hash',...args])},
  dispatchEvent:(e)=>calls.push(['event',e.type]),
 };
 const module={exports:{}};
 const fakeNavigation=(input)=>input==='projects'?{screen:'projects'}:null;
 vm.runInNewContext(compiled,{
  module,exports:module.exports,window:fakeWindow,URL,PopStateEvent:class {constructor(type){this.type=type;}},
  desktopDeepLinkNavigation:bridge.desktopDeepLinkNavigation,
  queueDesktopWorkNavigation:(target)=>{calls.push(['resource',JSON.parse(JSON.stringify(target))]);},
  parseClusterDeepLink:shared.parseClusterDeepLink,
  queueDesktopSourceCommit:(target)=>{calls.push(['revision',JSON.parse(JSON.stringify(target))]);},
  parseNavigationRoute:fakeNavigation,navigationHash:()=> '#projects',console,
 });
 const unsubscribe=module.exports.installDesktopDeepLinkRouting();
 assert.equal(typeof listeners['cluster:desktop-deep-link'],'function');
 callback('cluster://resource/card/c1/p1/b1');
 assert.deepEqual(calls.at(-1),['resource',{screen:'board',projectId:'p1',inspectScope:'card',inspectId:'c1',boardId:'b1'}]);
 listeners['cluster:desktop-deep-link']({detail:'cluster://resource/user/u1'});
 assert.deepEqual(calls.at(-1),['resource',{screen:'people',inspectScope:'person',inspectId:'u1'}]);
 const before=calls.length;
 callback('cluster://resource/user/u1?spoof=1');
 assert.equal(calls.length,before,'untrusted links must not navigate');
 callback('cluster://resource/card/c1/p1');
 assert.deepEqual(calls.at(-1),['resource',{screen:'board',projectId:'p1',inspectScope:'card',inspectId:'c1',boardId:null}]);
 callback('cluster://repo/r1/commit/abcdef012345');
 assert.deepEqual(calls.at(-1),['revision',{repositoryId:'r1',revision:'abcdef012345'}]);
 callback('cluster://open/projects');
 assert.equal(calls.at(-2)[0],'hash');
 assert.equal(calls.at(-1)[1],'popstate');
 unsubscribe();
 assert.equal(closed,true);
 assert.equal(listeners['cluster:desktop-deep-link'],undefined);
});
test('Qt shell sends canonical URI intact with origin guard',()=>{
 const controller=fs.readFileSync(path.join(root,'apps/desktop-qt/src/AppController.cpp'),'utf8');
 const qml=fs.readFileSync(path.join(root,'apps/desktop-qt/qml/pages/SharedRendererPage.qml'),'utf8');
 assert.match(controller,/QStringLiteral\("resource"\)/);
 assert.match(controller,/url\.toString\(QUrl::FullyEncoded\)/);
 assert.match(controller,/url\.hasQuery\(\) \|\| url\.hasFragment\(\)/);
 assert.match(qml,/pendingClusterLink/);
 assert.match(qml,/isAllowedRendererUrl/);
 assert.match(qml,/cluster:desktop-deep-link/);
 assert.match(qml,/JSON\.stringify\(target\)/);
});
console.log(`${passed}/16 TD4 R57 resource/deep-link integration checks passed (R58 source-review extension)`);
if(passed!==16)process.exitCode=1;
