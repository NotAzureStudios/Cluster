#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const read=p=>readFileSync(join(root,p),'utf8');
const go=read('tools/native/package-stager-go/msi_installer.go');
const identity=read('tools/native/package-stager-go/msi_identity.go');
const native=read('tools/native/package-stager-go/msi_identity_windows.go');
const qt=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ui=read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const contract=read('packages/renderer/src/core/desktop.ts');
let passed=0;
function test(title, fn){fn();passed++;console.log('PASS',title)}
test('MSI identity inspection reads the Property table through read-only Windows Installer database API',()=>{
 assert.match(native,/MsiOpenDatabaseW/);assert.match(native,/MsiDatabaseOpenViewW/);
 assert.match(native,/MsiViewFetch/);assert.match(native,/MSIDBOPEN_READONLY/);
 assert.match(native,/ProductCode/);assert.match(native,/ProductVersion/);
 assert.doesNotMatch(native,/MsiInstallProduct|MsiConfigureProduct|MsiApplyPatch|msiexec\.exe/);
});
test('Signed staged MSI digests are checked before metadata verification',()=>{
 const start=go.indexOf('func previewMSIInstaller');const end=go.indexOf('func runVerifiedMSI');const text=go.slice(start,end);
 assert.ok(text.indexOf('verifyRegularDigest(path') >= 0); assert.ok(text.indexOf('inspectStagedMSIProperties(path') > text.indexOf('verifyRegularDigest(path'));
});
test('Installation blocks embedded identity mismatch before consuming grant or creating an attempt receipt',()=>{
 const s=go.slice(go.indexOf('func installSupervisedMSI'));
 const identityCheck=s.indexOf('inspectStagedMSIProperties(installerPath'); const consume=s.indexOf('consumeGrant(root, claim)'); const receipt=s.indexOf('writeRawAtomic(receipt, raw)');
 assert.ok(identityCheck>=0 && identityCheck < consume && identityCheck < receipt);
});
test('Pure identity policy denies noncanonical/missing embedded values and mismatches',()=>{
 assert.match(identity,/msiProductCodePattern\.MatchString\(actualCode\)/);
 assert.match(identity,/msiProductVersionPattern\.MatchString\(actualVersion\)/);
 assert.match(identity,/declared\.ProductCode != actualCode \|\| declared\.ProductVersion != actualVersion/);
 assert.match(identity,/ReadOnly:\s*true, OSAttested:\s*false/);
});
test('Qt rejects preview evidence without matching internal identity, and forwards it to Desktop',()=>{
 assert.match(qt,/msi_properties_match_signed_declaration/);
 assert.match(qt,/"actualProductCode"/);assert.match(qt,/"actualProductVersion"/);
 assert.match(qt,/"msiIdentity"/);
});
test('Desktop distinguishes MSI file identity verification from software registration and health',()=>{
 assert.match(ui,/Staged MSI Property table/);assert.match(ui,/not software-health or publisher verification/);
 assert.match(contract,/msiIdentity\?:/);assert.match(ui,/Windows Installer product registration/);
});
test('Native Go identity regression tests execute successfully',()=>{
 const result=spawnSync('go',['test','./...'],{cwd:join(root,'tools/native/package-stager-go'),encoding:'utf8',timeout:120000});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
console.log(`${passed}/${passed} G14 installer identity integration checks passed`);
