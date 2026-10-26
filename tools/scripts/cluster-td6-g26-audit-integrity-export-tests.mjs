#!/usr/bin/env node
// G26 regression for actual audit service/route modules, not shadow logic.
// PostgreSQL snapshot/locking certification remains a separate runtime gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { verifyExport } from './verify-security-audit-export.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let checks = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS audit integrity/export: ${name}`); checks++; };
function load(source, mocks = {}) {
  const js = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (name in mocks) return mocks[name];
    if (name === 'node:crypto') return require(name);
    if (name.endsWith('/security-observability.js')) return {
      redactForLog: value => value,
      redactSensitiveText: value => String(value),
      sanitizeClientCorrelationId: value => value || null,
      sanitizeRequestPath: value => String(value || '/'),
    };
    throw Error(`${source}: unexpected dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}
const integrity = load('apps/server/src/core/security-audit-integrity.ts');
function event(sequence, prior = integrity.SECURITY_AUDIT_GENESIS_HASH) {
  const row = {
    id: `audit-${sequence}`, sequence, integrityVersion: 1, previousHash: prior,
    event: 'security.test', actorUserId: null, targetUserId: null,
    workspaceId: null, result: 'SUCCESS', reasonCode: 'TEST', requestId: null,
    requestMethod: null, requestPath: null, sessionId: null, ipAddress: null,
    userAgent: null, metadata: '{}', occurredAt: new Date('2026-10-22T12:00:00Z'),
  };
  return { ...row, eventHash: integrity.computeSecurityAuditHash(row) };
}
const first = event(1);
const second = event(2, first.eventHash);
function serviceFor(rows, exported = []) {
  const repo = {
    securityIntegrityEvents: async () => rows,
    securityEventsForExport: async () => exported,
    securitySnapshotForExport: async () => ({ events: exported, integrityEvents: rows }),
    securityCount: async () => rows.length,
  };
  const serviceModule = load('apps/server/src/domains/audit/audit-service.ts', {
    './audit-repository.js': { createAuditRepository: () => repo },
    '../../core/security-audit-store.js': { appendSecurityAuditEvent: async () => {} },
    '../../core/cursor-pagination.js': { buildCursorPage: () => ({}) },
    '../../core/security-audit-integrity.js': integrity,
  });
  return serviceModule.createAuditService({ prisma: {}, logger: { error() {} } });
}
await test('intact two-event audit chain is reported verified', async () => {
  const result = await serviceFor([first, second]).verifySecurityIntegrity();
  assert.equal(result.ok, true); assert.equal(result.checked, 2);
  assert.equal(result.totalEvents, 2); assert.equal(result.uncheckedEvents, 0);
});
await test('unsupported or legacy records invalidate global integrity status', async () => {
  const legacy = { ...second, integrityVersion: 0 };
  const result = await serviceFor([legacy, first]).verifySecurityIntegrity();
  assert.equal(result.ok, false); assert.equal(result.checked, 1);
  assert.equal(result.totalEvents, 2); assert.equal(result.uncheckedEvents, 1);
  assert.match(result.error, /unchained or unsupported-version/);
});
await test('reclassifying final event cannot silently truncate apparent chain', async () => {
  const result = await serviceFor([first, { ...second, integrityVersion: 42 }]).verifySecurityIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.uncheckedEvents, 1);
});
await test('missing middle event fails the chained sequence validation', async () => {
  const third = event(3, second.eventHash);
  const result = await serviceFor([first, third]).verifySecurityIntegrity();
  assert.equal(result.ok, false); assert.match(result.error, /sequence gap/i);
});
await test('damaged v1 hash is not masked by coverage accounting', async () => {
  const result = await serviceFor([first, { ...second, metadata: '{"changed":true}' }]).verifySecurityIntegrity();
  assert.equal(result.ok, false); assert.match(result.error, /hash mismatch/i);
});
await test('export digest covers parsed metadata in the actual response projection', async () => {
  const row = { ...first, metadata: '{"action":"approved","count":2}', actor: { id: 'u1' } };
  const service = serviceFor([first], [row]);
  const response = await service.exportSecurity({limit: 20}, value => JSON.parse(value));
  assert.equal(response.format, 'cluster-security-audit-export/v2');
  assert.deepEqual(response.events[0].metadata, {action:'approved', count:2});
  const { exportDigestSha256, ...unsigned } = response;
  assert.equal(exportDigestSha256, createHash('sha256').update(integrity.stableAuditJson(unsigned),'utf8').digest('hex'));
  const unparsed = { ...unsigned, events: [{ ...row }] };
  assert.notEqual(exportDigestSha256, createHash('sha256').update(integrity.stableAuditJson(unparsed)).digest('hex'));
});
await test('offline verifier confirms untouched exports and rejects modified metadata', async () => {
  const service = serviceFor([first], [{...first,metadata:'{"safe":true}'}]);
  const envelope = await service.exportSecurity({limit:1}, value => JSON.parse(value));
  assert.equal(verifyExport(envelope).ok,true);
  const forged = structuredClone(envelope);
  forged.events[0].metadata.safe=false;
  assert.deepEqual(verifyExport(forged).code,'DIGEST_MISMATCH');
  assert.equal(verifyExport({...envelope,format:'cluster-security-audit-export/v1'}).ok,false);
});
await test('malformed persisted metadata cannot be silently erased during evidence export', async () => {
  const service = serviceFor([first], [{...first,metadata:'not-json'}]);
  await assert.rejects(service.exportSecurity({limit:1}, () => ({})), /invalid metadata JSON/);
  const other = serviceFor([first], [{...first,metadata:'[]'}]);
  await assert.rejects(other.exportSecurity({limit:1}, () => ({})), /non-object metadata/);
});
await test('integrity reports both malformed chain and unsupported-version evidence', async () => {
  const result = await serviceFor([first, {...second,eventHash:'invalid'}, {...second,id:'legacy',integrityVersion:0}]).verifySecurityIntegrity();
  assert.equal(result.ok,false);
  assert.match(result.error, /hash mismatch/);
  assert.match(result.error, /unchained or unsupported-version/);
});
await test('export refuses to compute an ambiguous digest without response parser', async () => {
  await assert.rejects(serviceFor([first]).exportSecurity({ limit: 10 }), /metadata parser/);
});
// Verify the actual SQL query contract doesn't hide tampered integrityVersion rows.
await test('integrity repository queries every audit version, not only version one', async () => {
  const repository = load('apps/server/src/domains/audit/audit-repository.ts', {
    '../../core/cursor-pagination.js': {cursorWhere: () => ({})},
    '../../core/security-audit-store.js': { appendSecurityAuditEvent() {} },
  });
  let called = 0;
  const repo = repository.createAuditRepository({
    securityAuditEvent: { findMany: async query => { called++; assert.ok(!('where' in query), 'integrity verification must read unchained rows'); return [first, second]; } },
  });
  assert.equal((await repo.securityIntegrityEvents()).length, 2); assert.equal(called, 1);
});
function routeHarness(auditResponse = {ok: true}, auditThrow = false) {
  const handlers = new Map(), writes = [];
  const exported = {
    format: 'cluster-security-audit-export/v2', exportDigestScope: 'stableAuditJson(payload without exportDigestSha256)',
    generatedAt: new Date().toISOString(), filters: {}, integrity: {ok: true},
    events: [{ id: 'audit-1', metadata: {action:'approved'} }], exportDigestSha256: 'a'.repeat(64),
  };
  const route = load('apps/server/src/domains/audit/audit-routes.ts', {
    '../../core/cursor-pagination.js': { decodeCursor: value => value },
    '@cluster/shared': {
      auditActivityQuerySchema: {parse: value=>value},
      securityEventExportQuerySchema: {parse: value=>value},
      securityEventQuerySchema: {parse: value=>value},
    },
  });
  route.registerAuditRoutes({
    app: { get: (path, fn) => handlers.set(path, fn) },
    authorization: {requireAdmin: async () => ({id: 'admin'})},
    parseJsonObject: value => JSON.parse(value),
    auditService: {exportSecurity: async (_, parser) => { assert.equal(typeof parser, 'function'); return exported; }},
    logSecurityEvent: async event => { writes.push(event); if (auditThrow) throw Error('audit offline'); return auditResponse; },
  });
  const reply = {status:200, headers:{}, code(value){this.status=value;return this;},header(name,value){this.headers[name]=value;return this;},send(payload){return payload;}};
  return {invoke:()=>handlers.get('/api/security/events/export')({query:{limit:2}},reply),reply,exported,writes};
}
await test('audit export returns exactly the digested projection after persisted audit confirmation', async () => {
  const fixture = routeHarness();
  const actual = await fixture.invoke();
  assert.deepEqual(actual, fixture.exported);
  assert.equal(fixture.reply.headers['X-Cluster-Audit-Digest-SHA256'], fixture.exported.exportDigestSha256);
  assert.equal(fixture.writes.length, 1); assert.equal(fixture.writes[0].metadata.exportDigestSha256, fixture.exported.exportDigestSha256);
});
await test('failed audit acknowledgment refuses to disclose security export', async () => {
  const fixture = routeHarness({ok:false});
  const actual = await fixture.invoke();
  assert.equal(fixture.reply.status, 503); assert.equal(actual.code,'SECURITY_AUDIT_WRITE_FAILED');
  assert.equal(fixture.reply.headers['Content-Disposition'], undefined);
  assert.equal(fixture.reply.headers['X-Cluster-Audit-Digest-SHA256'], undefined);
});
await test('thrown security writer also refuses to disclose export', async () => {
  const fixture = routeHarness({ok:true}, true);
  const actual = await fixture.invoke();
  assert.equal(fixture.reply.status,503); assert.equal(actual.code,'SECURITY_AUDIT_WRITE_FAILED');
});
await test('shared security logging facade returns persisted audit result to caller', async () => {
  const code = readFileSync('apps/server/src/app/server-services-settings-integrations.ts','utf8');
  const functionBody = code.slice(code.indexOf('async function logSecurityEvent('), code.indexOf('async function verifyUserPin('));
  assert.match(functionBody, /return result;/);
});
console.log(`G26 audit integrity/export authority: ${checks}/${checks} passed`);
