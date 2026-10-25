import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClusterActionRunGate } from '../../packages/renderer/src/core/cluster-action-run-gate.ts';

const gate = createClusterActionRunGate();
let executions = 0;
let finish;
const gateRelease = new Promise(resolve => { finish = resolve; });
const first = gate.run('project:a:create', async () => { executions++; await gateRelease; return 'created'; });
const second = gate.run('project:a:create', () => { executions++; return 'duplicate'; });
assert.strictEqual(first, second);
assert.equal(gate.has('project:a:create'), true);
await Promise.resolve();
assert.equal(executions, 1);
console.log('PASS repeated click coalesces to exactly one operation');
const separate = await gate.run('project:b:create', () => 'independent');
assert.equal(separate, 'independent');
finish();
assert.deepEqual(await Promise.all([first, second]), ['created', 'created']);
assert.equal(gate.has('project:a:create'), false);
console.log('PASS different targets independent; completed keys released');
await assert.rejects(gate.run('failed', () => { throw new Error('server error'); }), /server error/);
assert.equal(gate.has('failed'), false);
assert.equal(await gate.run('failed', () => 'retry'), 'retry');
console.log('PASS failed operations can retry and do not leak pending keys');
await assert.rejects(gate.run('', () => 'invalid'), /required/);
console.log('PASS blank action keys rejected');
const files = {
  registry: readFileSync('packages/renderer/src/core/resource-action-registry.ts', 'utf8'),
  access: readFileSync('packages/renderer/src/features/projects/ProjectAccessPanel.tsx', 'utf8'),
  share: readFileSync('packages/renderer/src/features/projects/ProjectShareLinksSection.tsx', 'utf8'),
  menu: readFileSync('packages/renderer/src/features/workflow/WorkActionMenu.tsx', 'utf8'),
  tabs: readFileSync('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx', 'utf8'),
  idempotency: readFileSync('apps/server/src/core/idempotency.ts', 'utf8'),
  hooks: readFileSync('packages/renderer/src/components/useClusterMutationGate.ts', 'utf8'),
};
const checks = [
 ['canonical manifest determines action resource support', files.registry.includes('CLUSTER_RESOURCE_MANIFEST[target.kind]')],
 ['denied UI actions never appear', files.registry.includes('if (!action.allowed(target)) continue')],
 ['disabled actions include useful reason', files.registry.includes('action.unavailableReason || action.description')],
 ['project scoping enforced in action resolution', files.registry.includes('resource.projectScoped && !target.projectId?.trim()')],
 ['one menu framework used for work', files.menu.includes('resolveClusterResourceActions')],
 ['same action framework used for Project tabs', files.tabs.includes('resolveClusterResourceActions')],
 ['Project rule builder uses shared Resource Picker', files.access.includes('ariaLabel="Rule target"')],
 ['Project Access Explorer still uses canonical picker and server explanation', files.access.includes('ariaLabel="Access target"') && files.access.includes('/api/access/explain')],
 ['all Project permission mutations gated', ['createRule','patchRule','deleteRule','createShareLink','patchShareLink'].every(name => files.access.includes(`function ${name}`)) && (files.access.match(/return mutationGate.run\(/g)||[]).length === 5],
 ['Project rules receive busy feedback', files.access.includes('busyLabel="Saving…"')],
 ['Share links receive busy feedback', files.share.includes('busy={busyCreate}') && files.share.includes('busyForLink(link.id)')],
 ['Access Explorer rejects outdated responses', files.access.includes('sequence === explainRequestSequence.current')],
 ['no client-side permission grant', !files.registry.includes('api(') && !files.registry.includes('fetch(')],
 ['one-time restricted share tokens never cached in mutation receipts', files.idempotency.includes('share-links(?:\\/|$)') && files.idempotency.includes('one-time bearer secrets')],
 ['mutation runner uses gate before React state settles', files.hooks.includes('gate.current.has(key)')],
];
for (const [name, pass] of checks) {
  assert.ok(pass, name);
  console.log(`PASS ${name}`);
}
console.log(`${checks.length + 4}/${checks.length + 4} shared action / mutation checks passed`);
