import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(`${execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim()}/typescript`); } })();
let checks = 0;
const check = (fn) => { fn(); checks++; };
const route = read('apps/server/src/app/server-routes-health-operations.ts');
check(() => assert.match(route, /by: \["clientVersion"\][^\n]+orderBy: \{ clientVersion: "asc" \}[^\n]+take: 12/));
check(() => assert.match(route, /by: \["platform"\][^\n]+orderBy: \{ platform: "asc" \}[^\n]+take: 12/));
const runtime = read('apps/server/src/core/runtime-config.ts');
check(() => assert.match(runtime, /Number\(rawConfiguredApiBudget\) === 10 \|\| Number\(rawConfiguredApiBudget\) === 120/));
check(() => assert.match(runtime, /!String\(env\.CLUSTER_RATE_LIMIT_MAX \?\? ""\)\.trim\(\)/));
check(() => assert.match(runtime, /finiteNumber\(rawConfiguredApiBudget, 12_000, \{ min: 10/));
check(() => assert.match(read('packages/renderer/src/features/settings/ServerConfigPage.tsx'), /rateLimitMax: 12000/));
const bus = read('apps/server/src/core/cluster-coordination-bus.ts');
check(() => assert.match(bus, /private pendingPublish: Promise<void> = Promise\.resolve\(\)/));
check(() => assert.match(bus, /this\.pendingPublish = operation\.catch\(\(\) => undefined\)/));
const budgets = read('apps/server/src/core/api-read-contracts.ts');
check(() => assert.match(budgets, /id: "library\.workspace"[^\n]+maxQueries: 56/));
check(() => assert.match(budgets, /id: "notifications\.summary"[^\n]+maxQueries: 28/));
const controls = read('packages/renderer/src/features/application/styles/application-controls.css');
check(() => assert.match(controls, /RC23: prevent unbacked text/));
const notifications = read('packages/renderer/src/features/notifications/notifications.css');
check(() => assert.doesNotMatch(notifications, /\.notification-workspace-v251 \{ background: transparent !important; \}/));
const source = read('packages/renderer/src/core/server-state.ts');
check(() => assert.match(source, /batchUserStateRead<T>\(key\)/));
check(() => assert.match(source, /scope === "user" \? batchUserStateRead<T>\(key\)/));
check(() => assert.match(source, /if \(Object\.is\(resolved, valueRef\.current\)\) return/));
for (const file of ['apps/server/src/core/runtime-config.ts','apps/server/src/app/server-routes-health-operations.ts','apps/server/src/core/cluster-coordination-bus.ts','packages/renderer/src/core/server-state.ts','packages/renderer/src/features/settings/ServerConfigPage.tsx']) {
  const parsed = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(() => assert.equal(parsed.parseDiagnostics.length, 0, `${file}: syntax errors`));
}
// Execute the real hook module with a small React/transport stub. Two matching
// mounts in one microtask must hydrate from ONE bulk endpoint, not two GETs.
let queryCount = 0;
const seen = [];
let owner = { scope: 'user:1', generation: 1 };
const react = {
  useRef: value => ({current:value}),
  useState: value => [value, next => seen.push(next)],
  useEffect: fn => fn(),
  useCallback: fn => fn,
};
const api = {
  ApiError: class extends Error {},
  queryApi: async (url) => {
    queryCount++;
    assert.match(url, /^\/api\/client-state\/user\?keys=/);
    const keys = decodeURIComponent(url.split('?keys=')[1]).split(',');
    return { records: keys.map(key => ({key, payload:`saved:${key}`, revision:3})) };
  },
  mutateApi: async () => ({result:{record:{revision:4}}}),
};
const compiler = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports = {};
const deps = { react, './api':api, './offline-storage':{ getOfflineScopeIdentity:() => owner }, './user-state-ownership': { mayApplyClientState:() => true } };
new Function('require','exports',compiler)((name) => { if (!deps[name]) throw new Error('Unknown mock '+name); return deps[name]; },exports);
exports.useServerState('user','library.layout','grid');
exports.useServerState('user','projects.open-tabs',[]);
await new Promise(resolve => setImmediate(resolve));
check(() => assert.equal(queryCount, 1, 'simultaneous user preferences must use one bulk read'));
check(() => assert.ok(seen.includes('saved:library.layout')));
check(() => assert.ok(seen.includes('saved:projects.open-tabs')));
// Different login owners may never be combined into one batch.
exports.useServerState('user','old-key','old');
owner = { scope:'user:2', generation:2 };
exports.useServerState('user','new-key','new');
await new Promise(resolve => setImmediate(resolve));
check(() => assert.equal(queryCount, 2, 'only the new account may issue a further read'));
const meta=JSON.parse(read('config/release-candidate.json'));
check(() => { assert.match(meta.release,/^1\.0\.0-rc\.(?:2[3-9]|[3-9]\d+)$/); assert.ok(meta.sequence >= 23); });
console.log(`RC23 runtime/log/background tests: ${checks}/${checks} passed`);
