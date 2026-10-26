import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const load = (name) => {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports }, { filename: name });
  return mod.exports;
};
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const forms = load('packages/renderer/src/features/workflow/delegated-form-navigation.ts');
await check('Delegated Form reviewer access remains scoped to exact, nonempty form IDs', () => {
  for (const scope of ['studio-form', 'form-submission']) assert.equal(forms.delegatedFormDestination({ screen: 'studioSettings', scope, id: 'form_1', isAdmin: false }), 'forms');
  for (const bad of [
    { screen: 'studioSettings', scope: 'studio-announcement', id: 'ann_1', isAdmin: false },
    { screen: 'studioSettings', scope: 'studio-form', id: '', isAdmin: false },
    { screen: 'studioSettings', scope: 'studio-form', id: 'x'.repeat(161), isAdmin: false },
    { screen: 'studioSettings', scope: 'studio-form', id: 'form_1', isAdmin: true },
    { screen: 'serverConfig', scope: 'studio-form', id: 'form_1', isAdmin: false },
  ]) assert.equal(forms.delegatedFormDestination(bad), null);
});
await check('Direct link authorization check runs before asynchronous resource admission', () => {
  const src = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  const entry = src.indexOf('const openLinkedWork = (event: Event) => {');
  const permission = src.indexOf('if (!canOpenScreen(activeUser, incoming.screen) && !delegatedForms)', entry);
  const resolveCard = src.indexOf('if (incoming.screen === "board" && incoming.inspectScope === "card")', entry);
  const generic = src.indexOf('applyLinkedWork(incoming);', entry);
  assert.ok(entry > 0 && permission > entry && resolveCard > permission);
  assert.ok(generic > resolveCard);
  assert.match(src.slice(permission, resolveCard), /clearPendingDesktopWorkNavigation\(incoming\)/);
  assert.match(src.slice(permission, resolveCard), /Workspace unavailable/);
  assert.match(src.slice(permission, resolveCard), /Your current workspace was preserved/);
});
await check('Unauthorized deep-link recovery does not change current screen or open inspector', () => {
  const src = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  const body = src.slice(src.indexOf('if (!canOpenScreen(activeUser, incoming.screen) && !delegatedForms)'), src.indexOf('if (incoming.screen === "board" && incoming.inspectScope === "card")'));
  assert.ok(body.includes('return;'));
  assert.doesNotMatch(body, /setScreen\(/);
  assert.doesNotMatch(body, /applyLinkedWork\(/);
});
await check('Help context is loaded on demand and does not bypass workspace permissions', () => {
  const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  const lazy = read('packages/renderer/src/features/application/modules/application-lazy-workspaces.ts');
  assert.match(app, /canAccess=\{\(candidate\) => canOpenScreen\(activeUser, candidate\)\}/);
  assert.match(app, /!resourceWindow && !nativeKioskActive && contextualHelpOpen/);
  assert.match(lazy, /LazyClusterHelpDialog = lazy\(/);
});
console.log(`${count}/${count} G27 Pass 14 admission integration assertions passed`);
