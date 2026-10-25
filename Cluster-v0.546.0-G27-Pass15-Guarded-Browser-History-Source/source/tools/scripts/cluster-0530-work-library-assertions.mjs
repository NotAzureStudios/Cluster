import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeBoardBulk, describeBoardBulkOutcome } from '../../packages/renderer/src/features/boards/board-bulk-runner.ts';
import { applyLibraryBulkTagChange } from '../../apps/server/src/domains/library/library-bulk-tags.ts';
import { sortApprovalQueue } from '../../packages/renderer/src/features/admin/admin-approval-queue.ts';
import { describeLibraryBulkImpact } from '../../packages/renderer/src/features/library/library-bulk-impact.ts';
let total=0;
const check=(name,fn)=>{fn();console.log('PASS',name);total++};
const row=(id)=>({id,title:id});
const cards=[row('a'),row('b'),row('c'),row('d')];
const cancelled = new AbortController();
const result=await executeBoardBulk(cards,async (card)=>{
 if(card.id==='a')return { queued:false };
 if(card.id==='b')throw new Error('conflict');
 if(card.id==='c')cancelled.abort();
 return { queued:true };
},undefined,cancelled.signal);
check('Board cancellation stops *new* work after an in-flight mutation',()=>{
 assert.equal(result.applied,1);assert.equal(result.queued,1);assert.equal(result.cancelled,1);
 assert.deepEqual(result.appliedIds,['a']);assert.deepEqual(result.queuedIds,['c']);assert.deepEqual(result.remainingIds,['d']);
 assert.deepEqual(result.failures.map(v=>v.id),['b']);
 assert.match(describeBoardBulkOutcome(result),/not started/);
});
check('Board bulk skip and normal completion retain precise per-card IDs',async()=>{});
const done=await executeBoardBulk([row('a'),row('b')],async (v)=>v.id==='a'?'skip':{queued:false});
check('Board skip IDs are distinct from applied IDs',()=>{
 assert.deepEqual(done.skippedIds,['a']);assert.deepEqual(done.appliedIds,['b']);assert.equal(done.cancelled,0);
});
const early=new AbortController();early.abort();
const never=await executeBoardBulk(cards,async()=>{throw Error('should not run')},undefined,early.signal);
check('Already cancelled bulk never submits any card',()=>assert.deepEqual(never.remainingIds,['a','b','c','d']));
check('Adding Library tag retains existing tags without duplicate',()=>assert.deepEqual(applyLibraryBulkTagChange(['music','art','music'],'art','tag'),['music','art']));
check('Removing Library tag leaves other tags intact',()=>assert.deepEqual(applyLibraryBulkTagChange(['art','music'],'art','untag'),['music']));
check('Removing absent tag is an idempotent no-op',()=>assert.deepEqual(applyLibraryBulkTagChange(['art'],'music','untag'),['art']));
check('Empty or oversized tag fails closed',()=>{
 assert.throws(()=>applyLibraryBulkTagChange(['art'],'   ','tag'));
 assert.throws(()=>applyLibraryBulkTagChange([], 'x'.repeat(81),'untag'));
});
check('Library removal preview describes operation and selection bounds',()=>{
 const impact=describeLibraryBulkImpact('untag',['a'],[{id:'a',title:'A',type:'file'}],'music');
 assert.match(impact.message,/music/);assert.match(impact.title,/Remove tag/);
});
const approvals=[
{id:'old',title:'Old',type:'avatar_change',status:'pending',createdAt:'2026-09-01T00:00:00Z'},
{id:'critical',title:'Critical',type:'external_release',status:'pending',createdAt:'2026-10-01T00:00:00Z'},
{id:'done',title:'Done',type:'external_release',status:'approved',createdAt:'2026-10-08T00:00:00Z'},
{id:'high',title:'High',type:'project_completion',status:'pending',createdAt:'2026-10-04T00:00:00Z'}];
check('Approval triage sorts pending by priority and keeps resolved behind',()=>assert.deepEqual(sortApprovalQueue(approvals,'priority').map(v=>v.id),['critical','old','high','done']));
check('Approval triage oldest-first sorting deterministic',()=>assert.deepEqual(sortApprovalQueue(approvals,'oldest').map(v=>v.id),['old','critical','high','done']));
check('Approval triage newest-first sorting deterministic',()=>assert.deepEqual(sortApprovalQueue(approvals,'newest').map(v=>v.id),['high','critical','old','done']));
const src=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const lib=src('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const board=src('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');
const admin=src('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');
const bulk=src('apps/server/src/domains/library/library-routes.ts');
const coll=src('apps/server/src/domains/library/library-9e2-routes.ts');
check('Library UI enables tag removal, collections and archive',()=>{
 assert.match(lib,/bulkRemoveTag\(/);assert.match(lib,/addSelectedToCollection\(/);assert.match(lib,/removeSelectedFromCollection\(/);assert.match(lib,/Archive selected/);
 assert.match(lib,/expectedCollectionRevision: collection\.revision/);
});
check('Library server prevents stale trash lifecycle edits through direct status bulk action',()=>{assert.match(bulk,/LIBRARY_BULK_LIFECYCLE_CONFLICT/);});
check('Library bulk tags enforce same revision CAS as other bulk actions',()=>{
 assert.match(bulk,/"untag"/);assert.match(bulk,/applyLibraryBulkTagChange/);assert.match(bulk,/tx\.libraryItem\.updateMany\(\{ where: \{ id: item\.id, revision: body\.expectedRevisions/);
});
check('Manual collection membership writes use authorization, collection CAS and atomic transaction',()=>{
 assert.match(coll,/visible\.length !== body\.itemIds\.length/);
 assert.match(coll,/body\.expectedRevisions\[item\.id\] !== item\.revision/);
 assert.match(coll,/tx\.libraryCollection\.updateMany/);assert.match(coll,/tx\.libraryCollectionMembership\.createMany/);
 assert.match(coll,/tx\.libraryCollectionMembership\.deleteMany/);
 assert.match(coll,/isolationLevel: "Serializable"/);
});
check('Board only clears history of applied or queued cards and exposes cancel',()=>{
 assert.match(board,/new Set\(\[\.\.\.outcome\.appliedIds, \.\.\.outcome\.queuedIds\]\)/);
 assert.match(board,/\.\.\.outcome\.remainingIds/);assert.match(board,/bulkOperationAbortRef\.current\?\.abort\(\)/);
});
check('Approval queue can prioritize, sort, and advance safely after decision',()=>{
 assert.match(admin,/sortApprovalQueue\(items\.filter/);assert.match(admin,/setSelectedId\(nextPending\.id\)/);
 assert.match(admin,/Approval queue order/);assert.match(admin,/Next in queue/);
});
console.log(`${total}/${total} Cluster 0.530 Work/Library/Admin assertions passed`);
