#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(join(root,p),'utf8');
const module={exports:{}};
const code=ts.transpileModule(read('packages/renderer/src/features/whiteboards/whiteboard-operations.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,require:(name)=>{throw Error(name)},Map,Set,JSON,Array,Object,Number,Math,Date,String,Error}, {filename:'whiteboard-operations.ts'});
const plan=module.exports.planWhiteboardFeedSync;
const event=(sequence)=>({id:`op-${sequence}`,sequence,kind:'element.move',payload:{id:'e1',x:sequence,y:0}});
const feed=(overrides={})=>({ok:true,resetRequired:false,currentSequence:13,revision:7,operations:[event(11),event(12),event(13)],hasMore:false,returnedThroughSequence:13,...overrides});
let passed=0;function test(label,fn){fn();passed++;console.log('PASS '+label)}
test('applies only a fully contiguous page ending exactly at server watermark',()=>assert.equal(plan(10,5,feed()).action,'apply'));
test('does not falsely replay any missing operation',()=>assert.equal(plan(10,5,feed({operations:[event(11),event(13)]})).action,'refresh'));
test('does not replay a page starting at wrong sequence',()=>assert.equal(plan(10,5,feed({operations:[event(12),event(13)]})).action,'refresh'));
test('does not replay out of order or duplicate sequence',()=>assert.equal(plan(10,5,feed({operations:[event(11),event(11),event(13)]})).action,'refresh'));
test('does not jump to watermark after truncated 500 item page',()=>{
 const f=feed({currentSequence:950,operations:Array.from({length:500},(_,i)=>event(i+11)),hasMore:true,returnedThroughSequence:510});assert.equal(plan(10,5,f).action,'refresh');
});
test('does not trust full-length page when hasMore is explicitly true',()=>assert.equal(plan(10,5,feed({hasMore:true})).action,'refresh'));
test('does not trust inconsistent returned-through watermark',()=>assert.equal(plan(10,5,feed({returnedThroughSequence:12})).action,'refresh'));
test('rejects a snapshot reset even if operations look complete',()=>assert.equal(plan(10,5,feed({resetRequired:true})).action,'refresh'));
test('rejects a racing server read that reports stale current sequence',()=>assert.equal(plan(10,5,feed({currentSequence:9})).action,'refresh'));
test('same sequence and revision does not re-fetch unnecessarily',()=>assert.equal(plan(10,7,feed({currentSequence:10,operations:[],returnedThroughSequence:10})).action,'none'));
test('same sequence with newer metadata revision reloads full whiteboard',()=>assert.equal(plan(10,5,feed({currentSequence:10,operations:[],revision:6})).action,'refresh'));
test('advanced watermark with empty operations triggers full reload',()=>assert.equal(plan(10,5,feed({operations:[]})).action,'refresh'));
test('malformed or non-integer sequences cannot skip state',()=>assert.equal(plan(10,5,feed({currentSequence:13.5})).action,'refresh'));
test('server reports the operation page cursor and truncation',()=>{
 const route=read('apps/server/src/domains/collaboration/whiteboard-operation-routes.ts');assert.match(route,/returnedThroughSequence: operations\.length/);assert.match(route,/hasMore: resetRequired/);assert.match(route,/sequence: \{ gt: query\.after \}/);
});
test('renderer reloads authoritative state on missing feed and preserves dirty drafts for review',()=>{
 const ui=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
 assert.match(ui,/const feedPlan = planWhiteboardFeedSync/);assert.match(ui,/feedPlan\.action === "refresh"/);assert.match(ui,/if \(localWhiteboardDirty\) \{\s*setPendingRemote\(remote\)/);
 const before=ui.slice(ui.indexOf('const feedPlan ='),ui.indexOf('const remoteBase ='));
 assert.match(before,/applyRemoteWhiteboard\(remote,/);assert.doesNotMatch(before,/applyWhiteboardOperations\(activeWhiteboard, feed\.operations/);
});
console.log(`G25 WS14 feed-integrity tests: ${passed}/${passed} passed`);
