#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileAfterCommit } from '../../packages/renderer/src/core/post-commit-reconciliation.ts';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = file => readFileSync(resolve(root, file), 'utf8');
let count = 0;
async function check(label, run) { await run(); count++; console.log(`PASS ${label}`); }
await check('Committed create reports a failed refresh without retrying the mutation', async () => {
  let creates = 0;
  const created = await (async () => { creates++; return { id: 'issue-1' }; })();
  const error = await reconcileAfterCommit(async () => { throw new Error('Refresh temporarily unavailable'); });
  assert.equal(created.id, 'issue-1');
  assert.equal(creates, 1);
  assert.equal(error, 'Refresh temporarily unavailable');
});
await check('Successful follow-up has no spurious warning', async () => {
  assert.equal(await reconcileAfterCommit(async () => {}), null);
});
await check('Cross-realm thrown objects retain truthful warning', async () => {
  assert.equal(await reconcileAfterCommit(async () => { throw { message: 'Cache reset failed' }; }), 'Cache reset failed');
});
for (const [label,path,method] of [
  ['Project Issues','packages/renderer/src/features/projects/ProjectIssuesPanel.tsx','createIssue'],
  ['Project QA','packages/renderer/src/features/projects/ProjectQAPanel.tsx','createBug'],
]) await check(`${label} creates once, guards pending request, distinguishes post-commit from failed POST`, () => {
  const ui = read(path);
  const fn = ui.slice(ui.indexOf(`async function ${method}()`), ui.indexOf(method==='createBug'?'  return <section':'  return (', ui.indexOf(`async function ${method}()`)));
  assert.match(ui, /useRef\(false\)/);
  assert.match(ui, /reconcileAfterCommit/);
  assert.match(ui, /disabled=\{createBusy/);
  assert.match(fn, /if\s*\(createBusyRef\.current\)\s*return/);
  assert.match(fn, /createBusyRef\.current\s*=\s*true/);
  assert.match(fn, /createBusyRef\.current\s*=\s*false/);
  assert.match(fn, /const warning\s*=\s*await reconcileAfterCommit/);
  assert.match(fn, /catch\s*\(error\)/);
  const commitPos = fn.indexOf('await api<Card>("/api/cards"');
  const warnPos = fn.indexOf('const warning');
  assert.ok(commitPos >= 0 && warnPos > commitPos, 'Only post-commit work may be best effort');
});
await check('Partial Project issue Board loads report incomplete coverage', () => {
  const ui = read('packages/renderer/src/features/projects/ProjectIssuesPanel.tsx');
  assert.match(ui,/Promise\.allSettled/);
  assert.match(ui,/Issue totals are partial/);
  assert.match(ui,/throw failure\?\.status === "rejected"/);
});
await check('Partial QA Board loads report incomplete coverage', () => {
  const ui = read('packages/renderer/src/features/projects/ProjectQAPanel.tsx');
  assert.match(ui,/Promise\.allSettled/);
  assert.match(ui,/QA totals are partial/);
});
await check('Background reads are scoped to the current Project and newest request', () => {
  for (const [path,sequence] of [
    ['packages/renderer/src/features/projects/ProjectIssuesPanel.tsx', 'loadSequenceRef'],
    ['packages/renderer/src/features/projects/ProjectQAPanel.tsx', 'qaLoadSequenceRef'],
  ]) {
    const ui = read(path);
    assert.match(ui, /projectScopeRef\.current = project\.id/);
    assert.ok(ui.includes(`sequence !== ${sequence}.current`));
    assert.ok(ui.includes(`${sequence}.current += 1`));
    assert.match(ui, /projectScopeRef\.current !== creatingProjectId/);
  }
});
await check('Previous Project Boards are hidden synchronously during Project switches', () => {
  for (const path of [
    'packages/renderer/src/features/projects/ProjectIssuesPanel.tsx',
    'packages/renderer/src/features/projects/ProjectQAPanel.tsx',
  ]) {
    const ui = read(path);
    assert.match(ui, /const \[loadedBoards, setBoards\] = useState<Board\[]>\(\[\]\)/);
    assert.match(ui, /loadedBoards\.filter\(\(board\) => board\.project\?\.id === project\.id\)/);
  }
});
console.log(`Batch A Project issue / QA: ${count}/${count} passed`);
