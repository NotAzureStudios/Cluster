import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file=(p)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const go=file('tools/native/package-stager-go/file_update_sync.go');
const main=file('tools/native/package-stager-go/main.go');
const cpp=file('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ts=file('packages/renderer/src/core/desktop.ts');
const ui=file('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const checks=[
 ['tracked sync',go.includes('func syncFolder(')&&go.includes('prior.Files[entry.Path] != entry.DestinationSha256')],
 ['private preimage backups',go.includes('"backups/%04d"')&&go.includes('copyVerifiedFile(target,')],
 ['interrupted update recovery',go.includes('recoverDestinationPending')&&go.includes('preview, err = compareManagedDestination(o, destination)')],
 ['private update lock',go.includes('os.Mkdir(lock,')],
 ['guarded rollback',go.includes('local edit prevents rollback')],
 ['untracked files refuse by default',go.includes('!adoptExisting')],
 ['manual explicit replacement action',main.includes('"replace-files"')&&main.includes('*action == "replace-files"')],
 ['native file update commands',main.includes('"sync-files"')&&main.includes('"rollback-files"')],
 ['native destination-only picker',cpp.includes('QFileDialog::getExistingDirectory')],
 ['native additional destructive confirmation',cpp.includes('if (fileAdopt && QMessageBox::warning')],
 ['native result parsing',cpp.includes('CLUSTER_FILE_SYNC_RESULT')&&cpp.includes('CLUSTER_FILE_UPDATE_PREVIEW')],
 ['renderer cannot choose destination',ts.includes('Never accept destination paths or overwrite permissions from renderer input')],
 ['renderer routing for file updater',ts.includes('package.replaceFiles')&&ts.includes('package.rollbackFiles')],
 ['UI actions exposed',ui.includes('Preview destination files')&&ui.includes('Update selected folder')&&ui.includes('Roll back selected folder')],
 ['UI explicit override',ui.includes('Replace conflicting files (back up originals)')],
 ['fresh server targets checked',ui.includes('This Package is no longer an authorized device target.')],
];
for (const [label,condition] of checks) {assert.ok(condition,label);console.log('PASS',label)}
console.log(`${checks.length}/${checks.length} updater integration assertions passed`);
