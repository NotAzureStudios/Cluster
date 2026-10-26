/** TD5 P7: actual server runtime PostgreSQL compatibility and bounded pool math. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseResourceBudget } from '../../apps/server/src/core/database-resource-budget.ts';
import { configurePostgresqlRuntime } from '../../apps/server/src/core/postgresql-runtime.ts';

const keys = ['CLUSTER_DB_CONNECTION_BUDGET', 'CLUSTER_DB_RESERVED_CONNECTIONS', 'CLUSTER_DB_EXPECTED_API_NODES', 'CLUSTER_DB_POOL_MODE'];
function budget(overrides = {}, url = 'postgresql://user:secret@localhost/cluster') {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) process.env[key] = String(value);
    return databaseResourceBudget(url);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
}
const logger = { info() {}, warn() {} };
const fake = (version_num, recovery = false) => ({ $queryRawUnsafe: async () => [{ version_num, timezone: 'UTC', recovery }] });

test('PostgreSQL 17 is not certified compatible with server startup', async () => {
  await assert.rejects(configurePostgresqlRuntime(fake(170008), 'postgresql://user@localhost/db', logger), /PostgreSQL 18/);
});
test('PostgreSQL 18 primary remains accepted', async () => {
  const state = await configurePostgresqlRuntime(fake(180006), 'postgresql://user@localhost/db', logger);
  assert.equal(state.versionNumber, 180006);
});
test('PostgreSQL 18 replica is not writable', async () => {
  await assert.rejects(configurePostgresqlRuntime(fake(180006, true), 'postgresql://user@localhost/db', logger), /writable PostgreSQL primary/);
});
test('default connection budget never exceeds global reservation', () => {
  const v = budget();
  assert(v.apiPoolMax >= 1);
  assert(v.reservedConnections + v.expectedApiNodes * (v.apiPoolMax + v.coordinationConnectionsPerNode) <= v.globalBudget);
});
test('oversized URL pool request is clamped to the fair-share budget', () => {
  const v = budget({ CLUSTER_DB_CONNECTION_BUDGET: 32, CLUSTER_DB_RESERVED_CONNECTIONS: 4, CLUSTER_DB_EXPECTED_API_NODES: 4 },
    'postgresql://user:secret@localhost/cluster?connection_limit=500');
  assert.equal(v.apiPoolMax, 6);
  assert.equal(v.reservedConnections + v.expectedApiNodes * (v.apiPoolMax + 1), 32);
});
test('small but viable connection budgets permit single-connection pools', () => {
  const v = budget({ CLUSTER_DB_CONNECTION_BUDGET: 7, CLUSTER_DB_RESERVED_CONNECTIONS: 1, CLUSTER_DB_EXPECTED_API_NODES: 3 });
  assert.equal(v.apiPoolMax, 1);
});
test('impossible node or reservation configurations fail before creating pools', () => {
  assert.throws(() => budget({ CLUSTER_DB_CONNECTION_BUDGET: 10, CLUSTER_DB_RESERVED_CONNECTIONS: 5, CLUSTER_DB_EXPECTED_API_NODES: 3 }), /cannot support/);
  assert.throws(() => budget({ CLUSTER_DB_CONNECTION_BUDGET: 2, CLUSTER_DB_RESERVED_CONNECTIONS: 1, CLUSTER_DB_EXPECTED_API_NODES: 1 }), /cannot support/);
});
test('valid small URL limit is preserved, but no lower than one connection', () => {
  const v = budget({}, 'postgresql://user:secret@localhost/cluster?connection_limit=1');
  assert.equal(v.apiPoolMax, 1);
});
test('noninteger overrides cannot trick the pool calculator into oversized requests', () => {
  assert.equal(budget({}, 'postgresql://user@localhost/cluster?connection_limit=999garbage').apiPoolMax <= 24, true);
  const v = budget({ CLUSTER_DB_EXPECTED_API_NODES: '2units' });
  assert.equal(v.expectedApiNodes, 1);
});
test('pool-mode selection continues to honor configured transaction mode', () => {
  assert.equal(budget({ CLUSTER_DB_POOL_MODE: 'transaction' }).poolMode, 'transaction');
  assert.equal(budget({ CLUSTER_DB_POOL_MODE: 'bogus' }).poolMode, 'session');
});
