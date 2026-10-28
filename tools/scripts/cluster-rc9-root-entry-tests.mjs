// Root EXE admission gate: ensures RC packages the convenient one-click entry
// without introducing another server runtime or depending on old installs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source=fs.readFileSync(path.join(root,'tools/server-entry-go/main.go'),'utf8');
const test=fs.readFileSync(path.join(root,'tools/server-entry-go/main_test.go'),'utf8');
const pack=fs.readFileSync(path.join(root,'tools/scripts/package-cluster-rc.mjs'),'utf8');
const makeInstaller=fs.readFileSync(path.join(root,'tools/scripts/build-cluster-installer.mjs'),'utf8');
const installer=fs.readFileSync(path.join(root,'tools/installer/Install-Cluster.ps1'),'utf8');
const smoke=fs.readFileSync(path.join(root,'tools/scripts/cluster-rc-native-checks.mjs'),'utf8');
const expected=[
 ['legacy Windows PowerShell BOM supported',source.includes('bytes.TrimPrefix(markerBytes')],
 ['new markers written BOM-free',installer.includes('($record | ConvertTo-Json -Depth 5), ([Text.UTF8Encoding]::new($false))')],
 ['portable server path',source.includes('filepath.Join(managed, "Server")')],
 ['full root exe identity',source.includes('Cluster Server.exe')],
 ['native manager delegate',source.includes('ClusterServer.exe')],
 ['private dependencies managed by native launcher',source.includes('"--startup", "--browser"')],
 ['explicit interface mode',source.includes('"--interface"')],
 ['first run installer fallback',source.includes('paths.Installer')],
 ['does not use system node or PostgreSQL',!source.includes('postgres.exe')&&!source.includes('node.exe')],
 ['checks managed marker ownership',source.includes('marker.ManagedBy != "cluster-installer"')],
 ['validates install root',source.includes('marker.InstallRoot')],
 ['no automatic privileged launch',!source.includes('runas')&&!source.includes('ShellExecute')],
 ['launches child without hanging root stub',source.includes('command.Process.Release()')],
 ['missing installer gives actionable error',test.includes('TestMissingInstallerIsActionable')],
 ['rejects foreign installer markers',test.includes('TestInvalidMarkerCannotLaunchForeignServer')],
 ['performs Go module tests before build',smoke.includes("'tools/server-entry-go'")],
 ['Go stub built early',installer.includes("Run 'node' @('tools/scripts/build-cluster-server-entry.mjs') $source")],
 ['built artifact checked before deploy',installer.includes("'bin/Cluster Server.exe'")],
 ['both executables at archive root',pack.includes("name:'Cluster Server.exe'")&&pack.includes("name:'Cluster-Installer.exe'")],
 ['launcher not bundled recursively in installer',makeInstaller.includes("rel==='bin/Cluster Server.exe'")],
];
for (const [name,ok] of expected) assert.ok(ok,`RC9 root entry: ${name}`);
console.log(`${expected.length}/${expected.length} RC9 root-entry packaging and lifecycle checks passed`);
