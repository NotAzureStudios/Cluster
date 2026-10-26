import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const read = name => readFileSync(new URL('../../'+name, import.meta.url), 'utf8');
const authorityCode = read('packages/renderer/src/features/settings/account-request-authority.ts');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(authorityCode, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports });
const { AccountRequestAuthority } = module.exports;
let checks = 0;
function check(label, fn) { fn(); ++checks; console.log('PASS ' + label); }

check('first sessions read is current', () => {
  const state = new AccountRequestAuthority('member-a');
  assert.equal(state.isCurrent(state.begin('sessions')), true);
});
check('superseding a channel rejects older response', () => {
  const state = new AccountRequestAuthority('member-a');
  const old = state.begin('devices');
  const newer = state.begin('devices');
  assert.equal(state.isCurrent(old), false);
  assert.equal(state.isCurrent(newer), true);
});
check('independent private channels refresh independently', () => {
  const state = new AccountRequestAuthority('member-a');
  const sessions = state.begin('sessions');
  state.begin('devices'); state.begin('mfa-status');
  assert.equal(state.isCurrent(sessions), true);
});
check('owner switch rejects all old private reads', () => {
  const state = new AccountRequestAuthority('member-a');
  const reads = ['sessions', 'devices', 'mfa-status'].map(channel => state.begin(channel));
  assert.equal(state.switchOwner('member-b'), true);
  for (const read of reads) assert.equal(state.isCurrent(read), false);
  assert.equal(state.isCurrent(state.begin('sessions')), true);
});
check('switching back to an earlier owner does not revive old response', () => {
  const state = new AccountRequestAuthority('member-a');
  const old = state.begin('sessions');
  state.switchOwner('member-b'); state.begin('sessions');
  state.switchOwner('member-a');
  assert.equal(state.isCurrent(old), false);
});
check('cleanup invalidates inflight channels, including unchanged owner', () => {
  const state = new AccountRequestAuthority('member-a');
  const old = state.begin('mfa-status');
  state.invalidateAll();
  assert.equal(state.isCurrent(old), false);
  assert.equal(state.switchOwner('member-a'), false);
});
check('individual invalidation does not affect other channels', () => {
  const state = new AccountRequestAuthority('member-a');
  const sessions = state.begin('sessions');
  const devices = state.begin('devices');
  state.invalidate('sessions');
  assert.equal(state.isCurrent(sessions), false);
  assert.equal(state.isCurrent(devices), true);
});

const account = read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
check('account identity changes re-run and dispose security data readers', () => {
  assert.match(account, /securityRequestsRef\.current\.switchOwner\(currentUser\.id\)/);
  assert.match(account, /setPersonalSessions\(\[\]\);[\s\S]*?setPersonalDevices\(\[\]\);[\s\S]*?setDeviceLabels\(\{\}\)/);
  assert.match(account, /setMfaEnrollment\(null\);[\s\S]*?setMfaCode\(""\);[\s\S]*?setMfaRecoveryCodes\(\[\]\)/);
  assert.match(account, /return \(\) => securityRequestsRef\.current\.invalidateAll\(\)/);
  assert.match(account, /\}, \[currentUser\.id\]\)/);
});
check('initial and refresh session readers admit only current responses', () => {
  assert.match(account, /const ticket = securityRequestsRef\.current\.begin\("sessions"\)/);
  assert.match(account, /if \(securityRequestsRef\.current\.isCurrent\(ticket\)\) setPersonalSessions\(result\.sessions \|\| \[\]\)/);
});
check('device-key processing stops when account or reader changes', () => {
  assert.match(account, /const ticket = securityRequestsRef\.current\.begin\("devices"\)/);
  const body = account.slice(account.indexOf('  async function loadPersonalDevices()'), account.indexOf('  async function saveDeviceLabel('));
  assert.ok((body.match(/if \(!securityRequestsRef\.current\.isCurrent\(ticket\)\) return;/g) || []).length >= 3);
  assert.match(body, /setDeviceLabels\(Object\.fromEntries/);
});
check('MFA read errors do not impersonate disabled MFA', () => {
  assert.match(account, /const ticket = securityRequestsRef\.current\.begin\("mfa-status"\)/);
  assert.match(account, /setMfaStatusLoaded\(false\);[\s\S]*?MFA status could not be verified/);
  assert.match(account, /!mfaStatusLoaded \? "Unavailable"/);
});
check('a new identity cannot render prior MFA secrets or session lists', () => {
  assert.match(account, /securityViewOwner === currentUser\.id \? <>/);
  assert.match(account, /Loading security information for the current account/);
});
check('all MFA writers use immediate mutation gate', () => {
  for (const name of ['enrollPasskey', 'removeMfaFactor', 'beginMfaEnrollment', 'verifyMfaEnrollment', 'regenerateMfaRecoveryCodes', 'disableMfa']) {
    const beginning = account.indexOf('  async function ' + name + '(');
    assert.ok(beginning >= 0, `${name} exists`);
    const next = account.indexOf('  async function ', beginning + 15);
    const body = account.slice(beginning, next < 0 ? undefined : next);
    assert.match(body, /beginMfaAction\(\)/, name);
    assert.match(body, /finishMfaAction\(owner\)/, name);
  }
});
check('credential confirmation cannot cross account boundary', () => {
  assert.match(account, /if \(!approved \|\| !isCurrentMfaOwner\(owner\)\) return;/);
  assert.match(account, /if \(!isCurrentMfaOwner\(owner\)\) return;\s*const credential/);
  assert.match(account, /if \(!isCurrentMfaOwner\(owner\)\) return;\s*const result/);
});
console.log(`${checks}/${checks} G27 P24 security lifecycle checks passed`);
