import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServerLifecycle, runServerStartup } from '../../apps/server/src/app/server-lifecycle.ts';

function fixture({ drain = async () => {}, close = async () => {}, onClose = async () => {} } = {}) {
  const events = [];
  const hooks = [];
  const app = {
    addHook(name, fn) { assert.equal(name, 'onClose'); hooks.push(fn); },
    log: { info() {}, error() {} },
    server: { closeAllConnections() { events.push('force-close-connections'); } },
    async close() {
      events.push('app-close');
      await close();
      for (const hook of hooks) { events.push('onClose'); await hook(); }
    },
  };
  const lifecycle = createServerLifecycle({
    app, shutdownTimeoutMs: 5_000,
    onDraining: async () => { events.push('drain'); await drain(); },
    onClose: async () => { events.push('cleanup'); await onClose(); },
  });
  return { app, lifecycle, events };
}

test('normal managed shutdown drains before releasing database and server', async () => {
  const { lifecycle, events } = fixture();
  await lifecycle.shutdown('managed-host');
  assert.deepEqual(events, ['drain', 'app-close', 'onClose', 'cleanup']);
});

test('a rejected drain still releases Fastify onClose resources and reports failure', async () => {
  const failure = new Error('durable event drain failed');
  const { lifecycle, events } = fixture({ drain: async () => { throw failure; } });
  await assert.rejects(lifecycle.shutdown('SIGTERM'), (error) => error === failure);
  assert.deepEqual(events, ['drain', 'app-close', 'onClose', 'cleanup']);
});

test('drain throwing undefined still fails shutdown instead of logging completion', async () => {
  const { lifecycle, events } = fixture({ drain: async () => { throw undefined; } });
  let fulfilled = false;
  try { await lifecycle.shutdown('SIGINT'); fulfilled = true; } catch { /* expected */ }
  assert.equal(fulfilled, false);
  assert.equal(events.at(-1), 'cleanup');
});

test('both drain and close failures are retained for diagnostics', async () => {
  const a = new Error('drain failed');
  const b = new Error('close failed');
  const { lifecycle, events } = fixture({
    drain: async () => { throw a; }, close: async () => { throw b; },
  });
  await assert.rejects(lifecycle.shutdown('SIGTERM'), (error) => error instanceof AggregateError && error.errors[0] === a && error.errors[1] === b);
  assert.deepEqual(events, ['drain', 'app-close']);
});

test('concurrent stop requests share one drain/close operation', async () => {
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const { lifecycle, events } = fixture({ drain: async () => { await gate; } });
  const first = lifecycle.shutdown('SIGTERM');
  const second = lifecycle.shutdown('SIGINT');
  resume();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['drain', 'app-close', 'onClose', 'cleanup']);
});

test('startup failure tries drain and resource cleanup and propagates original failure', async () => {
  const startupFailure = new Error('database bootstrap failed');
  const { app, lifecycle, events } = fixture();
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(runServerStartup({
      app, prepare: async () => { throw startupFailure; },
      listen: async () => { throw new Error('unreachable'); },
      onReady: async () => {},
      shutdown: lifecycle.shutdown,
    }), (error) => error === startupFailure);
    assert.equal(process.exitCode, 1);
    assert.deepEqual(events, ['drain', 'app-close', 'onClose', 'cleanup']);
  } finally { process.exitCode = previousExitCode; }
});
