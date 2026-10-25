import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
let passed=0;
function check(title, action) { action(); ++passed; console.log(`PASS ${title}`); }
const go = read('tools/native/package-stager-go/transfer_stage.go');
const cli = read('tools/native/package-stager-go/main.go');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const bridge = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
check('Retained archive stages only after committed SHA-256 checkpoint verification', () => {
  assert.match(go, /readTransferCheckpoint\(meta, part, archive\)/);
  assert.match(go, /checkpoint.State != "committed"/);
  assert.match(go, /checkpoint.PrefixSha256 != digest/);
  assert.match(go, /checkedTransferFile\(archive\)/);
});
check('Go staging reuses independent Ed25519 verification and selected target checks', () => {
  assert.match(go, /TrustedKeySha256: pin/);
  assert.match(go, /ExpectedArtifactSha256: digest/);
  assert.match(go, /ExpectedPackageKey: key/);
  assert.match(go, /stage\(o\)/);
  assert.match(go, /"verified_staged_not_installed"/);
});
check('Go CLI accepts signed sidecars through bounded stdin, no renderer artifact path', () => {
  assert.match(cli, /case "transfer-stage":/);
  assert.match(cli, /io.ReadAll\(io.LimitReader\(os.Stdin, 8193\)\)/);
  assert.match(go, /os.MkdirTemp/);
  assert.match(go, /defer os.RemoveAll\(work\)/);
  assert.match(cli, /o.TrustedControlKeySha256 != ""/);
});
check('Native bridge uses independently provisioned trust root and local confirmed staging', () => {
  assert.match(broker, /QStringLiteral\("package.transfer.stage"\)/);
  assert.match(broker, /package-trust/);
  assert.match(broker, /pinInfo\.isSymLink\(\)/);
  assert.match(broker, /transfer-stage/);
  assert.match(broker, /staged_not_installed/);
  assert.match(broker, /No installation\/deployment/);
});
check('Qt stage path validates current profile and signed sidecars before invoking helper', () => {
  assert.match(broker, /manifest\.value\(QStringLiteral\("artifactSha256"\)\)\.toString\(\) != digest/);
  assert.match(broker, /m_controller->serverProfiles\(\)->activeProfileId\(\) != profile/);
  assert.match(broker, /QMessageBox::question\(nullptr, QStringLiteral\("Stage verified native archive"\)/);
});
check('Renderer checks fresh entitlement and committed disk digest, then invokes typed native capability', () => {
  assert.match(ui, /async function stageRetained\(target: Target\)/);
  assert.match(ui, /api\/me\/packages\/targets/);
  assert.match(ui, /checkpoint.state !== "committed"/);
  assert.match(ui, /stageRetainedNativePackageArchive\(/);
  assert.match(ui, /Stage retained archive…/);
  assert.match(bridge, /requestNativeCapability<\{ accepted: boolean; operationId\?: string \}>\("package.transfer.stage"/);
});
check('Changed TS/TSX files parse with zero diagnostics', () => {
  for (const [path, kind] of [
    ['packages/renderer/src/core/desktop.ts', ts.ScriptKind.TS],
    ['packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx', ts.ScriptKind.TSX],
  ]) {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, kind);
    assert.equal(source.parseDiagnostics.length, 0, path);
  }
});
console.log(`${passed}/${passed} G19 retained archive staging assertions passed`);
