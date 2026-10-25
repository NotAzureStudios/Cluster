import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => fs.readFileSync(path, 'utf8');
const src = {
  go: read('tools/native/package-stager-go/main.go'),
  goAudit: read('tools/native/package-stager-go/activation.go'),
  qt: read('apps/desktop-qt/src/NativeCapabilityBroker.cpp'),
  api: read('packages/renderer/src/core/desktop.ts'),
  ui: read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),
  status: read('apps/server/src/domains/inventory/managed-package-deployments.ts'),
  reconcile: read('apps/server/src/domains/inventory/managed-package-reconciliation.ts'),
  admin: read('packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx'),
};
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS', name); }
const transpile = path => {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: name => name === 'node:crypto' ? require(name) : require(name), Buffer, Date, Set, Map }, { filename: path });
  return mod.exports;
};
check('Go stage audit is separately dispatched', () => assert.match(src.go, /case "verify-stage":\s*out, err := auditStagedContent\(o\)/));
check('Five-entry staging kit accepted for read-only stage audit only', () => assert.match(src.go, /\*action != "stage" && \*action != "verify-stage"/));
check('Non-staging action rejects target constraints as authorization', () => assert.match(src.go, /stage target constraints cannot authorize activation/));
check('Native stage audit checks staged bytes', () => assert.match(src.goAudit, /func auditStagedContent[\s\S]*?verifyStaged\(root, m, archive, fingerprint\)/));
check('Native stage audit is explicitly nonattested', () => assert.match(src.goAudit, /State:\s*"verified_staged_not_installed", OSAttested: false/));
check('Read-only audit checks exact selected digest/key/version', () => assert.match(src.goAudit, /stage audit does not match selected Package target/));
check('Qt exposes a separate read-only native audit', () => assert.ok(src.qt.includes('package.auditKit') && src.qt.includes('verify-stage')));
check('Qt parses only verifier-emitted audit evidence', () => assert.match(src.qt, /CLUSTER_STAGE_AUDIT_RESULT /));
check('Qt audit state cannot look like a stage receipt', () => assert.match(src.qt, /audited_staged_not_installed/));
check('Qt independently selects local kit and trust store', () => assert.ok(src.qt.includes('QFileDialog::getOpenFileName') && src.qt.includes('/package-trust')));
check('Renderer does not supply trust data', () => {
  assert.match(src.qt, /\{QStringLiteral\("package.provisionTrust"\), \{\}\}/);
  assert.match(src.qt, /QInputDialog::getText/);
  assert.ok(!src.api.includes('provisionNativePackageTrust(fingerprint'));
});
check('Native trust fingerprint has mandatory second entry', () => assert.match(src.qt, /if \(repeated != typed\)/));
check('Trust change is blocked during in-flight staging', () => assert.match(src.qt, /if \(m_packageStageProcess\)[\s\S]{0,160}PACKAGE_STAGE_BUSY/));
check('Trust file write is atomic with restrictive requested owner permissions', () => {
  assert.match(src.qt, /QSaveFile output\(pinPath\)/);
  assert.match(src.qt, /QFileDevice::ReadOwner \| QFileDevice::WriteOwner/);
  assert.match(src.qt, /output\.commit\(\)/);
});
check('Session/profile epoch must survive trust confirmation', () => assert.match(src.qt, /m_brokerEpoch != epoch[\s\S]*?activeProfileId\(\) != profileId/));
check('Desktop has separate audit and trust capabilities', () => assert.ok(src.api.includes('auditNativePackageKit') && src.api.includes('getNativePackageTrustStatus') && src.api.includes('provisionNativePackageTrust')));
check('Client renders trust setup and native re-audit', () => assert.ok(src.ui.includes('Set up local signing trust') && src.ui.includes('Audit existing staged files')));
check('Audit result cannot trigger device staging receipt', () => assert.match(src.ui, /\["staged_not_installed", "failed"\]\.includes\(event\.status\.state\)/));
const state = transpile('apps/server/src/domains/inventory/managed-package-deployments.ts');
check('No self-declared activation state accepted', () => assert.equal(state.PACKAGE_DEVICE_REPORT_STATES.includes('activated'), false));
check('Cannot declare OS install by mutating staged report', () => assert.equal(state.packageDeviceTransitionAllowed('content_selected', 'activated'), false));
check('Rollback only from observed local content selection', () => {
  assert.equal(state.packageDeviceTransitionAllowed('failed','rolled_back'), false);
  assert.equal(state.packageDeviceTransitionAllowed('content_selected','rolled_back'), true);
});
check('Admin reconciliation uses honest noninstalled selection status', () => assert.ok(src.reconcile.includes('reported_selected') && !src.reconcile.includes('reported_current')));
check('Admin UI does not advertise installed software', () => assert.ok(src.admin.includes('No activation or installation status is accepted') && src.admin.includes('reported_selected')));
console.log(`${count}/${count} connected native audit, trust and report-state assertions passed`);
