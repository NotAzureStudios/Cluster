import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applicationReviewWhere, applicationConversionWhere } from '../../apps/server/src/domains/studio-systems/studio-application-revisions.ts';
const read = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
let checks = 0;
function check(name, callback) { callback(); checks++; console.log(`PASS ${name}`); }
const before = '2026-10-10T13:00:00.000Z';
const after = '2026-10-10T13:00:01.000Z';
const initial = { id: 'app1', status: 'submitted', convertedUserId: null, updatedAt: new Date(before) };
const same = (record, where) => record.id === where.id && record.updatedAt.getTime() === where.updatedAt.getTime() && record.convertedUserId === where.convertedUserId && (typeof where.status === 'string' ? record.status === where.status : where.status.in.includes(record.status));
check('Review uses explicit application revision and not a pre-read-only guard', () => {
  const predicate = applicationReviewWhere('app1', before);
  assert.equal(predicate.id, 'app1'); assert.equal(predicate.updatedAt.toISOString(), before);
  assert.equal(same(initial, predicate), true);
});
check('Two admins reviewing the same revision cannot both claim it', () => {
  const record = { ...initial };
  const first = applicationReviewWhere('app1', before), second = applicationReviewWhere('app1', before);
  assert.equal(same(record, first), true);
  record.status = 'approved'; record.updatedAt = new Date(after);
  assert.equal(same(record, second), false);
});
check('Converted applications can never be reopened for review', () => {
  assert.equal(same({ ...initial, status: 'converted', convertedUserId: 'user1' }, applicationReviewWhere('app1', before)), false);
  assert.equal(same({ ...initial, convertedUserId: 'user1' }, applicationReviewWhere('app1', before)), false);
});
check('Conversion requires the exact reviewed approved revision', () => {
  const claim = applicationConversionWhere('app1', after);
  assert.equal(same({ ...initial, status: 'approved', updatedAt: new Date(after) }, claim), true);
  assert.equal(same({ ...initial, status: 'rejected', updatedAt: new Date(after) }, claim), false);
  assert.equal(same({ ...initial, status: 'approved' }, claim), false);
  assert.equal(same({ ...initial, status: 'approved', convertedUserId: 'person1', updatedAt: new Date(after) }, claim), false);
});
const contracts = read('packages/shared/src/studio-systems-contracts.ts');
const server = read('apps/server/src/domains/studio-systems/studio-workflow-routes.ts');
const ui = read('packages/renderer/src/features/settings/StudioApplicationsPanel.tsx');
const admin = read('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');
check('Both request contracts require date-time revision', () => {
  assert.match(contracts,/studioApplicationReviewSchema = z\.object\(\{\s*expectedUpdatedAt: z\.string\(\)\.datetime/);
  assert.match(contracts,/studioApplicationConversionSchema = z\.object\(\{\s*expectedUpdatedAt: z\.string\(\)\.datetime/);
});
check('API response includes revision used for optimistic update', () => assert.match(server,/status: submission\.status, updatedAt: submission\.updatedAt/));
check('Review server performs atomic, conditional update and rejects a lost race', () => {
  assert.match(server,/studioFormSubmission\.updateMany\(\{\s*where: applicationReviewWhere\(submission\.id, body\.expectedUpdatedAt\)/);
  assert.match(server,/changed\.count !== 1/);
  assert.match(server,/APPLICATION_REVIEW_STALE/);
  assert.match(server,/studioFormSubmission\.findUniqueOrThrow/);
});
check('Conversion transaction conditionally claims same approved revision', () => {
  assert.match(server,/tx\.studioFormSubmission\.updateMany\(\{ where: applicationConversionWhere\(submission\.id, body\.expectedUpdatedAt\)/);
  assert.match(server,/if \(!claim\.count\) throw/);
  assert.match(server,/APPLICATION_CONVERSION_CONFLICT/);
});
check('UI sends captured updatedAt on both review and conversion', () => {
  assert.match(ui,/expectedUpdatedAt: application\.updatedAt/g);
  assert.equal((ui.match(/expectedUpdatedAt: application\.updatedAt/g)||[]).length,2);
});
check('Review and convert synchronously coalesce repeated clicks', () => {
  assert.match(ui,/mutationRef\.current = true; setBusyAction\("review"\)/);
  assert.match(ui,/mutationRef\.current = true; setBusyAction\("convert"\)/);
  assert.equal((ui.match(/mutationRef\.current = false; setBusyAction\(""\)/g)||[]).length,2);
});
check('Applicant profile mappings must be explicitly selected', () => { assert.match(ui, /setSelectedFields\(\[\]\)/); assert.match(ui, /none are preselected/); });
check('Application page keeps last known list after a failed refresh', () => {
  const failure = ui.slice(ui.indexOf('} catch (error) {'), ui.indexOf('} finally {', ui.indexOf('} catch (error) {')));
  assert.doesNotMatch(failure,/setApplications\(\[\]\)/);
  assert.match(ui,/generation === loadGenerationRef\.current/);
});
check('Generated credentials remain out of persistent status messages', () => {
  assert.doesNotMatch(ui,/setStatus\([^\n]*temporaryPassword/);
  assert.match(ui,/setCredential\(\{ id: result\.user\.id, username: result\.user\.username, password: result\.temporaryPassword/);
  assert.match(ui,/onClick=\{\(\) => setCredential\(null\)\}>Dismiss credentials/);
  assert.match(ui, /<ClusterCopyButton text=\{credential\.password\}/);
});
check('Conversion is explicitly confirmed and cannot be repeated for converted applications', () => {
  assert.match(ui,/title: "Create member account\?"/);
  assert.match(ui,/selected\.status !== "approved" \|\| selected\.convertedUserId/);
  assert.match(ui,/selected\.status !== "converted" && <div className="button-row"/);
});
check('Approval list retains known entries on failed refresh', () => {
  const err = admin.slice(admin.indexOf('} catch (loadError) {'), admin.indexOf('} finally {', admin.indexOf('} catch (loadError) {')));
  assert.doesNotMatch(err,/setItems\(\[\]\)/);
  assert.match(admin,/setItems\(\(current\) => current\.map\(\(entry\) => entry\.id === item\.id/);
});
const offboarding = read('packages/renderer/src/features/settings/StudioOffboardingPanel.tsx');
const offboardingServer = read('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts');
check('Offboarding uses synchronous in-flight lock on consequential actions', () => {
  assert.match(offboarding,/actionInFlightRef = useRef\(false\)/);
  assert.match(offboarding,/if \(actionInFlightRef\.current\) return;/);
  assert.match(offboarding,/actionInFlightRef\.current = true/);
  assert.match(offboarding,/actionInFlightRef\.current = false/);
});
check('Ambiguous offboarding mutation result reconciles instead of resubmitting', () => {
  assert.match(offboarding,/retryActionRef\.current = readOnly/);
  assert.match(offboarding,/void retryCommittedRefresh\(\)/);
  assert.match(offboarding,/readOnly = false/);
  assert.match(offboarding,/Impact preview refreshed from live authorities/);
});
check('Offboarding revision CAS happens inside transaction before side effects', () => {
  assert.match(offboardingServer,/async function claimOffboardingRevision\(/);
  assert.match(offboardingServer,/where: \{ id: current\.id, revision: current\.revision, status: current\.status \}/);
  assert.match(offboardingServer,/changed\.count !== 1/);
  assert.match(offboardingServer,/OFFBOARDING_CASE_STALE/);
  assert.match(offboardingServer,/await claimOffboardingRevision\(tx, current, "active"\);/);
  assert.equal((offboardingServer.match(/await claimOffboardingRevision\(tx, current\);/g)||[]).length,2);
});
console.log(`Cluster 0.537 People/Admin closeout: ${checks}/${checks} passed`);
