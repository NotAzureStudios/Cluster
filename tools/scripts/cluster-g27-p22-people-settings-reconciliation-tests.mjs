import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); } })();
const read = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/core/post-commit-reconciliation.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports });
const { reconcileAfterCommit } = module.exports;
let total = 0;
async function test(label, callback) { await callback(); total++; console.log('PASS ' + label); }
const page = read('packages/renderer/src/features/people/PeoplePages.tsx');
const account = read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
const studio = read('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
await test('Committed view refresh returns null only when its follow-up succeeded', async () => {
  let calls = 0;
  assert.equal(await reconcileAfterCommit(async () => { calls++; }), null);
  assert.equal(calls, 1);
});
await test('Rejected follow-up read becomes a warning instead of escaping', async () => {
  assert.equal(await reconcileAfterCommit(async () => { throw new Error('permission refreshed'); }), 'permission refreshed');
});
await test('Non-error follow-up failure does not escape or misstate server commit', async () => {
  assert.equal(await reconcileAfterCommit(async () => { throw null; }), 'The follow-up operation did not complete.');
});
await test('Empty error messages produce a useful warning', async () => {
  assert.equal(await reconcileAfterCommit(async () => { throw new Error(''); }), 'The follow-up operation did not complete.');
});
await test('Async committed follow-up failure is caught after suspension', async () => {
  const result = await reconcileAfterCommit(async () => { await Promise.resolve(); throw Error('disk unavailable'); });
  assert.equal(result, 'disk unavailable');
});
await test('Background person events refresh current selection, not event actor', () => {
  assert.match(page, /subscribeClusterCohesionEvent<Partial<ClusterPersonSummary>>\(CLUSTER_PERSON_CHANGED_EVENT, \(\) => \{/);
  assert.match(page, /loadProfiles\(activeProfileIdRef\.current, true\)\.catch/);
  assert.doesNotMatch(page, /loadProfiles\(changed\.id/);
});
await test('Selection cancels stale directory and profile requests before showing new person', () => {
  const select = page.slice(page.indexOf('  async function selectProfile('), page.indexOf('  const restorePersonDetail', page.indexOf('  async function selectProfile(')));
  assert.match(select, /\+\+peopleLoadSequenceRef\.current/);
  assert.match(select, /\+\+profileRequestSequenceRef\.current/);
  assert.match(select, /setProfile\(null\)/);
  assert.match(select, /setProfileCalendar\(\[\]\)/);
  assert.match(select, /sequence !== profileRequestSequenceRef\.current \|\| activeProfileIdRef\.current !== userId/);
  assert.match(page, /if \(sequence !== peopleLoadSequenceRef\.current\) return/);
});
await test('Calendar results and failures cannot overwrite a newer selection', () => {
  const cal = page.slice(page.indexOf('  async function loadProfileCalendar('), page.indexOf('  useEffect(() => {\n    if (profileView !== "calendar"'));
  assert.match(cal, /const sequence = \+\+calendarRequestSequenceRef\.current/);
  assert.match(cal, /setProfileCalendar\(\[\]\)/);
  assert.match(cal, /activeProfileIdRef\.current === userId\) setProfileCalendar\(result\)/);
  assert.match(cal, /activeProfileIdRef\.current === userId\) throw error/);
  assert.match(cal, /sequence === calendarRequestSequenceRef\.current\) setProfileCalendarLoading\(false\)/);
});
await test('Exact People profile, profile switch, and Calendar use fresh server reads', () => {
  assert.equal((page.match(/api<PeopleProfilePayload>\(`/g) || []).length, 2);
  assert.equal((page.match(/api\/users\/\$\{encodeURIComponent\(userId\)\}\/profile/g) || []).length, 2);
  assert.match(page, /api<ProfileCalendarEvent\[\]>\(`/);
  assert.doesNotMatch(page, /queryApi<PeopleProfilePayload>/);
  assert.doesNotMatch(page, /queryApi<ProfileCalendarEvent\[\]>/);
});
await test('Identity changes clear credential, profile, Calendar and team context', () => {
  const identityEffect = page.slice(page.indexOf('  // ProfilesPage can remain mounted'), page.indexOf('  const peopleServerGroups'));
  for (const expr of ['setIssuedCredential(null)', 'setProfile(null)', 'setProfileCalendar([])', 'setPeopleContext(null)', 'setWorkforceContext(null)', '++peopleLoadSequenceRef.current']) assert.ok(identityEffect.includes(expr), expr);
  assert.match(identityEffect, /\}, \[currentUser\.id\]\)/);
});
await test('Creation and password reset distinguish committed success from refresh failure', () => {
  const create = page.slice(page.indexOf('  async function createPersonAccount('), page.indexOf('  async function issuePasswordResetForProfile('));
  assert.match(create, /await api<PeopleProfilePayload & \{ temporaryPassword: string \}>\("\/api\/users"/);
  assert.match(create, /setIssuedCredential\(\{ username: created\.username, temporaryPassword: created\.temporaryPassword \}\)/);
  assert.match(create, /reconcileAfterCommit\(\(\) => loadProfiles\(created\.id, true, true\)\)/);
  const reset = page.slice(page.indexOf('  async function issuePasswordResetForProfile('), page.indexOf('  async function setProfileAccountState('));
  assert.match(reset, /await api<\{ ok: boolean; username: string; temporaryPassword: string \}>/);
  assert.match(reset, /reconcileAfterCommit\(async \(\) =>/);
  assert.match(reset, /Password reset succeeded, but profile refresh failed/);
});
await test('Every team writer uses shared committed read reconciliation', () => {
  for (const name of ['toggleTeamBundle', 'createTeam', 'toggleTeamMember', 'patchTeamMember', 'archiveTeam']) {
    const begin = page.indexOf('  async function ' + name + '(');
    assert.ok(begin !== -1, name);
    const end = page.indexOf('  async function ', begin + 20);
    const block = page.slice(begin, end < 0 ? undefined : end);
    assert.match(block, /await refreshPeopleAfterCommit\(/, name);
  }
  assert.match(page, /const warning = await reconcileAfterCommit\(\(\) => loadProfiles\(activeProfileIdRef\.current, true\)\)/);
});
await test('Account settings switch account source and cancel pending old account draft timers', () => {
  assert.match(account, /\}, \[loadAttempt, currentUser\.id\]\)/);
  assert.match(account, /if \(accountDraftTimer\.current !== null\) window\.clearTimeout\(accountDraftTimer\.current\)/);
  assert.match(account, /preferencesFingerprintRef\.current = null/);
  assert.match(account, /const cleanupWarning = await reconcileAfterCommit\(\(\) => clearOfflineDraft\(accountDraftKey\)\)/);
});
await test('Studio settings switch account source and cannot misstate committed settings on draft cleanup failure', () => {
  assert.match(studio, /\}, \[loadAttempt, currentUser\.id\]\)/);
  assert.match(studio, /if \(studioDraftTimer\.current !== null\) window\.clearTimeout\(studioDraftTimer\.current\)/);
  assert.match(studio, /const cleanupWarning = await reconcileAfterCommit\(\(\) => clearOfflineDraft\(studioDraftKey\)\)/);
  assert.match(studio, /The previous local draft could not be cleared and may reappear/);
});
await test('Account Create uses synchronous admission and scopes one-time credentials to the active session', () => {
  assert.match(page, /if \(!effectiveAdminMode \|\| accountCreateGateRef\.current\) return/);
  assert.match(page, /accountCreateGateRef\.current = true/);
  assert.match(page, /if \(accountScopeRef\.current !== scope\) return; \/\/ Never show another session's credential/);
  assert.match(page, /finally \{ accountCreateGateRef\.current = false/);
  assert.match(page, /if \(accountScopeRef\.current !== scope\) return; \/\/ Response contains a one-time password/);
});
await test('Team mutations share per-team same-frame admission and release', () => {
  assert.match(page, /const teamMutationGateRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(page, /if \(teamMutationGateRef\.current\.has\(teamId\)\) return false/);
  assert.match(page, /teamMutationGateRef\.current\.add\(teamId\)/);
  assert.match(page, /teamMutationGateRef\.current\.delete\(teamId\)/);
  for(const name of ['toggleTeamBundle','toggleTeamMember','patchTeamMember','archiveTeam']) {
    const start=page.indexOf('  async function '+name+'(');assert.ok(start>=0,name);
    const end=page.indexOf('  async function ',start+20);
    const block=page.slice(start,end<0?undefined:end);
    assert.match(block, /beginTeamMutation\(team\.id\)/,name);
    assert.match(block, /finishTeamMutation\(team\.id\)/,name);
  }
});
await test('Create Team blocks repeat clicks and disables pending UI controls', () => {
  assert.match(page, /if \(!name \|\| teamCreateGateRef\.current\) return/);
  assert.match(page, /teamCreateGateRef\.current = true/);
  assert.match(page, /teamCreateGateRef\.current = false/);
  assert.match(page, /disabled=\{teamCreateBusy \|\| !teamNameDraft\.trim\(\)\} busy=\{teamCreateBusy\}/);
  assert.match(page, /disabled=\{busyTeamIds\.has\(team\.id\)\}/);
});
await test('Account and Studio Settings gates admit one save per mounted identity', () => {
  assert.match(account, /const ticket = \{ ownerId: currentUser\.id \}/);
  assert.match(account, /if \(accountSaveGateRef\.current\) return/);
  assert.match(account, /if \(accountSaveOwnerRef\.current !== ticket\.ownerId\) return/);
  assert.match(account, /if \(accountSaveGateRef\.current === ticket\)/);
  assert.match(studio, /if \(saving \|\| studioSaveGateRef\.current\) return/);
  assert.match(studio, /studioSaveGateRef\.current = ticket; \/\/ Admit before awaiting the PIN prompt/);
  assert.match(studio, /if \(!pin \|\| studioSaveOwnerRef\.current !== ticket\.ownerId\) return/);
  assert.match(studio, /if \(studioSaveGateRef\.current === ticket\) studioSaveGateRef\.current = null/);
});
await test('Settings call post-commit UI adapters through guarded follow-ups', () => {
  assert.match(account, /const presentationWarning = await reconcileAfterCommit\(async \(\) =>/);
  assert.match(studio, /const presentationWarning = await reconcileAfterCommit\(async \(\) =>/);
  assert.match(studio, /if \(studioSaveOwnerRef\.current !== ticket\.ownerId\) return/);
  assert.match(account, /if \(accountSaveOwnerRef\.current !== ticket\.ownerId\) return/);
});
console.log(`${total}/${total} G27 P22 People and Settings tests passed`);
