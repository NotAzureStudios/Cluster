/** TD4 R49: executable tool-lifecycle -> provider feed admission and SSE reset. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const src = (filename) => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(filename, mocks = {}, extra = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(src(filename), {
    module: mod, exports: mod.exports, require: (key) => {
      if (!(key in mocks)) throw Error(`Unmocked dependency ${key} in ${filename}`);
      return mocks[key];
    }, console, process, Date, Promise, Map, Set, Math, Number, String, BigInt, JSON, Array, Error,
    Boolean, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, ...extra,
  }, { filename });
  return mod.exports;
}
const background = load('apps/server/src/core/background-tasks.ts');
const registry = new background.BackgroundTaskRegistry();
const availability = load('apps/server/src/domains/access/configurable-tool-availability.ts');
const lifecycle = load('apps/server/src/domains/changes/resource-change-tool-lifecycle.ts', {
  '../access/configurable-tool-availability.js': availability,
});
const enabled = (owner) => registry.isOwnerEnabled(owner);
const entry = (kind, id, sequence = 1) => ({
  sequence: String(sequence), eventType: 'resource.updated', resource: { kind, id },
  occurredAt: '2026-10-15T00:00:00.000Z',
});
let checks = 0;
async function check(label, callback) {
  try { await callback(); checks++; console.log('PASS', label); }
  catch (error) { process.exitCode = 1; console.error('FAIL', label, error); }
}
await check('every configured owner uses canonical TD2 availability', () => {
  for (const owner of ['timeline', 'tickets', 'calendar', 'scheduler', 'library', 'packets'])
    assert.ok(Object.hasOwn(availability.TOOL_AVAILABILITY, owner));
  assert.equal(lifecycle.resourceChangeToolOwner('ticket'), 'tickets');
  assert.equal(lifecycle.resourceChangeToolOwner('meeting'), 'calendar');
  assert.equal(lifecycle.resourceChangeToolOwner('file'), 'library');
  assert.equal(lifecycle.resourceChangeToolOwner('studio_form'), null);
  assert.equal(lifecycle.resourceChangeToolOwner('project'), null);
});
await check('tool disable stops owned events but preserves unrelated resources', () => {
  registry.setOwnerEnabled('library', false);
  const data = [entry('library', 'L1', 1), entry('file', 'L2', 2), entry('project', 'P1', 3), entry('packet', 'P2', 4)];
  assert.deepEqual(lifecycle.enabledResourceChanges(data, enabled).map((change) => change.resource.kind).join(','), 'project,packet');
  registry.setOwnerEnabled('library', true);
  assert.equal(lifecycle.enabledResourceChanges(data, enabled).length, 4);
});
await check('every Studio kill switch suspends its event kinds', () => {
  const owners = Object.entries(lifecycle.RESOURCE_CHANGE_TOOL_OWNERS);
  for (const [kind, owner] of owners) {
    registry.setOwnerEnabled(owner, false);
    assert.equal(lifecycle.enabledResourceChanges([entry(kind, 'X')], enabled).length, 0, kind);
    registry.setOwnerEnabled(owner, true);
  }
});
await check('fingerprint changes on suspend and returns on resume', () => {
  const initial = lifecycle.resourceChangeToolAvailabilityFingerprint(enabled);
  registry.setOwnerEnabled('tickets', false);
  assert.notEqual(lifecycle.resourceChangeToolAvailabilityFingerprint(enabled), initial);
  registry.setOwnerEnabled('tickets', true);
  assert.equal(lifecycle.resourceChangeToolAvailabilityFingerprint(enabled), initial);
});

let feed = [];
let sessionReads = 0;
let delaySecondSessionRead = null;
const listenerRefs = new Set();
const heartbeatCallbacks = [];
const requests = new Map();
const prisma = {
  session: { findUnique: async () => {
    sessionReads++;
    if (sessionReads === 2 && delaySecondSessionRead) await delaySecondSessionRead;
    return ({ id: 'S1', userId: 'U1', revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000), authenticationGeneration: 1,
    user: { id: 'U1', accountState: 'ACTIVE', authenticationGeneration: 1 } });
  } },
  libraryItem: { findMany: async ({ where }) => where.id.in.map((id) => ({ id, status: 'active', projectId: null })) },
  personnelRecordAttachment: { findMany: async () => [] },
  project: { findMany: async () => [] },
  accessRule: { findMany: async () => [] },
  calendarEvent: { findMany: async () => [] }, card: { findMany: async () => [] },
};
const routes = load('apps/server/src/domains/changes/resource-change-routes.ts', {
  'zod': { z: { object: () => ({ parse: (v) => v }), coerce: { string: () => ({ regex() { return this; }, optional() { return this; } }) } } },
  '@cluster/shared': { CLUSTER_ACCESS_TARGET_KINDS: ['project','library'],
    clusterResourceChangesQuerySchema: { parse: (q) => ({ after: String(q.after ?? 0), limit: 100 }) } },
  '../../core/api-response.js': { apiError: (_req, reply, status, code) => { reply.code(status); return { ok: false, code }; } },
  '../../core/resource-change-runtime.js': {
    resourceChangeWindow: async () => ({ floor: 0n, latest: BigInt(feed.at(-1)?.sequence || 0) }),
    readResourceChanges: async (_db, after, limit) => feed.filter((x) => BigInt(x.sequence) > after).slice(0, limit),
    resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence: async () => BigInt(feed.at(-1)?.sequence || 0),
  },
  './resource-change-providers.js': { isEnrolledResourceChangeProvider: () => false,
    loadResourceChangeProviderSnapshot: async () => ({ projectIds: [], requiresAudience: false,
      requiresLibrary: false, visible: () => new Set() }) },
  './resource-change-tool-lifecycle.js': lifecycle,
  '../workforce/workforce-user-authority.js': { WORKFORCE_USER_AUTHORITY_INCLUDE: {} },
  '../access/studio-audience.js': { loadStudioAudienceUserContext: async () => ({}) },
  '../planning/calendar-access.js': { canAccessCalendarEvent: async () => true },
}, {
  setInterval: (fn) => { heartbeatCallbacks.push(fn); return { unref() {} }; },
  clearInterval: () => {},
});
routes.registerResourceChangeRoutes({
  app: { get: (name, fn) => requests.set(name, fn) }, prisma,
  authorization: { hasTargetAccess: () => true, hasToolPermission: () => true },
  libraryAccess: { contextForUser: async () => ({}), visibleFor: () => true },
  getCurrentSession: async () => ({ id: 'S1', userId: 'U1' }),
  decorateUserForClient: async () => ({ isAdmin: true, workspaceRole: 'admin' }),
  changeRuntime: { subscribe: (fn) => { listenerRefs.add(fn); return () => listenerRefs.delete(fn); } },
  isConfigurableToolEnabled: enabled,
});
const pull = async () => {
  const reply = { code() { return this; }, header() { return this; } };
  return requests.get('/api/changes')({ query: { after: '0' }, raw: {} }, reply);
};
await check('GET suppresses disabled Library events even for administrator', async () => {
  feed = [entry('library', 'L1', 1), entry('file', 'L2', 2), entry('project', 'P1', 3)];
  registry.setOwnerEnabled('library', false);
  const response = await pull();
  assert.deepEqual(response.changes.map((change) => change.resource.kind).join(','), 'project');
  assert.equal(response.cursor, '3');
  registry.setOwnerEnabled('library', true);
});
await check('GET re-evaluates TD2 state without leaking cached permissions', async () => {
  feed = [entry('library', 'L1', 1)];
  assert.equal((await pull()).changes.length, 1);
  registry.setOwnerEnabled('library', false);
  assert.equal((await pull()).changes.length, 0);
  registry.setOwnerEnabled('library', true);
  assert.equal((await pull()).changes.length, 1);
});
await check('admin fast path rechecks availability after asynchronous session lookup', async () => {
  feed = [entry('ticket', 'T1', 1)];
  sessionReads = 0;
  let unblock;
  let entered;
  const reached = new Promise((resolve) => { entered = resolve; });
  delaySecondSessionRead = new Promise((resolve) => { unblock = resolve; });
  const find = prisma.session.findUnique;
  prisma.session.findUnique = async (...args) => {
    const result = find(...args);
    if (sessionReads === 2) entered();
    return result;
  };
  try {
    const inFlight = pull();
    await reached;
    registry.setOwnerEnabled('tickets', false);
    unblock();
    const result = await inFlight;
    assert.equal(result.changes.length, 0);
  } finally {
    unblock();
    prisma.session.findUnique = find;
    registry.setOwnerEnabled('tickets', true);
    delaySecondSessionRead = null;
    sessionReads = 0;
  }
});
await check('SSE tool transition sends reset even when idle and no new events arrive', async () => {
  feed = [];
  const writes = [];
  const raw = { destroyed: false, writableEnded: false, writableLength: 0,
    setHeader() {}, flushHeaders() {}, write(frame) { writes.push(frame); return true; },
    once() {}, end() { this.writableEnded = true; } };
  const req = { query: {}, raw: { once() {} } };
  const reply = { raw, hijack() {} };
  await requests.get('/api/changes/stream')(req, reply);
  assert.ok(writes.some((frame) => frame.includes('event: ready')));
  registry.setOwnerEnabled('library', false);
  heartbeatCallbacks.at(-1)();
  assert.ok(writes.some((frame) => frame.includes('tool_availability_changed')));
  const resets = writes.filter((frame) => frame.includes('tool_availability_changed')).length;
  heartbeatCallbacks.at(-1)();
  assert.equal(writes.filter((frame) => frame.includes('tool_availability_changed')).length, resets);
  registry.setOwnerEnabled('library', true);
  heartbeatCallbacks.at(-1)();
  assert.equal(writes.filter((frame) => frame.includes('tool_availability_changed')).length, resets + 1);
  raw.end();
});
await check('SSE delivery hides disabled-tool identifiers while keeping unrelated events and cleanup', async () => {
  feed = [];
  registry.setOwnerEnabled('library', false);
  const writes = [];
  const closeHandlers = [];
  const raw = { destroyed: false, writableEnded: false, writableLength: 0,
    setHeader() {}, flushHeaders() {}, write(frame) { writes.push(frame); return true; },
    once() {}, end() { this.writableEnded = true; } };
  const req = { query: {}, raw: { once: (_type, callback) => closeHandlers.push(callback) } };
  await requests.get('/api/changes/stream')(req, { raw, hijack() {} });
  const subscribed = [...listenerRefs].at(-1);
  assert.equal(typeof subscribed, 'function');
  subscribed([entry('library', 'PRIVATE-LIBRARY', 1), entry('project', 'P1', 2)]);
  for (let index = 0; index < 6; index++) await new Promise(setImmediate);
  assert.ok(writes.some((frame) => frame.includes('event: change') && frame.includes('"id":"P1"')));
  assert.equal(writes.some((frame) => frame.includes('PRIVATE-LIBRARY')), false);
  registry.setOwnerEnabled('library', true);
  heartbeatCallbacks.at(-1)();
  assert.ok(writes.some((frame) => frame.includes('tool_availability_changed')));
  closeHandlers.forEach((callback) => callback());
  assert.equal(listenerRefs.has(subscribed), false);
  raw.end();
});
await check('reset is emitted to mounted client subscribers and unsubscribes cleanly', () => {
  const handlers = new Map();
  const events = [];
  const client = load('packages/renderer/src/core/resource-change-client.ts', {
    './api': { invalidateApiQueries() {}, invalidateApiQueryTags() {} },
    './cohesion-events': {
      emitClusterCohesionEvent: (type, value) => {
        events.push({ type, value });
        for (const handler of handlers.get(type) || []) handler(value);
      },
      subscribeClusterCohesionEvent: (type, handler) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(handler);
        return () => handlers.get(type).delete(handler);
      },
    },
  });
  const observed = [];
  const off = client.subscribeResourceChangeFeedResets((reset) => observed.push(reset.reason));
  client.emitResourceChangeFeedReset({ reason: 'tool_availability_changed', cursor: '42' });
  assert.deepEqual(observed, ['tool_availability_changed']);
  assert.equal(events.at(-1).type, 'cluster-resource-feed-reset');
  off();
  client.emitResourceChangeFeedReset({ reason: 'cursor_expired' });
  assert.deepEqual(observed, ['tool_availability_changed']);
});
await check('SSE reset invalidates cached and mounted resources through existing refresh hooks', () => {
  const source = fs.readFileSync('packages/renderer/src/features/application/use-resource-change-invalidation.ts', 'utf8');
  const hook = fs.readFileSync('packages/renderer/src/core/use-resource-change-refresh.ts', 'utf8');
  assert.ok(source.includes('emitResourceChangeFeedReset({ reason, cursor: resetCursor })'));
  assert.ok(source.includes('invalidateApiQueries()'));
  assert.ok(hook.includes('subscribeResourceChangeFeedResets(() => schedule())'));
  assert.ok(hook.includes('unsubscribeReset()'));
  assert.ok(hook.includes('resourceChangeMatches(detail, options)'));
});
if (process.exitCode) process.exit(process.exitCode);
console.log(`${checks}/${checks} TD4 R49 provider-lifecycle assertions passed`);
