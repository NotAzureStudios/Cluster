// Regression for the RC49 Windows build failure. The navigation model's
// canonical field is `route`, not `screen`; keep application initialization
// aligned with the actual AppNavigationState contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const navigation = read('packages/renderer/src/core/navigation.ts');
const application = read('packages/renderer/src/features/application/ClusterApplication.tsx');
const candidate = JSON.parse(read('config/release-candidate.json'));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${passed}: ${name}`); }

check('AppNavigationState identifies the current screen with route', () => {
  assert.match(navigation, /export type AppNavigationState = \{\s*route: AppScreen;/);
  assert.match(navigation, /export function createNavigationState\([\s\S]*?\): AppNavigationState \{\s*return \{\s*route,/);
});
check('application boot and board return origin read the canonical route', () => {
  assert.match(application, /useState<AppScreen>\(initialNavigation\.state\.route\)/);
  assert.match(application, /lastVisitedScreenRef = useRef<AppScreen>\(initialNavigation\.state\.route\)/);
  assert.doesNotMatch(application, /initialNavigation\.state\.screen\b/);
});
check('board-origin tracking still handles entering and leaving boards', () => {
  assert.match(application, /screen === "board" && previous !== "board"/);
  assert.match(application, /boardReturnOriginRef\.current = \{ screen: previous === "whiteboard" \? "projects" : previous, projectId \}/);
  assert.match(application, /lastVisitedScreenRef\.current = screen;/);
});
check('1.0.x patch source retains the RC50 navigation fixes', () => {
  assert.ok(candidate.sequence >= 50);
  assert.equal(candidate.channel, 'stable');
  assert.match(candidate.release, /^1\.0\.[1-9][0-9]*$/);
  assert.equal(candidate.release, candidate.sourceVersion);
});
console.log(`RC50 renderer navigation contract: ${passed}/${passed} checks passed`);
