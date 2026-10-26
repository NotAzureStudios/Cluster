import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Execute the actual TypeScript functions using a transpiled CommonJS module.
// No React, Postgres or mocked business logic is needed for these pure functions.
function loadTs(file, imports = {}) {
  const content = read(file);
  const transpiled = ts.transpileModule(content, { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const diagnostics = (transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, `${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))}`);
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console, require: (id) => {
    if (Object.prototype.hasOwnProperty.call(imports, id)) return imports[id];
    throw new Error(`Unexpected test dependency from ${file}: ${id}`);
  }};
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: file });
  return module.exports;
}
let passed = 0;
function check(description, action) { action(); console.log(`PASS ${description}`); passed++; }
const a11y = loadTs('packages/renderer/src/core/accessibility-preferences.ts');
const visual = loadTs('packages/renderer/src/core/visual-system.ts', {'./accessibility-preferences': a11y, '../../../shared/appearance/semantic-palette.json': JSON.parse(read('packages/shared/appearance/semantic-palette.json'))});
const policy = loadTs('apps/server/src/domains/access/request-policy.ts');
const availability = loadTs('apps/server/src/domains/access/configurable-tool-availability.ts');

check('Appearance resolves on startup without a temporal-dead-zone error', () => {
  const context = visual.resolveVisualContext({});
  assert.equal(context.backgroundBase, 'clean');
  assert.equal(context.backgroundPattern, 'hex');
  assert.equal(context.fontFamily, 'comfortaa');
});
check('Legacy grid selection and canonical background settings both resolve', () => {
  assert.equal(visual.resolveVisualContext({ backgroundStyle: 'grid' }).backgroundPattern, 'grid');
  const custom = visual.resolveVisualContext({ backgroundBaseStyle: 'aurora', backgroundPattern: 'dots' });
  assert.equal(custom.backgroundBase, 'aurora');
  assert.equal(custom.backgroundPattern, 'dots');
});
check('Contrast chooses dark text for canonical blue rather than inaccessible white', () => {
  assert.equal(visual.themeContrastColor('#57c1ff'), '#07111f');
  assert.equal(visual.themeContrastColor('#ffffff'), '#07111f');
  assert.equal(visual.themeContrastColor('#000000'), '#ffffff');
  assert.equal(visual.themeContrastColor('#zzzzzz'), '#ffffff');
});
check('Applying resolved context sets actual CSS variables and layout preferences', () => {
  const properties = new Map(); const root = { style: { setProperty: (key, value) => properties.set(key, value) }, dataset: {} };
  visual.applyVisualContext(root, visual.resolveVisualContext({ backgroundPattern: 'grid', interfaceDensity: 'dense' }));
  assert.equal(properties.get('--studio-primary-contrast'), '#07111f');
  assert.equal(root.dataset.backgroundPattern, 'grid');
  assert.equal(root.dataset.density, 'dense');
});
check('OS reduced-motion preference cannot be overridden by Full user motion', () => {
  const system = { reducedMotion: true, highContrast: false, reducedTransparency: false };
  assert.equal(a11y.resolveAccessibilityPreferences({ userMotionPreference: 'full' }, system).motion, 'reduced');
  assert.equal(a11y.resolveAccessibilityPreferences({ userMotionPreference: 'none' }, system).motion, 'none');
  assert.equal(a11y.resolveAccessibilityPreferences({ userMotionPreference: 'full' }, { ...system, reducedMotion: false }).motion, 'full');
});
check('Typography maps Inter to a distinct stack without changing Comfortaa default', () => {
  const css = read('packages/renderer/src/styles/typography-contract.css');
  assert.match(css, /:root\[data-font="inter"\]\{--cluster-active-font:"Inter",/);
  assert.match(css, /:root\[data-font="comfortaa"\]\{--cluster-active-font:var\(--cluster-font-stack\)/);
});
const matrix = [
  ['/api/tickets', 'tickets', 'ticketsEnabled', 'Tickets'],
  ['/api/timeline', 'timeline', 'timelineEnabled', 'Timeline'],
  ['/api/calendar/events', 'calendar', 'calendarEnabled', 'Calendar'],
  ['/api/schedule', 'scheduler', 'schedulerEnabled', 'Scheduler'],
  ['/api/time', 'scheduler', 'schedulerEnabled', 'Scheduler'],
  ['/api/library', 'library', 'libraryEnabled', 'Library'],
  ['/api/packets', 'packets', 'packetsEnabled', 'Packets'],
];
check('Request policy and availability guard use the same six canonical tool identities', () => {
  for (const [url, id, setting, label] of matrix) {
    assert.equal(policy.requestCapabilityForPath(url), id, url);
    assert.equal(availability.isConfigurableToolCapability(id), true);
    assert.equal(availability.disabledConfigurableToolLabel(id, { [setting]: false }), label, id);
    assert.equal(availability.disabledConfigurableToolLabel(id, { [setting]: true }), null, id);
    assert.equal(availability.disabledConfigurableToolLabel(id, {}), null, id);
  }
  assert.equal(availability.disabledConfigurableToolLabel('serverConfig', { schedulerEnabled: false }), null);
  assert.equal(availability.isConfigurableToolCapability('time'), false);
});
check('Configurable tool map tracks the canonical admin-configurable manifest IDs', () => {
  const manifest = read('packages/shared/src/cluster-manifest.ts');
  const ids = [...manifest.matchAll(/^\s{2}(\w+):\s*\{[^\n]*adminConfigurable:\s*true/gm)].map(m=>m[1]);
  assert.equal(ids.length, 6, `Expected exactly six manifest configurable tools, got ${ids}`);
  for (const id of ids) assert.equal(availability.isConfigurableToolCapability(id), true, id);
});
check('Server middleware enforces availability through centralized helper, not stale time alias', () => {
  const server = read('apps/server/src/app/server-request-infrastructure.ts');
  const services = read('apps/server/src/app/server-services-request-domain.ts');
  assert.match(server, /if \(isConfigurableToolCapability\(policy\.capability\)\)/);
  assert.match(server, /disabledToolLabel\(policy\.capability, await readSettings\(\)\)/);
  assert.match(server, /code: "TOOL_DISABLED"/);
  assert.match(services, /return disabledConfigurableToolLabel\(tool, settings\)/);
  assert.doesNotMatch(services, /normalized === "time"/);
});
console.log(`${passed}/${passed} Cluster TD0 executable and contract checks passed.`);
