import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const app=readFileSync(new URL('../../packages/renderer/src/features/application/ClusterApplication.tsx',import.meta.url),'utf8');
const src=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const occurrences=[];
function visit(node){
 if(ts.isJsxAttribute(node)&&['onOpenBoard','onOpenWhiteboard'].includes(node.name.text)){
   const initializer=node.initializer;
   if(initializer&&ts.isJsxExpression(initializer)&&initializer.expression){
     const line=src.getLineAndCharacterOfPosition(node.pos).line+1;
     occurrences.push({name:node.name.text,line,expr:initializer.expression.getText(src)});
   }
 }
 ts.forEachChild(node,visit);
}
visit(src);
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
check('all thirteen application shell workspace open callbacks are found',()=>{assert.equal(occurrences.length,13);assert.equal(occurrences.filter(c=>c.name==='onOpenBoard').length,8);assert.equal(occurrences.filter(c=>c.name==='onOpenWhiteboard').length,5)});
for(const c of occurrences){
 const calls=[],mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(`exports.open=${c.expr};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   module:mod,exports:mod.exports,
   openClusterWorkNavigation:target=>{calls.push(target);return true},
   setBoardId:()=>{throw Error('bypassed Board authorization')},
   setWhiteboardId:()=>{throw Error('bypassed Whiteboard authorization')},
   setScreen:()=>{throw Error('mutated route outside central guard')},
 },{filename:`shell-workspace-${c.line}.ts`});
 mod.exports.open('asset-id');
 check(`${c.name} line ${c.line} emits exact identity without direct state mutation`,()=>{
   assert.equal(calls.length,1);
   assert.equal(calls[0].screen,c.name==='onOpenBoard'?'board':'whiteboard');
   assert.equal(calls[0][c.name==='onOpenBoard'?'boardId':'whiteboardId'],'asset-id');
   assert.equal('projectId' in calls[0],false); // parent resolved from current server, not current selection
 });
}
const source=readFileSync(new URL('../../packages/renderer/src/features/workflow/authorized-workspace-navigation.ts',import.meta.url),'utf8');
check('Board and Whiteboard activation enters fresh current-placement resolver',()=>{
 assert.match(source,/target\.screen === "board"/);
 assert.match(source,/target\.screen === "whiteboard"/);
 assert.match(app,/resolveAuthorizedWorkspaceNavigation\(incoming, \{/);
 assert.match(app,/force: true, persist: false, staleWhileRevalidate: false/);
});
check('server permission denial does not apply linked resource destination',()=>{
 const from=app.indexOf('void resolveAuthorizedWorkspaceNavigation(incoming, {');
 const end=app.indexOf('applyLinkedWork(resolved, sequence, navigationAttempt);',from);
 assert.ok(from>0&&end>from);
 assert.match(app.slice(from,end),/if \(!resolved\) \{/);
 assert.doesNotMatch(app.slice(from,end),/setBoardId\(|setWhiteboardId\(/);
});
check('central navigation still requires unsaved-work confirmation before state changes',()=>{
 assert.match(app,/if \(!changed \|\| !hasUnsavedChanges\(\)\)/);
 assert.match(app,/approved && active && expectedSequence === navigationSequence && expectedAttempt === navigationAttemptRef\.current/);
});
assert.equal(passed,17);
console.log(`${passed}/${passed} G27 Pass 12 shell workspace navigation tests passed`);
