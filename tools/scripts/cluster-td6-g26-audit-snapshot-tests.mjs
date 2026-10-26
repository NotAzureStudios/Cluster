#!/usr/bin/env node
// Executes the actual TypeScript repository/service through a lightweight
// transpilation harness. Simulated MVCC is a contract test, NOT PostgreSQL QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS audit snapshot: ${name}`); }
function load(file, mocks) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  }}).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (name in mocks) return mocks[name];
    if (name === 'node:crypto') return require(name);
    throw Error(`${file}: unexpected import ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
const integrity = load('apps/server/src/core/security-audit-integrity.ts', {
  'node:crypto': require('node:crypto'),
  './security-observability.js': {
    redactForLog: val => val, redactSensitiveText: val => String(val),
    sanitizeClientCorrelationId: val => val || null, sanitizeRequestPath: val => String(val || '/'),
  },
});
const repoModule = load('apps/server/src/domains/audit/audit-repository.ts', {
  '../../core/cursor-pagination.js': { cursorWhere: () => ({}) },
  '../../core/security-audit-store.js': { appendSecurityAuditEvent: async () => {} },
});
const serviceModule = load('apps/server/src/domains/audit/audit-service.ts', {
  './audit-repository.js': repoModule,
  '../../core/security-audit-store.js': { appendSecurityAuditEvent: async () => {} },
  '../../core/cursor-pagination.js': { buildCursorPage: () => ({}) },
  '../../core/security-audit-integrity.js': integrity,
});
function event(sequence, prior = integrity.SECURITY_AUDIT_GENESIS_HASH) {
  const fields = {
    id: `evt-${sequence}`, sequence, integrityVersion: 1, previousHash: prior,
    event: 'security.example', result: 'SUCCESS', reasonCode: 'TEST',
    actorUserId: null, targetUserId: null, workspaceId: null,
    requestId: null, requestMethod: null, requestPath: null,
    sessionId: null, ipAddress: null, userAgent: null,
    metadata: '{"safe":true}', occurredAt: new Date('2026-10-22T12:00:00Z'),
  };
  return { ...fields, eventHash: integrity.computeSecurityAuditHash(fields) };
}
const first = event(1);
const next = event(2, first.eventHash);
const query = { limit: 5000 };
const parse = value => JSON.parse(value);

// This fake emulates REPEATABLE READ and a concurrent append between reads;
// the repository still must request real PG isolation via Prisma.
function fixture({ reject = false, corrupt = false } = {}) {
  const live = [first];
  const invocations = [];
  let transactions = 0;
  let options = null;
  const prisma = {
    $transaction: async (fn, opts) => {
      transactions++; options = opts;
      if (reject) throw Error('snapshot unavailable');
      const frozen = [...live];
      let reads = 0;
      return fn({ securityAuditEvent: { findMany: async opts => {
        invocations.push(opts);
        reads++;
        if (reads === 1) live.push(next);
        if (opts.select) return corrupt ? [{...first, eventHash:'bad'}] : frozen;
        return frozen;
      }}});
    },
    securityAuditEvent: { findMany: async () => [...live] },
  };
  return { prisma, live, invocations, get options() { return options; }, get transactions() { return transactions; } };
}
await test('export requests one bounded REPEATABLE READ transaction', async () => {
  const f = fixture();
  const service = serviceModule.createAuditService({ prisma: f.prisma, logger: {error(){}} });
  const exported = await service.exportSecurity(query, parse);
  assert.equal(f.transactions, 1);
  assert.deepEqual(f.options, { isolationLevel:'RepeatableRead', maxWait:5000, timeout:30000 });
  assert.equal(f.invocations.length,2);
  assert.equal(exported.events.length,1);
  assert.equal(exported.integrity.totalEvents,1);
  assert.equal(exported.integrity.lastSequence,1);
  assert.equal(exported.integrity.ok,true);
  assert.equal(f.live.length,2, 'a concurrent append occurred outside the snapshot');
  assert.match(exported.snapshotConsistency, /REPEATABLE READ/);
  assert.equal(exported.integrityScope,'global-audit-table-at-export-snapshot');
});
await test('export always reads global chain even when filtered event count is zero', async () => {
  const f = fixture();
  const result = await serviceModule.createAuditService({prisma:f.prisma,logger:{error(){}}})
    .exportSecurity({...query, event:'no.such.event'},parse);
  // Mock does not evaluate where itself; confirm the repository applied filters
  // ONLY to event projection, not integrity verification.
  assert.equal(f.invocations[0].where.event,'no.such.event');
  assert.equal('where' in f.invocations[1],false);
  assert.equal(result.integrity.totalEvents,1);
});
await test('corrupt chain inside snapshot fails integrity rather than showing clean', async () => {
  const f = fixture({corrupt:true});
  const result = await serviceModule.createAuditService({prisma:f.prisma,logger:{error(){}}}).exportSecurity(query,parse);
  assert.equal(result.integrity.ok,false);
  assert.match(result.integrity.error,/hash mismatch/);
});
await test('failed isolation is not replaced with inconsistent nontransactional reads', async () => {
  const f = fixture({reject:true});
  const service = serviceModule.createAuditService({prisma:f.prisma,logger:{error(){}}});
  await assert.rejects(service.exportSecurity(query,parse),/snapshot unavailable/);
  assert.equal(f.transactions,1);
  assert.equal(f.invocations.length,0);
});
await test('read-only audit integrity endpoint is distinct from export snapshot', async () => {
  const f = fixture();
  const result = await serviceModule.createAuditService({prisma:f.prisma,logger:{error(){}}}).verifySecurityIntegrity();
  assert.equal(result.totalEvents,1);
  assert.equal(f.transactions,0);
});
await test('digest and independent verifier both use the exported snapshot projection', async () => {
  const f = fixture();
  const result = await serviceModule.createAuditService({prisma:f.prisma,logger:{error(){}}}).exportSecurity(query,parse);
  const {exportDigestSha256,...withoutDigest} = result;
  const crypto = require('node:crypto');
  assert.equal(exportDigestSha256,crypto.createHash('sha256').update(integrity.stableAuditJson(withoutDigest),'utf8').digest('hex'));
});
await test('route refuses export when snapshot fails, without claiming an audit export', async () => {
  const handlers = new Map();
  let logged = 0;
  const routeModule = load('apps/server/src/domains/audit/audit-routes.ts', {
    '../../core/cursor-pagination.js': {decodeCursor:v=>v},
    '@cluster/shared': {
      securityEventExportQuerySchema:{parse:v=>v},
      securityEventQuerySchema:{parse:v=>v},
      auditActivityQuerySchema:{parse:v=>v},
    },
  });
  routeModule.registerAuditRoutes({
    app:{get:(path, fn)=>handlers.set(path,fn)},
    authorization:{requireAdmin:async()=>({id:'admin'})},
    parseJsonObject:parse,
    auditService:{exportSecurity:async()=>{throw Error('transaction timed out')}},
    logSecurityEvent:async()=>{logged++;return {ok:true}},
  });
  const reply = {status:200, headers:{},code(value){this.status=value;return this},
    header(key,val){this.headers[key]=val;return this}, send(body){return body}};
  const response = await handlers.get('/api/security/events/export')({query:{limit:5}},reply);
  assert.equal(reply.status,503);
  assert.deepEqual(response,{ok:false,code:'SECURITY_AUDIT_SNAPSHOT_UNAVAILABLE'});
  assert.equal(logged,0);
  assert.equal(reply.headers['X-Cluster-Audit-Digest-SHA256'],undefined);
  assert.equal(reply.headers['Content-Disposition'],undefined);
  assert.equal(reply.headers['Cache-Control'],'no-store');
});
console.log(`G26 transactional audit export: ${passed}/${passed} passed`);
