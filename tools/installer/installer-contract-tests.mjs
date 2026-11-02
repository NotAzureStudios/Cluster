import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const installer=import.meta.dirname;
const root=path.resolve(installer,'../..');
// Git for Windows checks out PowerShell files with CRLF. Compare normalized
// source text rather than failing a valid installer on its line endings.
const ps=fs.readFileSync(path.join(installer,'Install-Cluster.ps1'),'utf8').replace(/\r\n/g,'\n');
const src=fs.readFileSync(path.join(installer,'main.go'),'utf8');
const builder=fs.readFileSync(path.join(root,'tools/scripts/build-cluster-installer.mjs'),'utf8');
let passed=0;function check(name,condition){assert.ok(condition,name);console.log('PASS',name);passed++;}
check('installer product naming',src.includes('Cluster Installer')&&!src.includes('One-Click Test Manager'));
check('portable application stays beside installer, not drive/profile root',src.includes('filepath.Dir(executable), "Cluster"')&&!src.includes('ClusterStudio-Managed'));
check('never adopts legacy test marker',src.includes('cluster-installer-managed.json')&&src.includes('m.ManagedBy != "cluster-installer"'));
check('archive and script are embedded',src.includes('assets/bundled-source.zip Install-Cluster.ps1'));
check('private verified toolchains',ps.includes('6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba')&&ps.includes('a3911b5e0e1b1053f25ed0675f4c1c6aad1e2bfcf253df2b9be4caabd2edd95d'));
check('download progress is suppressed',ps.includes("$ProgressPreference = 'SilentlyContinue'"));
check('temporary and cache paths inside portable root',ps.includes('$env:TEMP = $tempPath')&&ps.includes('$env:GOCACHE =')&&ps.includes('$env:npm_config_cache ='));
check('validated before execute',ps.indexOf('  TestManifest $source')<ps.lastIndexOf('  ProvisionPortableTools'));
check('build before replacement',ps.indexOf("Run 'npm.cmd' @('run','build')")<ps.indexOf('ApplyRevision $source $hash'));
check('project preserved',ps.includes("$preserved = @('data', 'runtime', $ownerMarker)")&&ps.includes('apps/server/.env'));
check('refuses unmanaged destination',ps.includes('Refusing to overwrite an unmanaged folder'));
check('process and port safety',ps.includes('AssertServerStopped $target')&&ps.includes('ClusterStudioServer')&&ps.includes('@(3000, 4000, 54321)'));
check('rollback state tracked',ps.includes('$movedOld.Add')&&ps.includes('if (-not $committed)'));
check('artifact manifest integrity',ps.includes('Source integrity failure: $relative'));
check('native server started automatically',ps.includes("'--interface','--startup','--browser'"));
check('relaunch skips recompiling same revision',ps.includes('without rebuilding')&&ps.includes('if ($StartInstalled)'));
check('no OS-level installers',!/winget|choco|Start-Process\s+msiexec|\.msi\b/i.test(ps));
check('installer script can safely live within work root',!ps.includes('Install workspace cannot overwrite the installer folder')&&ps.includes('EnsureUnder $target $WorkRoot'));
check('no user-profile AppData probing',!ps.includes('LOCALAPPDATA'));
check('fresh install uses bundled source, not random adjacent archive',src.includes('chooseEmbeddedRevision(installedHash, embeddedHash')&&src.includes('Use the revision embedded in this EXE')); 
check('runtime pruning of root documents leaves nested app files to targeted pruning',ps.includes('Get-ChildItem -LiteralPath $source -File')&&ps.includes('tools/fixtures')); 
check('source ZIP excludes installer executable and embedded payload',builder.includes("bin/Cluster-Installer.exe")&&builder.includes("tools/installer/assets/bundled-source.zip"));
check('source ZIP generated without external npm ZIP dependencies',builder.includes("from 'node:zlib'")&&builder.includes('crc32'));
check('native compiler stdout and stderr retained for troubleshooting',ps.includes('2>&1 | ForEach-Object') && ps.includes('full stdout/stderr is in $script:log') && ps.includes('Installer logging: native stdout/stderr retained'));
check('subprocess exit code still gates installation and leaves existing server untouched',ps.includes('$exitCode = $LASTEXITCODE') && ps.includes('if ($null -eq $exitCode -or $exitCode -ne 0)'));
check('database credentials are masked in recorded native output',ps.includes('$safeLine = $line -replace') && ps.includes('[REDACTED]@'));


