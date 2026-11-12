// Desktop 1.2.2 must be a genuinely rebuilt Qt application, never renamed 0.482.0 bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const identity=JSON.parse(read('config/release-candidate.json'));
const toolchains=JSON.parse(read('config/toolchain-versions.json'));
const profiles=JSON.parse(read('config/distribution-profiles.json'));
const cmake=read('apps/desktop-qt/CMakeLists.txt');
const desktop=profiles.profiles['desktop-windows-x64'];
const workflow=read('.github/workflows/desktop-qt-candidate.yml');
const nativeVersion=toolchains.desktop?.parityVersionHold;
assert.equal(identity.release,'1.2.2');
assert.equal(identity.sequence,200002);
assert.equal(nativeVersion,identity.release,'Desktop version must match integrated release');
assert.equal(desktop.desktopNativeVersion,nativeVersion,'Profile cannot reuse old binaries');
assert.ok(cmake.includes('project(ClusterDesktop VERSION 1.2.2 LANGUAGES CXX)'),'Qt must compile new version');
assert.ok(cmake.includes('string(JSON CLUSTER_SUITE_RUNTIME_VERSION GET') &&
 cmake.includes('set(CLUSTER_RUNTIME_VERSION'),'workstation helper must use current suite runtime');
assert.ok(cmake.includes('CLUSTER_WORKSTATION_MANIFEST_VERSION STREQUAL CLUSTER_RUNTIME_VERSION'),'Qt must verify native helper provenance');
assert.ok(workflow.includes('branches: [main, client/desktop-qt]') && workflow.includes('pull_request:'),'Qt must build on main and release PR');
assert.ok(workflow.includes('--channel $channel --build'),'CI must rebuild Qt installer, not rename old files');
assert.ok(workflow.includes("Start-Process -FilePath (Resolve-Path $executable) -ArgumentList '--smoke-test'"),'CI must boot packaged Qt EXE and validate QML load');
assert.ok(workflow.includes('Cluster-Desktop-Installer-1.2.2-windows-x64.exe') &&
 workflow.includes('Cluster-Desktop-1.2.2-windows-x64.zip'),'CI artifacts must use new identity');
assert.ok(!workflow.includes('Cluster-Desktop-Installer-0.482.0-windows-x64.exe'),'CI must not upload legacy installer');
const packager=read('tools/scripts/package-qt-desktop.mjs');
assert.ok(packager.includes('run(cpack, ["--config", cpackConfig, "-G", "NSIS"'),'must emit NSIS');
assert.ok(packager.includes('Server executable leaked into the Desktop distribution:'),'must reject Server files in Desktop');
assert.ok(workflow.includes('artifacts/release-profiles/desktop-windows-x64/build-receipt.json'),'versioned Qt release requires source/hash receipt');
console.log('PASS: Cluster 1.2.2 Qt Desktop native identity, helper parity, Windows build/launch and distribution contracts');
