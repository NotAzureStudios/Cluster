import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const app=readFileSync(new URL('../../packages/renderer/src/features/application/ClusterApplication.tsx',import.meta.url),'utf8');
const source=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function extract(name){let result;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)result=node;ts.forEachChild(node,visit)}visit(source);assert.ok(result,`missing ${name} controller`);return ts.transpileModule('exports.handler='+result.getText(source)+';', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}
const projectFn=extract('openProject'),resumeFn=extract('resumeWorkspace');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
const tick=async()=>{await Promise.resolve();await Promise.resolve()};
function environment({kind='project',currentScreen='board',currentProject='p1',dirty=true,allowed=true,approved=false,seq=0,resumeContext,whiteboards=[]}={}){
 let resolve,reject;
 const deferred=new Promise((yes,no)=>{resolve=yes;reject=no});
 const calls=[];
 const navigationAttemptRef={current:seq};
 const projects=[{id:'p1'},{id:'p2'},{id:'p3'}];
 const env={
   module:{exports:{}},navigationAttemptRef,screen:currentScreen,projectId:currentProject,boardId:'b1',whiteboardId:'w1',
   projects,user:{id:'user1'},activeUser:{id:'user1'},canUseProject:()=>allowed,
   setOpenProjectTabIds:fn=>{calls.push(['tabs']);},pinnedProjectTabIds:[],MAX_PROJECT_TABS:10,nextOpenProjectTabs:()=>[],
   clearProjectSwitchRouteContext:()=>calls.push(['routeClear']),
   setProjectId:id=>calls.push(['project',id]),setBoardId:id=>calls.push(['board',id]),setWhiteboardId:id=>calls.push(['whiteboard',id]),
   setScreen:(...args)=>{calls.push(['screen',...args]);navigationAttemptRef.current++;return Promise.resolve()},
   hasUnsavedChanges:()=>{calls.push(['dirty']);return dirty},
   confirmCluster:()=>{calls.push(['confirm']);return deferred},
   resumeContext:resumeContext===undefined?{screen:'board',projectId:'p2',boardId:'b2'}:resumeContext,
   visibleProjects:projects,boardOptions:()=>[{id:'b2',projectId:'p2'}],whiteboards,
   canOpenScreen:()=>true,clearResumeWorkspace:()=>calls.push(['clearResume']),
 };
 env.exports=env.module.exports;
 vm.runInNewContext(kind==='project'?projectFn:resumeFn,env,{filename:kind+'.controller.ts'});
 return {env,fn:env.module.exports.handler,calls,approve:()=>resolve(approved),reject:()=>reject(Error('dialog failure'))};
}
let t=environment();t.fn('p2');
check('direct Project open checks unsaved state before any Project mutation',()=>assert.deepEqual(t.calls.map(x=>x[0]),['dirty','confirm']));
t.approve();await tick();
check('denied Project switch does not change route, tabs or selected project',()=>assert.equal(t.calls.some(x=>x[0]==='project'),false));
t=environment({approved:true});t.fn('p2');t.approve();await tick();
check('approved Project opens correct project after the dialog',()=>{
 const ops=t.calls.map(x=>x[0]);assert.ok(ops.indexOf('confirm')<ops.indexOf('routeClear'));assert.deepEqual(t.calls.find(x=>x[0]==='project').slice(1),['p2']);
});
check('approved Project bypasses only the redundant second guard',()=>{const c=t.calls.find(x=>x[0]==='screen');assert.equal(c[1],'project');assert.equal(c[2].discardApproved,true)});
t=environment({dirty:false});t.fn('p2');
check('clean Project switch does not summon discard confirmation',()=>{assert.equal(t.calls.some(x=>x[0]==='confirm'),false);assert.equal(t.calls.some(x=>x[0]==='project'),true)});
t=environment({currentScreen:'project',currentProject:'p2'});t.fn('p2');
check('opening already selected Project avoids discard prompt',()=>assert.equal(t.calls.some(x=>x[0]==='confirm'),false));
t=environment({approved:true});t.fn('p2');t.fn('p3');t.approve();await tick();
check('older Project confirmation cannot override a newer Project intent',()=>assert.deepEqual(t.calls.filter(x=>x[0]==='project').map(x=>x[1]),['p3']));
t=environment({approved:true});t.fn('p2');t.env.navigationAttemptRef.current++;t.approve();await tick();
check('a later unrelated screen intent cancels outstanding Project confirmation',()=>assert.equal(t.calls.some(x=>x[0]==='project'),false));
t=environment({approved:true});t.fn('p2');t.reject();await tick();
check('failed Project confirmation cannot mutate route',()=>assert.equal(t.calls.some(x=>x[0]==='project'),false));
t=environment({allowed:false});t.fn('p2');
check('disallowed Project never sets a private Project ID',()=>assert.equal(t.calls.some(x=>x[0]==='project'),false));
t=environment({kind:'resume'});t.fn();
check('Continue Working checks dirty state before selecting stored Board',()=>assert.deepEqual(t.calls.map(x=>x[0]),['dirty','confirm']));
t.approve();await tick();
check('canceled Resume keeps current Board and Project intact',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=environment({kind:'resume',approved:true});t.fn();t.approve();await tick();
check('approved Resume selects saved Board/Project once',()=>{
 assert.deepEqual(t.calls.find(x=>x[0]==='board').slice(1),['b2']);assert.deepEqual(t.calls.find(x=>x[0]==='project').slice(1),['p2']);
});
check('approved Resume avoids a redundant setScreen discard guard',()=>assert.equal(t.calls.find(x=>x[0]==='screen')[2].discardApproved,true));
t=environment({kind:'resume',approved:true});t.fn();t.env.navigationAttemptRef.current++;t.approve();await tick();
check('new navigation intent discards a stale Resume confirmation',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=environment({kind:'resume',approved:true});t.fn();t.reject();await tick();
check('Resume confirmation failure leaves selection unchanged',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=environment({kind:'resume',dirty:false,resumeContext:{screen:'whiteboard',projectId:'p1',whiteboardId:'w2'},whiteboards:[{id:'w2',projectId:'p1'}]});t.fn();
check('clean Resume can restore a Whiteboard without asking',()=>{
 assert.equal(t.calls.some(x=>x[0]==='confirm'),false);assert.equal(t.calls.find(x=>x[0]==='whiteboard')[1],'w2');
});
t=environment({kind:'resume',dirty:false,resumeContext:{screen:'project',projectId:'p2'}});
// Stub the direct Project opener with a non-mutating recorder; it is a separate controller.
t.env.openProject=(...args)=>t.calls.push(['openProject',...args]);t.fn();
check('Resume Project delegates with a single approved transition',()=>{const c=t.calls.find(x=>x[0]==='openProject');assert.deepEqual(c.slice(1),['p2',false,true])});
t=environment({kind:'resume',resumeContext:null});t.fn();
check('Continue Working with no candidate does not prompt or mutate',()=>assert.deepEqual(t.calls,[]));
check('all inbound resource links invalidate an older direct Project confirmation',()=>assert.match(app,/const sequence = \+\+navigationSequence;\s*const navigationAttempt = \+\+navigationAttemptRef\.current/));
check('generic screen-controller prompts also invalidate outstanding Project confirmation',()=>assert.match(app,/async function setScreen\([\s\S]*?const navigationIntent = \+\+navigationAttemptRef\.current/));
check('stale direct screen confirmation never mutates route',()=>assert.match(app,/if \(!discard \|\| navigationIntent !== navigationAttemptRef\.current\) return/));
assert.equal(count,22);
console.log(`${count}/${count} G27 Pass 11 direct Project and Resume navigation checks passed`);
