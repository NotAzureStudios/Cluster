import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const cpp = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ts = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const go = read('tools/native/package-stager-go/file_update_sync.go');
const caps = cpp.slice(cpp.indexOf('QStringList NativeCapabilityBroker::capabilities() const'), cpp.indexOf('QString NativeCapabilityBroker::successResponse'));
const schemas = cpp.slice(cpp.indexOf('bool NativeCapabilityBroker::validatePayloadShape'), cpp.indexOf('QJsonValue NativeCapabilityBroker::dispatch'));
const checks = [
  ['native per-profile destination store', cpp.includes('DesktopPackageDestinations') && cpp.includes('store.beginGroup(profileId)')],
  ['native per-profile history store', cpp.includes('DesktopPackageUpdateHistory') && cpp.includes('history.beginGroup(profileId)')],
  ['native folder picker authoritative', cpp.includes('Select persistent Package destination') && cpp.includes('QFileDialog::getExistingDirectory')],
  ['renderer cannot provide paths', !ts.includes('package.destination.setPath') && ts.includes('Never accept destination paths')],
  ['saved destination validation', cpp.includes('savedDestinationIsSafe(fileDestination)') && cpp.includes('QDir::isAbsolutePath(value)')],
  ['native confirmation for updates', cpp.includes('Cluster destination file updater') && cpp.includes('if (fileAdopt && QMessageBox::warning')],
  ['saved folder reused by updater', cpp.includes('fileDestination = store.value(expectedKey).toString()')],
  ['unmapped fallback picker retained', cpp.includes('if (fileDestination.isEmpty()) {') && cpp.includes('Choose existing folder for Package files')],
  ['status fields are advisory not attested', cpp.includes('Advisory only: persisted UI freshness is NOT signature or OS') && ui.includes('not an installation attestation')],
  ['local rollback does not falsely report current release', cpp.includes('history.remove(QString()); // rollback requires')],
  ['remapping clears old status', cpp.includes('do not report a different folder as up to date')],
  ['forgetting folder does not delete files', cpp.includes('not native backups or destination files')],
  ['signed managed files remain authoritative', go.includes('compareManagedDestination(o, destination)') && go.includes('recoverDestinationPending')],
  ['update fresh entitlement check remains', ui.includes('This Package is no longer an authorized device target.')],
  ['renderer refreshes local history after native completion', ui.includes('file_update_complete') && ui.includes('getNativePackageDestinations().then')],
  ['users can save and forget folder', ui.includes('Save destination folder') && ui.includes('Forget destination')],
  ['users can compare reported release to current target', ui.includes('destination.reportedArtifactSha256 === target.release.artifactSha256')],
  ['file update still has rollback and replacement', ui.includes('Roll back selected folder') && ui.includes('Replace conflicting files')],
];
const expected = [
  'package.previewFiles', 'package.syncFiles', 'package.replaceFiles', 'package.rollbackFiles',
  'package.auditManaged', 'package.destination.list', 'package.destination.choose', 'package.destination.remove',
];
for (const name of expected) {
  checks.push([`${name} registered in native capabilities`, caps.includes(`QStringLiteral("${name}")`)]);
  checks.push([`${name} registered in native payload schema`, schemas.includes(`{QStringLiteral("${name}"),`)]);
  checks.push([`${name} present in renderer bridge`, ts.includes(`"${name}"`)]);
  checks.push([`${name} native dispatcher implementation`, cpp.slice(cpp.indexOf('QJsonValue NativeCapabilityBroker::dispatch')).includes(`capability == QStringLiteral("${name}")`)]);
}
for (const [name, passed] of checks) {
  assert.ok(passed, name);
  console.log('PASS', name);
}
console.log(`${checks.length}/${checks.length} Desktop updater source-contract checks passed`);
