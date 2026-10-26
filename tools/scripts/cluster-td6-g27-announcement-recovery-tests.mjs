#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const module={exports:{}};
const file='packages/renderer/src/features/settings/announcement-intent-recovery.ts';
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('module','exports','require',compiled)(module,module.exports,()=>{throw Error('unexpected import')});
const recovery=module.exports;
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
const storageMap=new Map();
const storage={getItem:key=>storageMap.get(key)||null,setItem:(key,v)=>storageMap.set(key,v),removeItem:key=>storageMap.delete(key)};
const id='e0b47d9a-a56e-4358-a14e-331f3a4e7e3f';
const record={id,digest:'a'.repeat(64),createdAt:100_000};
await check('session-only marker stores opaque identity and SHA-256, no payload content',()=>{
 recovery.savePendingAnnouncementIntent(storage,'create',record);
 const raw=storage.getItem(recovery.intentStorageKey('create'));
 assert.deepEqual(JSON.parse(raw),record);assert.equal(raw.includes('secret content'),false);
});
await check('valid marker restores across component mounts',()=>assert.deepEqual(recovery.readPendingAnnouncementIntent(storage,'create',101_000),record));
await check('kind segregation prevents duplicate intent from clobbering create',()=>{
 recovery.savePendingAnnouncementIntent(storage,'duplicate',{...record,id:'037823b2-764e-4c4e-97e1-2738c39fa483'});
 assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',101_000).id,id);
 assert.notEqual(recovery.readPendingAnnouncementIntent(storage,'duplicate',101_000).id,id);
});
await check('stale and future-dated markers expire safely',()=>{
 assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',record.createdAt+86400001),null);
 recovery.savePendingAnnouncementIntent(storage,'create',record);
 assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',record.createdAt-60001),null);
});
await check('malformed JSON, identifiers and hashes are rejected',()=>{
 storage.setItem(recovery.intentStorageKey('create'),'{');assert.equal(recovery.readPendingAnnouncementIntent(storage,'create'),null);
 recovery.savePendingAnnouncementIntent(storage,'create',{...record,id:'../../escape'});assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',101000),null);
 recovery.savePendingAnnouncementIntent(storage,'create',{...record,digest:'body text'});assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',101000),null);
});
await check('clearing one marker cannot erase another operation',()=>{
 recovery.savePendingAnnouncementIntent(storage,'create',record);
 recovery.clearPendingAnnouncementIntent(storage,'create','other-id');assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',101000)?.id,id);
 recovery.clearPendingAnnouncementIntent(storage,'create',id);assert.equal(recovery.readPendingAnnouncementIntent(storage,'create',101000),null);
 assert.ok(recovery.readPendingAnnouncementIntent(storage,'duplicate',101000));
});
await check('blocked browser storage does not prevent use of in-memory retries',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 assert.equal(recovery.readPendingAnnouncementIntent(blocked,'create'),null);
 assert.doesNotThrow(()=>recovery.savePendingAnnouncementIntent(blocked,'create',record));
 assert.doesNotThrow(()=>recovery.clearPendingAnnouncementIntent(blocked,'create',id));
});
await check('content fingerprints preserve equality and detect changed bodies',async()=>{
 const a=await recovery.announcementRequestDigest(JSON.stringify({title:'A',body:'private'}));
 assert.match(a,/^[0-9a-f]{64}$/);
 assert.equal(a,await recovery.announcementRequestDigest(JSON.stringify({title:'A',body:'private'})));
 assert.notEqual(a,await recovery.announcementRequestDigest(JSON.stringify({title:'A',body:'changed'})));
});
await check('composer offers recovery inspection and explicit discarding, never automatic replay',()=>{
 const ui=readFileSync('packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx','utf8');
 assert.match(ui,/function reviewPending/);assert.match(ui,/Check previous/);assert.match(ui,/Discard recovery marker/);
 assert.match(ui,/!digest \|\| stored\.digest !== digest/);assert.match(ui,/create-intents\/\$\{encodeURIComponent\(marker\.id\)\}/);
 assert.doesNotMatch(ui,/localStorage/);
});
console.log(`G27 announcement reload recovery: ${passed}/${passed} passed`);
