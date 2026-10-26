import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copyClusterText } from '../../packages/renderer/src/core/clipboard.ts';

const root = resolve(import.meta.dirname, '../..');
const src = (file) => readFileSync(resolve(root, file), 'utf8');
const tests = [];
const test = (label, body) => tests.push([label, body]);
const savedWindow = globalThis.window;
const savedNavigator = globalThis.navigator;
const setBrowser = (desktop, write) => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: desktop ? { clusterDesktop: { writeClipboardText: desktop } } : {} });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: write ? { clipboard: { writeText: write } } : {} });
};
const paths = [
  'components/PersonSummary.tsx', 'components/PresenceAvatar.tsx',
  'features/people/PeoplePages.tsx', 'features/auth/AuthScreens.tsx',
  'features/settings/ServerConfigPage.tsx', 'features/settings/StudioApplicationsPanel.tsx',
  'features/admin/AdminWorkspacePage.tsx', 'features/projects/CloseoutPortalPanel.tsx',
];
const renderer = (name) => src(`packages/renderer/src/${name}`);

test('Native success is respected without a redundant browser call', async () => {
  let native = 0, browser = 0;
  setBrowser(async () => { native++; return true; }, async () => { browser++; });
  assert.equal(await copyClusterText('secret-a'), true);
  assert.equal(native, 1); assert.equal(browser, 0);
});
test('Native explicit false correctly falls back to browser clipboard', async () => {
  let written = '';
  setBrowser(async () => false, async (text) => { written = text; });
  assert.equal(await copyClusterText('secret-b'), true);
  assert.equal(written, 'secret-b');
});
test('Native throw correctly falls back to browser clipboard', async () => {
  let written = false;
  setBrowser(async () => { throw Error('not available'); }, async () => { written = true; });
  assert.equal(await copyClusterText('value'), true); assert.equal(written, true);
});
test('Both unavailable or failing return false, never fake success', async () => {
  setBrowser(async () => false, async () => { throw Error('permission blocked'); });
  assert.equal(await copyClusterText('secret-c'), false);
  setBrowser(null, null);
  assert.equal(await copyClusterText('secret-c'), false);
});
test('Empty clipboard requests do not call any delivery provider', async () => {
  let count = 0;
  setBrowser(async () => {count++; return true;}, async () => {count++;});
  assert.equal(await copyClusterText(''), false);assert.equal(count,0);
});
test('Shared copy button has immediate synchronous guard and pending state', () => {
  const code = renderer('components/ClusterCopyButton.tsx');
  for (const part of ['lock.current = true', 'if (lock.current || disabled || !text) return', 'busy={pending}', 'copyClusterText(text)', 'role={feedback === "failed" ? "alert" : "status"}']) assert.ok(code.includes(part), part);
});
test('Secret value changes invalidate late copy results and old success', () => {
  const code = renderer('components/ClusterCopyButton.tsx');
  assert.match(code, /generation\.current \+= 1;/);
  assert.match(code, /if \(request === generation\.current\) setFeedback/);
  assert.match(code, /\[text\]/);
  assert.doesNotMatch(code, /console\.|localStorage|sessionStorage|\btrackEvent\(|\bemitAnalytics\(/);
});
test('Sensitive auth and admin copy surfaces share feedback and no raw browser copy', () => {
  for (const file of paths) {
    const code = renderer(file);
    assert.ok(code.includes('ClusterCopyButton'), `missing canonical copy control: ${file}`);
    assert.doesNotMatch(code, /navigator\.clipboard\?\.writeText/, `unsafe direct clipboard: ${file}`);
  }
});
test('One-time codes, credentials, and partner links copy through the shared control', () => {
  const auth = renderer('features/auth/AuthScreens.tsx');
  const server = renderer('features/settings/ServerConfigPage.tsx');
  const people = renderer('features/people/PeoplePages.tsx');
  const closeout = renderer('features/projects/CloseoutPortalPanel.tsx');
  assert.match(auth, /<ClusterCopyButton text=\{recoveryCodes\.join\("\\n"\)\}/);
  for (const needle of ['credentialSecret.value','webhookSecret.value']) assert.ok(server.includes(`<ClusterCopyButton text={${needle}}`));
  assert.ok(people.includes('<ClusterCopyButton text={issuedCredential.temporaryPassword}'));
  assert.ok(closeout.includes('<ClusterCopyButton text={newShareUrl}'));
});
test('Data table announces copy failure rather than incorrectly reporting success', () => {
  const code=renderer('components/ClusterDataTable.tsx');
  assert.match(code, /const copied = await copyClusterText/);
  assert.match(code, /setClipboardStatus\(copied \?/);
  assert.match(code, /\.then\(\(copied\) => setClipboardStatus\(copied \?/);
});
test('Previous shell and People identity contracts remain in source', () => {
  const tabs=renderer('features/application/modules/ApplicationProjectTabs.tsx');
  const avatar=renderer('components/PresenceAvatar.tsx');
  for(const part of ['My Work','Tickets']) assert.ok(tabs.includes(part), part);
  for(const part of ['accentColor','data-status']) assert.ok(avatar.includes(part), part);
});
let passed=0;
try {
  for(const [label,fn] of tests){await fn();passed++;console.log('PASS',label);}
} finally {
  if(savedWindow===undefined) delete globalThis.window;else Object.defineProperty(globalThis,'window',{configurable:true,value:savedWindow});
  if(savedNavigator===undefined) delete globalThis.navigator;else Object.defineProperty(globalThis,'navigator',{configurable:true,value:savedNavigator});
}
console.log(`TD3 PASS26 ${passed}/${tests.length} passed`);
