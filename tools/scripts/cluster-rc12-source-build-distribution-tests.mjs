import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const installer=read('tools/installer/Install-Cluster.ps1');
const launcher=read('apps/server-launcher-go/main.go');
const admission=read('apps/server-launcher-go/managed_release_admission.go');
const deployed=read('tools/scripts/cluster-rc-runtime-admission.mjs');
const manifest=read('tools/scripts/cluster-rc-preflight.mjs');
const rootEntry=read('tools/server-entry-go/main.go');
const packageSrc=read('tools/scripts/package-cluster-rc.mjs');
const expected=[
 ['RC12 release identity',/^1\.0\.0-rc\.(?:1[2-9]|[2-9][0-9])$/.test(JSON.parse(read('config/release-candidate.json')).release)],
 ['installer privately provides pinned Go and Node',installer.includes('ProvisionPortableTools')&&installer.includes('$goArchiveSha256')&&installer.includes('$nodeArchiveSha256')],
 ['installer compiles Host',installer.includes("Run 'node' @('tools/scripts/build-native-host.mjs') $source")],
 ['installer compiles Server Manager',installer.includes("Run 'node' @('tools/scripts/build-server-launcher.mjs') $source")],
 ['installer compiles installed root entry',installer.includes("Run 'node' @('tools/scripts/build-cluster-server-entry.mjs') $source")],
 ['installer compiles Update helper',installer.includes("Run 'node' @('tools/scripts/build-update-helper.mjs') $source")],
 ['installer compiles Workstation service',installer.includes("Run 'node' @('tools/scripts/build-workstation-service.mjs') $source")],
 ['installer generates Prisma',installer.includes("Run 'npm.cmd' @('run','db:generate') $source")],
 ['installer compiles backend and renderer',installer.includes("Run 'npm.cmd' @('run','build') $source")],
 ['installer checks built outputs before mutation',installer.indexOf('cluster-rc-preflight.mjs')<installer.indexOf('ApplyRevision $source $hash')],
 ['installer checks deployed outputs before commit',installer.indexOf('cluster-rc-runtime-admission.mjs')<installer.indexOf('$committed = $true')],
 ['no automatic compilation for installed release',admission.includes('normal startup will not recompile')&&launcher.includes('verifyManagedStartup(root, force, prebuiltReady')],
 ['no npm install fallback for installed release',admission.includes('normal startup will not execute npm install')],
 ['explicit native repair kept separate',/if explicitRepair\s*\{\s*return nil\s*\}/.test(admission)],
 ['Prisma compiled output required',deployed.includes('apps/server/dist/generated/prisma/client.js')],
 ['deployed native host required',deployed.includes('bin/cluster-host.exe')],
 ['deployed update helper required',deployed.includes('bin/cluster-update-helper.exe')],
 ['deployed workstation helper required',deployed.includes('bin/cluster-workstation-service.exe')],
 ['compiled server module resolution checked',deployed.includes('createRequire(path.join(root,\'apps/server/dist/index.js\'))')],
 ['web bundle checked',deployed.includes('Built web bundle contains no JavaScript assets')],
 ['preflight checks production artifacts',manifest.includes('bin/cluster-workstation-service.exe')],
 ['root server delegates to manager',rootEntry.includes('NativeManager: filepath.Join(server, "bin", "ClusterServer.exe")')],
 ['both executables root package',packageSrc.includes("name:'Cluster Server.exe'")&&packageSrc.includes("name:'Cluster-Installer.exe'")],
];
for(const [name,okay] of expected){assert.ok(okay,name);console.log('PASS',name);}
console.log(`${expected.length}/${expected.length} RC12 source-built Windows distribution gates passed`);
