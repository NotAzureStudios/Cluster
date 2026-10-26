// Execute the production native evidence validator, not a reimplementation.
// These tests do not install anything or claim OS health.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const code = fs.readFileSync(new URL('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('DesktopDevicePackagesPanel.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let extracted; let helper;
function walk(node) {
  if (ts.isFunctionDeclaration(node) && ['verifyReadOnlyMSIEvidence','verifyMSIBootObservation'].includes(node.name?.text)) {if (node.name?.text === 'verifyReadOnlyMSIEvidence') extracted = node.getText(ast); else helper = node.getText(ast);}
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(helper); assert.ok(extracted, 'production validator found');
const js = ts.transpileModule(helper + "\n" + extracted, { compilerOptions: {target: ts.ScriptTarget.ES2022} }).outputText;
const verify = Function(`"use strict"; ${js}; return verifyReadOnlyMSIEvidence;`)();
const codeId = '{12345678-1234-ABCD-ABCD-1234567890AB}';
const clean = {schema:1, packageKey:'studio-tools', state:'no_recorded_attempt', hasReceipt:false, lockPresent:false, admissionLockPresent:false,
  manualReviewRequired:false, retryAuthorized:false, readOnly:true, osAttested:false};
const interrupted = {...clean, state:'interrupted_or_active_without_receipt', lockPresent:true, manualReviewRequired:true};
const receipt = {...clean, state:'msi_restart_required_not_os_attested', hasReceipt:true, manualReviewRequired:true,
  receiptSha256:'c'.repeat(64), stagedArtifactVerified:false, registrationTransition:'historical_receipt_no_transition_evidence',registrationDrift:'no_post_exit_baseline',
  bootObservation:{state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false},
  product: {state:'registered_version_mismatch', productCode:codeId, expectedVersion:'1.0.0',
    versionMatches:false, readOnly:true, osAttested:false, probeScope:'current_user_and_machine', probeComplete:true},
  attempt: {packageKey:'studio-tools', version:'1.0.0', artifactSha256:'a'.repeat(64),
    msiSha256:'b'.repeat(64), productCode:codeId, productVersion:'1.0.0', state:'msi_restart_required_not_os_attested',
    startedAt:'2026-10-24T00:00:00Z', finishedAt:'2026-10-24T00:01:00Z', exitCode:3010, osAttested:false}};
let count=0;
for(const good of [clean, interrupted, receipt]) {
  assert.doesNotThrow(()=>verify(good,'studio-tools'));count++;
}
const cases = [
  {...clean, state:'some_other_state'}, {...clean, hasReceipt:true}, {...clean, product:receipt.product},
  {...clean, receiptSha256:'a'.repeat(64)}, {...clean, attempt:receipt.attempt},
  {...clean, manualReviewRequired:true}, {...interrupted, manualReviewRequired:false},
  {...interrupted, lockPresent:false}, {...clean, stagedArtifactVerified:true},
  {...clean, retryAuthorized:true}, {...clean, readOnly:false}, {...clean, osAttested:true},
  {...receipt, attempt:undefined}, {...receipt, product:undefined}, {...receipt, manualReviewRequired:false},
  {...receipt, receiptSha256:'not-a-hash'}, {...receipt, state:'msi_exit_zero_not_os_attested'},
  {...receipt, attempt:{...receipt.attempt, packageKey:'other-package'}},
  {...receipt, attempt:{...receipt.attempt, osAttested:true}},
  {...receipt, attempt:{...receipt.attempt, productCode:'bad'}},
  {...receipt, attempt:{...receipt.attempt, productVersion:'1.0-beta'}},
  {...receipt, attempt:{...receipt.attempt, artifactSha256:'not-a-hash'}},
  {...receipt, attempt:{...receipt.attempt, msiSha256:'not-a-hash'}},
  {...receipt, product:{...receipt.product, readOnly:false}},
  {...receipt, product:{...receipt.product, osAttested:true}},
  {...receipt, product:{...receipt.product, productCode:'{AAAABBBB-1234-ABCD-ABCD-1234567890AB}'}},
  {...receipt, product:{...receipt.product, expectedVersion:'2.0.0'}},
  {...receipt, packageKey:'other-package'},
];
for (const [i,bad] of cases.entries()) {
  assert.throws(()=>verify(bad,'studio-tools'), /MSI recovery evidence/, `tampered native evidence case ${i}`);
  count++;
}
assert.ok(code.includes('verifyReadOnlyMSIEvidence(report, target.package.key);'), 'both local inspection and grant flow validate the native response');count++;
const native = fs.readFileSync(new URL('../native/package-stager-go/msi_installer.go', import.meta.url), 'utf8');
const custody = native.indexOf('requireNoForeignMSIAttemptForProduct(root, m.PackageKey');
const register = native.indexOf('requireFreshMSIProductRegistration(product, productErr');
const prepare = native.indexOf('prepareMSIInstall(receipt, root, claim, out)');
assert.ok(custody>0 && register>custody && prepare>register, 'native product and custody checks precede grant consumption');count++;
const qt = fs.readFileSync(new URL('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp', import.meta.url), 'utf8');
const qtInspection = qt.slice(qt.indexOf('if (capability == QStringLiteral("package.msiAttemptStatus"))'),
  qt.indexOf('if (capability == QStringLiteral("package.stageStatus"))'));
for (const requirement of ['const bool cleanRecord', 'const bool interruptedLock', 'const bool pastAttempt',
  'knownAttemptState', 'receiptValue.isBool()', 'readOnly', 'retryAuthorized', 'const bool hasReceipt']) {
  assert.ok(qtInspection.includes(requirement), `Qt native evidence must check ${requirement}`);count++;
}
console.log(`${count}/${count} executed G26 Pass 24 MSI product custody and response integrity assertions passed`);
