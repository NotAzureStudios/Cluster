import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectLibraryMatchingSelection, LibraryMatchingSelectionError } from '../../apps/server/src/domains/library/library-matching-selection.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const work = fs.readFileSync(path.join(root, 'apps/server/src/domains/library/library-bulk-jobs.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'apps/server/src/domains/library/library-routes.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'packages/renderer/src/features/library/LibraryWorkspacePage.tsx'), 'utf8');
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const lifecycle = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-lifecycle.ts'),'utf8')), {exports:lifecycle});
// Minimal schema builder isolates the real transaction/worker implementation
// from the lean archive's missing Zod package. Contract enforcement is also
// examined at the source boundary below.
const chain = new Proxy({}, { get: (_target, key) => {
  if (key === 'parse') return (input) => input;
  return (..._args) => chain;
}});
const z = new Proxy({}, { get: () => (..._args) => chain });
let registered;
const exports = {};
vm.runInNewContext(transpile(work), { exports, require(spec) {
  if (spec === 'zod') return { z };
  if (spec === './library-item-serialization.js') return { parseJsonArray: (value) => JSON.parse(value || '[]') };
  if (spec === './library-platform-9e2.js') return { libraryLockIsActive: (value) => Boolean(value?.active) };
  if (spec === './library-collection-access.js') return { libraryCollectionRole: (collection, userId, admin) => admin || collection.ownerId === userId ? 'owner' : collection.grants?.find(g=>g.userId===userId)?.role || null, libraryCollectionCan: (role, minimum) => minimum === 'edit' ? role === 'owner' || role === 'editor' : Boolean(role) };
  if (spec === './library-bulk-lifecycle.js') return lifecycle;
  if (spec === './library-bulk-tags.js') return { applyLibraryBulkTagChange: (current, tag, action) => action === 'tag' ? [...new Set([...current, tag])] : current.filter((value) => value !== tag) };
  throw new Error('Unexpected import: ' + spec);
}, console });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
function data(count) { return Array.from({length: count}, (_, idx) => ({ id: `i${idx}`, revision: 1, type: 'file', tags: '[]', pinned: false, status: 'active', lifecycleState: 'active', deletedAt: null })); }
function dbFixture(count) {
  let items = new Map(data(count).map(item => [item.id, item]));
  let checkpoints = new Map();
  let events = [];
  let protectedIds = new Set();
  let lockedIds = new Set();
  let deniedIds = new Set();
  let actor = { id: 'user-1', accountState: 'ACTIVE', archived: false };
  let collection = { id: 'collection-a', revision: 2, archived: false, ownerId: 'user-1', grants: [] };
  let failActivity = false;
  const getCheckpoint = jobId => checkpoints.get(jobId);
  function delegates(snapshot, output) {
    return {
      user: { findUnique: async () => actor && { ...actor } },
      libraryCollection: { findUnique: async () => collection && { ...collection } },
      libraryItem: {
        findMany: async ({where}) => where.parentId ? [...new Set([...snapshot.values()].filter(item => where.parentId.in.includes(item.parentId)).map(item => item.parentId))].map(parentId => ({parentId})) : [...snapshot.values()].filter(item => where.id.in.includes(item.id)).map(item => ({...item})),
        updateMany: async ({where, data: diff}) => {
          const item = snapshot.get(where.id);
          if (!item || item.revision !== where.revision) return {count: 0};
          const changed = {...item, ...diff};
          if (diff.revision?.increment) changed.revision = item.revision + diff.revision.increment;
          snapshot.set(item.id, changed);
          return {count: 1};
        },
      },
      personnelRecordAttachment: { findMany: async ({where}) => where.libraryItemId.in.filter(id => protectedIds.has(id)).map(libraryItemId => ({libraryItemId})) },
      libraryAssetLock: { findMany: async ({where}) => where.itemId.in.filter(id => lockedIds.has(id)).map(itemId => ({itemId, active: true})) },
      // R62 hierarchy provenance blocks a flat bulk lifecycle change when
      // present. This fixture models items not owned by a hierarchy job.
      libraryHierarchyLifecycleEntry: { findMany: async () => [] },
      libraryBulkCheckpoint: {
        findUniqueOrThrow: async ({where}) => { const checkpoint = output.get(where.jobId); if (!checkpoint) throw Error('missing checkpoint'); return {...checkpoint}; },
        updateMany: async ({where, data: changes}) => {
          const checkpoint = output.get(where.jobId);
          if (!checkpoint || checkpoint.nextIndex !== where.nextIndex) return {count: 0};
          const changed = {...checkpoint};
          for (const [key,value] of Object.entries(changes)) changed[key] = typeof value === 'object' && 'increment' in value ? (checkpoint[key] ?? 0) + value.increment : value;
          output.set(where.jobId, changed);
          return {count: 1};
        },
      },
      activityEvent: {create: async ({data}) => { if (failActivity) throw Error('simulated DB insert rejection'); output.events.push(data); }},
    };
  }
  const prisma = {
    libraryBulkCheckpoint: {
      upsert: async ({where,create}) => {
        if (!checkpoints.has(where.jobId)) checkpoints.set(where.jobId, {nextIndex:0,changed:0,conflicted:0,denied:0,blocked:0,skipped:0, ...create});
        return checkpoints.get(where.jobId);
      },
      findUniqueOrThrow: async ({where}) => ({...checkpoints.get(where.jobId)}),
    },
    $transaction: async (cb) => {
      const rows = new Map([...items].map(([k,v])=>[k,{...v}]));
      const progress = new Map([...checkpoints].map(([k,v])=>[k,{...v}]));
      progress.events = [...events];
      const value = await cb(delegates(rows,progress));
      items = rows; checkpoints = progress; events = progress.events;
      return value;
    },
  };
  exports.registerLibraryBulkJobHandler({
    worker:{register(type,fn){ assert.equal(type,'library.bulk.metadata'); registered=fn; }},
    prisma,
    libraryAccess:{contextForUser:async user=>({user}),visibleFor:(_context,item)=>!deniedIds.has(item.id)},
  });
  const run = async ({jobId='job-a',targets=data(count).map(({id,revision})=>({id,revision})), action='tag', tag='new', pinned, collection: collectionScope, onProgress=()=>{}, onCancel=()=>{}}={}) => {
    const job = {id:jobId,createdById:'user-1'};
    const payload={actorId:'user-1',action,tag,pinned,targets, ...(collectionScope ? {collection: collectionScope} : {})};
    return registered({job,payload,throwIfCancelled:onCancel,throwIfToolUnavailable:async()=>{},updateProgress:onProgress});
  };
  return {run,get items(){return items;},get events(){return events;},getCheckpoint,protectedIds,lockedIds,deniedIds,setActor:(value)=>actor=value,setCollection:(value)=>collection=value,failActivity:(v)=>failActivity=v};
}
await check('1000-item server selection includes all accessible items with one immutable revision per ID',async()=>{
  const rows=data(1000);
  const selection=await collectLibraryMatchingSelection({maximumSelected:1000,fetchPage:async(skip,take)=>rows.slice(skip,skip+take),filterVisible:async rows=>rows});
  assert.equal(selection.length,1000);
  await assert.rejects(()=>collectLibraryMatchingSelection({maximumSelected:1000,fetchPage:async(skip,take)=>data(1001).slice(skip,skip+take),filterVisible:async rows=>rows}),e=>e instanceof LibraryMatchingSelectionError && e.code==='LIBRARY_MATCHING_TOO_LARGE');
});
await check('45 items process in three transactional chunks and create three atomic activity events',async()=>{
  const db=dbFixture(45);
  const result=await db.run();
  assert.deepEqual({total:result.total,changed:result.changed,processed:result.processed},{total:45,changed:45,processed:45});
  assert.equal(db.events.length,3); assert.equal(db.items.get('i0').revision,2); assert.deepEqual(JSON.parse(db.items.get('i42').tags),['new']);
  assert.deepEqual(db.events.map(e=>JSON.parse(e.metadata).range),[[0,20],[20,40],[40,45]]);
});
await check('commit followed by lost progress acknowledgement resumes at the next chunk without duplicate writes',async()=>{
  const db=dbFixture(44);let reports=0;
  await assert.rejects(()=>db.run({onProgress:async()=>{if(++reports===1)throw Error('ack lost');}}),/ack lost/);
  assert.equal(db.getCheckpoint('job-a').nextIndex,20);
  const finished=await db.run();
  assert.equal(finished.changed,44);assert.equal(db.items.get('i0').revision,2);assert.equal(db.events.length,3);
});
await check('permissions, protected Personnel Records, locks, stale revisions and no-op actions skip safely',async()=>{
  const db=dbFixture(8);
  db.deniedIds.add('i0');db.protectedIds.add('i1');db.lockedIds.add('i2');db.items.get('i3').revision=2;
  db.items.get('i4').tags='["new"]';
  const result=await db.run();
  assert.equal(result.changed,3);assert.equal(result.denied,2);assert.equal(result.blocked,1);assert.equal(result.conflicted,1);assert.equal(result.skipped,1);
  assert.equal(db.items.get('i0').revision,1); assert.equal(db.items.get('i1').revision,1); assert.equal(db.items.get('i2').revision,1);
});
await check('a failed audit INSERT rolls back all chunk changes and the checkpoint',async()=>{
  const db=dbFixture(10); db.failActivity(true);
  await assert.rejects(()=>db.run(),/simulated DB/);
  assert.equal(db.items.get('i0').revision,1);assert.equal(db.getCheckpoint('job-a').nextIndex,0); assert.equal(db.events.length,0);
  db.failActivity(false);const outcome=await db.run();assert.equal(outcome.changed,10);
});
await check('cancellation between chunks preserves the completed checkpoint and can resume without duplication',async()=>{
  const db=dbFixture(25);let cancel=false;
  await assert.rejects(()=>db.run({onProgress:async()=>{cancel=true},onCancel:async()=>{if(cancel)throw Error('cancelled')}}),/cancelled/);
  assert.equal(db.getCheckpoint('job-a').nextIndex,20);
  const recovered=await db.run();assert.equal(recovered.changed,25);assert.equal(db.events.length,2);
});
await check('offboarded actor cannot continue the next chunk',async()=>{
  const db=dbFixture(25);db.setActor({id:'user-1',archived:true,accountState:'DISABLED'});
  await assert.rejects(()=>db.run(),/initiating account/);assert.equal(db.getCheckpoint('job-a').nextIndex,0);
});
await check('job actor mismatch or duplicate snapshot IDs are refused before changes',async()=>{
  const db=dbFixture(2);
  await assert.rejects(()=>db.run({targets:[{id:'i0',revision:1},{id:'i0',revision:1}]}),/Duplicate/);
  assert.equal(db.items.get('i0').revision,1);
});
await check('revoked Collection grant blocks future chunks but preserves earlier committed work',async()=>{
  const db=dbFixture(45);
  let reports=0;
  const r=await db.run({collection:{id:'collection-a',revision:2},onProgress:async()=>{
    if(++reports===1)db.setCollection({id:'collection-a',revision:2,archived:false,ownerId:'another-user',grants:[]});
  }});
  assert.equal(r.changed,20);assert.equal(r.denied,25);assert.equal(db.events.length,3);
  assert.equal(db.items.get('i0').revision,2);assert.equal(db.items.get('i25').revision,1);
});
await check('changed Collection revision stops all pending item mutations',async()=>{
  const db=dbFixture(21); db.setCollection({id:'collection-a',revision:3,archived:false,ownerId:'user-1',grants:[]});
  const r=await db.run({collection:{id:'collection-a',revision:2}});
  assert.equal(r.denied,21);assert.equal(r.changed,0);
});
await check('server route enforces digest, per-user job visibility and permission rechecks',async()=>{
  assert.match(routes,/LIBRARY_BULK_PREVIEW_STALE/);assert.match(routes,/requireLibraryTool\(request, reply, "edit"\)/);
  assert.match(routes,/detail\.job\.createdById !== user\.id/);assert.match(routes,/personnelRecordAttachment\.findMany/);
  assert.match(routes,/libraryAccess\.contextForUser\(actor, tx\)/);
});
await check('job ownership, schema checkpoint and connected UI are present',async()=>{
  assert.match(schema,/model LibraryBulkCheckpoint/);assert.match(schema,/job BackgroundJob @relation/);
  assert.match(ui,/queueMatchingMetadata/);assert.match(ui,/Cancel remaining/);assert.match(ui,/library\.activeBulkJob/);
  const types=fs.readFileSync(path.join(root,'apps/server/src/domains/jobs/job-tool-ownership.ts'),'utf8');assert.match(types,/"library\.bulk\.metadata"/);
});

