/** TD4 R51: cursor recovery + durable typed invalidation wire source checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, deps = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(transpile(file), { module: mod, exports: mod.exports,
    require(id) { if (!(id in deps)) throw Error(`Unmocked module ${id} in ${file}`); return deps[id]; },
    console, process, Date, Promise, Number, Math, String, Boolean, BigInt, JSON, Error, Array, Map, Set, Object,
    setInterval, clearInterval, setTimeout, clearTimeout, ...globals,
  }, { filename: file });
  return mod.exports;
}
let checks = 0;
async function check(name, fn) { try { await fn(); checks++; console.log('PASS', name); } catch (error) { process.exitCode = 1; console.error('FAIL', name, error); } }
const handlers = new Map();
let latest = 20n;
let readCount = 0;
const feed = [];
let subscriber;
const heartbeatCallbacks = [];
const prisma = { session: { findUnique: async () => ({ id: 'S1', userId: 'U1', revokedAt: null, expiresAt: new Date(Date.now() + 120_000), authenticationGeneration: 1, user: { id: 'U1', accountState: 'ACTIVE', authenticationGeneration: 1 } }) },
  project: { findMany: async () => [] }, accessRule: { findMany: async () => [] },
  calendarEvent: { findMany: async () => [] }, card: { findMany: async () => [] },
};
const routes = load('apps/server/src/domains/changes/resource-change-routes.ts', {
  zod: { z: { object: () => ({ parse: q => q }), coerce: { string: () => ({ regex() { return this; }, optional() { return this; } }) } } },
  '@cluster/shared': { CLUSTER_ACCESS_TARGET_KINDS: ['project'], clusterResourceChangesQuerySchema: { parse: q => ({ after: String(q.after ?? '0'), limit: Number(q.limit || 100) }) } },
  '../../core/api-response.js': { apiError: () => ({ ok: false }) },
  '../../core/resource-change-runtime.js': {
    resourceChangeWindow: async () => ({ floor: 1n, latest }),
    readResourceChanges: async (_db, after, limit) => { readCount++; return feed.filter(change => BigInt(change.sequence) > after).slice(0, limit); },
    resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence: async () => latest,
  },
  './resource-change-providers.js': { isEnrolledResourceChangeProvider: () => false, loadResourceChangeProviderSnapshot: async () => ({ projectIds: [], requiresAudience: false, requiresLibrary: false, visible: () => new Set() }) },
  './resource-change-tool-lifecycle.js': { enabledResourceChanges: xs => xs, resourceChangeToolAvailabilityFingerprint: () => 'enabled' },
  '../workforce/workforce-user-authority.js': { WORKFORCE_USER_AUTHORITY_INCLUDE: {} },
  '../access/studio-audience.js': { loadStudioAudienceUserContext: async () => ({}) },
  '../planning/calendar-access.js': { canAccessCalendarEvent: async () => true },
}, { setInterval: fn => { heartbeatCallbacks.push(fn); return { unref() {} }; }, clearInterval() {} });
routes.registerResourceChangeRoutes({ app: { get: (name, handler) => handlers.set(name, handler) }, prisma,
  getCurrentSession: async () => ({ id: 'S1', userId: 'U1' }), decorateUserForClient: async () => ({ isAdmin: true, workspaceRole: 'admin' }),
  authorization: { hasTargetAccess: () => true, hasToolPermission: () => true },
  libraryAccess: { contextForUser: async () => ({}), visibleFor: () => true },
  changeRuntime: { subscribe: fn => { subscriber = fn; return () => { subscriber = null; }; } },
  isConfigurableToolEnabled: () => true,
});
const get = async after => handlers.get('/api/changes')({ query: { after }, raw: {} }, { header() { return this; } });
function stream(after) {
  const frames = [];
  const closeHandlers = [];
  const raw = { destroyed: false, writableEnded: false, writableLength: 0, setHeader() {}, flushHeaders() {}, write: frame => { frames.push(frame); return true; }, end() { this.writableEnded = true; } };
  const req = { query: { after }, raw: { once: (_event, cb) => closeHandlers.push(cb) } };
  return { frames, raw, closeHandlers, start: () => handlers.get('/api/changes/stream')(req, { raw, hijack() {} }) };
}
await check('HTTP future cursor from restored database resets to current latest', async () => {
  const before = readCount;
  const result = await get('999');
  assert.equal(result.resetRequired, true);
  assert.equal(result.resetReason, 'cursor_ahead');
  assert.equal(result.cursor, '20');
  assert.equal(result.hasMore, false);
  assert.equal(result.changes.length, 0);
  assert.equal(readCount, before, 'must not read impossible historical range');
});
await check('HTTP expired cursor resets independently from future cursor', async () => {
  latest = 20n;
  const result = await get('0');
  assert.equal(result.resetRequired, false);
  assert.equal(result.cursor, '0');
});
await check('SSE future cursor resets with a LOWER authoritative cursor', async () => {
  const s = stream('999');
  await s.start();
  assert.ok(s.frames.some(frame => frame.includes('event: reset') && frame.includes('cursor_ahead') && frame.includes('"cursor":"20"')));
  assert.ok(s.frames.some(frame => frame.includes('event: ready') && frame.includes('"cursor":"20"')));
  s.closeHandlers.forEach(cb => cb());
  s.raw.end();
});
await check('SSE future cursor on empty restored outbox also resets', async () => {
  latest = 0n;
  const s = stream('999');
  await s.start();
  assert.ok(s.frames.some(frame => frame.includes('event: reset') && frame.includes('"cursor":"0"')));
  s.closeHandlers.forEach(cb => cb());
  s.raw.end();
  latest = 20n;
});
await check('SSE after reset can receive new events from restored sequence', async () => {
  latest = 20n;
  const s = stream('999');
  await s.start();
  latest = 21n;
  await subscriber([{ wireVersion: 1, eventSchemaVersion: 1, sequence: '21', eventType: 'activity.recorded', resource: { kind: 'project', id: 'P1' }, occurredAt: '2026-10-15T00:00:00.000Z' }]);
  for (let index = 0; index < 6; index++) await new Promise(setImmediate);
  assert.ok(s.frames.some(frame => frame.includes('event: change') && frame.includes('"sequence":"21"')));
  s.closeHandlers.forEach(cb => cb());
  s.raw.end();
});
await check('shared event change contract requires a versioned wire and domain version', () => {
  const src = fs.readFileSync('packages/shared/src/resource-change.ts', 'utf8');
  assert.match(src, /wireVersion:\s*z\.literal\(CLUSTER_RESOURCE_CHANGE_WIRE_VERSION\)/);
  assert.match(src, /eventSchemaVersion:\s*z\.number\(\)\.int\(\)/);
  assert.match(src, /resource:\s*clusterResourceAddressSchema/);
});
const projectedSchema = { safeParse: value => ({ success: value.wireVersion === 1 && value.eventSchemaVersion === 1 && ['project', 'library'].includes(value.resource?.kind), data: value }) };
const runtime = load('apps/server/src/core/resource-change-runtime.ts', { '@cluster/shared': { CLUSTER_RESOURCE_CHANGE_WIRE_VERSION: 1, clusterResourceChangeSchema: projectedSchema } });
await check('server projects durable event schema and canonical resource kind', async () => {
  const events = await runtime.readResourceChanges({ domainEventOutbox: { findMany: async () => [{ sequence: 21n, type: 'activity.recorded', schemaVersion: 1, resourceKind: 'project', resourceId: 'P1', resourceProjectId: null, resourceRevision: '3', occurredAt: new Date('2026-10-15T00:00:00.000Z') }] } }, 20n);
  assert.equal(events.length, 1);
  assert.equal(events[0].wireVersion, 1);
  assert.equal(events[0].eventSchemaVersion, 1);
  assert.equal(events[0].resource.id, 'P1');
});
await check('server rejects corrupt outbox versions instead of emitting untyped events', async () => {
  await assert.rejects(runtime.readResourceChanges({ domainEventOutbox: { findMany: async () => [{ sequence: 21n, type: 'activity.recorded', schemaVersion: 99, resourceKind: 'project', resourceId: 'P1', resourceProjectId: null, resourceRevision: null, occurredAt: new Date() }] } }, 20n), /Invalid resource-change/);
});
await check('renderer validates change frames and refreshes on malformed envelopes', () => {
  const src = fs.readFileSync('packages/renderer/src/features/application/use-resource-change-invalidation.ts', 'utf8');
  assert.match(src, /clusterResourceChangeSchema\.safeParse/);
  assert.match(src, /invalid_change_envelope/);
  assert.match(src, /malformed_change_frame/);
  assert.ok(src.indexOf('rememberCursor(decoded.data.sequence, decoded.data.cursorIdentity)') > src.indexOf('if (!decoded.success)'));
  assert.match(src, /emitResourceChangeFeedReset\(\{ reason, cursor: resetCursor \}\)/);
});
await check('durable producer refuses incompatible known event schemas and invalid resource addresses', () => {
  const src = fs.readFileSync('apps/server/src/core/domain-events.ts', 'utf8');
  assert.match(src, /clusterDomainEventDescriptor\(type\)/);
  assert.match(src, /descriptor\.schemaVersion !== schemaVersion/);
  assert.match(src, /clusterResourceAddressSchema\.parse\(event\.resource\)/);
});
await check('actual renderer hook rejects an unsupported wire envelope without advancing cursor', () => {
  let mount;
  const instances = [];
  const stores = new Map([['cluster-resource-change-cursor:U1', '999']]);
  const applied = [], reset = [], invalidations = [], reconciliations = [];
  const fakeWindow = {
    location: { origin: 'https://cluster.local' },
    localStorage: { getItem: key => stores.get(key) ?? null, setItem: (key, value) => stores.set(key, value) },
    setTimeout: (fn, ms) => { reconciliations.push({ fn, ms }); return reconciliations.length; }, clearTimeout: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const fakeDocument = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  class FakeEventSource {
    constructor(url) { this.url = url; this.handlers = new Map(); instances.push(this); }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    emit(name, payload) { this.handlers.get(name)({ data: JSON.stringify(payload), lastEventId: payload.sequence || '' }); }
    close() { this.closed = true; }
  }
  const validatedSchema = { safeParse: candidate => candidate?.wireVersion === 1 && candidate?.eventSchemaVersion === 1 && candidate?.resource?.kind === 'project' && /^[1-9][0-9]*$/.test(candidate.sequence)
    ? { success: true, data: candidate } : { success: false } };
  const hook = load('packages/renderer/src/features/application/use-resource-change-invalidation.ts', {
    'react': { useEffect: fn => { mount = fn; } },
    '@cluster/shared': { clusterResourceChangeSchema: validatedSchema },
    '../../core/api': { API_URL: '', invalidateApiQueries: () => invalidations.push('clear') },
    '../../core/offline-runtime-shell': { refreshOfflineSyncState: async () => {} },
    '../../core/resource-change-client': { applyResourceChangeInvalidation: c => applied.push(c), emitResourceChangeFeedReset: r => reset.push(r) },
    '../../core/reconnect-backoff': { reconnectBackoffDelay: () => 2000 },
  }, { window: fakeWindow, document: fakeDocument, navigator: { onLine: true }, URL, EventSource: FakeEventSource });
  hook.useResourceChangeInvalidation('U1');
  const cleanup = mount();
  assert.equal(instances.length, 1);
  assert.ok(instances[0].url.includes('after=999'));
  instances[0].emit('ready', { cursor: '20' });
  assert.equal(stores.get('cluster-resource-change-cursor:U1'), '20');
  instances[0].emit('change', { wireVersion: 2, eventSchemaVersion: 1, sequence: '21', resource: { kind: 'project', id: 'P1' } });
  assert.equal(stores.get('cluster-resource-change-cursor:U1'), '20');
  assert.deepEqual(reset.map(r => r.reason), ['invalid_change_envelope']);
  assert.equal(applied.length, 0);
  assert.equal(invalidations.length, 1);
  instances[0].emit('change', { wireVersion: 1, eventSchemaVersion: 1, sequence: '21', eventType: 'activity.recorded', resource: { kind: 'project', id: 'P1' }, occurredAt: new Date().toISOString() });
  assert.equal(stores.get('cluster-resource-change-cursor:U1'), '21');
  assert.equal(applied.length, 1);
  instances[0].emit('reset', { cursor: '3', reason: 'cursor_ahead' });
  assert.equal(stores.get('cluster-resource-change-cursor:U1'), '3', 'restore must allow authoritative cursor rollback');
  assert.equal(reset.at(-1).reason, 'cursor_ahead');
  cleanup();
  assert.equal(instances[0].closed, true);
});
const producer = load('apps/server/src/core/domain-events.ts', {
  '@cluster/shared': {
    clusterDomainEventDescriptor: kind => kind === 'activity.recorded' ? { type: kind, schemaVersion: 1 } : null,
    clusterResourceAddressSchema: { parse: resource => {
      if (!resource || !['project','library'].includes(resource.kind) || !resource.id) throw new Error('Invalid resource address');
      return resource;
    } },
  },
  'node:crypto': { randomUUID: () => 'generated-id' },
  './reliability-context.js': { currentReliabilityContext: () => null, runWithReliabilityContext: (_ctx, fn) => fn() },
}, { Buffer, queueMicrotask });
await check('transaction-scoped sequence lock precedes each outbox INSERT', async () => {
  const commands = [];
  const tx = { $queryRawUnsafe: async (sql, ...args) => {
    commands.push({ sql, args });
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [{}];
    if (sql.includes('INSERT INTO "DomainEventOutbox"')) return [{ id: args[0], type: args[1], payload: args[12], schemaVersion: args[2] }];
    throw Error('Unexpected SQL: ' + sql);
  } };
  const runtime = new producer.DurableDomainEventRuntime({});
  const e = { id: 'E1', type: 'activity.recorded', schemaVersion: 1, occurredAt: new Date(), resource: { kind: 'project', id: 'P1' }, payload: { op: 'updated' } };
  const inserted = await runtime.appendInTransaction(tx, e);
  assert.equal(inserted.id, 'E1');
  assert.equal(commands.length, 2);
  assert.match(commands[0].sql, /^SELECT pg_advisory_xact_lock\(\d+::bigint\)$/);
  assert.match(commands[1].sql, /^INSERT INTO "DomainEventOutbox"/);
  assert.equal(commands[1].args[2], 1, 'outbox schema version must be persisted verbatim');
  commands.length = 0;
  await runtime.appendInTransaction(tx, { ...e, id: 'E2' });
  assert.equal(commands[0].sql, 'SELECT pg_advisory_xact_lock(6192449487634434181::bigint)');
});
await check('known producer event rejects incompatible schema before insert or lock', async () => {
  let queries = 0;
  const runtime = new producer.DurableDomainEventRuntime({});
  const tx = { $queryRawUnsafe: async () => { queries++; return []; } };
  const base = { id: 'E3', type: 'activity.recorded', occurredAt: new Date(), resource: { kind: 'project', id: 'P1' }, payload: {} };
  await assert.rejects(runtime.appendInTransaction(tx, { ...base, schemaVersion: 2 }), /Unsupported schema version/);
  await assert.rejects(runtime.appendInTransaction(tx, { ...base, schemaVersion: 1.5 }), /schema version is invalid/);
  await assert.rejects(runtime.appendInTransaction(tx, { ...base, schemaVersion: 1, resource: { kind: 'forged', id: 'P1' } }), /Invalid resource address/);
  assert.equal(queries, 0);
});
if (process.exitCode) process.exit(process.exitCode);
console.log(`${checks}/${checks} TD4 R51 typed change-feed checks passed`);
