import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const file = 'packages/renderer/src/features/workflow/authorized-detail-navigation.ts';
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports }, { filename: file });
const { resolveAuthorizedDetailNavigation: resolve, requiresAuthorizedDetailNavigation: requires } = mod.exports;
let total = 0;
const check = async (title, fn) => { await fn(); total++; console.log(`PASS ${title}`); };
const targets = [
  ['whiteboard', { screen: 'whiteboard', whiteboardId: 'w.1', projectId: 'stale' }, '/api/whiteboards/w.1'],
  ['calendar', { screen: 'calendar', inspectScope: 'calendar-event', inspectId: 'c.1', projectId: 'stale' }, '/api/calendar/events/c.1'],
  ['scheduler', { screen: 'scheduler', inspectScope: 'schedule-block', inspectId: 's.1', projectId: 'stale' }, '/api/schedule/blocks/s.1'],
  ['timeline', { screen: 'timeline', inspectScope: 'timeline-item', inspectId: 't.1', projectId: 'stale' }, '/api/timeline/items/t.1'],
  ['library', { screen: 'library', inspectScope: 'library-item', inspectId: 'l.1', projectId: 'stale' }, '/api/library/l.1'],
  ['people', { screen: 'people', inspectScope: 'person', inspectId: 'u.1', projectId: 'stale' }, '/api/users/u.1/profile'],
  ['tickets', { screen: 'tickets', inspectScope: 'ticket', inspectId: 'ticket.1', projectId: 'stale' }, '/api/cards/ticket.1'],
  ['approvals', { screen: 'admin', inspectScope: 'approval', inspectId: 'ap.1', projectId: 'stale' }, '/api/admin/approvals/ap.1'],
];
for (const [kind, target, path] of targets) {
  const id = target.whiteboardId || target.inspectId;
  await check(`${kind} exact endpoint and current placement`, async () => {
    assert.equal(requires(target), true);
    const result = await resolve(target, { isCurrent: () => true, read: async (actual) => {
      assert.equal(actual, path); return kind === 'tickets' ? { id, workItemKind: 'ticket', list: { board: { id: 'board-1', projectId: 'current-project' } } } : kind === 'approvals' ? { approval: { id } } : { id, projectId: 'current-project' };
    } });
    assert.equal(result.projectId, ['people', 'approvals'].includes(kind) ? null : 'current-project');
    assert.equal(result.inspectId, target.inspectId);
  });
  await check(`${kind} denied/missing/mismatched fail closed`, async () => {
    for (const value of [null, undefined, { id: 'wrong', projectId: 'p' }, { error: '403' }]) {
      assert.equal(await resolve(target, { isCurrent: () => true, read: async () => value }), null);
    }
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => { throw new Error('403'); } }), null);
  });
  await check(`${kind} stale navigation, malformed and oversized IDs`, async () => {
    assert.equal(await resolve(target, { isCurrent: () => false, read: async () => { throw new Error('should not read'); } }), null);
    assert.equal(await resolve({ ...target, [target.whiteboardId ? 'whiteboardId' : 'inspectId']: ' '.repeat(2) }, { isCurrent: () => true, read: async () => ({ id }) }), null);
    assert.equal(await resolve({ ...target, [target.whiteboardId ? 'whiteboardId' : 'inspectId']: 'x'.repeat(201) }, { isCurrent: () => true, read: async () => ({ id }) }), null);
    let active = true;
    assert.equal(await resolve(target, { isCurrent: () => active, read: async () => { active = false; return { id, projectId: 'p' }; } }), null);
  });
  if (!['people', 'tickets', 'approvals'].includes(kind)) {
    await check(`${kind} missing/malformed placement refused`, async () => {
      for (const value of [{ id }, { id, projectId: 47 }, { id, projectId: '  ' }, { id, projectId: 'x'.repeat(201) }])
        assert.equal(await resolve(target, { isCurrent: () => true, read: async () => value }), null);
      assert.equal((await resolve(target, { isCurrent: () => true, read: async () => ({ id, projectId: null }) })).projectId, null);
    });
  }
}
await check('Ticket kind and owning Board enforced independently', async () => {
  const target = targets.find((entry) => entry[0] === 'tickets')[1];
  for (const result of [
    { id: 'ticket.1', workItemKind: 'card', list: { board: { id: 'b', projectId: 'p' } } },
    { id: 'ticket.1', workItemKind: 'ticket' },
    { id: 'ticket.1', workItemKind: 'ticket', list: { board: { id: 'b' } } },
    { id: 'ticket.1', workItemKind: 'ticket', list: { board: { id: 'b', projectId: null } } },
    { id: 'ticket.1', workItemKind: 'ticket', list: { board: { id: '', projectId: 'p' } } },
  ]) assert.equal(await resolve(target, { isCurrent: () => true, read: async () => result }), null);
  assert.equal((await resolve(target, { isCurrent: () => true, read: async () => ({ id: 'ticket.1', workItemKind: 'ticket', list: { board: { id: 'new-board', projectId: 'new-project' } } }) })).projectId, 'new-project');
});
await check('approval wrapper is required and exact ID is compared', async () => {
  const target = targets.find((entry) => entry[0] === 'approvals')[1];
  for (const result of [{ id: 'ap.1' }, { approval: { id: 'other' } }, { approval: null }])
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => result }), null);
});
await check('index-only views not intercepted', async () => {
  for (const target of [{ screen: 'whiteboard' }, { screen: 'calendar' }, { screen: 'people' }, { screen: 'library' }, { screen: 'board', boardId: 'b1' }, { screen: 'project', projectId: 'p1' }, { screen: 'inbox' }]) {
    assert.equal(requires(target), false);
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => { throw new Error('No fetch for index'); } }), null);
  }
});
await check('URL-encoded identity and canonical path', async () => {
  const target = { screen: 'library', inspectScope: 'library-item', inspectId: 'foo/bar', projectId: 'old' };
  assert.equal((await resolve(target, { isCurrent: () => true, read: async (path) => {
    assert.equal(path, '/api/library/foo%2Fbar'); return { id: 'foo/bar', projectId: null };
  } })).projectId, null);
});
const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
await check('central handler admits before applying navigation', async () => {
  assert.match(app, /if \(requiresAuthorizedDetailNavigation\(incoming\)\)/);
  assert.match(app, /resolveAuthorizedDetailNavigation\(incoming, \{/);
  assert.match(app, /queryApi<DetailNavigationRead>\(path, \{\s*force: true, persist: false, staleWhileRevalidate: false/);
  assert.match(app, /sequence === navigationSequence/);
  assert.match(app, /Your current workspace was preserved/);
});
await check('standalone whiteboard does not inherit unrelated project', async () => {
  assert.match(app, /target\.screen === "whiteboard" && target\.whiteboardId/);
  assert.match(app, /setProjectId\(null\)/);
});
await check('domain read endpoints are already permission-controlled', async () => {
  assert.match(read('apps/server/src/domains/planning/calendar-routes.ts'), /app\.get\("\/api\/calendar\/events\/:eventId"[\s\S]*?canViewEvent\(request, event\)/);
  assert.match(read('apps/server/src/domains/planning/timeline-routes.ts'), /app\.get\("\/api\/timeline\/items\/:itemId"[\s\S]*?canViewTimelineItem\(request, item\)/);
  assert.match(read('apps/server/src/domains/time/time-routes.ts'), /app\.get\("\/api\/schedule\/blocks\/:blockId"[\s\S]*?canViewScheduleBlock\(request, block\)/);
  assert.match(read('apps/server/src/app/server-routes-access-media.ts'), /app\.get\("\/api\/admin\/approvals\/:approvalId"[\s\S]*?adminForApprovals\(request, reply\)/);
  assert.match(read('apps/server/src/domains/cards/card-routes.ts'), /app\.get\("\/api\/cards\/:cardId"[\s\S]*?requireCard\(request, reply, cardId, "view"\)/);
  assert.match(read('apps/server/src/domains/library/library-routes.ts'), /app\.get\("\/api\/library\/:itemId"[\s\S]*?findAccessibleItem\(request, reply, params\.itemId\)/);
  assert.match(read('apps/server/src/app/server-routes-media-whiteboards.ts'), /app\.get\("\/api\/whiteboards\/:whiteboardId"[\s\S]*?enforceTargetAccess\(request, reply, "whiteboard"/);
});
console.log(`${total}/${total} G27 Pass 7 authorized detail checks passed`);
