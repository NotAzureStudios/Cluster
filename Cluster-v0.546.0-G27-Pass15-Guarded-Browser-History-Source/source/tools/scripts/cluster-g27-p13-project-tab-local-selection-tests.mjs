import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const app=readFileSync(new URL('../../packages/renderer/src/features/application/ClusterApplication.tsx',import.meta.url),'utf8');
const src=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function handler(name){let n;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)n=node;ts.forEachChild(node,visit)}visit(src);assert.ok(n,name);return ts.transpileModule('exports.handler='+n.getText(src)+';',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}
const sources={close:handler('closeProjectTab'),other:handler('closeOtherProjectTabs')};
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
const tick=async()=>{await Promise.resolve();await Promise.resolve()};
function openHandler(type,{dirty=true,approval=false,currentProject='p2',screen='project',visibleProjects=['p1','p2','p3']}={}){
 const calls=[],ref={current:0};let resolve,reject;
 const deferred=new Promise((yes,no)=>{resolve=yes;reject=no});const module={exports:{}};
 const env={module,exports:module.exports,screen,projectId:currentProject,
   visibleProjects:visibleProjects.map(id=>({id})),openProjectTabIds:['p1','p2','p3'],
   navigationAttemptRef:ref,isProjectContextScreen:value=>['project','board','whiteboard'].includes(value),
   setOpenProjectTabIds:val=>calls.push(['tabs',val]),setPinnedProjectTabIds:val=>calls.push(['pins',typeof val==='function'?val(['p1','p2','p3']):val]),
   setProjectId:id=>calls.push(['project',id]),setScreen:(...args)=>{calls.push(['screen',...args]);ref.current++;return Promise.resolve()},
   openProject:(...args)=>{calls.push(['openProject',...args]);ref.current++},
   hasUnsavedChanges:()=>{calls.push(['dirty']);return dirty},
   confirmCluster:()=>{calls.push(['confirm']);return deferred},
 };
 vm.runInNewContext(sources[type],env,{filename:type+'.handler.ts'});
 return {calls,ref,fn:module.exports.handler,approve:()=>resolve(approval),reject:()=>reject(Error('dialog failed'))};
}
let t=openHandler('close');t.fn('p2');
check('closing dirty active tab preflights before removing tabs or changing screen',()=>assert.deepEqual(t.calls.map(c=>c[0]),['dirty','confirm']));
t.approve();await tick();
check('canceled active tab close preserves tabs and selection',()=>assert.equal(t.calls.some(c=>c[0]==='tabs'),false));
t=openHandler('close',{approval:true});t.fn('p2');t.approve();await tick();
check('approved active tab close selects an allowed remaining Project',()=>{
 assert.equal(t.calls.find(c=>c[0]==='project')?.[1],'p1');
 assert.deepEqual(Array.from(t.calls.find(c=>c[0]==='tabs')?.[1]),['p1','p3']);
});
check('approved tab closure carries internal single-prompt preapproval',()=>assert.equal(t.calls.find(c=>c[0]==='screen')?.[2]?.discardApproved,true));
t=openHandler('close',{dirty:true});t.fn('p3');
check('closing background Project tab is immediate and does not discard current work',()=>{
 assert.equal(t.calls.some(c=>c[0]==='confirm'),false);assert.equal(t.calls.some(c=>c[0]==='tabs'),true);assert.equal(t.calls.some(c=>c[0]==='project'),false);
});
t=openHandler('close',{approval:true});t.fn('p2');t.ref.current++;t.approve();await tick();
check('new navigation intent prevents old active-tab close after approval',()=>assert.equal(t.calls.some(c=>c[0]==='tabs'),false));
t=openHandler('close',{approval:true});t.fn('p2');t.reject();await tick();
check('failed confirmation cannot close an active Project tab',()=>assert.equal(t.calls.some(c=>c[0]==='tabs'),false));
t=openHandler('close',{dirty:false,visibleProjects:[]});t.fn('p2');
check('inaccessible tab fallback goes to Projects instead of a denied Project',()=>{assert.equal(t.calls.find(c=>c[0]==='project')[1],null);assert.equal(t.calls.find(c=>c[0]==='screen')[1],'projects')});
t=openHandler('other');t.fn('p3');
check('close other tabs does not delete tabs before dirty Project switch approval',()=>assert.deepEqual(t.calls.map(c=>c[0]),['dirty','confirm']));
t.approve();await tick();
check('canceled close-other retains all tabs and Project selection',()=>assert.equal(t.calls.some(c=>c[0]==='tabs'),false));
t=openHandler('other',{approval:true});t.fn('p3');t.approve();await tick();
check('approved close-other pins only chosen tab, then opens it once',()=>{
 assert.deepEqual(Array.from(t.calls.find(c=>c[0]==='tabs')[1]),['p3']);assert.deepEqual(Array.from(t.calls.find(c=>c[0]==='pins')[1]),['p3']);assert.deepEqual(t.calls.find(c=>c[0]==='openProject').slice(1),['p3',false,true]);
});
t=openHandler('other',{dirty:true});t.fn('p2');
check('closing other tabs around already selected Project requires no confirmation',()=>assert.equal(t.calls.some(c=>c[0]==='confirm'),false));
t=openHandler('other',{dirty:false,visibleProjects:['p1']});t.fn('p3');
check('cannot keep a Project tab no longer visible to current user',()=>assert.deepEqual(t.calls,[]));
const attributes=[];
function visit(node){if(ts.isJsxAttribute(node)&&['onSelectBoard','onSelectWhiteboard','onCloseBoard'].includes(node.name.text)&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)attributes.push({name:node.name.text,text:node.initializer.expression.getText(src)});ts.forEachChild(node,visit)}visit(src);
check('workspace selector/close handlers have unique call sites',()=>assert.deepEqual(attributes.map(x=>x.name).sort(),['onCloseBoard','onSelectBoard','onSelectWhiteboard']));
function invokeAttr(name,id){const attribute=attributes.find(x=>x.name===name),calls=[],module={exports:{}};
 vm.runInNewContext(ts.transpileModule('exports.handler='+attribute.text+';', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 module,exports:module.exports,board:{project:{id:'p2'}},projectId:'p2',openClusterWorkNavigation:arg=>calls.push(['navigate',arg]),openProject:id=>calls.push(['openProject',id]),setScreen:id=>calls.push(['setScreen',id]),setBoard:()=>{throw Error('discarded Board early')},setBoardId:()=>{throw Error('bypassed Board guard')},setWhiteboardId:()=>{throw Error('bypassed Whiteboard guard')},
 },{filename:name+'.tsx'});
 module.exports.handler(id);return calls;
}
check('Board selector routes named Board ID through central admission',()=>assert.equal(invokeAttr('onSelectBoard','b9')[0][1].boardId,'b9'));
check('Board selector routes empty picker through unsaved-work-aware admission',()=>assert.deepEqual(Object.keys(invokeAttr('onSelectBoard',null)[0][1]),['screen']));
check('Whiteboard selector routes named ID through central admission',()=>assert.equal(invokeAttr('onSelectWhiteboard','w9')[0][1].whiteboardId,'w9'));
check('Whiteboard selector routes empty picker through guarded generic workspace',()=>assert.deepEqual(Object.keys(invokeAttr('onSelectWhiteboard',null)[0][1]),['screen']));
check('Board close requests guarded Project open without discarding loaded Board first',()=>assert.deepEqual(invokeAttr('onCloseBoard',undefined),[['openProject','p2']]));
check('empty Board picker clears local model only after selected Board ID is cleared',()=>assert.match(app,/if \(screen !== "board"\) return;\s*if \(boardId\) void loadBoard\(boardId\);\s*else \{ setBoard\(null\); setBoardLoadError\(null\); setBoardLoading\(false\); \}/));
assert.equal(passed,20);
console.log(`${passed}/${passed} G27 Pass 13 Project tab and local workspace selection checks passed`);
