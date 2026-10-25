/** F06 source wiring checks; native semantics are exercised by go test ./.... */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const preview = read('tools/native/package-stager-go/file_update_preview.go');
const sync = read('tools/native/package-stager-go/file_update_sync.go');
const native = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const bridge = read('packages/renderer/src/core/desktop.ts');
const checks = [
 ['native read-only classification', preview.includes('classifyDestinationActions(&out, prior)')],
 ['safe tracked upgrades', preview.includes('update_managed')],
 ['untracked collisions', preview.includes('conflict_untracked')],
 ['local modification detection', preview.includes('conflict_modified')],
 ['pending recovery disclosed', preview.includes('out.PendingRecovery = true')],
 ['pre-update scan under lock', sync.includes('classifyDestinationActions(&preview, prior)')],
 ['blocked conflicts before journal', sync.indexOf('no update journal created') < sync.indexOf('os.MkdirAll(filepath.Join(opDir, "backups")')],
 ['state file symlinks blocked', sync.includes('unsafe destination tracking file')],
 ['journal symlinks blocked', sync.includes('unsafe destination journal file')],
 ['native Qt forwards plan', native.includes('QStringLiteral("filePlan")')],
 ['native Qt bounded examples', native.includes('previewConflicts.size() >= 20')],
 ['renderer bridge typed', bridge.includes('conflictExamples: Array<')],
 ['Desktop summary mounted', ui.includes('Verified destination update plan')],
 ['Desktop names conflict categories', ui.includes('Locally modified') && ui.includes('Untracked file')],
 ['no installer attestation claimed', ui.includes('No files installed, executed, or modified.')],
];
let passed = 0;
for (const [name, valid] of checks) {
 if (valid) passed++;
 console.log(`${valid ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`${passed}/${checks.length} TD6 F06 Package plan source integration assertions passed`);
if (passed !== checks.length) process.exitCode = 1;
