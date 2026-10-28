// Prevent another release that completes Vite then fails on a trivial native Go typo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const host = fs.readFileSync(path.join(root, 'apps/host-go/main.go'), 'utf8');
const ps = fs.readFileSync(path.join(root, 'tools/installer/Install-Cluster.ps1'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'tools/scripts/cluster-rc-smoke.mjs'), 'utf8');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'config/release-candidate.json'), 'utf8'));
const assertBefore = (a,b) => {
  const first = ps.indexOf(a), second = ps.indexOf(b);
  assert.ok(first >= 0 && second >= 0 && first < second, `Expected ${a} before ${b}`);
};
assert.match(host, /displayReleaseVersion\(h\.root\)/);
assert.doesNotMatch(host, /displayReleaseVersion\(root\)/);
assertBefore("Run 'node' @('tools/scripts/cluster-rc-native-checks.mjs')", "Run 'node' @('tools/scripts/build-native-host.mjs')");
assertBefore("Run 'node' @('tools/scripts/build-native-host.mjs')", "Run 'npm.cmd' @('run','build')");
assertBefore("Run 'node' @('tools/scripts/build-server-launcher.mjs')", "Run 'npm.cmd' @('run','build')");
assert.ok(smoke.includes('cluster-rc6-native-boundary-tests.mjs'));
assert.match(identity.release, /^1\.0\.0-rc\.[1-9]\d*$/);
assert.equal(identity.sequence, Number(identity.release.split('.').at(-1))); // RC6+ version-agnostic native gate
for (const section of ['host-go','server-launcher-go']) {
 const unit = fs.readFileSync(path.join(root,'apps',section,'release_display_test.go'),'utf8');
 assert.match(unit, /version = "0\.546\.0"/);
 assert.match(unit, /defer func\(\) \{ version = originalVersion \}\(\)/);
}
console.log('9/9 RC6 native build boundary checks passed');
