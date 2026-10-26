import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireReviewedOffboardingRevision } from '../../apps/server/src/domains/studio-systems/studio-offboarding-revisions.ts';
const src = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const contracts = src('packages/shared/src/studio-systems-contracts.ts');
const server = src('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts');
const ui = src('packages/renderer/src/features/settings/StudioOffboardingPanel.tsx');
const onbServer = src('apps/server/src/domains/studio-systems/studio-onboarding-routes.ts');
const onbUI = src('packages/renderer/src/features/settings/StudioOnboardingPanel.tsx');
const onbPublication = src('apps/server/src/domains/studio-systems/studio-onboarding-publication.ts');
let checks = 0;
function check(label, run) { run(); checks++; console.log(`PASS ${label}`); }
function expectsStale(value) { assert.throws(value, (error) => error?.code === 'OFFBOARDING_CASE_STALE' && error?.statusCode === 409); }
check('Matching reviewed revision is permitted', () => assert.equal(requireReviewedOffboardingRevision({ revision: 7 },7), undefined));
check('Stale revision blocked before consequential operations', () => expectsStale(() => requireReviewedOffboardingRevision({ revision: 8 },7)));
check('Future revision cannot be used', () => expectsStale(() => requireReviewedOffboardingRevision({ revision: 8 },9)));
check('Noninteger / missing revision cannot be used', () => { for (const n of [0,-1,NaN,1.1,undefined,Number.MAX_SAFE_INTEGER+1]) expectsStale(() => requireReviewedOffboardingRevision({revision:8},n)); });
check('All three destructive offboarding API inputs require revision', () => {
 for (const name of ['Equipment','Execute','Cancel']) {
   const section = contracts.match(new RegExp(`studioOffboarding${name}Schema = z\\.object\\(\\{([\\s\\S]*?)\\}\\)`))?.[1];
   assert.ok(section?.includes('expectedRevision: z.number().int().positive()'),name);
 }
});
check('Server rejects stale admin views for equipment, completion and cancellation', () => assert.equal((server.match(/requireReviewedOffboardingRevision\(current, body\.expectedRevision\);/g)||[]).length,3));
check('Backend response publishes the revision from canonical case', () => assert.match(server,/revision: row\.revision/));
check('Conditional DB revision claim remains within each transaction', () => {
 assert.match(server,/where: \{ id: current\.id, revision: current\.revision, status: current\.status \}/);
 assert.equal((server.match(/await claimOffboardingRevision\(tx, current/g)||[]).length,3);
});
check('Concurrent case creation serializes on canonical subject record', () => {
 const section = server.slice(server.indexOf('app.post("/api/studio-systems/offboarding"'),server.indexOf('app.patch("/api/studio-systems/offboarding/:caseId/equipment"'));
 const transaction = section.slice(section.indexOf('const created = await prisma.$transaction'));
 assert.match(transaction,/tx\.\$queryRaw`SELECT "id" FROM "User" WHERE "id" = \$\{subject\.id\} FOR UPDATE`/);
 assert.ok(transaction.indexOf('FOR UPDATE') < transaction.indexOf('tx.studioOffboardingCase.findFirst'));
 assert.ok(transaction.indexOf('tx.studioOffboardingCase.findFirst') < transaction.indexOf('tx.personnelRecord.create'));
 assert.match(transaction,/OFFBOARDING_CASE_ACTIVE/);
});
check('UI submits exact reviewed revisions for equipment, completion, cancellation', () => {
 assert.equal((ui.match(/expectedRevision: item\.revision/g)||[]).length,3);
});
check('UI contains accessible cancellation reason, explicit confirmation and retained draft', () => {
 assert.match(ui,/aria-label="Offboarding cancellation reason"/);
 assert.match(ui,/onClick=\{\(\) => void cancelPendingCase\(\)\}/);
 assert.match(ui,/disabled=\{busy \|\| !cancelReason\.trim\(\)\}/);
 assert.match(ui,/const explanation = cancelReason\.trim\(\)/);
});
check('UI does not accidentally replay an uncertain offboarding mutation', () => {
 assert.match(ui,/retryActionRef\.current = readOnly/);
 assert.match(ui,/void retryCommittedRefresh\(\)/);
});
check('Onboarding retries never automatically replay ambiguous writes', () => {
 assert.match(onbUI,/retryActionRef\.current = readOnly/);
 assert.match(onbUI,/void retryCommittedRefresh\(\)/);
 assert.match(onbUI,/actionInFlightRef\.current = true/);
});
check('Onboarding progress report stays safely retryable as a read', () => assert.match(onbUI,/await runAction\(`report:\$\{versionId\}`, "Loading onboarding progress…", execute, \(\) => undefined, true\);/));
check('Onboarding publishing uses the same transaction for assignment and status', () => {
 const section = onbServer.slice(onbServer.indexOf('app.post("/api/studio-systems/onboarding/:planId/versions"'), onbServer.indexOf('app.post("/api/studio-systems/onboarding/versions/:versionId/assign"'));
 assert.match(section,/commitStudioOnboardingPublication\(prisma/);
 assert.match(onbPublication,/tx\.\$queryRaw`SELECT "id" FROM "StudioOnboardingPlan"/);
 assert.match(onbPublication,/createStudioOnboardingAssignments\(tx, created, userIds/);
 assert.match(onbPublication,/tx\.studioOnboardingAssignment\.updateMany/);
 assert.match(onbPublication,/tx\.studioOnboardingPlan\.update/);
 assert.doesNotMatch(onbPublication,/createStudioOnboardingAssignments\(prisma, created/);
});
check('Onboarding rejects duplicate resource references on publish', () => {
 assert.match(contracts,/const key = `\$\{step\.kind\}:\$\{step\.resourceId\}`/);
 assert.match(contracts,/An onboarding resource can appear only once/);
});
check('Onboarding step editor can reorder and prevents duplicates', () => {
 assert.match(onbUI,/function moveStep\(index: number, direction: -1 \| 1\)/);
 assert.match(onbUI,/step\.kind === newStep\.kind && step\.resourceId === newStep\.resourceId/);
 assert.match(onbUI,/moveStep\(index, -1\)/);
 assert.match(onbUI,/moveStep\(index, 1\)/);
});
console.log(`Cluster v0.538 People lifecycle closeout: ${checks}/${checks} checks passed`);
