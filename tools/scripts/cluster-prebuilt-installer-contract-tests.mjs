import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const builder = read('tools/scripts/build-cluster-installer.mjs');
const bootstrap = read('tools/installer/main.go');
const installer = read('tools/installer/Install-Cluster.ps1');
const source = read('tools/installer/installer-contract-tests.mjs');

assert.match(builder, /CLUSTER_INSTALLER_PAYLOAD\|\|'prebuilt'/);
assert.match(builder, /process\.platform!=='win32'\|\|process\.arch!=='x64'/);
assert.match(builder, /package-lock\.json is missing/);
assert.match(builder, /lock\.lockfileVersion<3/);
assert.match(builder, /Prebuilt installer requires a traceable commit/);
assert.match(builder, /gitStatus\.status!==0\|\|stagedStatus\.status!==0/);
assert.match(builder, /kind:'prebuilt-windows-x64'/);
assert.match(builder, /config\/prebuilt-runtime\.json/);
assert.match(builder, /source\/SOURCE_FILE_MANIFEST\.sha256/);
assert.match(builder, /\(!prebuilt&&rel==='bin\/Cluster Server\.exe'\)/);
assert.match(builder, /node_modules\/@cluster\//);
assert.match(builder, /totalBytes>2147483648/);

assert.match(bootstrap, /embeddedPrebuiltInfo\(bundled, identity\)/);
assert.match(bootstrap, /CLUSTER_INSTALLER_DEV_SOURCE_BUILD/);
assert.match(bootstrap, /dragged ZIP installation is disabled/);
assert.match(bootstrap, /-AllowDevSourceBuild/);
assert.match(bootstrap, /Verified prebuilt runtime: no Node\/Go compilation/);

assert.match(installer, /function TestPrebuiltRuntime\(/);
assert.match(installer, /\$metadata\.release -ne \$releaseIdentity\.release/);
assert.match(installer, /\$metadata\.sequence -ne \$releaseIdentity\.sequence/);
assert.match(installer, /Prebuilt artifact integrity failure/);
assert.match(installer, /Prebuilt Windows executable has invalid PE header/);
assert.match(installer, /if \(\$isPrebuilt\) \{/);
assert.match(installer, /ProvisionPortableTools -RuntimeOnly/);
assert.match(installer, /if \(\$isPrebuilt\) \{ RepairWorkspaceJunctions \$source \}/);
assert.match(installer, /elseif \(\$AllowDevSourceBuild\)/);
assert.match(installer, /Source compilation is developer-only/);
assert.match(installer, /if \(\$RuntimeOnly\) \{/);
assert.ok(installer.indexOf('TestPrebuiltRuntime $source') < installer.indexOf('ApplyRevision $source $hash'), 'Verify before modifying installed release');

const prebuiltSection = installer.split('  if ($isPrebuilt) {\n    Say')[1]?.split('  } elseif ($AllowDevSourceBuild) {')[0];
assert.ok(prebuiltSection, 'Prebuilt installation branch required');
assert.doesNotMatch(prebuiltSection, /npm\.cmd|build-native-host|build-server-launcher|db:generate|build-update-helper/, 'Normal installer must not compile');
assert.match(source, /candidate source regressions run before installation/, 'Existing source-mode contract checks remain present');

const artifacts = [...builder.match(/const requiredRuntime=\[([\s\S]*?)\];/)?.[1].matchAll(/'([^']+)'/g) ?? []].map(m => m[1]);
assert.ok(artifacts.length >= 10, 'Require compiled server, web, Prisma, native and validation artifacts');
for (const artifact of artifacts) {
  assert.ok(installer.includes("'"+artifact+"'"), 'PowerShell must verify packaged artifact ' + artifact);
}
assert.match(bootstrap, /repairSameRelease := len\(os\.Args\) == 2 && os\.Args\[1\] == "--repair"/);
assert.match(bootstrap, /sameReleaseRepairAllowed\(installed, installedHash, embeddedHash, installedSeq, identity\.Sequence\)/);
assert.match(bootstrap, /"-RepairInstalled", "-SkipLaunch"/);
assert.match(installer, /\[switch\]\$RepairInstalled/);
assert.match(installer, /\$existing\.archiveSha256 -ine \$hash/);
assert.match(installer, /if \(-not \$RepairInstalled -and \$installed\.archiveSha256 -eq \$hash/);
assert.match(installer, /Recover the environment file from a verified backup before repair/);
console.log('PASS: prebuilt installer and exact-revision data-preserving repair contracts (' + artifacts.length + ' required artifacts)');