await check('archive changes only standalone files and rejects protected, locked, and nested records',async()=>{
  const db=dbFixture(9);
  db.items.get('i0').type='folder';
  db.items.get('i1').parentId='i2'; // A non-folder with a child is still a hierarchy operation.
  db.items.get('i3').status='archived';
  db.items.get('i4').deletedAt=new Date();
  db.items.get('i5').lifecycleState='trashed';
  db.protectedIds.add('i6'); db.lockedIds.add('i7');
  const result=await db.run({action:'archive'});
  assert.equal(result.changed,2);assert.equal(result.denied,1);
  assert.equal(result.blocked,5);assert.equal(result.skipped,1);
  assert.equal(db.items.get('i8').status,'archived');assert.equal(db.items.get('i8').revision,2);
  assert.equal(db.items.get('i0').status,'active');assert.equal(db.items.get('i2').status,'active');
  assert.equal(db.events[0].type,'library.bulk.lifecycle.chunk');
});
await check('unarchive is not Trash restore and requires an archived non-folder record',async()=>{
  const db=dbFixture(5);
  db.items.get('i0').status='archived';db.items.get('i1').status='archived';
  db.items.get('i1').type='folder';db.items.get('i2').status='trashed';
  db.items.get('i3').lifecycleState='destroyed';
  const result=await db.run({action:'unarchive'});
  assert.equal(result.changed,1);assert.equal(result.blocked,3);assert.equal(result.skipped,1);
  assert.equal(db.items.get('i0').status,'active');
  assert.equal(db.items.get('i2').status,'trashed');
  assert.equal(db.items.get('i1').status,'archived');
});
await check('archive retries never reapply a committed chunk and preserve audit evidence',async()=>{
  const db=dbFixture(26);let calls=0;
  await assert.rejects(()=>db.run({action:'archive',onProgress:()=>{if(++calls===1)throw Error('ack lost');}}),/ack lost/);
  assert.equal(db.getCheckpoint('job-a').nextIndex,20);
  const result=await db.run({action:'archive'});
  assert.equal(result.changed,26);assert.equal(db.items.get('i0').revision,2);assert.equal(db.events.length,2);
  assert.equal(db.events[1].type,'library.bulk.lifecycle.chunk');
});
await check('lifecycle eligibility and public UI route contracts agree',async()=>{
  assert(lifecycle.libraryBackgroundLifecycleEligible({type:'file',status:'active',lifecycleState:'active'},'archive'));
  assert(!lifecycle.libraryBackgroundLifecycleEligible({type:'folder',status:'active',lifecycleState:'active'},'archive'));
  assert(!lifecycle.libraryBackgroundLifecycleEligible({type:'file',status:'trashed',lifecycleState:'trashed'},'unarchive'));
  assert(lifecycle.libraryBackgroundLifecycleEligible({type:'file',status:'archived',lifecycleState:'active'},'unarchive'));
  assert.match(routes,/filterLibraryBackgroundCandidates\(permitted, body\.action/);
  assert.match(ui,/Restore archived matching files/);
  assert.match(ui,/Archive matching files/);
  assert.match(work,/parentsWithChildren\.has\(target\.id\)/);
  const rows=[{id:'a',type:'file',status:'active',lifecycleState:'active'},{id:'b',type:'file',status:'active',lifecycleState:'active'}];
  assert.deepEqual(Array.from(await lifecycle.filterLibraryBackgroundCandidates(rows,'archive',async()=>['b']), item=>item.id),['a']);
});
console.log(`${passed}/${passed} durable Library background bulk assertions passed`);
