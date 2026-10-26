import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/workflow/authorized-project-detail-navigation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports });
const { resolveAuthorizedProjectDetailNavigation: resolve, requiresAuthorizedProjectDetailNavigation: requires } = mod.exports;
let total = 0;
const check = async (name, fn) => { await fn(); total++; console.log('PASS ' + name); };
const scenarios = [
  ['build-artifact', 'delivery/build', 'direct'],
  ['qa-plan', 'delivery/qa-plan', 'direct'],
  ['qa-session', 'delivery/qa-session', 'direct'],
  ['release', 'delivery/release', 'direct'],
  ['source-review', 'source-control/reviews', 'review'],
  ['source-commit', 'source-control/commits', 'commit'],
];
for (const [scope, route, envelope] of scenarios) {
  const target = { screen: 'project', projectId: 'p1', projectTab: 'source', inspectScope: scope, inspectId: 'r1' };
  const good = envelope === 'direct' ? { id: 'r1', projectId: 'p1' } : { [envelope]: { id: 'r1' } };
  await check(`${scope} reaches exact authorized record endpoint`, async () => {
    assert.equal(requires(target), true);
    assert.equal((await resolve(target, { isCurrent: () => true, read: async (path) => {
      assert.equal(path, `/api/projects/p1/${route}/r1`); return good;
    } })).inspectId, 'r1');
  });
  await check(`${scope} refuses missing, revoked and mismatched record`, async () => {
    for (const value of [null, {}, envelope === 'direct' ? { id: 'different', projectId: 'p1' } : { [envelope]: { id: 'different' } }])
      assert.equal(await resolve(target, { isCurrent: () => true, read: async () => value }), null);
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => { throw Error('403'); } }), null);
    if (envelope === 'direct') assert.equal(await resolve(target, { isCurrent: () => true, read: async () => ({ id: 'r1', projectId: 'p2' }) }), null);
  });
  await check(`${scope} rejects stale selection or malformed identities`, async () => {
    let active = true;
    assert.equal(await resolve(target, { isCurrent: () => active, read: async () => { active = false; return good; } }), null);
    assert.equal(await resolve({ ...target, projectId: '' }, { isCurrent: () => true, read: async () => good }), null);
    assert.equal(await resolve({ ...target, inspectId: 'x'.repeat(201) }, { isCurrent: () => true, read: async () => good }), null);
  });
}
await check('other Project and tool screens use their existing handlers', async () => {
  for (const target of [{ screen: 'project', projectId: 'p1' }, { screen: 'project', projectId: 'p1', inspectScope: 'project-control', inspectId: 'c1' }, { screen: 'calendar', projectId: 'p1', inspectScope: 'calendar-event', inspectId: 'e1' }]) {
    assert.equal(requires(target), false);
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => { throw Error('unexpected'); } }), null);
  }
});
await check('central link handler runs project child admission before generic parent Project admission', async () => {
  const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  assert.ok(app.indexOf('if (requiresAuthorizedProjectDetailNavigation(incoming))') < app.indexOf('if (incoming.screen === "project")'));
  assert.match(app, /queryApi<ProjectDetailRead>\(path, \{\s*force: true, persist: false, staleWhileRevalidate: false/);
  assert.match(app, /resolveAuthorizedProjectDetailNavigation\(incoming, \{/);
});
await check('existing Project delivery and source readers enforce exact Project ownership', async () => {
  const delivery = read('apps/server/src/domains/projects/project-delivery-routes.ts');
  const service = read('apps/server/src/domains/projects/project-delivery-service.ts');
  const source = read('apps/server/src/domains/source-control/source-control-routes.ts');
  assert.match(delivery, /get\("\/api\/projects\/:projectId\/delivery\/:kind\/:id"[\s\S]*?projectFor\(request, reply, projectId, "view"\)/);
  assert.match(service, /where: \{ id, projectId, archived: false \}/);
  assert.match(source, /get\("\/api\/projects\/:projectId\/source-control\/reviews\/:reviewId"[\s\S]*?projectSourceContext\(deps, request, reply, projectId, "view"\)/);
  assert.match(source, /get\("\/api\/projects\/:projectId\/source-control\/commits\/:commitId"[\s\S]*?sourceControl", "view"/);
});
console.log(`${total}/${total} Pass 8 exact Project detail assertions passed`);
