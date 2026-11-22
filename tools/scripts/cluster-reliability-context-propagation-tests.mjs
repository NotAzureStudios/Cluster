// The user and workspace resolved in an async preHandler (after an await) must
// reach the route handler. enterWith there is lost; the request's context is
// updated in place instead.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { currentReliabilityContext, enterReliabilityContext, updateReliabilityContext } from '../../apps/server/src/core/reliability-context.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Fastify = createRequire(path.join(root, 'apps/server/package.json'))('fastify');
let n = 0; const check = (label, fn) => Promise.resolve(fn()).then(() => { n++; console.log('PASS', label); });

const app = Fastify();
app.addHook('onRequest', async (request) => { enterReliabilityContext({ correlationId: `c-${request.headers['x-user']}`, requestId: String(request.id) }); });
app.addHook('preHandler', async (request) => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  updateReliabilityContext({ userId: String(request.headers['x-user']), workspaceId: `w-${request.headers['x-user']}` });
});
app.get('/', async () => {
  await new Promise((resolve) => setTimeout(resolve, 2));
  return currentReliabilityContext();
});

await check('handler sees the user and workspace resolved after an await', async () => {
  const body = (await app.inject({ url: '/', headers: { 'x-user': 'alice' } })).json();
  assert.equal(body.userId, 'alice'); assert.equal(body.workspaceId, 'w-alice'); assert.equal(body.correlationId, 'c-alice');
});
await check('concurrent requests never see each other\'s context', async () => {
  const users = Array.from({ length: 40 }, (_, i) => `u${i}`);
  const bodies = await Promise.all(users.map((user) => app.inject({ url: '/', headers: { 'x-user': user } }).then((r) => r.json())));
  bodies.forEach((body, i) => { assert.equal(body.userId, users[i]); assert.equal(body.workspaceId, `w-${users[i]}`); assert.equal(body.correlationId, `c-${users[i]}`); });
});
await check('an empty update keeps what the request already had', async () => {
  const local = Fastify();
  local.addHook('onRequest', async () => { enterReliabilityContext({ correlationId: 'keep', workspaceId: 'w1' }); });
  local.addHook('preHandler', async () => { await null; updateReliabilityContext({ workspaceId: null }); });
  local.get('/', async () => currentReliabilityContext());
  const body = (await local.inject({ url: '/' })).json();
  assert.equal(body.workspaceId, 'w1'); assert.equal(body.correlationId, 'keep');
  await local.close();
});
await app.close();
console.log(`Reliability context propagation: ${n}/${n} passed`);