check('candidate upgrade is sequence-based, not based on an EXE timestamp',src.includes('releaseSequence')&&src.includes('chooseEmbeddedRevision')&&!src.includes('shouldUpgradeBundled')&&!src.includes('installerModified'));
check('first-time install has no prior managed folder requirement',src.includes('!installed || chooseEmbeddedRevision')&&ps.includes('Installed independent fresh Cluster release candidate'));
check('manifests reject unlisted files before npm executes',ps.includes('Unlisted source file in archive')&&ps.indexOf('  TestManifest $source')<ps.indexOf('  ProvisionPortableTools'));
check('candidate source regressions run before installation',ps.includes("cluster-rc-smoke.mjs")&&ps.indexOf('cluster-rc-smoke.mjs')<ps.indexOf('ApplyRevision $source $hash'));
check('release gate runs before installation',ps.includes("Run 'node' @('tools/scripts/cluster-rc-preflight.mjs','--built')")&&ps.indexOf('cluster-rc-preflight.mjs')<ps.indexOf('ApplyRevision $source $hash'));
check('candidate fails build rather than replacing server',ps.includes("Run 'npm.cmd' @(") && ps.indexOf("Run 'npm.cmd' @('run','build')")<ps.indexOf('ApplyRevision $source $hash'));
check('candidate records release sequence and channel',ps.includes('releaseSequence = [int]$releaseIdentity.sequence')&&ps.includes('releaseChannel'));
check('compiler dependencies are pinned when lockfile available',ps.includes("Run 'npm.cmd' @('ci'")&&ps.includes('stable release is BLOCKED'));
check('runtime prunes old test scripts after compiling',ps.includes('Get-ChildItem -LiteralPath $scriptsDir')&&ps.includes("'tools/fixtures','tools/installer'"));

check('runtime junction relocation fixed before commit',ps.includes('RepairWorkspaceJunctions $target') && ps.includes("Run 'node' @('tools/scripts/cluster-rc-runtime-admission.mjs') $target") && ps.indexOf('RepairWorkspaceJunctions $target') < ps.indexOf('$committed = $true'));
check('runtime link fix preserves data and fails safely',ps.includes('[IO.Directory]::Delete($link, $false)') && ps.includes('Expected a workspace junction, refusing to replace a physical directory'));
check('native Go compilation precedes npm dependencies and TypeScript compilation',ps.indexOf("Run 'node' @('tools/scripts/build-native-host.mjs')") < ps.indexOf("Run 'npm.cmd' @('install'") && ps.indexOf("Run 'node' @('tools/scripts/build-server-launcher.mjs')") < ps.indexOf("Run 'npm.cmd' @('run','build')"));
check('native Go unit checks precede native binaries',ps.indexOf('cluster-rc-native-checks.mjs') < ps.indexOf("Run 'node' @('tools/scripts/build-native-host.mjs')"));
check('root launcher published after installed commit',ps.includes('function PublishRootServerLauncher') && ps.indexOf('  ApplyRevision $source $hash') < ps.lastIndexOf('  PublishRootServerLauncher $target'));
check('root entry point copied beside the installer',ps.includes("$portableRoot = Split-Path -Parent $WorkRoot") && ps.includes("Join-Path $portableRoot 'Cluster Server.exe'") && ps.includes("Join-Path $installedRoot 'bin/Cluster Server.exe'"));
check('root launcher cannot overwrite unmanaged EXE',ps.includes('Root executable already exists and is not managed') && ps.includes('$record.sha256 -ine $actual'));
check('root launcher staging verified and rollback supported',ps.includes('Root launcher copy failed integrity verification') && ps.includes('if ($oldMoved -and (Test-Path -LiteralPath $backup'));
check('relaunch repairs missing root launcher',ps.includes("Installed revision is current; launching without rebuilding.'\n      PublishRootServerLauncher $target") && ps.includes('if ($StartInstalled)'));
console.log(`${passed}/${passed} integrated Cluster Installer contract checks passed`);
