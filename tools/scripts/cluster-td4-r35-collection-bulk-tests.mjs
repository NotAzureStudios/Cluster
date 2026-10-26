import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { collectLibraryMatchingSelection, LibraryMatchingSelectionError } from '../../apps/server/src/domains/library/library-matching-selection.ts';
import { libraryCollectionCan, libraryCollectionRole } from '../../apps/server/src/domains/library/library-collection-access.ts';
import { createHash } from 'node:crypto';
const libraryBulkSelectionDigest = targets => createHash('sha256').update(JSON.stringify(targets.map(t=>[t.id,t.revision]))).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-collection-selection.ts'),'utf8');
const routes = fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-routes.ts'),'utf8');
const worker = fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-jobs.ts'),'utf8');
const ui = fs.readFileSync(path.join(root,'packages/renderer/src/features/library/LibraryWorkspacePage.tsx'),'utf8');
const contract = fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-job-contract.ts'),'utf8');
const lifecycle={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-lifecycle.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:lifecycle});
const exports = {};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports, require(spec){
    if(spec==='./library-collection-access.js')return {libraryCollectionCan,libraryCollectionRole};
    if(spec==='./library-matching-selection.js')return {collectLibraryMatchingSelection};
    if(spec==='./library-bulk-job-contract.js')return {libraryBulkSelectionDigest};
    if(spec==='./library-bulk-lifecycle.js')return lifecycle;
    if(spec==='./library-platform-9e2.js')return {
      librarySmartCollectionWhere:()=>({query:{folderScope:null},where:{lifecycleState:{not:'destroyed'}}}),
      librarySmartCollectionDescendantFolders:async id=>[id],
    };
    throw Error('Unexpected import '+spec);
  }, console,
});
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS',name);}
const sample = (n)=>Array.from({length:n},(_,i)=>({id:`item-${i}`,type:'file',revision:1,status:'active',lifecycleState:'active',deletedAt:null,project:null}));
function fixture({count=12,kind='manual',role='owner',revision=2,protectedIds=[],deniedIds=[],archived=false,ownerId='alice',projectId=null,folderScope=false}={}){
  const items=sample(count);const denied=new Set(deniedIds);const protectedSet=new Set(protectedIds);
  const collection={id:'col-1',revision,archived,ownerId,kind,projectId,queryJson:'{}',grants:role==='owner'?[]:[{userId:'alice',role}]};
  if(role!=='owner')collection.ownerId='bob';
  const tx={
    libraryCollection:{findUnique:async()=>collection},
    libraryCollectionMembership:{findMany:async({skip,take})=>items.slice(skip,skip+take).map(item=>({item}))},
    libraryItem:{findMany:async({where,skip=0,take=100})=>where?.parentId ? [...new Set(items.filter(item=>where.parentId.in.includes(item.parentId)).map(item=>item.parentId))].map(parentId=>({parentId})) : items.slice(skip,skip+take),findUnique:async()=>folderScope?{id:'folder',type:'folder',status:'active',lifecycleState:'active'}:null},
    personnelRecordAttachment:{findMany:async({where})=>where.libraryItemId.in.filter(id=>protectedSet.has(id)).map(libraryItemId=>({libraryItemId}))},
  };
  const context={decorated:{isAdmin:false}};
  const run=(action='tag')=>exports.resolveLibraryBulkCollectionSelection({tx,context,actorId:'alice',collectionId:'col-1',expectedRevision:2,action,canContribute:(_ctx,item)=>!denied.has(item.id)});
  return {run,collection,items,denied,protectedSet};
}
await check('Manual collection across unloaded pages yields exactly the accessible ID/revisions',async()=>{
  const f=fixture({count:620,protectedIds:['item-2'],deniedIds:['item-3']}); const r=await f.run();
  assert.equal(r.targets.length,618);assert.equal(r.collection.id,'col-1');assert.equal(r.collection.revision,2);
  assert(!r.targets.some(t=>['item-2','item-3'].includes(t.id)));assert.equal(r.digest,libraryBulkSelectionDigest(r.targets));
});
await check('Shared editor is allowed but shared viewer is denied even if item ACL contributes',async()=>{
  assert.equal((await fixture({role:'editor'}).run()).targets.length,12);
  await assert.rejects(()=>fixture({role:'viewer'}).run(),e=>e.code==='LIBRARY_BULK_COLLECTION_DENIED'&&e.status===403);
});
await check('Revoked grants and archived collections fail closed',async()=>{
  const revoked=fixture({role:'editor'});revoked.collection.grants=[];
  await assert.rejects(()=>revoked.run(),e=>e.code==='LIBRARY_BULK_COLLECTION_DENIED');
  await assert.rejects(()=>fixture({archived:true}).run(),e=>e.code==='LIBRARY_BULK_COLLECTION_DENIED');
});
await check('Stale collection revision blocks enqueue regardless of unchanged item revisions',async()=>{
  await assert.rejects(()=>fixture({revision:3}).run(),e=>e.code==='LIBRARY_BULK_COLLECTION_STALE');
});
await check('One thousand accessible entries allowed, one thousand one rejects without partial results',async()=>{
  assert.equal((await fixture({count:1000}).run()).targets.length,1000);
  await assert.rejects(()=>fixture({count:1001}).run(),e=>e.code==='LIBRARY_MATCHING_TOO_LARGE');
});
await check('Smart query uses canonical item matching and can filter protected records',async()=>{
  const f=fixture({count:300,kind:'smart',protectedIds:['item-1']});
  const r=await f.run();assert.equal(r.targets.length,299);
});
await check('Malformed Smart Collection query is rejected before matching',async()=>{
  const f=fixture({kind:'smart'});f.collection.queryJson='garbage';
  await assert.rejects(()=>f.run(),e=>e.code==='LIBRARY_BULK_COLLECTION_INVALID');
});
await check('R35 contract enforces mutually exclusive workspace vs collection targets',async()=>{
  assert.match(contract,/Boolean\(input\.query\) === Boolean\(input\.collectionId\)/);
  assert.match(contract,/expectedCollectionRevision/);
});
await check('Preview and queue share one collection resolver and request-key scope',async()=>{
  assert.match(routes,/resolveLibraryBulkCollectionSelection/);
  assert.match(routes,/collectionId: body\.collectionId, collectionRevision: body\.expectedCollectionRevision/);
  assert.match(routes,/selection\.collection \? \{ collection: selection\.collection \}/);
  assert.match(routes,/LIBRARY_BULK_PREVIEW_STALE/);
});
await check('Worker rechecks collection revision and editing grant each committed chunk',async()=>{
  assert.match(worker,/collection\.revision === command\.collection\.revision/);
  assert.match(worker,/libraryCollectionCan\(libraryCollectionRole/);
  assert.match(worker,/!collectionAllowed \|\| !row/);
});
await check('UI exposes the operation to collection editors but not viewers and guards navigation changes',async()=>{
  assert.match(ui,/expectedCollectionRevision: startingCollection\.revision/);
  assert.match(ui,/activeCollection\.accessRole !== "viewer"/);
  assert.match(ui,/requestSerial\.current !== initialSerial/);
});
await check('archive and unarchive select only lifecycle-eligible Collection members', async()=>{
 const f=fixture({count:7});
 f.items[0].type='folder'; f.items[1].status='archived';
 f.items[6].parentId='item-5';
 f.items[2].status='trashed'; f.items[3].deletedAt=new Date();
 f.items[4].lifecycleState='destroyed';
 const archive=await f.run('archive');
 assert.deepEqual(Array.from(archive.targets,t=>t.id),['item-6']);
 const unarchive=await f.run('unarchive');
 assert.deepEqual(Array.from(unarchive.targets,t=>t.id),['item-1']);
});
console.log(`${checks}/${checks} TD4 R36 collection-aware durable bulk tests passed`);
