#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewBoardCardChanges, resolveBoardCardChanges, cardToBoardDraft } from '../../packages/renderer/src/features/boards/board-card-conflict-resolution.ts';
import { whiteboardRecoveryStorageKey } from '../../packages/renderer/src/features/whiteboards/whiteboard-recovery-identity.ts';
const R=(file)=>readFileSync(join(import.meta.dirname,'../..',file),'utf8');
let passed=0;function test(name,fn){fn();console.log('PASS',name);passed++;}
const initial={id:'CARD',title:'Start',priority:'medium',memberIds:['a','b'],labels:['ready','fix'],watcherIds:[],revision:1};
const base=cardToBoardDraft(initial,'a');
const changed=(overrides={})=>({...base,...overrides});
test('independent concurrent membership additions are merged in stable server-first order',()=>{
 const r=reviewBoardCardChanges(base,changed({memberIds:['a','b','local']}),changed({memberIds:['a','b','remote']}));
 assert.equal(r.conflicts.length,0);assert.deepEqual(r.proposed.memberIds,['a','b','remote','local']);
});
test('member deletion survives unrelated remote addition',()=>{
 const r=reviewBoardCardChanges(base,changed({memberIds:['a']}),changed({memberIds:['a','b','remote']}));
 assert.deepEqual(r.proposed.memberIds,['a','remote']);
});
test('remote deletion survives unrelated local addition',()=>{
 const r=reviewBoardCardChanges(base,changed({memberIds:['a','b','local']}),changed({memberIds:['a']}));
 assert.deepEqual(r.proposed.memberIds,['a','local']);
});
test('convergent set reorder does not generate a conflict or fake change',()=>{
 const r=reviewBoardCardChanges(base,changed({memberIds:['b','a'],labels:'fix, ready'}),base);
 assert.deepEqual(r.localChanges,[]);assert.deepEqual(r.conflicts,[]);
});
test('concurrent independent label additions and removals respect both sides',()=>{
 const r=reviewBoardCardChanges(base,changed({labels:'ready, local'}),changed({labels:'ready, fix, remote'}));
 assert.equal(r.conflicts.length,0);assert.equal(r.proposed.labels,'ready, remote, local');
});
test('label values with whitespace are normalized and deduplicated',()=>{
 const r=reviewBoardCardChanges(base,changed({labels:'ready, fix,  local,local, '}),changed({labels:'ready,fix,remote'}));
 assert.equal(r.proposed.labels,'ready, fix, remote, local');
});
test('scalar conflicts remain explicit even when memberships merge',()=>{
 const r=reviewBoardCardChanges(base,changed({title:'local',memberIds:['a','b','local']}),changed({title:'remote',memberIds:['a','b','remote']}));
 assert.deepEqual(r.conflicts.map(x=>x.field),['title']);assert.equal(resolveBoardCardChanges(r,{}),null);
 const resolved=resolveBoardCardChanges(r,{title:'server'});assert.equal(resolved.title,'remote');assert.deepEqual(resolved.memberIds,['a','b','remote','local']);
});
test('merged Card arrays are detached from both input drafts',()=>{
 const local=changed({memberIds:['a','b','local']}),remote=changed({memberIds:['a','b','remote']});
 const r=reviewBoardCardChanges(base,local,remote),merged=resolveBoardCardChanges(r,{});
 merged.memberIds.push('third');assert.deepEqual(local.memberIds,['a','b','local']);assert.deepEqual(remote.memberIds,['a','b','remote']);
});
test('Whiteboard recovery keys require authenticated user and whiteboard identity',()=>{
 assert.equal(whiteboardRecoveryStorageKey('', 'board'),null);assert.equal(whiteboardRecoveryStorageKey(null,'board'),null);
 assert.equal(whiteboardRecoveryStorageKey('owner',null),null);assert.equal(whiteboardRecoveryStorageKey('owner',' '),null);
});
test('recovery keys isolate accounts, boards and escaped separator characters',()=>{
 const a=whiteboardRecoveryStorageKey('user-a','board'),b=whiteboardRecoveryStorageKey('user-b','board');
 assert.notEqual(a,b);assert.notEqual(a,whiteboardRecoveryStorageKey('user-a','other'));
 assert.notEqual(whiteboardRecoveryStorageKey('u:x','b'),whiteboardRecoveryStorageKey('u','x:b'));
 assert.ok(a.startsWith('cluster-whiteboard-recovery-v2:'));
});
test('all Whiteboard recovery persistence and removal goes through authenticated key',()=>{
 const ui=R('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
 assert.match(ui,/whiteboardRecoveryStorageKey\(whiteboardCollaboration\.me\?\.id, id\)/);
 assert.doesNotMatch(ui,/cluster-whiteboard-recovery-\$\{.*\}-v196/);
 assert.match(ui,/if \(!key\) return false;/);assert.match(ui,/if \(key\) window\.localStorage\.removeItem\(key\)/);
 assert.match(ui,/\[activeWhiteboard\?\.id, activeWhiteboard\?\.updatedAt, selectedWhiteboardId, whiteboardCollaboration\.me\?\.id\]/);
 assert.match(ui,/draft\?\.whiteboard\?\.id !== activeWhiteboard\.id/);
});
console.log(`G25 WS12 recovery and concurrent membership: ${passed}/${passed} passed`);
