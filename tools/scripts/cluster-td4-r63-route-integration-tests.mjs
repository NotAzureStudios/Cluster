import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const routes=read('apps/server/src/domains/library/library-routes.ts');
const ui=read('packages/renderer/src/features/library/LibraryGovernancePanel.tsx');
const logic=read('apps/server/src/domains/library/library-disposition.ts');
const old=read('apps/server/src/domains/library/library-destruction.ts');
const schema=read('apps/server/prisma/schema.prisma');
const sql=read('apps/server/prisma/migrations/20261016031500_td4_library_disposition_ledger/migration.sql');
let n=0;function check(label,fn){fn();n++;console.log('PASS',label)}
check('legacy endpoint is retired and old deletion function cannot delete',()=>{assert.doesNotMatch(routes,/app.delete\("\/api\/library\/:itemId\/permanent"/);assert.doesNotMatch(old,/libraryItem\.delete/);assert.match(old,/LIBRARY_DISPOSITION_REVIEW_REQUIRED/)});
check('all disposition routes authorize manage access',()=>{
 for(const route of ['app.get("/api/library/:itemId/disposition"','app.post("/api/library/:itemId/disposition"','app.post("/api/library/:itemId/disposition/cancel"']){
  const at=routes.indexOf(route);assert.ok(at>=0,route);const end=routes.indexOf('\n  });',at);const block=routes.slice(at,end);assert.match(block,/findAccessibleItem\(request, reply, params.itemId, "manage"\)/);
 }
});
check('request and cancellation are serializable transactional mutations',()=>{
 assert.match(routes,/tx: any\) => requestLibraryDisposition\(tx/);assert.match(routes,/tx: any\) => cancelLibraryDisposition\(tx/);assert.match(routes,/isolationLevel: "Serializable"/);
});
check('preview rehydrates current evidence and blocks physical destruction',()=>{
 assert.match(routes,/inspectLibraryDisposition\(prisma, params.itemId\)/);
 assert.match(routes,/reviewLibraryDisposition\(prisma, params.itemId\)/);
 assert.match(routes,/physicalDisposalAllowed: false/);
});
check('restore cancels pending request in same transaction as item update',()=>{
 const a=routes.indexOf('app.post("/api/library/:itemId/restore"');const b=routes.indexOf('app.get("/api/library/:itemId/destruction-preview"',a);const block=routes.slice(a,b);assert.match(block,/cancelLibraryDisposition\(tx/);assert.match(block,/tx.libraryItem.update/);assert.match(block,/isolationLevel: "Serializable"/);
});
check('retention relaxation requires admin and audit reason',()=>{
 const a=routes.indexOf('app.put("/api/library/:itemId/retention"');const b=routes.indexOf('// Disposition is staged',a);const block=routes.slice(a,b);
 assert.match(block,/RETENTION_OVERRIDE_ADMIN_REQUIRED/);assert.match(block,/RETENTION_OVERRIDE_REASON_REQUIRED/);
 assert.match(block,/revision: body.expectedRevision/);assert.match(block,/tx.activityEvent.create/);
});
check('published releases are independently checked beyond backlinks',()=>{
 assert.match(logic,/tx.packetRelease.count/);assert.match(logic,/PUBLISHED_RELEASE_REFERENCE/);assert.match(logic,/BACKLINKS_PRESENT/);
});
check('source versions and derivatives remain referenced and intact',()=>{
 assert.match(logic,/tx.libraryVersion.count/);assert.match(logic,/tx.libraryDerivative.count/);assert.doesNotMatch(logic,/\.(?:deleteMany|delete)\(/);
});
check('restore window blocks early review and no physical disposal permit generated',()=>{
 assert.match(logic,/LIBRARY_DISPOSITION_RESTORE_DAYS = 30/);assert.match(logic,/RESTORE_WINDOW_ACTIVE/);assert.match(logic,/physicalDisposalAllowed: false/);
});
check('DB constrains concurrent pending requests and append-only evidence',()=>{
 assert.match(sql,/one_pending_per_item/);assert.match(sql,/WHERE "status" = 'PENDING_REVIEW'/);assert.match(sql,/BEFORE UPDATE OR DELETE ON "LibraryDispositionEvidence"/);
 assert.match(schema,/model LibraryDispositionRequest/);assert.match(schema,/model LibraryDispositionEvidence/);
});
check('UI requires reason and title and exposes cancellation with safe messaging',()=>{
 assert.match(ui,/expectedValue: item.title/);assert.match(ui,/reason.trim\(\)/);
 assert.match(ui,/disposition\/cancel/);assert.match(ui,/No physical file deletion is enabled/);assert.doesNotMatch(ui,/\/permanent/);
});
check('route never acknowledges backlinks as bypass',()=>assert.doesNotMatch(routes.slice(routes.indexOf('app.post("/api/library/:itemId/disposition"'),routes.indexOf('app.patch("/api/library/:itemId"')),/acknowledgeBacklinks/));
console.log(`R63 route/UX/migration checks ${n}/${n}`);
