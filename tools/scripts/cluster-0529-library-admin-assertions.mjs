import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decidePendingAvatarAudit } from '../../apps/server/src/domains/users/avatar-approval.ts';
import { inspectLibraryBulkScope, LibraryBulkScopeLimitError } from '../../apps/server/src/domains/library/library-bulk-scope.ts';
import { describeLibraryBulkImpact } from '../../packages/renderer/src/features/library/library-bulk-impact.ts';
let passed = 0;
const check = async (name, action) => { await action(); console.log(`PASS ${name}`); passed++; };
const tree = [
  { id:'a', type:'folder', parentId:null },
  { id:'b', type:'folder', parentId:'a' },
  { id:'c', type:'file', parentId:'b' },
  { id:'d', type:'file', parentId:'a' },
  { id:'e', type:'folder', parentId:null },
];
const children = async (ids, limit) => tree.filter(item => ids.includes(item.parentId)).slice(0,limit);
const root = tree.filter(item => item.id === 'a');
const result = await inspectLibraryBulkScope(root, children, ()=>true,()=>false);
await check('Recursive impact traverses children and nested folders',()=>assert.deepEqual(result.descendants.map(row=>row.id).sort(),['b','c','d']));
await check('Nested selected roots are not double counted', async()=> {
  const nested = await inspectLibraryBulkScope([tree[0],tree[1]],children,()=>true,()=>false);
  assert.deepEqual(nested.descendants.map(row=>row.id).sort(),['c','d']);
});
await check('Confidential nested item blocks change',async()=>{
  const blocked=await inspectLibraryBulkScope(root,children,(item)=>item.id!=='c',()=>false);
  assert.equal(blocked.hasRestrictedDescendants,true);
});
await check('Nested managed folder blocks change',async()=>{
  const protectedTree=await inspectLibraryBulkScope(root,children,()=>true,(item)=>item.id==='b');
  assert.equal(protectedTree.hasProtectedDescendants,true);
});
await check('Bounded traversal fails closed',async()=>{
  await assert.rejects(()=>inspectLibraryBulkScope(root,children,()=>true,()=>false,2),LibraryBulkScopeLimitError);
});
await check('Unrelated roots are not scanned',async()=>{
  const outside=await inspectLibraryBulkScope([tree[4]],children,()=>true,()=>false);
  assert.equal(outside.descendants.length,0);
});
const rows = [{ id:'a', title:'Art', type:'folder', revision:2 }];
await check('Bulk preview explicitly counts nested location impact',()=>{
  const preview={ok:true,selectedCount:1,descendantCount:17,totalAffectedByLocation:18,action:'move',requiresRevalidation:true};
  const impact=describeLibraryBulkImpact('move',['a'],rows,'Reference',preview);
  assert.match(impact.message,/17 additional items/);
  assert.match(impact.message,/18/);
});
await check('Bulk preview rejects mismatched selection/action',()=>{
  assert.throws(()=>describeLibraryBulkImpact('trash',['a'],rows,'',{ok:true,selectedCount:1,descendantCount:5,totalAffectedByLocation:6,action:'move',requiresRevalidation:true}),/no longer matches/);
});
const libraryRoute=readFileSync(new URL('../../apps/server/src/domains/library/library-routes.ts',import.meta.url),'utf8');
const adminRoute=readFileSync(new URL('../../apps/server/src/app/server-routes-access-media.ts',import.meta.url),'utf8');
const avatarRoute=readFileSync(new URL('../../apps/server/src/domains/users/user-avatar-routes.ts',import.meta.url),'utf8');
const approvalsUI=readFileSync(new URL('../../packages/renderer/src/features/admin/AdminApprovalCenter.tsx',import.meta.url),'utf8');
const libraryUI=readFileSync(new URL('../../packages/renderer/src/features/library/LibraryWorkspacePage.tsx',import.meta.url),'utf8');
await check('Bulk writes reuse the exact preflight authorization, target check, and nested lock checks',()=>{
  assert.match(libraryRoute,/prepareLibraryBulk\(request, reply, body\)/);
  assert.match(libraryRoute,/LIBRARY_BULK_DESTINATION_DENIED/);
  assert.match(libraryRoute,/LIBRARY_BULK_NESTED_ACCESS/);
  assert.match(libraryRoute,/LIBRARY_BULK_LOCK_CONFLICT/);
  assert.match(libraryRoute,/libraryItemId: \{ in: impactedIds \}/);
  assert.match(libraryRoute,/new Set\(ids\)\.size === ids\.length/);
});
await check('UI requires server preview for hierarchy-sensitive mutations',()=>{
  assert.match(libraryUI,/"\/api\/library\/bulk\/preview"/);
  assert.match(libraryUI,/describeLibraryBulkImpact\(action, ids, items, destination, scope\)/);
});
await check('Both avatar approval routes consume the shared one-time authority',()=>{
  assert.match(adminRoute,/decidePendingAvatarAudit\(prisma, audit, actor\.id, body\.decision/);
  assert.match(avatarRoute,/decidePendingAvatarAudit\(prisma, audit, actor\.id, body\.status/);
});
await check('Avatar decisions are single-use and never revert a newer upload',async()=>{
  const state={status:'pending',avatarUrl:'/avatar/b.png'};
  const tx={avatarAudit:{
    updateMany:async ({where,data})=>{
      if(state.status!==where.status)return {count:0};
      state.status=data.status;
      return {count:1};
    },
    findUnique:async()=>({id:'a',status:state.status,user:{avatarUrl:state.avatarUrl}}),
  },user:{updateMany:async ({where,data})=>{
    if(state.avatarUrl!==where.avatarUrl)return {count:0};
    state.avatarUrl=data.avatarUrl;
    return {count:1};
  }}};
  const db={$transaction:async(fn)=>fn(tx)};
  const audit={id:'a',userId:'u',previousUrl:'/avatar/a.png',newUrl:'/avatar/b.png'};
  const decided=await decidePendingAvatarAudit(db,audit,'admin','rejected','Changed avatar');
  assert.equal(decided.status,'rejected');
  assert.equal(state.avatarUrl,'/avatar/a.png');
  assert.equal(await decidePendingAvatarAudit(db,audit,'admin','approved',null),null);
  state.status='pending';state.avatarUrl='/avatar/c.png';
  await decidePendingAvatarAudit(db,audit,'admin','rejected',null);
  assert.equal(state.avatarUrl,'/avatar/c.png');
});
await check('Admin UI blocks duplicate decisions and confirms lifecycle-sensitive outcomes',()=>{
  assert.match(approvalsUI,/decidingRef\.current = true/);
  assert.match(approvalsUI,/confirmCluster/);
  assert.match(approvalsUI,/setNote\(""\); \}, \[selectedId\]/);
});
console.log(`${passed}/13 cluster-0529 Library & Admin assertions passed`);
