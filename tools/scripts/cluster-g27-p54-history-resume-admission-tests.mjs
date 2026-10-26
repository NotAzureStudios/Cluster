import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const root = new URL('../../', import.meta.url);
const source = (file) => readFileSync(new URL(file, root), 'utf8');
const transpile = (file, modules = {}) => {
  const out = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: out.exports, module: out, require: (id) => {
    if (!Object.hasOwn(modules, id)) throw Error(`Unexpected dependency ${id} in ${file}`);
    return modules[id];
  } }, { filename: file });
  return out.exports;
};
const project = transpile('packages/renderer/src/features/workflow/authorized-project-navigation.ts');
const board = transpile('packages/renderer/src/features/workflow/authorized-board-navigation.ts');
const detail = transpile('packages/renderer/src/features/workflow/authorized-detail-navigation.ts');
const createNavigationState = (route, input = {}) => ({ route, section: input.section || null, subsection: input.subsection || null,
  context: { projectId: input.projectId || null, boardId: input.boardId || null, whiteboardId: input.whiteboardId || null } });
const { admitAuthorizedHistoryNavigation } = transpile('packages/renderer/src/features/workflow/authorized-history-navigation.ts', {
  '../../core/navigation': { createNavigationState },
  './authorized-project-navigation': project,
  './authorized-board-navigation': board,
  './authorized-detail-navigation': detail,
});
let total = 0;
async function check(name, fn) { await fn(); console.log('PASS', name); total++; }
const history = (route, context = {}) => createNavigationState(route, { ...context, section: 'overview', subsection: 'activity' });
const inputs = (changes = {}) => ({
  canOpen: () => true, isCurrent: () => true,
  readProject: async (id) => ({ id }), readBoard: async (id) => ({ id, projectId: 'new-project' }),
  readWhiteboard: async (path) => ({ id: path.split('/').at(-1), projectId: 'whiteboard-home' }), ...changes,
});
await check('History: Project requires a fresh authorized read', async () => {
  const result = await admitAuthorizedHistoryNavigation(history('project', { projectId: 'p1' }), inputs());
  assert.equal(result.context.projectId, 'p1');
  assert.equal(result.section, 'overview');
});
await check('History: inaccessible Project leaves workspace untouched', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('project', { projectId: 'p1' }), inputs({ readProject: async () => { throw Error('403'); } })), null);
});
await check('History: a Project with mismatched ID is refused', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('project', { projectId: 'p1' }), inputs({ readProject: async () => ({ id: 'p2' }) })), null);
});
await check('History: incomplete Project locator is refused', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('project'), inputs()), null);
});
await check('History: moved Board uses current Project', async () => {
  const result = await admitAuthorizedHistoryNavigation(history('board', { projectId: 'old-project', boardId: 'b1' }), inputs());
  assert.equal(result.context.projectId, 'new-project');
  assert.equal(result.context.boardId, 'b1');
});
await check('History: standalone Board clears previous Project', async () => {
  const result = await admitAuthorizedHistoryNavigation(history('board', { projectId: 'old', boardId: 'b1' }), inputs({readBoard: async (id) => ({ id, projectId: null })}));
  assert.equal(result.context.projectId, null);
});
await check('History: Board without server placement is refused', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('board', { boardId: 'b1' }), inputs({ readBoard: async (id) => ({id}) })), null);
});
await check('History: inaccessible Board is refused', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('board', { boardId: 'b1' }), inputs({ readBoard: async () => { throw Error('404'); } })), null);
});
await check('History: Whiteboard revalidates specific record and placement', async () => {
  const result = await admitAuthorizedHistoryNavigation(history('whiteboard', { whiteboardId: 'w1', projectId: 'old' }), inputs());
  assert.equal(result.context.projectId, 'whiteboard-home');
  assert.equal(result.context.whiteboardId, 'w1');
});
await check('History: revoked Whiteboard is refused', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('whiteboard', { whiteboardId: 'w1' }), inputs({ readWhiteboard: async () => null })), null);
});
await check('History: no unknown tool is opened when current user cannot view it', async () => {
  assert.equal(await admitAuthorizedHistoryNavigation(history('admin'), inputs({ canOpen: () => false })), null);
});
await check('History: plain tool restored only while authorized', async () => {
  assert.equal((await admitAuthorizedHistoryNavigation(history('calendar'), inputs())).route, 'calendar');
});
await check('History: revoked permission while pending blocks restore', async () => {
  let allowed = true;
  const result = await admitAuthorizedHistoryNavigation(history('project', {projectId:'p1'}), inputs({
    canOpen: () => allowed,
    readProject: async (id) => { allowed = false; return {id}; },
  }));
  assert.equal(result, null);
});
await check('History: session switch while pending blocks restore', async () => {
  let valid = true;
  assert.equal(await admitAuthorizedHistoryNavigation(history('board', {boardId:'b1'}), inputs({
    isCurrent: () => valid,
    readBoard: async id => { valid = false; return { id, projectId: 'p1' }; },
  })), null);
});
const app = source('packages/renderer/src/features/application/ClusterApplication.tsx');
await check('Application uses fresh resource reads and avoids persisted API cache', async () => {
  assert.match(app, /admitAuthorizedHistoryNavigation\(candidate, \{/);
  assert.match(app, /readProject: \(id\) => queryApi<AuthorizedProjectRead>[\s\S]*?force: true, persist: false, staleWhileRevalidate: false/);
  assert.match(app, /readBoard: \(id\) => queryApi<AuthorizedBoardRead>[\s\S]*?force: true, persist: false, staleWhileRevalidate: false/);
});
await check('Application uses a session epoch, not only the account ID', async () => {
  assert.match(app, /historyAccountRef\.current\.epoch \+ 1/);
  assert.match(app, /owner\.epoch === historyAuthRef\.current\.epoch/);
  assert.match(app, /sequence === navigationSequence/);
  assert.match(app, /interactiveEpoch === interactiveNavigationEpochRef\.current/);
  assert.match(app, /interactiveNavigationEpochRef\.current \+= 1/);
});
await check('History denial preserves active workspace and canonical URL', async () => {
  assert.match(app, /if \(!admitted\) \{ keepCurrent\(\); return; \}/);
  assert.match(app, /window\.history\.replaceState\(current/);
});
await check('History canonicalizes moved resources after admission', async () => {
  assert.match(app, /applyNavigation\(admitted\);[\s\S]*?window\.history\.replaceState\(admitted/);
});
await check('Resume Board/Whiteboard/Project uses the shared authorization admission event', async () => {
  const resume = app.slice(app.indexOf('function resumeWorkspace()'), app.indexOf('function openServerConfiguration('));
  assert.match(resume, /openClusterWorkNavigation\(\{ screen: "board"/);
  assert.match(resume, /openClusterWorkNavigation\(\{ screen: "whiteboard"/);
  assert.match(resume, /openClusterWorkNavigation\(\{ screen: "project"/);
  assert.doesNotMatch(resume, /setBoardId|setWhiteboardId|openProject\(/);
});
console.log(`${total}/${total} G27 P54 history and resume tests passed`);
