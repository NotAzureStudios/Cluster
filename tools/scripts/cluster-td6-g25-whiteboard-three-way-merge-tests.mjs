#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(join(root,p),'utf8');
function load(name) {
 const js=ts.transpileModule(read(name),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require:k=>{throw Error('Unexpected runtime import '+k)},Map,Set,Object,JSON,Array,Number,String,Error},{filename:name});return module.exports;
}
const merge=load('packages/renderer/src/features/whiteboards/whiteboard-conflict-review.ts');
const ops=load('packages/renderer/src/features/whiteboards/whiteboard-operations.ts');
const E=(id,overrides={})=>({id,type:'rect',x:10,y:20,width:100,height:60,text:'start',...overrides});
const board=(overrides={})=>({id:'board-1',operationSequence:4,revision:3,name:'Board',description:'',projectId:null,canvasWidth:1800,canvasHeight:950,backgroundColor:'#fff',gridColor:'#aaa',gridStyle:'lines',categories:[],labels:[],productionLinks:{},elements:[E('a')],...overrides});
let passed=0;function test(label,fn){fn();passed++;console.log('PASS '+label)}
test('no conflict: server changes an unrelated object while local edits a different one',()=>{
 const base=board({elements:[E('a'),E('b')]});
 const mine=board({elements:[E('a',{text:'mine'}),E('b')]});
 const remote=board({elements:[E('a'),E('b',{x:55})],revision:4,operationSequence:5});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,0);
 const draft=review.resolve({});assert.equal(draft.elements.find(x=>x.id==='a').text,'mine');assert.equal(draft.elements.find(x=>x.id==='b').x,55);assert.equal(draft.operationSequence,5);
});
test('same element, disjoint properties merge without overwriting remote',()=>{
 const base=board();const mine=board({elements:[E('a',{text:'mine'})]});const remote=board({elements:[E('a',{x:72})],operationSequence:5});
 const result=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(result.conflicts.length,0);assert.equal(result.resolve({}).elements[0].x,72);assert.equal(result.resolve({}).elements[0].text,'mine');
});
test('same property conflicting values require explicit keep mine or server',()=>{
 const base=board();const mine=board({elements:[E('a',{x:21})]});const remote=board({elements:[E('a',{x:36})],operationSequence:5});
 const result=merge.reviewWhiteboardConflict(base,mine,remote), key=result.conflicts[0]?.key;
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].minePreview,'21');assert.equal(result.conflicts[0].serverPreview,'36');assert.equal(result.resolve({}),null);assert.equal(result.resolve({[key]:'mine'}).elements[0].x,21);assert.equal(result.resolve({[key]:'server'}).elements[0].x,36);
});
test('concurrent delete and edit requires explicit choice, never silently resurrect',()=>{
 const base=board(),mine=board({elements:[E('a',{text:'edit'})]}),remote=board({elements:[]});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,1);assert.equal(review.resolve({}),null);
 assert.equal(review.resolve({[review.conflicts[0].key]:'server'}).elements.length,0);
 assert.equal(review.resolve({[review.conflicts[0].key]:'mine'}).elements[0].text,'edit');
});
test('local deletion versus remote modification requires explicit choice',()=>{
 const base=board(),mine=board({elements:[]}),remote=board({elements:[E('a',{x:90})]});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,1);assert.equal(review.resolve({}),null);
 assert.equal(review.resolve({[review.conflicts[0].key]:'mine'}).elements.length,0);
 assert.equal(review.resolve({[review.conflicts[0].key]:'server'}).elements[0].x,90);
});
test('identical concurrent delete is nonconflicting',()=>{
 const review=merge.reviewWhiteboardConflict(board(),board({elements:[]}),board({elements:[]}));assert.equal(review.conflicts.length,0);assert.equal(review.resolve({}).elements.length,0);
});
test('independent created objects survive in authoritative server order',()=>{
 const base=board({elements:[]}),mine=board({elements:[E('local')]}),remote=board({elements:[E('remote')]});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,0);assert.equal(review.resolve({}).elements.map(x=>x.id).join(','),'remote,local');
});
test('same-ID divergent concurrent creation is explicit conflict',()=>{
 const base=board({elements:[]}),mine=board({elements:[E('same',{text:'local'})]}),remote=board({elements:[E('same',{text:'server'})]});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,1);assert.equal(review.resolve({}),null);
 assert.equal(review.resolve({[review.conflicts[0].key]:'server'}).elements[0].text,'server');
});
test('changed metadata fields merge individually, including array settings',()=>{
 const base=board(),mine=board({name:'Locally renamed',categories:[{id:'c',name:'local'}]}),remote=board({description:'server description',gridColor:'#bbb'});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,0);
 const out=review.resolve({});assert.equal(out.name,'Locally renamed');assert.equal(out.description,'server description');assert.equal(out.gridColor,'#bbb');assert.equal(out.categories[0].id,'c');
});
test('overlapping categorical settings require manual choice',()=>{
 const base=board(),mine=board({name:'My board'}),remote=board({name:'Their board'});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,1);assert.equal(review.resolve({}),null);
 assert.equal(review.resolve({[review.conflicts[0].key]:'mine'}).name,'My board');
});
test('conflicting element field choices are independent and all required',()=>{
 const base=board(),mine=board({elements:[E('a',{x:30,y:45})]}),remote=board({elements:[E('a',{x:60,y:80})]});
 const review=merge.reviewWhiteboardConflict(base,mine,remote);assert.equal(review.conflicts.length,2);const choices={[review.conflicts[0].key]:'mine',[review.conflicts[1].key]:'server'};
 assert.equal(review.resolve({[review.conflicts[0].key]:'mine'}),null);
 assert.equal(review.resolve(choices).elements[0].x,30);assert.equal(review.resolve(choices).elements[0].y,80);
});
test('unrelated incoming element updates remain intact when submitting merged ops',()=>{
 const base=board({elements:[E('a'),E('b')]}),mine=board({elements:[E('a',{text:'draft'}),E('b')]}),remote=board({elements:[E('a'),E('b',{x:250})],revision:5,operationSequence:9});
 const review=merge.reviewWhiteboardConflict(base,mine,remote),draft=review.resolve({});
 const operations=ops.buildWhiteboardOperations(remote,draft);assert.equal(operations.length,1);
 const result=ops.applyWhiteboardOperations(remote,operations,10,6);assert.equal(result.elements.find(x=>x.id==='a').text,'draft');assert.equal(result.elements.find(x=>x.id==='b').x,250);
});
test('source and target Whiteboard identities must match',()=>{
 assert.throws(()=>merge.reviewWhiteboardConflict(board(),board(),board({id:'other'})),/identities/);
});
test('duplicate element IDs fail closed',()=>{
 assert.throws(()=>merge.reviewWhiteboardConflict(board({elements:[E('a'),E('a')]}),board(),board()),/duplicate/);
});
test('stale recovery copies cannot overwrite newer server work without review',()=>{
 const ui=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
 const banner=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePanels.tsx');
 assert.match(ui,/staleServerSequence=\{Boolean\(recoveryDraft/);
 assert.match(ui,/Cannot directly restore a draft from an older server sequence/);
 assert.match(banner,/disabled=\{staleServerSequence\}/);
 assert.match(ui,/whiteboard-recovery-/);
});
test('UI never presents reviewed merge as committed and saves via direct online revisioned request',()=>{
 const ui=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
 assert.match(ui,/Apply reviewed changes locally/);assert.match(ui,/Save reviewed merge/);assert.match(ui,/Your draft/);assert.match(ui,/Current server/);assert.match(ui,/reviewedMergeAwaitingSave\s*\?\s*\{ queued: false, result: await api/);
 assert.match(ui,/baseSequence: Number\(baseWhiteboard.operationSequence/);assert.match(ui,/!autoSaveEnabled \|\| !activeWhiteboard \|\| !localWhiteboardDirty \|\| reviewedMergeAwaitingSave/);
 assert.match(ui,/setWhiteboardMergeChoices\(\{\}\)/);assert.match(ui,/setSavedHistory\(\[\]\)/);
});
console.log(`G25 three-way Whiteboard review: ${passed}/${passed} passed`);
