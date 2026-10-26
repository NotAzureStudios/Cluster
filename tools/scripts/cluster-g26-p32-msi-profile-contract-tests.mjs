// Pass32: Qt cannot be linked on this build host. Assert that the actual Qt
// production boundary applies one complete product/receipt envelope to BOTH
// MSI observation capabilities; never count this as linked Qt validation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const qt=read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
let n=0;
const check=(condition,description)=>{assert.ok(condition,description);n++};
function between(start,end){const a=qt.indexOf(start);const b=qt.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return qt.slice(a,b)}
const helper=between('bool validNativeMSIAttemptReceiptEnvelope(const QJsonObject &report)', 'const QStringList &workstationCapabilities()');
const profile=between('if (capability == QStringLiteral("package.msiProfileStatus"))', 'if (capability == QStringLiteral("package.msiAttemptStatus"))');
const single=between('if (capability == QStringLiteral("package.msiAttemptStatus"))', 'if (capability == QStringLiteral("package.stageStatus"))');
check(profile.includes('validNativeMSIAttemptReceiptEnvelope(record)'), 'profile enforces complete envelope');
check(single.includes('validNativeMSIAttemptReceiptEnvelope(value)'), 'single inspection enforces complete envelope');
check(profile.includes('validNativeMSIRegistrationTransition(record)'), 'profile enforces transition');
check(single.includes('validNativeMSIRegistrationTransition(value)'), 'single enforces transition');
check(profile.includes('validNativeMSIBootObservation(record.value'), 'profile enforces boot evidence');
check(single.includes('validNativeMSIBootObservation(value.value'), 'single enforces boot evidence');
check(helper.includes('report.value(QStringLiteral("receiptSha256"))'), 'receipt hash required');
check(helper.includes('attempt.value(QStringLiteral("artifactSha256"))'), 'artifact digest required');
check(helper.includes('attempt.value(QStringLiteral("msiSha256"))'), 'MSI digest required');
check(helper.includes('attempt.value(QStringLiteral("productCode"))'), 'signed ProductCode required');
check(helper.includes('attempt.value(QStringLiteral("productVersion"))'), 'signed ProductVersion required');
check(helper.includes('attempt.value(QStringLiteral("packageKey"))'), 'package identity required');
check(helper.includes('attempt.value(QStringLiteral("osAttested"))'), 'false OS attestation required');
check(helper.includes('product.value(QStringLiteral("productCode"))'), 'OS query identity must match signed code');
check(helper.includes('product.value(QStringLiteral("expectedVersion"))'), 'OS query version must match signed declaration');
check(helper.includes('validNativeMSIRegistrationSample(report.value(QStringLiteral("product"))'), 'OS product fully validated by shared sample guard');
check(helper.includes('attempt.isEmpty() && product.isEmpty()'), 'no-receipt cannot carry fake metadata');
check(helper.includes('report.value(QStringLiteral("stagedArtifactVerified"))'), 'staged bytes cannot be OS health');
check(!profile.includes('install-msi')&&!single.includes('install-msi'), 'inspection never launches MSI');
check(!profile.includes('consumeGrant')&&!single.includes('consumeGrant'), 'inspection does not consume grant');
check(profile.includes('records.size() <= 64'), 'profile remains bounded');
check(profile.includes('!keyPattern.match(key).hasMatch()'), 'profile keys validated');
check(profile.includes('key <= lastKey'), 'profile ordering checked to prevent duplicate rows');
check(single.includes('PACKAGE_MSI_EVIDENCE_UNSAFE'), 'single fails closed');
check(profile.includes('PACKAGE_MSI_EVIDENCE_UNSAFE'), 'profile fails closed');
const src=read('../native/package-stager-go/msi_registration_transition.go');
check(src.includes('observeMSIPostExitRegistration'), 'double-sample evidence implementation retained');
console.log(`${n}/${n} G26 Pass32 Qt MSI profile/single parity source-boundary checks passed (Qt linked runtime not exercised)`);
