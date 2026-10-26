/** Independent source integration assertions: NOT a live authenticated request. */
import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const routes=read('apps/server/src/domains/library/library-routes.ts');
const domain=read('apps/server/src/domains/library/library-disposition.ts');
const schema=read('apps/server/prisma/schema.prisma');
const sql=read('apps/server/prisma/migrations/20261016051500_td4_disposition_independent_decisions/migration.sql');
const ui=read('packages/renderer/src/features/library/LibraryGovernancePanel.tsx');
let n=0;function test(label,fn){fn();n++;console.log('PASS',label)}
const endpoint=routes.slice(routes.indexOf('app.post("/api/library/:itemId/disposition/decision"'),routes.indexOf('app.post("/api/library/:itemId/disposition/cancel"'));
test('decision mutation has distinct authenticated administrator gate',()=>{assert.match(endpoint,/findAccessibleItem\(request, reply, params.itemId, "manage"\)/);assert.match(endpoint,/decorated\?\.isAdmin/);assert.match(endpoint,/ADMIN_REQUIRED/)});
test('decision accepts finite action set and mandatory audit reason',()=>{assert.match(endpoint,/z\.enum\(\["APPROVE", "REJECT", "REVOKE"\]\)/);assert.match(endpoint,/\.trim\(\)\.min\(12\)\.max\(1000\)/)});
test('review is serializable and CAS revision aware',()=>{assert.match(endpoint,/expectedDecisionRevision/);assert.match(endpoint,/isolationLevel: "Serializable"/);assert.match(domain,/decisionRevision: input.expectedDecisionRevision/);assert.match(domain,/requestDecisionRevision: nextRevision/)});
test('review changes are append-only within same transaction',()=>{assert.match(domain,/tx.libraryDispositionDecision.create/);assert.match(domain,/tx.libraryDispositionEvidence.create/);assert.match(domain,/tx.activityEvent.create/);assert.match(sql,/BEFORE UPDATE OR DELETE ON "LibraryDispositionDecision"/)});
test('one active request covers both approved and pending states',()=>{assert.match(sql,/"status" IN \('PENDING_REVIEW', 'REVIEW_APPROVED'\)/);assert.match(domain,/status: "REVIEW_APPROVED"/)});
test('two-person independent approval and self-review are enforced',()=>{assert.match(domain,/LIBRARY_DISPOSITION_REQUIRED_APPROVERS = 2/);assert.match(domain,/request.requestedById === input.actorId/);assert.match(domain,/approverIds.includes\(input.actorId\)/)});
test('approval verifies restore window snapshot and blockers',()=>{assert.match(domain,/now < new Date\(request.reviewAfter\)/);assert.match(domain,/inspected.blockers.length \|\| inspected.fingerprint !== request.snapshotSha256/)});
test('read path returns current approval state and no-storage authority',()=>{assert.match(routes,/approvalValidNow: review\?\.approvalValidNow/);assert.match(routes,/canApproveDisposition:/);assert.match(routes,/physicalDisposalAllowed: false/)});
test('UI exposes approval/revoke/reject with explicit non-destructive semantics',()=>{assert.match(ui,/decideDisposition\("APPROVE"\)/);assert.match(ui,/decideDisposition\("REVOKE"\)/);assert.match(ui,/decideDisposition\("REJECT"\)/);assert.match(ui,/No physical file deletion is enabled/)});
test('Prisma stores versioned request and immutable chronological decisions',()=>{assert.match(schema,/decisionRevision Int\s+@default\(0\)/);assert.match(schema,/model LibraryDispositionDecision/);assert.match(schema,/@unique\(\[requestId, requestDecisionRevision\]\)/);assert.match(sql,/"snapshotVersion" INTEGER NOT NULL DEFAULT 1/)});
test('physical deletion, filesystem move and quarantine deliberately absent',()=>{assert.doesNotMatch(endpoint,/\b(?:unlink|rename|copyFile|rm|rmdir|deleteMany)\b/);assert.match(domain,/physicalDisposalAllowed: false/)});
test('rejected requests and cancellation are distinct auditable endings',()=>{assert.match(domain,/REVIEW_REJECTED/);assert.match(domain,/status: "CANCELLED"/);assert.match(sql,/'REJECT'/)});
console.log(`R66 routes, UI and schema checks ${n}/${n}`);
