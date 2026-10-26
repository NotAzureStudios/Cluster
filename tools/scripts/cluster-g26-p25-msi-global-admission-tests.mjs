// Execute the real renderer validator and audit native lock wiring. Go's
// concurrent lock and crash-evidence tests are in msi_global_admission_test.go.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const renderer = read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const ast = ts.createSourceFile('panel.tsx', renderer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fn; let helper;
function walk(node) {
  if (ts.isFunctionDeclaration(node) && ['verifyReadOnlyMSIEvidence','verifyMSIBootObservation'].includes(node.name?.text)) {if (node.name?.text === 'verifyReadOnlyMSIEvidence') fn = node.getText(ast); else helper = node.getText(ast);}
  ts.forEachChild(node,walk);
}
walk(ast);
assert.ok(helper); assert.ok(fn, 'production read-only MSI response validator');
const js = ts.transpileModule(helper + "\n" + fn, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const validate = Function(`"use strict";${js};return verifyReadOnlyMSIEvidence`)();
let count=1;
const base = {schema:1,packageKey:'studio-tools',state:'no_recorded_attempt',hasReceipt:false,lockPresent:false,
  admissionLockPresent:false,manualReviewRequired:false,retryAuthorized:false,readOnly:true,osAttested:false,stagedArtifactVerified:false};
const held = {...base, state:'interrupted_or_active_without_receipt',lockPresent:true,admissionLockPresent:true,manualReviewRequired:true};
const otherLock = {...held, admissionLockPresent:false};
for (const good of [base,held,otherLock]) { assert.doesNotThrow(()=>validate(good,'studio-tools')); count++; }
for(const bad of [
  {...base,admissionLockPresent:undefined}, {...base,admissionLockPresent:'false'},
  {...base,admissionLockPresent:true}, {...held,lockPresent:false},
  {...held,manualReviewRequired:false}, {...held,admissionLockPresent:undefined},
  {...held,readOnly:false}, {...held,retryAuthorized:true},
  {...held,hasReceipt:true}, {...held,osAttested:true},
  {...held,packageKey:'different'}, {...base,stagedArtifactVerified:true},
]) { assert.throws(()=>validate(bad,'studio-tools'),/MSI recovery evidence/); count++; }
assert.ok(renderer.includes('Profile-wide admission lock:'), 'global lock explicitly labeled for operators'); count++;
assert.ok(renderer.includes('isRecordedMSIAttemptBlocked(report)'), 'existing grant preflight observes global lock'); count++;
const type = read('../../packages/renderer/src/core/desktop.ts');
assert.match(type,/admissionLockPresent: boolean/, 'typed bridge includes global admission'); count++;
const qt = read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const boundary = qt.slice(qt.indexOf('if (capability == QStringLiteral("package.msiAttemptStatus"))'),qt.indexOf('if (capability == QStringLiteral("package.stageStatus"))'));
for (const marker of ['admissionLockPresent','admissionValue.isBool()','admissionValue.toBool() && !hasLock','const bool pastAttempt','const bool interruptedLock']) {
  assert.ok(boundary.includes(marker),`Qt independent response validator ${marker}`); count++;
}
const installer=read('../native/package-stager-go/msi_installer.go');
const rootGlobal = installer.indexOf('acquireMSIInstallLock(root, "msi-admission")');
const localLock = installer.indexOf('acquireMSIInstallLock(parent, m.PackageKey)');
const custody = installer.indexOf('requireNoForeignMSIAttemptForProduct(root, m.PackageKey');
const grantConsumed = installer.indexOf('prepareMSIInstall(receipt, root, claim, out)');
assert.ok(rootGlobal>0 && localLock>rootGlobal && custody>localLock && grantConsumed>custody,
  'profile global lock serializes local custody scan and grant consumption'); count++;
assert.match(installer,/defer unlockAdmission\(\)/, 'global lock stays held during msiexec');count++;
const inspect=read('../native/package-stager-go/msi_attempt_status.go');
for (const marker of ['msi-admission.lock','AdmissionLockPresent','unsafe MSI admission lock','operation_lock_without_receipt']) {
  assert.ok(inspect.includes(marker),`Go recovery evidence includes ${marker}`); count++;
}
const test=read('../native/package-stager-go/msi_global_admission_test.go');
for (const marker of ['TestMSIGlobalAdmissionLockConcurrentDifferentPackages','TestMSIAdmissionOrphanLockVisibleAcrossPackageKeys','TestMSIAdmissionUnsafeLockFailsClosed']) {
  assert.ok(test.includes(marker),`executed Go coverage: ${marker}`);count++;
}
console.log(`${count}/${count} G26 Pass 25 profile MSI admission and evidence assertions passed`);
