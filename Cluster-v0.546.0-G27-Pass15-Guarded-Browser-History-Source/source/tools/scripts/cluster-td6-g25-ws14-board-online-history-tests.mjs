#!/usr/bin/env node
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{resolve,join}from'node:path';import{createRequire}from'node:module';import vm from'node:vm';
const root=resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),ts=require('typescript');const read=p=>readFileSync(join(root,p),'utf8');
const mod={exports:{}};const source=read('packages/renderer/src/features/boards/board-card-move-history.ts');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(js,{module:mod,exports:mod.exports,require,Array,Map,Set,Number,String,Math});const can=mod.exports.canReplayBoardSavedMove;
let tests=0;const test=(title,fn)=>{fn();tests++;console.log('PASS '+title)};
const state=(connection,queuedStatuses=[],busy=false)=>can({connection,queuedStatuses,busy});
test('live and polling can use revision-guarded session history',()=>{assert.equal(state('live'),true);assert.equal(state('polling'),true)});
test('offline, reconnecting, connecting cannot queue history reversal',()=>{for(const c of ['offline','reconnecting','connecting'])assert.equal(state(c),false)});
test('pending, replaying, paused, failed, conflicting changes block move history',()=>{for(const status of ['pending','replaying','paused','failed','conflict'])assert.equal(state('live',[status]),false)});
test('finished queue entries do not block saved move history',()=>assert.equal(state('live',['complete','applied']),true));
test('busy move disables overlapping history actions',()=>assert.equal(state('live',[],true),false));
test('renderer guards click and keyboard paths, and shows honest disabled reason',()=>{
 const p=read('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');assert.match(p,/if \(!boardSavedMoveAllowed\) \{/);assert.match(p,/moveOperationBusyRef\.current \|\| !boardSavedMoveAllowed/);assert.match(p,/disabled=\{!boardSavedMoveAllowed \|\| !moveHistory\.undo\.length\}/);assert.match(p,/History paused · reconnect/);
});
console.log(`G25 WS14 Board history checks: ${tests}/${tests} passed`);
