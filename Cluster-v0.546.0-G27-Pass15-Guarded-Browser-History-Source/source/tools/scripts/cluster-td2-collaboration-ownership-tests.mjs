import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, dependencies = {}) {
  const transpiled = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', transpiled.outputText)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected dependency ${name} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const collab = load('apps/server/src/core/collaboration-runtime.ts');
const { CollaborationRuntime, collaborationRoomOwner } = collab;
const { createCollaborationAccessBoundary } = load('apps/server/src/domains/collaboration/collaboration-access.ts', {
  '../../core/collaboration-runtime.js': collab,
  '../presence/presence-policy-service.js': { sanitizePresenceForRecipient: (presence) => presence },
});
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS', name); }
function client(id) {
  const frames = [];
  const raw = { destroyed: false, writableEnded: false, end() { this.writableEnded = true; }, write(value) { frames.push(value); return true; } };
  return { client: { id, userId: id, sessionId: `session-${id}`, clientId: 'device', raw, lastSentAt: Date.now() }, frames, raw };
}
function presence(userId, tool, resourceId) { return { userId, userName: userId, tool, resourceId, clientId: 'device', updatedAt: Date.now() }; }
await check('Only directly owned collaboration rooms map to kill switches', () => {
  for (const t of ['calendar', 'library', 'scheduler', 'timeline']) assert.equal(collaborationRoomOwner(t), t);
  for (const t of ['project', 'board', 'whiteboard', 'release', 'build', 'qa', 'control']) assert.equal(collaborationRoomOwner(t), null);
});
await check('Disabling Library closes its own streams without disconnecting shared rooms', () => {
  const runtime = new CollaborationRuntime();
  const library = client('lib'); const board = client('board'); const calendar = client('cal');
  runtime.addStream('library', 'file:123', library.client);
  runtime.addStream('board', 'board:456', board.client);
  runtime.addStream('calendar', 'project', calendar.client);
  runtime.upsertPresence(presence('lib', 'library', 'file:123'), false);
  runtime.upsertPresence(presence('board', 'board', 'board:456'), false);
  assert.equal(runtime.disconnectTool('library'), 1);
  assert.equal(library.raw.writableEnded, true);
  assert.equal(board.raw.writableEnded, false);
  assert.equal(calendar.raw.writableEnded, false);
  assert.match(library.frames.join(''), /tool_disabled/);
  assert.equal(runtime.stateFor('library', 'file:123').presence.length, 0);
  assert.equal(runtime.stateFor('board', 'board:456').presence.length, 1);
  assert.equal(runtime.diagnostics().streamConnections, 2);
  runtime.close();
});
await check('Disable removes heartbeat-only presence and stale authorization cache', () => {
  const runtime = new CollaborationRuntime();
  runtime.upsertPresence(presence('heartbeat', 'calendar', 'project'), false);
  runtime.setCachedAccess('person:calendar:project:view', true);
  assert.equal(runtime.getCachedAccess('person:calendar:project:view'), true);
  assert.equal(runtime.disconnectTool('calendar'), 0);
  assert.equal(runtime.stateFor('calendar', 'project').presence.length, 0);
  assert.equal(runtime.getCachedAccess('person:calendar:project:view'), null);
  runtime.close();
});
function boundary(enabled = false) {
  const runtime = new CollaborationRuntime();
  const gate = { enabled };
  const auth = createCollaborationAccessBoundary({
    prisma: {
      project: { findUnique: async () => ({ id: 'project', archived: false }) },
      session: { findUnique: async () => ({ userId: 'person', expiresAt: new Date(Date.now() + 60_000), revokedAt: null }) },
      user: { findUnique: async () => ({ id: 'person' }) },
    },
    authorization: { authorize: async () => ({ allowed: true }), hasToolPermission: () => true },
    collaborationRuntime: runtime, decorateUserForClient: async () => ({}),
    getCurrentUser: async () => ({ id: 'person' }), parseLabels: () => [],
    libraryAccess: {},
    isToolEnabled: () => gate.enabled,
  });
  const reply = { status: null, body: null, code(value) { this.status = value; return this; }, send(value) { this.body = value; return this; } };
  return { auth, runtime, gate, reply };
}
await check('Disabled Calendar returns TOOL_DISABLED even with previously cached allow', async () => {
  const { auth, runtime, reply } = boundary(false);
  runtime.setCachedAccess('person:calendar:project:view', true);
  assert.equal(await auth({}, reply, 'calendar', 'project'), false);
  assert.equal(reply.status, 503); assert.equal(reply.body.code, 'TOOL_DISABLED');
  runtime.close();
});
await check('Re-enable restores access and disabled state revokes stream reauthorization', async () => {
  const { auth, runtime, gate, reply } = boundary(true);
  assert.equal(await auth({}, reply, 'calendar', 'project'), true);
  gate.enabled = false;
  assert.equal(await runtime.accessController.authorize({ userId: 'person', sessionId: 'session', clientId: 'device' }, 'calendar', 'project'), false);
  gate.enabled = true;
  assert.equal(await runtime.accessController.authorize({ userId: 'person', sessionId: 'session', clientId: 'device' }, 'calendar', 'project'), true);
  runtime.close();
});
await check('Project rooms keep their separate permissions when Calendar disabled', async () => {
  const { auth, runtime, reply } = boundary(false);
  assert.equal(await auth({}, reply, 'project', 'project'), true);
  runtime.close();
});
await check('Application reconciles enabled-to-disabled transitions and wires the request gate', () => {
  const server = read('apps/server/src/app/cluster-server.ts');
  assert.match(server, /collaborationRoomOwner\(tool as CollaborationTool\) === tool/);
  assert.match(server, /collaborationRuntime\.disconnectTool\(tool as CollaborationTool\)/);
  assert.match(server, /isToolEnabled: \(owner\) => backgroundTasks\.isOwnerEnabled\(owner\)/);
});
await check('Stream closes during initial state loading without leaked telemetry or duplicate cleanup', () => {
  const routes = read('apps/server/src/domains/collaboration/collaboration-routes.ts');
  const listener = routes.indexOf('request.raw.once("close", cleanup);');
  const projection = routes.indexOf('await collaborationRuntime.stateForRecipient(client, query.tool, query.resourceId)');
  assert.ok(listener > 0 && projection > listener, 'cleanup must precede awaiting state projection');
  assert.match(routes, /if \(cleanedUp\) return;/);
  assert.match(routes, /if \(!cleanedUp\) collaborationRuntime\.sendEvent\(client, "state", initialState\)/);
});
console.log(`${passed}/${passed} TD2 collaboration ownership checks passed`);
