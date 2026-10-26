/** TD6 F07 native audit + Qt/Desktop contract assertions. Native hash behavior is verified by actual Go tests. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const audit = read('tools/native/package-stager-go/file_update_audit.go');
const go = read('tools/native/package-stager-go/main.go');
const qt = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const bridge = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const tests = read('tools/native/package-stager-go/file_update_audit_test.go');
const checks = [
 ['signed, current selection gate', audit.includes('compareManagedDestination(o, destination)') && audit.includes('managedStatus(root, preview.PackageKey)')],
 ['independent canonical ledger', audit.includes('readDestinationState(statePath, preview.PackageKey, preview.Destination)')],
 ['read-only output', audit.includes('ReadOnly: true, Executed: false')],
 ['per-file hash check', audit.includes('io.Copy(digest, io.LimitReader(f, maxExpandedSize+1))')],
 ['tracked vs untracked disambiguation', audit.includes('untracked_collision') && audit.includes('tracked_modified')],
 ['retired source files reported', audit.includes('retired_modified') && audit.includes('retired_missing')],
 ['symlink-safe filesystem', audit.includes('os.Lstat(path)') && audit.includes('verifyDestinationParents(dest, filepath.Dir(path))')],
 ['bounded historical scan', audit.includes('maxDestinationAuditTracked') && audit.includes('maxDestinationAuditBytes')],
 ['ledger and managed generation race checks', audit.includes('reflect.DeepEqual(after, prior)') && audit.includes('final.Generation != initial.Generation')],
 ['CLI audit command wired', go.includes('case "audit-files":') && go.includes('CLUSTER_FILE_AUDIT_RESULT ')],
 ['Qt registers separate capability', qt.includes('QStringLiteral("package.auditFiles")')],
 ['Qt preserves local path authority', qt.includes('savedDestinationIsSafe(fileDestination)') && !bridge.includes('destinationPath:')],
 ['Qt parses bounded audit evidence', qt.includes('CLUSTER_FILE_AUDIT_RESULT ') && qt.includes('previewConflicts.size() >= 20')],
 ['read-only operations cannot update advisory installation history', qt.includes('if (success && fileOperation && !fileReadOnly)')],
 ['typed renderer bridge', bridge.includes('"file_update_audit"') && bridge.includes('retiredMissing: number')],
 ['Desktop audit button and display', ui.includes('Audit tracked destination files…') && ui.includes('Tracked destination integrity audit')],
 ['no OS installation attestation represented', ui.includes('Not proof of software installation or machine health.')],
 ['native Go test cases', tests.includes('TestDestinationAuditMissingHealthyModifiedAndRollback') && tests.includes('TestDestinationAuditUntrackedAndRetiredFiles') && tests.includes('TestDestinationAuditRejectsUnsafeFilesystemAndTracking')],
];
let passed=0;
for(const [label,valid] of checks){ console.log(`${valid?'PASS':'FAIL'} ${label}`);if(valid)passed++; }
console.log(`${passed}/${checks.length} F07 audit integration assertions passed`);
if(passed!==checks.length)process.exitCode=1;
