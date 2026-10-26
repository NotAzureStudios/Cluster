#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const domain = 'apps/server/src/domains/library/';
function load(name, dependencies = {}) {
  const source = readFileSync(domain + name + '.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((specifier) => dependencies[specifier] ?? require(specifier), mod, mod.exports);
  return mod.exports;
}
const effective = load('library-effective-retention');
const guard = load('library-retention-relocation', { './library-effective-retention.js': effective });
const scopeHelpers = {
  inspectLibraryBulkScope: async (selected, find, allowed) => {
    const all = [], queue = selected.filter(x => x.type === 'folder').map(x => x.id);
    const seen = new Set(selected.map(x => x.id));
    while (queue.length) {
      const page = await find(queue.splice(0), 100);
      for (const entry of page) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);all.push(entry);
        if (entry.type === 'folder') queue.push(entry.id);
      }
    }
    return { descendants: all, hasRestrictedDescendants: all.some(x => !allowed(x)), hasProtectedDescendants: false };
  }, LibraryBulkScopeLimitError: class extends Error {},
};
const bulk = load('library-bulk-transaction-guard', {
  './library-bulk-scope.js': scopeHelpers,
  './library-platform-9e2.js': { libraryLockIsActive: () => false },
  './library-effective-retention.js': effective,
  './library-retention-relocation.js': guard,
});
let count=0;
async function test(title, fn) { await fn(); count++; console.log('PASS G26 retention mutation:', title); }
const future='2031-01-01T00:00:00.000Z', sooner='2030-01-01T00:00:00.000Z', past='2020-01-01T00:00:00.000Z';
const row=(id,parentId=null,more={})=>({id,parentId,projectId:'project',revision:1,type:'file',legalHold:false,retentionUntil:null,status:'active',lifecycleState:'active',...more});
function db(rows, opts={}) {
  const entries = Object.fromEntries(rows.map(x=>[x.id,x]));
  return {
    libraryItem: {
      findUnique: async({where}) => entries[where.id]??null,
      findMany:async ({where}) => Object.values(entries).filter(x=>where.id?.in?.includes(x.id) || where.parentId?.in?.includes(x.parentId)),
    },
    user: { findUnique:async()=>({id:'actor',accountState:'ACTIVE',archived:false,accessExpiresAt:null}) },
    personnelRecordAttachment:{findMany:async()=>[]},libraryAssetLock:{findMany:async()=>[]},
    ...opts,
  };
}
const access={contextForUser:async()=>({}),visibleFor:()=>true};
async function runBulk(rows,{id,action,parentId=null}) { return bulk.revalidateLibraryBulkTreeWrite({
  tx:db(rows), actorId:'actor', ids:[id],expectedRevisions:{[id]:1},action,parentId,
  itemInclude:{},access,isManagedFolder:()=>false,
}); }
const sameCode = code => e=>e.code===code;
await test('retained file cannot escape held parent to root',async()=>{
  const p=row('held',null,{type:'folder',legalHold:true});
  await assert.rejects(guard.assertLibraryMovePreservesRetention(db([p]),row('file','held'),null),sameCode('LIBRARY_MOVE_WEAKENS_HOLD'));
});
await test('move to another held parent preserves the hold',async()=>{
  const a=row('a',null,{type:'folder',legalHold:true}),b=row('b',null,{type:'folder',legalHold:true});
  const result=await guard.assertLibraryMovePreservesRetention(db([a,b]),row('file','a'),'b');
  assert.equal(result.after.legalHold,true);
});
await test('own hold remains active after moving to root',async()=>{
  const a=row('a',null,{type:'folder',legalHold:true});
  const result=await guard.assertLibraryMovePreservesRetention(db([a]),row('file','a',{legalHold:true}),null);
  assert.equal(result.after.legalHold,true);
});
await test('move cannot shorten inherited active retention',async()=>{
  const a=row('a',null,{type:'folder',retentionUntil:future}),b=row('b',null,{type:'folder',retentionUntil:sooner});
  await assert.rejects(guard.assertLibraryMovePreservesRetention(db([a,b]),row('file','a'),'b'),sameCode('LIBRARY_MOVE_WEAKENS_RETENTION'));
});
await test('same or stronger future retention is permitted',async()=>{
  const a=row('a',null,{type:'folder',retentionUntil:sooner}),b=row('b',null,{type:'folder',retentionUntil:future});
  const outcome=await guard.assertLibraryMovePreservesRetention(db([a,b]),row('file','a'),'b');
  assert.equal(outcome.after.retentionUntil.toISOString(),future);
});
await test('expired retention alone need not prevent relocation',async()=>{
  const a=row('a',null,{type:'folder',retentionUntil:past});
  await guard.assertLibraryMovePreservesRetention(db([a]),row('file','a'),null);
});
await test('cycle in destination ancestry fails closed',async()=>{
  const a=row('a','b',{type:'folder'}),b=row('b','a',{type:'folder'});
  await assert.rejects(guard.assertLibraryMovePreservesRetention(db([a,b]),row('file',null),'a'),sameCode('LIBRARY_RETENTION_CYCLE'));
});
await test('missing destination ancestry fails closed',async()=>{
  await assert.rejects(guard.assertLibraryMovePreservesRetention(db([]),row('file'),'missing'),sameCode('LIBRARY_RETENTION_PARENT_MISSING'));
});
await test('cross-project destination cannot weaken boundary',async()=>{
  const a=row('a',null,{type:'folder',projectId:'different'});
  await assert.rejects(guard.assertLibraryMovePreservesRetention(db([a]),row('file'), 'a'),sameCode('LIBRARY_RETENTION_PROJECT_BOUNDARY'));
});
await test('single-item bulk Trash rejects inherited hold',async()=>{
  const a=row('a',null,{type:'folder',legalHold:true}),file=row('file','a');
  await assert.rejects(runBulk([a,file],{id:'file',action:'trash'}),sameCode('LIBRARY_INHERITED_RETENTION_ACTIVE'));
});
await test('single-item bulk Trash rejects inherited deadline',async()=>{
  const a=row('a',null,{type:'folder',retentionUntil:future}),file=row('file','a');
  await assert.rejects(runBulk([a,file],{id:'file',action:'trash'}),sameCode('LIBRARY_INHERITED_RETENTION_ACTIVE'));
});
await test('bulk Trash rejects protected descendant',async()=>{
  const root=row('root',null,{type:'folder'}),file=row('file','root',{legalHold:true});
  await assert.rejects(runBulk([root,file],{id:'root',action:'trash'}),sameCode('LIBRARY_DESCENDANT_RETENTION_ACTIVE'));
});
await test('bulk move applies source ancestry guard at write',async()=>{
  const root=row('root',null,{type:'folder',legalHold:true}),file=row('file','root');
  await assert.rejects(runBulk([root,file],{id:'file',action:'move'}),sameCode('LIBRARY_MOVE_WEAKENS_HOLD'));
});
await test('bulk move allows equal policy destination',async()=>{
  const root=row('root',null,{type:'folder',legalHold:true}),dest=row('dest',null,{type:'folder',legalHold:true}),file=row('file','root');
  const result=await runBulk([root,dest,file],{id:'file',action:'move',parentId:'dest'});
  assert.equal(result.selected.length,1);
});
await test('metadata PATCH cannot lower hold even for unchanged false payload',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{legalHold:false}).code,'LIBRARY_RETENTION_ENDPOINT_REQUIRED');
});
await test('metadata PATCH cannot alter retention deadline',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{retentionUntil:null}).code,'LIBRARY_RETENTION_ENDPOINT_REQUIRED');
});
await test('metadata PATCH cannot alter retention policy key',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{retentionPolicyKey:null}).code,'LIBRARY_RETENTION_ENDPOINT_REQUIRED');
});
await test('metadata PATCH cannot relocate an item',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{parentId:'elsewhere'}).code,'LIBRARY_MOVE_WORKFLOW_REQUIRED');
});
await test('metadata PATCH may preserve current parent ID',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{parentId:null}),null);
});
await test('metadata PATCH cannot reassign project ownership',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{projectId:'other'}).code,'LIBRARY_PROJECT_TRANSFER_WORKFLOW_REQUIRED');
});
await test('metadata PATCH cannot Trash directly',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{status:'trashed'}).code,'LIBRARY_LIFECYCLE_WORKFLOW_REQUIRED');
});
await test('metadata PATCH cannot restore lifecycle without dedicated path',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i',null,{status:'trashed',lifecycleState:'trashed'}),{status:'active'}).code,'LIBRARY_LIFECYCLE_WORKFLOW_REQUIRED');
});
await test('normal title and description PATCH remains available',()=>{
  assert.equal(guard.libraryMetadataMutationDenial(row('i'),{title:'Asset',body:'notes'}),null);
});
await test('bulk and hierarchy guard, direct PATCH and DELETE use canonical mutation checks',()=>{
  const route=readFileSync(domain+'library-routes.ts','utf8');
  const move=readFileSync(domain+'library-hierarchy-move.ts','utf8');
  const guardSrc=readFileSync(domain+'library-bulk-transaction-guard.ts','utf8');
  assert.match(route,/libraryMetadataMutationDenial\(existing, body\)/);
  assert.match(route,/const retention = await resolveLibraryEffectiveRetention\(tx, current\)/);
  assert.match(route,/LIBRARY_INHERITED_RETENTION_ACTIVE/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(move,/fingerprint: digest\(\[libraryHierarchyFingerprint\(tree\), sourceRetention.lineage\]\)/);
  assert.match(guardSrc,/assertLibraryMovePreservesRetention\(tx, root/);
});
console.log(`G26 retention mutation closure: ${count}/${count} passed`);
