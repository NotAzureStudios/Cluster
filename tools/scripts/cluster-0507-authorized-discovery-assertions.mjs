import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverProjectAccessTargets } from '../../apps/server/src/domains/access/project-target-discovery.ts';

const project = { id: 'p1', name: 'Artemis', workspaceId: 'studio1' };
const records = {
  board: [{ id: 'b1', name: 'Public Board', projectId: 'p1', archived: false }, { id: 'b2', name: 'Private Board', projectId: 'p1', archived: false }, { id: 'elsewhere', name: 'Other Studio Board', projectId: 'p2', archived: false }],
  whiteboard: [{ id: 'w1', name: 'Whiteboard', projectId: 'p1' }],
  libraryItem: [{ id: 'l1', title: 'Private Master Art', projectId: 'p1', source: 'manual', deletedAt: null, status: 'active' }, { id: 'l2', title: 'Approved Art', projectId: 'p1', source: 'manual', deletedAt: null, status: 'active' }],
  reviewAsset: [{ id: 'r1', title: 'Review Art', projectId: 'p1' }],
};
const reads = [];
const matches = (row, filter) => !filter || Object.entries(filter).every(([key, value]) => {
  if (key === 'NOT') return true;
  if (value && typeof value === 'object' && 'contains' in value) return String(row[key] || '').toLowerCase().includes(String(value.contains).toLowerCase());
  if (value && typeof value === 'object' && 'notIn' in value) return !value.notIn.includes(row[key]);
  return row[key] === value;
});
function createPrisma({failRules = false} = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(records)) tables[name] = {
    async findMany(query) { reads.push({ table: name, query }); return rows.filter((row) => matches(row, query.where)).slice(0, query.take); },
  };
  tables.accessRule = { async findMany(options) { reads.push({ table:'accessRule', query: options }); if (failRules) throw new Error('policy store unavailable'); return [{ targetKind: 'board', targetId: 'b2', effect: 'deny', status: 'active' }]; } };
  return tables;
}
function args(overrides = {}) {
  return {
    prisma: createPrisma(), project, request: { id: 'user1' }, actorId: 'user1', cursorSecret: 'unit-test-secret',
    authorization: { async authorize(_request, action, resource, context) {
      assert.equal(context.surface, 'api');
      assert.ok(Array.isArray(context.rules));
      assert.equal(resource.project.id, 'p1');
      if (resource.targetId === 'b2' && context.rules.some((rule) => rule.targetId === 'b2' && rule.effect === 'deny')) return {allowed:false};
      if (resource.targetId === 'w1' && action === 'manage') return {allowed:false};
      return {allowed:true};
    } },
    q: '', minimum: 'view', limit: 80, ruleSelect: { targetKind:true },
    canAccessLibraryItem: async (_request, item) => { assert.equal(item.project?.id, 'p1'); return item.id !== 'l1'; },
    ...overrides,
  };
}
const list = await discoverProjectAccessTargets(args());
assert.deepEqual(list.targets.map((item) => `${item.kind}:${item.id}`), ['project:p1', 'board:b1', 'whiteboard:w1', 'library:l2', 'review_asset:r1']);
assert.ok(!JSON.stringify(list).includes('Private'));
assert.ok(!JSON.stringify(list).includes('elsewhere'));
console.log('PASS scoped results with per-target deny and Library ACL filtering');
assert.ok(reads.filter((entry) => entry.table === 'accessRule').length >= 1);
assert.ok(reads.filter((entry) => entry.table !== 'accessRule').every((entry) => entry.query.where.projectId === 'p1'));
assert.ok(reads.filter((entry) => entry.table === 'accessRule').some((entry) => entry.query.where.OR.some((rule) => rule.targetId?.in?.includes('b2'))));
console.log('PASS bounded per-project queries and one complete policy snapshot');
const search = await discoverProjectAccessTargets(args({ q: 'public', minimum: 'manage' }));
assert.deepEqual(search.targets.map((row) => row.id), ['b1']);
console.log('PASS server-side search and manage policy');
const denied = await discoverProjectAccessTargets(args({ minimum: 'manage', limit: 1, authorization: { authorize: async () => ({allowed:false}) } }));
assert.deepEqual(denied.targets, []);
assert.equal(denied.truncated, false);
console.log('PASS no unauthorized candidate names or hidden counts exposed');
await assert.rejects(discoverProjectAccessTargets(args({prisma:createPrisma({failRules:true})})),/policy store unavailable/);
console.log('PASS policy store failures fail closed');
let sawLimit = false;
const one = await discoverProjectAccessTargets(args({limit:1, authorization:{ authorize:async () => {sawLimit=true; return {allowed:true};} }}));
assert.equal(one.targets.length,1);
assert.equal(one.truncated,true);
assert.ok(sawLimit);
console.log('PASS bounded result count and explicit truncation');
const access = readFileSync('apps/server/src/domains/access/access-routes.ts','utf8');
const panel = readFileSync('packages/renderer/src/features/projects/ProjectAccessPanel.tsx','utf8');
const control = readFileSync('packages/renderer/src/components/ClusterCombobox.tsx','utf8');
assert.ok(access.includes('authorization.requireProject(request, reply, query.projectId, query.minimum)'));
assert.ok(access.includes('Cache-Control'));
const hook = readFileSync('packages/renderer/src/components/useAuthorizedProjectResources.ts','utf8');
assert.ok(panel.includes('useAuthorizedProjectResources') && hook.includes('/api/access/targets?') && hook.includes('setResources([])'));
assert.ok(panel.includes('!authorizedTarget(form.targetKey)'));
assert.ok(control.includes('onSearchChange?.(event.target.value)'));
assert.ok(!panel.includes('resources={resourceCandidates} allowedKinds={undefined}'));
console.log('PASS server authorization boundary, no-store transport and searched UI integration');
console.log('7/7 project target discovery assertions passed');
