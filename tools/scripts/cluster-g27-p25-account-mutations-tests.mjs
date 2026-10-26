import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const account = readFileSync(new URL('../../packages/renderer/src/features/settings/AccountSettingsPage.tsx', import.meta.url), 'utf8');
let count = 0;
function test(label, fn) { fn(); console.log('PASS ' + label); count++; }
function body(name) {
  const start = account.indexOf('  async function ' + name + '(');
  assert.ok(start > 0, `${name} function exists`);
  const end = account.indexOf('\n  async function ', start + 14);
  const other = account.indexOf('\n  function ', start + 14);
  const cutoff = Math.min(...[end, other].filter(x => x >= 0));
  return account.slice(start, Number.isFinite(cutoff) ? cutoff : undefined);
}
test('Profile Save uses synchronous single-flight lock before awaited API request', () => {
  assert.match(body('saveProfile'), /if \(profileSaveGateRef\.current\) return;[\s\S]*?profileSaveGateRef\.current = ticket;[\s\S]*?await api/);
});
test('Profile Save invalidates a pending profile refresh', () => {
  assert.match(body('saveProfile'), /securityRequestsRef\.current\.invalidate\("profile-refresh"\)/);
});
test('Profile Save does not mistake a local UI callback failure for a failed server save', () => {
  assert.match(body('saveProfile'), /setProfileDirty\(false\);[\s\S]*?reconcileAfterCommit\(\(\) => onUserUpdated\(result\.user\)\)/);
});
test('Profile Save discards stale identity responses', () => {
  assert.match(body('saveProfile'), /if \(!securityRequestsRef\.current\.isCurrent\(ticket\)\) return/);
  assert.match(body('saveProfile'), /if \(profileSaveGateRef\.current === ticket\)/);
});
test('Profile reload is latest-only and account-scoped', () => {
  assert.match(body('reloadProfileFromServer'), /begin\("profile-refresh"\)/);
  assert.match(body('reloadProfileFromServer'), /if \(!securityRequestsRef\.current\.isCurrent\(ticket\)\) return/);
});
test('Avatar conversion checks account before remote write and UI update', () => {
  const avatar = body('uploadProfileAvatar');
  assert.match(avatar, /if \(avatarUploadGateRef\.current\) return/);
  assert.match(avatar, /await readProfileImageAsDataUrl\(file\);\s*if \(!securityRequestsRef\.current\.isCurrent\(ticket\)\) return/);
  assert.match(avatar, /await api<[^>]+>/);
  assert.match(avatar, /const warning = await reconcileAfterCommit/);
});
test('Session revocation locks at invocation and reports HTTP failures', () => {
  for (const name of ['revokePersonalSession', 'revokeOtherPersonalSessions']) {
    const fn = body(name);
    assert.match(fn, /if \(sessionActionGateRef\.current\) return/);
    assert.match(fn, /sessionActionGateRef\.current = ticket/);
    assert.match(fn, /!securityRequestsRef\.current\.isCurrent\(ticket\)/);
    assert.match(fn, /catch \(error\)/);
  }
});
test('Session revocation rechecks identity after confirmation before POST', () => {
  assert.match(body('revokeOtherPersonalSessions'), /if \(!approved \|\| !securityRequestsRef\.current\.isCurrent\(ticket\)\) return;\s*const result = await api/);
});
test('Device actions do not race and remain scoped to an owner', () => {
  for (const name of ['saveDeviceLabel','rotateCurrentDeviceProof','revokePersonalDevice']) {
    const fn = body(name);
    assert.match(fn, /deviceActionGateRef\.current/);
    assert.match(fn, /!securityRequestsRef\.current\.isCurrent\(ticket\)/);
    assert.match(fn, /finally \{/);
  }
});
test('Security device proof cannot be sent following account switch', () => {
  assert.match(body('rotateCurrentDeviceProof'), /const payload = await createDeviceProofRotationPayload\(device\.deviceId\);\s*if \(!securityRequestsRef\.current\.isCurrent\(ticket\)\) return;\s*const result = await api/);
});
test('Switching account clears mutation gates and old in-memory private profile', () => {
  assert.match(account, /profileSaveGateRef\.current = null;[\s\S]*?avatarUploadGateRef\.current = null;[\s\S]*?sessionActionGateRef\.current = null;[\s\S]*?deviceActionGateRef\.current = null/);
  assert.match(account, /setProfileForm\(profileFormFromUser\(currentUser\)\)/);
});
console.log(`${count}/${count} G27 P25 profile/device/session checks passed`);
