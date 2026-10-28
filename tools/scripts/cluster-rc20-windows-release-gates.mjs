// RC20 regression: reproduce the Windows TS2741 JSX mistake without an npm install,
// and test rate-limit lane isolation + exact chrome and compatibility contracts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript`); } })();
let checks = 0;
function check(fn) { fn(); checks++; }
const admin = read('packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx');
const parsed = ts.createSourceFile('ProductionIntegrationAdminPages.tsx', admin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function missingJSXProps(source, component) {
  let props = new Set();
  function discover(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === component) {
      const type = node.parameters[0]?.type;
      if (!type || !ts.isTypeLiteralNode(type)) throw Error(`${component} lacks a declared prop contract`);
      props = new Set(type.members.filter(member => ts.isPropertySignature(member) && !member.questionToken).map(member => member.name?.getText(source)));
    }
    ts.forEachChild(node, discover);
  }
  discover(source);
  if (!props.size) throw Error(`${component} not declared`);
  const missing = [];
  function examine(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === component) {
      const present = new Set(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => attr.name.text));
      for (const prop of props) if (!(prop === "children" && ts.isJsxOpeningElement(node)) && !present.has(prop) && !node.attributes.properties.some(ts.isJsxSpreadAttribute)) missing.push({ prop, position: source.getLineAndCharacterOfPosition(node.pos).line + 1 });
    }
    ts.forEachChild(node, examine);
  }
  examine(source);
  return missing;
}
check(() => assert.deepEqual(missingJSXProps(parsed, 'AdminSurface'), []));
check(() => {
  // Catch regression if description becomes required in the future while calls omit it.
  const bad = ts.createSourceFile('bad.tsx', admin.replace('description?: string;', 'description: string;'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.ok(missingJSXProps(bad, 'AdminSurface').some(x => x.prop === 'description'));
});
check(() => assert.match(admin, /description \? <p>\{description\}<\/p> : null/));
const js = ts.transpileModule(read('apps/server/src/core/request-workload.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, Object, String, Math, RegExp, Set, Map, Number, Boolean });
const policy = module.exports.apiTransportRateLimitPolicy;
const lane = (pathname, method='GET', apiRateLimitMax=6000) => policy({ pathname, method, apiRateLimitMax });
check(() => assert.equal(lane('/api/meta/compatibility').bucketName, 'api-compatibility'));
check(() => assert.equal(lane('/api/meta/compatibility').limit, 120));
check(() => assert.equal(lane('/api/notifications/summary').bucketName, 'api-live'));
check(() => assert.equal(lane('/api/calendar/upcoming').bucketName, 'api-live'));
check(() => assert.equal(lane('/api/projects').bucketName, 'api'));
check(() => assert.equal(lane('/api/projects', 'POST').bucketName, 'api-mutation'));
check(() => assert.equal(lane('/api/auth/login', 'POST').bucketName, 'api-mutation'));
check(() => assert.equal(lane('/api/meta/compatibility', 'GET', 40).limit, 40));
check(() => assert.equal(lane('/api/projects', 'GET', 120).limit, 120));
const go = read('apps/server-launcher-go/server_config_windows.go');
const runtime = read('apps/server/src/core/runtime-config.ts');
check(() => assert.match(go, /\{"rateLimitMax"[^\n]*settingNumber, 12000,/));
check(() => assert.match(runtime, /"CLUSTER_RATE_LIMIT_MAX", bootSettings, "rateLimitMax"/));
check(() => assert.match(runtime, /Number\(rawConfiguredApiBudget\) === 10 \|\| Number\(rawConfiguredApiBudget\) === 120/));
check(() => assert.match(runtime, /finiteNumber\(rawConfiguredApiBudget, 12_000,/));
const styles = read('packages/renderer/src/features/shell/shell-v2.css');
check(() => assert.match(styles, /RC20: taskbar must be a clean solid chrome surface[\s\S]*background-image: none !important/));
const offline = read('packages/renderer/src/core/offline-runtime.ts');
const status = read('packages/renderer/src/components/operational-status.ts');
check(() => assert.match(offline, /compatibilityRejected = compatibility\.compatible === false/));
check(() => assert.match(offline, /compatibilityRejected \? "incompatible" : "compatibility-check-pending"/));
check(() => assert.match(offline, /mutationReplayAllowed = reachable && compatibilityReplayAllowed/));
check(() => assert.match(offline, /serverState: "compatibility-check-pending",\s*readAccessAllowed: false,\s*mutationReplayAllowed: false/));
check(() => assert.match(status, /"compatibility-check-pending"[\s\S]*"compatibility_pending"/));
console.log(`RC20: ${checks}/${checks} focused Windows build, bounded widget lanes, version-gate, and texture checks passed`);
