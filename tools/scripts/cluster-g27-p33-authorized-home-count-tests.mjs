import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'packages/renderer/src/features/home-widgets/home-scoped-aggregate.ts'), 'utf8');
const custom = readFileSync(path.join(root, 'packages/renderer/src/features/home-widgets/CustomHomeWidget.tsx'), 'utf8');
const builtIn = readFileSync(path.join(root, 'packages/renderer/src/features/home-widgets/BuiltInHomeWidget.tsx'), 'utf8');
const routes = readFileSync(path.join(root, 'apps/server/src/domains/data-metrics/data-metric-routes.ts'), 'utf8');
const runtime = readFileSync(path.join(root, 'apps/server/src/app/server-data-platform-runtime.ts'), 'utf8');
const require = createRequire(import.meta.url);
const ts = require(path.resolve(process.execPath, '../../lib/node_modules/typescript/lib/typescript.js'));
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let effect = null, state = null, apiRead = null, count = 0;
const check = (description, fn) => { fn(); count++; console.log(`PASS ${description}`); };
const policy = {
  homeWidgetNeedsScopedAggregates: (config) => Boolean(config && (config.context && config.context !== 'studio' || config.timeRange && config.timeRange !== 'all' || config.filterText?.trim() || config.savedViewId?.trim())),
  resolveHomeWidgetContext: (config, runtime) => {
    const context = config?.context || 'studio';
    if (context === 'project') return { kind: 'project', id: config.contextId || null };
    if (context === 'current-project') return { kind: 'project', id: runtime.currentProjectId || null };
    if (context === 'user') return { kind: 'user', id: config.contextId || null };
    if (context === 'me') return { kind: 'user', id: runtime.currentUserId };
    if (context === 'my-role' || context === 'role') return { kind: 'role', id: context === 'role' ? config.contextId || null : runtime.currentRoleId || null };
    return { kind: 'studio' };
  },
  homeWidgetTimeCutoff: (config, now) => config?.timeRange === '7d' ? now.getTime() - 7*86400000 : config?.timeRange === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : null,
};
const sandbox = {
  module: { exports: {} }, exports: {},
  require: (name) => name === 'react' ? {
    useMemo: (factory) => factory(),
    useState: (initial) => { state = initial; return [initial, (next) => { state = next; }]; },
    useEffect: (callback) => { effect = callback; },
  } : name.includes('home-widget-runtime-policy') ? policy : name.includes('core/api') ? { api: (...args) => apiRead(...args) } : {},
  Date, Promise, AbortController, JSON, Number, Object, Set, Error, encodeURIComponent,
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: 'home-scoped-aggregate.js' });
const { homeScopedCountSpec, useHomeScopedCounts } = sandbox.module.exports;
const runtimeContext = { currentUserId: 'person-a', currentProjectId: 'project-a', currentRoleId: 'role-a' };
const now = new Date('2026-10-25T14:00:00.000Z');
check('Project scope resolves to canonical Projects count + exact ID condition', () => {
  const spec = homeScopedCountSpec('projects.total', { context: 'current-project' }, runtimeContext, now);
  assert.equal(spec.metricId, 'projects.count'); assert.equal(spec.query.filters.conditions[0].fieldId, 'id');
  assert.equal(spec.query.filters.conditions[0].value, 'project-a'); assert.equal(spec.valueField, 'value');
});
check('Studio date range uses server updatedAt aggregation rather than truncated lists', () => {
  const spec = homeScopedCountSpec('projects.total', { timeRange: '7d' }, runtimeContext, now);
  assert.equal(spec.metricId, 'projects.count'); assert.equal(spec.query.timeRange.fieldId, 'updatedAt');
  assert.equal(spec.query.timeRange.from, '2026-10-18T14:00:00.000Z');
});
check('Personal People count uses complete authorization-filtered count, not capacity hours', () => {
  const spec = homeScopedCountSpec('people.total', { context: 'me' }, runtimeContext, now);
  assert.equal(spec.metricId, 'people.capacity_total'); assert.equal(spec.valueField, 'count');
  assert.equal(spec.query.filters.conditions[0].value, 'person-a');
});
for (const [name, binding, config, runtime] of [
  ['missing Project', 'projects.total', { context: 'project' }, runtimeContext],
  ['unresolved identity', 'projects.total', { context: 'project', contextId: 'project-a' }, {}],
  ['user-scoped Project count', 'projects.total', { context: 'me' }, runtimeContext],
  ['role-scoped count', 'people.total', { context: 'my-role' }, runtimeContext],
  ['Project-scoped People count', 'people.total', { context: 'project', contextId: 'project-a' }, runtimeContext],
  ['People time range lacking exact semantic parity', 'people.total', { context: 'me', timeRange: 'today' }, runtimeContext],
  ['unsupported metric binding', 'builds.total', { context: 'project', contextId: 'project-a' }, runtimeContext],
  ['saved view', 'projects.total', { context: 'project', contextId: 'project-a', savedViewId: 'view-a' }, runtimeContext],
  ['free-text filter', 'projects.total', { context: 'project', contextId: 'project-a', filterText: 'confidential' }, runtimeContext],
]) check(`Unsupported / incomplete ${name} fails closed`, () => assert.equal(homeScopedCountSpec(binding, config, runtime, now), null));
check('Server defines authorized count adapters and complete result provenance', () => {
  assert.match(runtime, /const projectCountMetric.*id: "projects.count"/);
  assert.match(runtime, /const peopleCapacityMetric.*id: "people.capacity_total"/);
  assert.match(runtime, /scope: "authorized_query", complete: true/);
  assert.match(routes, /adapter.authorizeActor\(String\(user.id\)\)/);
});
check('Custom and built-in widgets consume only scoped authorized projection results', () => {
  assert.match(custom, /useHomeScopedCounts\(/); assert.match(custom, /scopedCounts\.values\[binding\]/);
  assert.match(builtIn, /useHomeScopedCounts\(/); assert.match(builtIn, /authorizedCounts\.values\["projects.total"\]/);
  assert.match(custom, /HOME_SCOPED_AGGREGATES_UNAVAILABLE/);
});
check('Reject fake complete, incomplete, negative, fractional, and stale metric result shapes', () => {
  const fn = vm.runInNewContext('isCompleteAuthorizedCount', sandbox);
  const base = { scope: 'authorized_query', complete: true, generatedAt: '2026-10-25T14:00:00Z' };
  assert.equal(fn(base, 0), true); assert.equal(fn(base, 9), true);
  assert.equal(fn({ ...base, scope: 'global' }, 9), false);
  assert.equal(fn({ ...base, complete: false }, 9), false);
  assert.equal(fn({ ...base, generatedAt: 'bad date' }, 9), false);
  assert.equal(fn(base, -1), false); assert.equal(fn(base, 1.5), false); assert.equal(fn(base, null), false);
});
// Exercise real effect, abort and validation logic with small React/API stubs.
const nextTick = () => new Promise((resolve) => setImmediate(resolve));
apiRead = async (_path, options) => ({ ok: true, read: { value: 3, count: 3, scope: 'authorized_query', complete: true, generatedAt: now.toISOString() } });
const config = { context: 'project', contextId: 'project-a' };
useHomeScopedCounts(['projects.total'], config, runtimeContext);
const cleanup = effect(); await nextTick();
check('Hook accepts verified complete authorized server values', () => assert.equal(state.values['projects.total'].value, 3));
cleanup();
let resolveRequest;
apiRead = (_path, options) => new Promise((resolve) => { resolveRequest = resolve; });
useHomeScopedCounts(['projects.total'], config, runtimeContext);
const cleanCancelled = effect(); cleanCancelled();
resolveRequest({ ok: true, read: { value: 999, scope: 'authorized_query', complete: true, generatedAt: now.toISOString() } });
await nextTick();
check('Unmount/account-switch cancellation rejects late successful responses', () => assert.equal(state.values['projects.total'], undefined));
apiRead = async () => ({ ok: true, read: { value: 12, complete: false, scope: 'authorized_query', generatedAt: now.toISOString() } });
useHomeScopedCounts(['projects.total'], config, runtimeContext);
effect(); await nextTick();
check('Incomplete server projections do not become displayed totals', () => { assert.equal(state.values['projects.total'], undefined); assert.match(state.error, /could not be verified/); });
console.log(`G27 P33 scoped authorized Home counts: ${count}/${count} passed`);
