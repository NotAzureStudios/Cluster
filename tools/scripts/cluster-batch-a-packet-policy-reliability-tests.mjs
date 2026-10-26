#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPacketWorkflowGate } from '../../packages/renderer/src/features/packets/packet-workflow-gate.ts';

const base = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const renderer = readFileSync(resolve(base, 'packages/renderer/src/features/packets/PacketsPage.tsx'), 'utf8');
const application = readFileSync(resolve(base, 'packages/renderer/src/features/application/ClusterApplication.tsx'), 'utf8');
let tests = 0;
function check(name, fn) { fn(); console.log('PASS', name); tests++; }
async function checkAsync(name, fn) { await fn(); console.log('PASS', name); tests++; }
const pending = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

await checkAsync('only one mutation enters the gate in a synchronous event cycle', async () => {
  const gate = createPacketWorkflowGate(); const d = pending(); let calls = 0;
  const first = gate.run(() => { calls++; return d.promise; });
  const duplicate = await gate.run(() => { calls++; return Promise.resolve('duplicate'); });
  assert.equal(duplicate.status, 'ignored'); assert.equal(calls, 1); assert.equal(gate.busy(), true);
  d.resolve('committed'); assert.deepEqual(await first, { status: 'committed', value: 'committed' }); assert.equal(gate.busy(), false);
});
await checkAsync('failed HTTP mutations return a failure and release the gate', async () => {
  const gate = createPacketWorkflowGate(); const failure = new Error('401 Forbidden');
  assert.deepEqual(await gate.run(() => Promise.reject(failure)), { status: 'failed', error: failure });
  assert.equal(gate.busy(), false); assert.equal((await gate.run(() => Promise.resolve(3))).status, 'committed');
});
await checkAsync('unmount fences a late committed result and future actions', async () => {
  const gate = createPacketWorkflowGate(); const d = pending(); const action = gate.run(() => d.promise);
  gate.invalidate(); d.resolve({ sensitive: 'previous account data' });
  assert.equal((await action).status, 'ignored');
  assert.equal((await gate.run(() => Promise.resolve('other'))).status, 'ignored');
});
await checkAsync('unmount fences late error and prevents old account feedback', async () => {
  const gate = createPacketWorkflowGate(); const d = pending(); const action = gate.run(() => d.promise);
  gate.invalidate(); d.reject(new Error('old user secret'));
  assert.equal((await action).status, 'ignored');
});
await checkAsync('separate workflow gates do not globally block independent tabs', async () => {
  const first = createPacketWorkflowGate(), second = createPacketWorkflowGate(); const a = pending(), b = pending();
  const one = first.run(() => a.promise), two = second.run(() => b.promise);
  assert.equal(first.busy(), true); assert.equal(second.busy(), true);
  a.resolve('A'); b.resolve('B');
  assert.equal((await one).status, 'committed'); assert.equal((await two).status, 'committed');
});
check('Packets UI remounts for a new authenticated account', () => {
  assert.match(application, /<LazyPacketsPage\s+key=\{activeUser\.id\}\s+currentUser=\{activeUser\}/);
  assert.match(renderer, /policyWriteGate\.current\.invalidate\(\)/);
  assert.match(renderer, /packetWriteGate\.current\.invalidate\(\)/);
});
check('Policy readers discard older successes and failures', () => {
  assert.match(renderer, /const sequence = \+\+policyReadSequence\.current;/);
  assert.match(renderer, /if \(sequence !== policyReadSequence\.current\) return false/);
  assert.match(renderer, /if \(sequence === policyReadSequence\.current\)\s+setPolicyError/);
  assert.match(renderer, /policyReadSequence\.current \+= 1; setPolicyInitials/);
});
check('Policy acceptance is one request per action and applies only to the matching published version', () => {
  assert.match(renderer, /policyWriteGate\.current\.busy\(\)/);
  assert.match(renderer, /policyWriteGate\.current\.run\(\(\) => api/);
  assert.match(renderer, /policy\.policy\.id === policyId && policy\.version\.id === versionId/);
  assert.match(renderer, /blocking: feed\.blocking\.filter\(\(id\) => id !== versionId\)/);
  assert.match(renderer, /Policy acceptance saved\. The policy list could not refresh/);
});
check('Packet author saves do not reinterpret follow-up refresh as a failed write', () => {
  assert.match(renderer, /packetWriteGate\.current\.run\(\(\) => api\(`/);
  assert.match(renderer, /loadPackets\(packetId, true, true\)/);
  assert.match(renderer, /Packet settings saved\. Refresh the Packet catalog/);
  assert.match(renderer, /definitionPending \|\| !definitionDraft\.title/);
});
check('Packet completion and publication are guarded at operation admission', () => {
  assert.match(renderer, /async function completeActivePacket\(\)/);
  assert.match(renderer, /async function completePacketWithForm\(formSubmissionId: string\)/);
  assert.match(renderer, /async function publishActivePacket\(/);
  assert.match(renderer, /packetWriteGate\.current\.busy\(\)\) return/);
  assert.match(renderer, /setReleaseRefreshIndex\(\(index\) => index \+ 1\)/);
});
check('Recipient acknowledgment stays bound to the exact immutable published release', () => {
  assert.match(renderer, /const sequence = releaseCatalogSequence\.current/);
  assert.match(renderer, /expectedManifestSha256: catalog\.manifestSha256/);
  assert.match(renderer, /expectedVersionLabel: catalog\.versionLabel/);
  assert.match(renderer, /if \(sequence === releaseCatalogSequence\.current\)/);
});
check('Revocation immediately invalidates stale recipient downloads', () => {
  assert.match(renderer, /if \(outcome\.status === "committed"\) \{\s+\/\/ Revocation succeeded/);
  assert.match(renderer, /setPublishedCatalog\(null\)/);
  assert.match(renderer, /setManagedReleases\(\(rows\) => rows\.map/);
});
check('required Packet assignment and reminder reconcile after committed writes', () => {
  assert.match(renderer, /async function loadReleaseRequirements\(releaseId: string, cursor\?: string, status: PacketRequirementStatus = requirementStatus, allowPending = false\)/);
  assert.match(renderer, /const refreshed = await loadReleaseRequirements\(release\.id, undefined, requirementStatus, true\)/);
  assert.match(renderer, /Reminder committed\. Reload the release requirements/);
  assert.match(renderer, /Assignments saved\. Reload the release requirements/);
  assert.match(renderer, /const packetId = activePacketId, recipients = \[\.\.\.requirementRecipients\]/);
});
console.log(`Batch A Packet/Policy reliability: ${tests}/${tests} passed`);
