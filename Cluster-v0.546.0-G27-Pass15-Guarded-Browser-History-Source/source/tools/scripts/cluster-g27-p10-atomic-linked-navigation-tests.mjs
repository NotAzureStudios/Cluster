import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const source=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let node;
function find(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='applyLinkedWork')node=n;ts.forEachChild(n,find)}
find(source);
assert.ok(node?.initializer,'Production linked-work function must exist');
const compiled=ts.transpileModule(`exports.applyLinkedWork=${node.initializer.getText(source)};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const initial='https://cluster.test/?workProject=p1&inspect=card%3Ac1#board/p1/b1';
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
function simulate({currentScreen='board',currentProject='p1',currentBoard='b1',dirty=true,approval=false,auth=true,admin=true,delegated=false,sequence=7}={}){
 const calls=[],current=new URL(initial),win={location:{href:initial},history:{state:{},replaceState:(_state,_title,uri)=>{win.location.href=new URL(uri,current.origin).href;calls.push(['url',uri])}},dispatchEvent:event=>calls.push(['event',event.type,event.detail]),setTimeout:(fn)=>{fn()}};
 let resolver, rejecter,active=true, navigationSequence=sequence;
 const deferred=new Promise((resolve,reject)=>{resolver=resolve;rejecter=reject});
 const module={exports:{}};
 const env={
   module,exports:module.exports,window:win,URL,
   CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
   activeUser:{id:'u1',isAdmin:admin},isAppScreen:()=>true,canOpenScreen:()=>auth,
   delegatedFormDestination:()=>delegated?'myForms':null,
   screen:currentScreen,projectId:currentProject,boardId:currentBoard,whiteboardId:null,
   CLUSTER_WORK_PROJECT_QUERY_KEY:'workProject',CLUSTER_WORK_PROJECT_TAB_QUERY_KEY:'projectTab',
   active,navigationSequence,navigationAttemptRef:{current:1},hasUnsavedChanges:()=>{calls.push(['dirty']);return dirty},
   confirmCluster:()=>{calls.push(['confirm']);return deferred},
   clearPendingDesktopWorkNavigation:()=>calls.push(['consume']),
   reportClusterWorkNavigationRecovery:()=>calls.push(['recovery']),
   setScreen:(...args)=>{calls.push(['setScreen',...args]);return Promise.resolve()},
   openProject:(...args)=>calls.push(['openProject',...args]),
   setProjectId:id=>calls.push(['project',id]),setBoardId:id=>calls.push(['board',id]),setWhiteboardId:id=>calls.push(['whiteboard',id]),
 };
 vm.runInNewContext(compiled,env,{filename:'ClusterApplication.applyLinkedWork.ts'});
 const target={screen:'board',projectId:'p1',boardId:'b2',inspectScope:'card',inspectId:'c2'};
 return {calls,target,fn:(t=target,s=sequence,a=1)=>module.exports.applyLinkedWork(t,s,a),approve:()=>resolver(approval),reject:()=>rejecter(Error('dialog down')),
   updateSeq:s=>{env.navigationSequence=s},updateAttempt:a=>{env.navigationAttemptRef.current=a},invalidate:()=>{env.active=false},url:()=>win.location.href};
}
const nextTick=async()=>{await Promise.resolve();await Promise.resolve()};
let t=simulate();t.fn();
check('dirty Card-to-Card transition asks once before modifying selection',()=>assert.deepEqual(t.calls.map(x=>x[0]),['dirty','confirm']));
t.approve();await nextTick();
check('denied Card transition preserves URL and original Board',()=>{assert.equal(t.url(),initial);assert.equal(t.calls.some(x=>x[0]==='board'),false)});
t=simulate({approval:true});t.fn();t.approve();await nextTick();
check('approved new Card changes URL and Board exactly once',()=>{
 assert.equal(t.calls.filter(x=>x[0]==='url').length,1);
 assert.equal(t.calls.filter(x=>x[0]==='board').length,1);
 assert.match(t.url(),/inspect=card%3Ac2/);
});
check('approved link does not trigger a second discard prompt in setScreen',()=>{
 assert.equal(t.calls.filter(x=>x[0]==='confirm').length,1);
 const c=t.calls.find(x=>x[0]==='setScreen');assert.equal(c?.[1],'board');assert.equal(c?.[2]?.discardApproved,true);
});
t=simulate({approval:true});t.fn();t.updateSeq(8);t.approve();await nextTick();
check('newer link cancels older pending discard prompt',()=>assert.deepEqual(t.calls.map(x=>x[0]),['dirty','confirm']));
t=simulate({approval:true});t.fn();t.invalidate();t.approve();await nextTick();
check('session/effect cleanup aborts pending confirmation',()=>assert.equal(t.calls.some(x=>x[0]==='url'),false));
t=simulate();t.fn();t.reject();await nextTick();
check('confirmation system failure is not implicit approval',()=>{assert.equal(t.calls.some(x=>x[0]==='url'),false)});
t=simulate({dirty:false});t.fn();
check('clean navigation commits immediately without prompting',()=>{
 assert.equal(t.calls.some(x=>x[0]==='confirm'),false);assert.equal(t.calls.filter(x=>x[0]==='url').length,1);
});
t=simulate();t.fn({screen:'board',projectId:'p1',boardId:'b1',inspectScope:'card',inspectId:'c1'});
check('same exact destination does not prompt for unsaved work',()=>assert.equal(t.calls.some(x=>x[0]==='confirm'),false));
t=simulate();t.fn({screen:'board',projectId:'p1',inspectScope:'card',inspectId:'c2'});
check('incomplete Board inspector is denied before any prompt or URL mutation',()=>assert.deepEqual(t.calls,[]));
t=simulate({auth:false});t.fn();
check('inaccessible tools are denied before prompt/URL',()=>assert.deepEqual(t.calls,[]));
t=simulate({admin:false});t.fn({screen:'studioSettings',inspectScope:'studio-announcement',inspectId:'a1'});
check('non-admin Studio announcement link does not mutate URL',()=>assert.deepEqual(t.calls,[]));
t=simulate({currentScreen:'calendar',approval:true});t.fn({screen:'project',projectId:'p2',projectTab:'builds'});t.approve();await nextTick();
check('Project link preflights before current Project changes',()=>{
 const ops=t.calls.map(x=>x[0]);assert.ok(ops.indexOf('confirm')<ops.indexOf('project'));assert.ok(ops.indexOf('confirm')<ops.indexOf('url'));
});
check('Project link uses preapproved Project opener instead of double prompt',()=>{
 const c=t.calls.find(x=>x[0]==='openProject');assert.equal(c?.[1],'p2');assert.equal(c?.[2],true);assert.equal(c?.[3],true);
});
t=simulate({approval:true,delegated:true,admin:false,auth:false});t.fn({screen:'studioSettings',inspectScope:'form-submission',inspectId:'submission1'});t.approve();await nextTick();
check('delegated Form reviewer opens My Forms without admin privilege',()=>{
 const c=t.calls.find(x=>x[0]==='setScreen');assert.equal(c?.[1],'settings');assert.equal(c?.[2]?.section,'myForms');assert.equal(c?.[2]?.discardApproved,true);
});
t=simulate();t.fn({screen:'board',projectId:'p1',boardId:'b2',inspectScope:'card',inspectId:'c2'},6);
check('already obsolete authorization sequence never prompts or commits',()=>assert.deepEqual(t.calls,[]));
check('all five central call sites bind the current navigation sequence',()=>{
 const block=app.slice(app.indexOf('const openLinkedWork ='),app.indexOf('window.addEventListener(CLUSTER_OPEN_WORK_SOURCE_EVENT, openLinkedWork)'));
 assert.equal((block.match(/applyLinkedWork\([^;]+, sequence, navigationAttempt\);/g)||[]).length,5);
});
check('internal discard bypass is only passed after linked-work admission',()=>{
 assert.match(app,/if \(!changed \|\| !hasUnsavedChanges\(\)\) \{/);
 assert.match(app,/if \(approved && active && expectedSequence === navigationSequence && expectedAttempt === navigationAttemptRef\.current\) commit\(\)/);
});
t=simulate({approval:true});t.fn();t.updateAttempt(2);t.approve();await nextTick();
check('a newer direct navigation cancels an older linked-work confirmation',()=>assert.equal(t.calls.some(x=>x[0]==='url'),false));
check('the application shared navigation guard remains active for ordinary navigation',()=>{
 assert.match(app,/next !== screen && !options\.discardApproved && hasUnsavedChanges\(\)/);
});
assert.equal(checks,20);
console.log(`${checks}/${checks} G27 Pass 10 atomic linked-work navigation checks passed`);
