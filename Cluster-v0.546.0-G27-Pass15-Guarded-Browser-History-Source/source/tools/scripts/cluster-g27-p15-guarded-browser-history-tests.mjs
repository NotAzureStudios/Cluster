import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const base=new URL('../../packages/renderer/src/',import.meta.url);
const read=p=>readFileSync(new URL(p,base),'utf8');
const helper=read('features/workflow/guarded-browser-history.ts');
const resolver=read('features/workflow/authorized-workspace-navigation.ts');
const app=read('features/application/ClusterApplication.tsx');
function compile(source,filename,importMap={}) {
 const js=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(js,{module:{exports},exports,require:id=>{
  if(id in importMap)return importMap[id];throw Error('Unexpected require: '+id)
 }}, {filename});return exports;
}
const resolverExports=compile(resolver,'authorized-workspace-navigation.ts');
const navExports={createNavigationState:(route,fields={})=>({route,section:fields.section||null,subsection:fields.subsection||null,context:{projectId:fields.projectId||null,boardId:fields.boardId||null,whiteboardId:fields.whiteboardId||null}})};
const {createGuardedBrowserHistoryRestorer}=compile(helper,'guarded-browser-history.ts',{'../../core/navigation':navExports,'./authorized-workspace-navigation':resolverExports});
const nav=(route,id,{projectId=null,section=null}={})=>navExports.createNavigationState(route,{projectId,boardId:route==='board'?id:null,whiteboardId:route==='whiteboard'?id:null,...(route==='project'?{projectId:id}:{}),section});
let n=0;
function check(name,ok){assert.ok(ok,name);++n;console.log('PASS '+name)}
function build({routeAllowed=true,dirty=false,userId='u1',confirm=()=>Promise.resolve(true),reader}={}) {
 let generation=0;const log=[];const pending=[];const state={userId,dirty,routeAllowed};
 const restorer=createGuardedBrowserHistoryRestorer({
   getSessionId:()=>state.userId,
   beginNavigationIntent:()=>++generation,
   isNavigationIntentCurrent:g=>generation===g,
   canOpenRoute:()=>state.routeAllowed,
   readWorkspace:reader||((kind,id)=>{log.push(['read',kind,id]);return new Promise((resolve,reject)=>pending.push({kind,id,resolve,reject}))}),
   hasUnsavedChanges:()=>state.dirty,
   confirmDiscard:()=>{log.push(['confirm']);return confirm()},
   commit:target=>log.push(['commit',target]),
   restoreCurrentUrl:()=>log.push(['revert']),
   onUnavailable:()=>log.push(['unavailable']),
 });return {restorer,log,pending,state,overrideIntent:()=>generation++};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let t=build();let p=t.restorer.restore(nav('board','b1',{projectId:'old'}));
check('historical Board route is read before any UI mutation',t.log.map(x=>x[0]).join(',')==='read');
check('fresh Board fetch uses canonical identity',t.pending[0].kind==='board'&&t.pending[0].id==='b1');
t.pending[0].resolve({id:'b1',projectId:'new'});check('successful fresh Board route commits',await p);
check('historical Board placement replaced with current authorized Project',t.log.at(-1)[1].context.projectId==='new');
t=build();p=t.restorer.restore(nav('whiteboard','w2'));t.pending[0].resolve({id:'w2',projectId:null});check('standalone Whiteboard has no parent',await p && t.log.at(-1)[1].context.projectId===null);
t=build();p=t.restorer.restore(nav('project','p3'));t.pending[0].resolve({projectId:'p3'});check('Project uses snapshot projectId identity',await p);
t=build();p=t.restorer.restore(nav('project','p3'));t.pending[0].resolve({projectId:'wrong'});check('mismatched Project snapshot is refused',!(await p)&&!t.log.some(x=>x[0]==='commit'));
check('refused Project restores URL and shows safe notice',t.log.some(x=>x[0]==='revert')&&t.log.some(x=>x[0]==='unavailable'));
t=build();p=t.restorer.restore(nav('board','b'));t.pending[0].resolve({id:'b',projectId:'parent'});await p;
check('Board original identity is preserved',t.log.at(-1)[1].context.boardId==='b');
t=build({dirty:true,confirm:async()=>false});p=t.restorer.restore(nav('board','b'));t.pending[0].resolve({id:'b',projectId:null});await p;
check('dirty work only prompts after authorized workspace read',t.log.findIndex(x=>x[0]==='confirm')>t.log.findIndex(x=>x[0]==='read'));
check('declined discard never applies target state',!t.log.some(x=>x[0]==='commit')&&t.log.some(x=>x[0]==='revert'));
t=build({dirty:true});p=t.restorer.restore(nav('board','b'));t.pending[0].resolve({id:'b',projectId:null});check('approved discard can commit after authorized read',await p);
t=build({routeAllowed:false});check('disabled or inaccessible route refused without API read',!(await t.restorer.restore(nav('board','b')))&&t.pending.length===0);
let resolveDialog; t=build({dirty:true,confirm:()=>new Promise(r=>{resolveDialog=r})});p=t.restorer.restore(nav('calendar',''));await flush();
check('nonworkspace route respects unsaved state',t.log.some(x=>x[0]==='confirm'));
const q=t.restorer.restore(nav('calendar',''));
check('popstate and hashchange share one outstanding prompt',t.log.filter(x=>x[0]==='confirm').length===1);
resolveDialog(true);check('duplicate events commit once',await p && await q && t.log.filter(x=>x[0]==='commit').length===1);
t=build();p=t.restorer.restore(nav('board','b1'));const q2=t.restorer.restore(nav('board','b2'));
t.pending[1].resolve({id:'b2',projectId:null});check('latest history selection can commit',await q2);
t.pending[0].resolve({id:'b1',projectId:null});check('superseded history read cannot override newer choice',!(await p)&&t.log.filter(x=>x[0]==='commit').length===1);
t=build();p=t.restorer.restore(nav('board','b1'));t.overrideIntent();t.pending[0].resolve({id:'b1',projectId:null});check('a later nonhistory navigation cancels stale history result',!(await p)&&!t.log.some(x=>x[0]==='commit'));
t=build();p=t.restorer.restore(nav('board','b1'));t.state.userId='u2';t.pending[0].resolve({id:'b1',projectId:null});check('session change rejects old user authorization result',!(await p)&&!t.log.some(x=>x[0]==='commit'));
t=build({userId:null});check('signed-out workspace history never fetches protected workspace',!(await t.restorer.restore(nav('board','b')))&&t.pending.length===0);
t=build();p=t.restorer.restore(nav('board','b'));t.pending[0].reject(Error('network/forbidden'));check('failed read is a deny not cached location fallback',!(await p)&&t.log.some(x=>x[0]==='unavailable'));
t=build({dirty:true,confirm:async()=>{throw Error('dialog failure')}});check('failed discard confirmation fails closed',!(await t.restorer.restore(nav('calendar','')))&&!t.log.some(x=>x[0]==='commit'));
t=build();p=t.restorer.restore(nav('board','b'));t.restorer.invalidate();t.pending[0].resolve({id:'b',projectId:null});check('unmount invalidates pending browser restoration',!(await p)&&!t.log.some(x=>x[0]==='commit'));
check('actual app wires popstate and hashchange through shared guarded restorer',app.includes('createGuardedBrowserHistoryRestorer({')&&app.includes('void historyRestorer.restore(candidate)')&&app.includes('historyRestorer.invalidate()'));
check('actual app uses uncached server projections for fresh history checks',/readWorkspace: \(kind, id\) => queryApi<AuthorizedWorkspaceRead>[\s\S]*?force: true, persist: false, staleWhileRevalidate: false/.test(app));
check('actual app ties history to global navigation intent and session',app.includes('beginNavigationIntent: () => ++navigationAttemptRef.current')&&app.includes('getSessionId: () => historySessionRef.current.id'));
check('no direct history application bypassing new guard survives',!app.includes('if (candidate && await confirmHistoryNavigation()) applyNavigation(candidate)'));
console.log(`${n}/${n} G27 Pass 15 guarded browser history checks passed`);
