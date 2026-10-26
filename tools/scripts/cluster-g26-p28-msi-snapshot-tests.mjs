// Source-level invariants complement executable Go race-injection tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const helper=read('../native/package-stager-go/msi_profile_status.go');
const tests=read('../native/package-stager-go/msi_profile_status_test.go');
let count=0;
for(const marker of ['collectMSIProfileSnapshot','sameMSIProfileFile','sameMSIProfileSnapshot',
 'inspectMSIProfileWithCheckpoint(root, nil)','status.AdmissionLockPresent != out.AdmissionLockPresent',
 'terminal, e := collectMSIProfileSnapshot(abs)','!sameMSIProfileSnapshot(start, terminal)',
 'os.SameFile(before, after)','before.ModTime().Equal(after.ModTime())',
 'sort.Strings(names)','len(names) > maxMSIProfileEntries','!validPackageKey(key)',
 'info.Mode()&os.ModeSymlink != 0','return out, errors.New("MSI profile inventory changed during inspection")']) {
 assert.ok(helper.includes(marker),`MSI snapshot ${marker}`);count++}
for(const name of ['TestMSIProfileSnapshotRefusesConcurrentEntryCreation','TestMSIProfileSnapshotRefusesChangingAdmissionLock',
 'TestMSIProfileSnapshotRefusesReplacedReceipt','TestMSIProfileSnapshotRefusesAbsentRootBecomingPresent']){
 assert.ok(tests.includes('func '+name+'('),`race test ${name}`);count++}
const panel=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
assert.ok(panel.includes('verifyReadOnlyMSIProfile(report)'));count++;
assert.ok(panel.includes('report.complete !== true'));count++;
const qt=read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
assert.ok(qt.includes('value.value(QStringLiteral("complete")).toBool(false)'));count++;
const main=read('../native/package-stager-go/main.go');
assert.ok(main.includes('case "msi-profile-status"'));count++;
console.log(`${count}/${count} Pass28 stable MSI inventory source assertions passed`);
