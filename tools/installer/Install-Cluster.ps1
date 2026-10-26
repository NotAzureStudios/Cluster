# Cluster Installer: managed Windows server installation/update from a full source revision.
# Experimental: native Windows/Node/PostgreSQL certification is not yet complete.
# Requires only Windows PowerShell 5.1+ and network for first-run portable toolchains.
[CmdletBinding()]
param(
  [string]$Archive,
  [string]$WorkRoot = (Join-Path $PSScriptRoot 'Cluster'),
  [switch]$BuildOnly,
  [switch]$CheckOnly,
  [switch]$SkipLaunch,
  [switch]$AllowUntrustedArchive,
  [switch]$StartInstalled
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Prevent PowerShell 5.1's full-width blue download progress block.
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$target = Join-Path $WorkRoot 'Server'
$incoming = Join-Path $WorkRoot 'Revisions'
$buildRoot = Join-Path $WorkRoot 'Build'
$backupRoot = Join-Path $WorkRoot 'Rollback'
$ownerMarker = '.cluster-installer-managed.json'
$preserved = @('data', 'runtime', $ownerMarker)
$log = $null

function Say([string]$message) {
  $line = '[Cluster Installer] ' + $message
  Write-Host $line
  if ($script:log) { Add-Content -LiteralPath $script:log -Value $line -Encoding UTF8 }
}
function Fail([string]$message) { throw $message }
function EnsureUnder([string]$path, [string]$parent) {
  $p = [IO.Path]::GetFullPath($path).TrimEnd('\','/')
  $r = [IO.Path]::GetFullPath($parent).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  if (-not $p.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { Fail "Unsafe path outside lab root: $path" }
}
# Pin the official platform archive digests. Toolchains are private and never installed into Windows.
$nodeArchiveSha256 = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
$goArchiveSha256 = 'a3911b5e0e1b1053f25ed0675f4c1c6aad1e2bfcf253df2b9be4caabd2edd95d'
function GetVerifiedDownload([string]$url, [string]$archive, [string]$hash) {
  if (Test-Path -LiteralPath $archive -PathType Leaf) {
    $existing = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    if ($existing -ieq $hash) { Say "Using verified cached archive: $archive"; return }
    Remove-Item -LiteralPath $archive -Force
  }
  $partial = "$archive.downloading"
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  Say "Downloading private toolchain: $url"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing -MaximumRedirection 5
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $hash) { Fail "Official toolchain SHA-256 verification failed: $url" }
    Move-Item -LiteralPath $partial -Destination $archive -Force
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  }
}
function ProvisionPortableTools() {
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Cluster Installer requires 64-bit Windows.' }
  $toolRoot = Join-Path $WorkRoot 'Toolchains'
  $cache = Join-Path $toolRoot 'Downloads'
  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  $nodeVersion = '24.20.0'
  $nodeFile = "node-v$nodeVersion-win-x64.zip"
  $node = Join-Path $toolRoot "node-v$nodeVersion\node.exe"
  $npm = Join-Path $toolRoot "node-v$nodeVersion\npm.cmd"
  if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $npm -PathType Leaf)) {
    $download = Join-Path $cache $nodeFile
    GetVerifiedDownload "https://nodejs.org/dist/v$nodeVersion/$nodeFile" $download $nodeArchiveSha256
    $staging = Join-Path $toolRoot 'node.staging'
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory($download, $staging)
    $extracted = Join-Path $staging "node-v$nodeVersion-win-x64"
    if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))) { Fail 'Node archive did not contain expected runtime.' }
    $destination = Split-Path -Parent $node
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    Move-Item -LiteralPath $extracted -Destination $destination
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  $nodeResult = (& $node --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeResult -ne 'v24.20.0') { Fail "Private Node verification failed: $nodeResult" }
  $goVersion = '1.27.1'
  $goFile = "go$goVersion.windows-amd64.zip"
  $go = Join-Path $toolRoot "go-$goVersion\go\bin\go.exe"
  if (-not (Test-Path -LiteralPath $go -PathType Leaf)) {
    $download = Join-Path $cache $goFile
    GetVerifiedDownload "https://go.dev/dl/$goFile" $download $goArchiveSha256
    $staging = Join-Path $toolRoot 'go.staging'
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory($download, $staging)
    if (-not (Test-Path -LiteralPath (Join-Path $staging 'go/bin/go.exe'))) { Fail 'Go archive missing expected toolchain.' }
    $destination = Join-Path $toolRoot "go-$goVersion"
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $destination
  }
  $goResult = (& $go version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $goResult -notmatch 'go1\.27\.1\s+windows/amd64') { Fail "Private Go verification failed: $goResult" }
  # Process-local PATH; no machine installation, administrator permission, or permanent PATH modification.
  $env:GOROOT = Join-Path $toolRoot "go-$goVersion\go"
  $env:PATH = (Split-Path -Parent $node) + ';' + (Split-Path -Parent $go) + ';' + $env:PATH
  $env:GOTOOLCHAIN = 'local'
  $env:GOPATH = Join-Path $toolRoot 'GoCache'
  $env:GOCACHE = Join-Path $toolRoot 'GoBuildCache'
  $env:npm_config_cache = Join-Path $toolRoot 'NpmCache'
  Say 'Private Node and Go are ready. No system-level installation required.'
}
function Run([string]$executable, [string[]]$arguments, [string]$workingDirectory) {
  Say ("Running: " + $executable + ' ' + ($arguments -join ' '))
  Push-Location -LiteralPath $workingDirectory
  try {
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$executable failed (exit $LASTEXITCODE); existing Cluster installation was not replaced." }
  } finally { Pop-Location }
}
function IsBadEntry([string]$path) {
  if (-not $path -or $path.StartsWith('/') -or $path.StartsWith('\') -or $path -match '^[A-Za-z]:' -or $path.Contains(':')) { return $true }
  $normalized = $path.Replace('\', '/')
  if (-not $normalized.StartsWith('source/', [StringComparison]::Ordinal)) { return $true }
  $parts = @($normalized.Split('/'))
  for ($i = 0; $i -lt $parts.Count; $i++) {
    if ($parts[$i] -eq '..' -or $parts[$i] -eq '.') { return $true }
    if ($parts[$i] -eq '' -and $i -ne ($parts.Count - 1)) { return $true }
    if ($parts[$i] -eq '' -and -not $normalized.EndsWith('/')) { return $true }
  }
  return $false
}
function TestZip([string]$file) {
  $archiveObject = [IO.Compression.ZipFile]::OpenRead($file)
  try {
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $required = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $files = 0
    [long]$uncompressed = 0
    foreach ($entry in $archiveObject.Entries) {
      $p = $entry.FullName.Replace('\','/')
      if (IsBadEntry $p) { Fail "Archive contains invalid path: $p" }
      # ZIP Unix file type 0xA000 indicates a symlink; reject rather than following it.
      if (($entry.ExternalAttributes -band [int]0xF0000000) -eq [int]0xA0000000) { Fail "ZIP symlink not accepted: $p" }
      if (-not $p.EndsWith('/')) {
        $uncompressed += $entry.Length
        if ($entry.Length -gt 268435456 -or $uncompressed -gt 2147483648) { Fail 'ZIP exceeds development-source safety limits.' }
        if ($entry.Length -gt 10485760 -and $entry.CompressedLength -lt ($entry.Length / 1000)) { Fail 'ZIP entry decompression ratio exceeds limit.' }
        if (-not $names.Add($p)) { Fail "ZIP contains duplicate path: $p" }
        $null = $required.Add($p)
        $files++
      }
      if ($files -gt 100000) { Fail 'Archive has too many entries.' }
    }
    foreach ($need in @('source/package.json','source/config/toolchain-versions.json', 'source/apps/server/package.json','source/apps/web/package.json','source/apps/server-launcher-go/main.go','source/apps/host-go/main.go','source/tools/scripts/build-native-host.mjs')) {
      if (-not $required.Contains($need)) { Fail "Archive is not a full Cluster source revision. Missing: $need" }
    }
    if ($files -lt 200) { Fail "Suspiciously small source revision ($files files)." }
  } finally { $archiveObject.Dispose() }
}
function TestManifest([string]$source) {
  $manifest = Join-Path $source 'SOURCE_FILE_MANIFEST.sha256'
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    if (-not $AllowUntrustedArchive) { Fail 'Source hash manifest missing; refusing an unverified revision.' }
    Say 'WARNING: source manifest missing, verification overridden.'
    return
  }
  $checked = 0
  foreach ($line in [IO.File]::ReadLines($manifest)) {
    if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { Fail 'Invalid source SHA-256 manifest line.' }
    $expected = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
    if ($relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($relative)) { Fail 'Unsafe path in source manifest.' }
    $candidate = Join-Path $source $relative
    EnsureUnder $candidate $source
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { Fail "Manifest file missing: $relative" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail "Source integrity failure: $relative" }
    $checked++
  }
  if ($checked -lt 200) { Fail 'Source manifest contained too few files.' }
  Say "Verified $checked source-file hashes."
}
function LaunchClusterServer([string]$root) {
  # The current Cluster 0.546 native launcher uses default PostgreSQL
  # 54321 and may attach to the global ClusterStudioServer service.
  # Do not launch a test build into an already-running production instance.
  $service = Get-CimInstance Win32_Service -Filter "Name='ClusterStudioServer'" -ErrorAction Stop
  if ($service -and $service.State -ne 'Stopped') {
    Fail 'ClusterStudioServer service is already running. Existing server was not interrupted; stop it before starting the new installation.'
  }
  $ports = @(3000, 4000, 54321)
  foreach ($port in $ports) {
    $occupied = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($occupied) {
      Fail "TCP port $port is occupied. Install files are prepared, but the existing server must be stopped before launch."
    }
  }
  $exe = Join-Path $root 'bin/ClusterServer.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail "Missing native launcher: $exe" }
  Say 'Launching Cluster Server Manager (automatic start). Windows may request administrator approval and first-time Owner setup.'
  Start-Process -FilePath $exe -ArgumentList @('--root',('"' + $root + '"'),'--interface','--startup','--browser') -WorkingDirectory $root
}
function AssertServerStopped([string]$root) {
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { return }
  # Never stop or interfere with a different production Cluster instance.
  $escaped = [regex]::Escape($root.TrimEnd('\'))
  $runningService = Get-CimInstance Win32_Service -Filter "Name='ClusterStudioServer'" -ErrorAction Stop
  if ($runningService -and $runningService.State -ne 'Stopped' -and $runningService.PathName -match $escaped) {
    Fail 'The managed ClusterStudioServer service is running. Stop it through the Windows Server Manager before updating.'
  }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    ($_.CommandLine -and $_.CommandLine -match $escaped) -or ($_.ExecutablePath -and $_.ExecutablePath -match $escaped)
  })
  if ($processes.Count -gt 0) {
    $ids = ($processes | ForEach-Object { $_.ProcessId }) -join ','
    Fail "Cluster Server has active processes (PIDs $ids). Stop it before installing revision files."
  }
}
function ApplyRevision([string]$source, [string]$hash) {
  EnsureUnder $target $WorkRoot
  if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath (Join-Path $target $ownerMarker) -PathType Leaf)) {
      Fail "Refusing to overwrite an unmanaged folder: $target. Existing production servers are never valid targets."
    }
    AssertServerStopped $target
  } else { New-Item -ItemType Directory -Path $target -Force | Out-Null }
  $previous = Join-Path $backupRoot ('previous-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff') + '-' + $hash.Substring(0,8))
  New-Item -ItemType Directory -Path $previous -Force | Out-Null
  $savedEnv = Join-Path $target 'apps/server/.env'
  $stateEnv = Join-Path $WorkRoot 'preserved-server-env.tmp'
  if (Test-Path -LiteralPath $savedEnv -PathType Leaf) { Copy-Item -LiteralPath $savedEnv -Destination $stateEnv -Force }
  $movedOld = New-Object 'System.Collections.Generic.List[string]'
  $movedNew = New-Object 'System.Collections.Generic.List[string]'
  $committed = $false
  try {
    foreach ($child in @(Get-ChildItem -LiteralPath $target -Force)) {
      if ($preserved -contains $child.Name) { continue }
      Move-Item -LiteralPath $child.FullName -Destination (Join-Path $previous $child.Name) -ErrorAction Stop
      $movedOld.Add($child.Name)
    }
    foreach ($child in @(Get-ChildItem -LiteralPath $source -Force)) {
      Move-Item -LiteralPath $child.FullName -Destination (Join-Path $target $child.Name) -ErrorAction Stop
      $movedNew.Add($child.Name)
    }
    if (Test-Path -LiteralPath $stateEnv -PathType Leaf) {
      Copy-Item -LiteralPath $stateEnv -Destination (Join-Path $target 'apps/server/.env') -Force
    }
    $record = @{ schema=2; archiveSha256=$hash; appliedUtc=[DateTime]::UtcNow.ToString('o'); installRoot=$WorkRoot; managedBy='cluster-installer' }
    ($record | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $target $ownerMarker) -Encoding UTF8
    $committed = $true
  } finally {
    if (-not $committed) {
      Say 'Revision installation failed. Restoring previous application files.'
      foreach ($name in $movedNew) {
        $newFile = Join-Path $target $name
        if (Test-Path -LiteralPath $newFile) { Move-Item -LiteralPath $newFile -Destination (Join-Path $source $name) -ErrorAction Stop }
      }
      foreach ($name in $movedOld) {
        $oldFile = Join-Path $previous $name
        if (Test-Path -LiteralPath $oldFile) { Move-Item -LiteralPath $oldFile -Destination (Join-Path $target $name) -ErrorAction Stop }
      }
    }
    if (Test-Path -LiteralPath $stateEnv -PathType Leaf) { Remove-Item -LiteralPath $stateEnv -Force }
  }
  Say "Updated managed Cluster installation. Previous application snapshot: $previous"
}

try {
  # This script is embedded by the EXE and extracted into WorkRoot by design.
  # Protect application/data instead: the build root, staging, and target are siblings,
  # and ApplyRevision only replaces verified, installer-owned target contents.
  EnsureUnder $target $WorkRoot
  EnsureUnder $incoming $WorkRoot
  EnsureUnder $buildRoot $WorkRoot
  EnsureUnder $backupRoot $WorkRoot
  foreach ($directory in @($WorkRoot,$incoming,$buildRoot,$backupRoot)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  # Build temp files belong with this portable installation. Avoid writing multi-GB npm/Go
  # extraction intermediates into C:\Users\...\AppData\Local\Temp.
  $tempPath = Join-Path $WorkRoot 'Temp'
  New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
  $env:TEMP = $tempPath
  $env:TMP = $tempPath
  $env:TMPDIR = $tempPath
  $log = Join-Path $WorkRoot 'installer.log'
  Say "Cluster installation: $target"
  if ($StartInstalled) {
    $currentMarker = Join-Path $target $ownerMarker
    if (-not (Test-Path -LiteralPath $currentMarker -PathType Leaf)) { Fail 'No Cluster installation has been completed yet.' }
    $installedMarker = Get-Content -LiteralPath $currentMarker -Raw | ConvertFrom-Json
    if ($installedMarker.managedBy -ne 'cluster-installer' -or $installedMarker.installRoot -ine $WorkRoot) { Fail 'Unmanaged installation marker. Refusing to launch from an untrusted folder.' }
    LaunchClusterServer $target
    exit 0
  }
  if (-not $Archive) {
    $latest = Get-ChildItem -LiteralPath $incoming -Filter '*Source*.zip' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $latest) { Fail "No source archive found. Put a Cluster full-source ZIP next to Cluster-Installer.exe." }
    $Archive = $latest.FullName
  }
  $Archive = [IO.Path]::GetFullPath($Archive)
  if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { Fail "Archive not found: $Archive" }
  if ([IO.Path]::GetExtension($Archive).ToLowerInvariant() -ne '.zip') { Fail 'Expected full source ZIP (not an incremental patch).' }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant()
  Say "Revision archive SHA-256: $hash"
  $current = Join-Path $target $ownerMarker
  if (-not $BuildOnly -and -not $CheckOnly -and (Test-Path -LiteralPath $current -PathType Leaf)) {
    $installed = Get-Content -LiteralPath $current -Raw | ConvertFrom-Json
    if ($installed.archiveSha256 -eq $hash -and $installed.managedBy -eq 'cluster-installer' -and $installed.installRoot -ieq $WorkRoot) {
      Say 'Installed revision is current; launching without rebuilding.'
      if (-not $SkipLaunch) { LaunchClusterServer $target }
      exit 0
    }
  }
  TestZip $Archive
  $stage = Join-Path $buildRoot ('revision-' + $hash.Substring(0,16))
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Say 'Extracting validated source into isolated build directory.'
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $stage)
  $source = Join-Path $stage 'source'
  TestManifest $source
  if ($CheckOnly) { Say 'Source archive verified; no installation or build was performed.'; exit 0 }
  ProvisionPortableTools
  $versions = Get-Content -LiteralPath (Join-Path $source 'config/toolchain-versions.json') -Raw | ConvertFrom-Json
  Say "Building Cluster v$($versions.cluster). Installed server remains untouched until builds succeed."
  $env:GOTOOLCHAIN = 'local'
  $env:CLUSTER_VERSION = [string]$versions.cluster
  Run 'npm.cmd' @('install','--include=dev','--no-audit','--no-fund','--no-progress') $source
  # Prisma 7 validates its configured datasource during generation. Use a
  # deliberately nonfunctional local build-time URL; never connect to live data.
  $oldDirect = $env:DIRECT_DATABASE_URL
  $oldDatabase = $env:DATABASE_URL
  try {
    $env:DIRECT_DATABASE_URL = 'postgresql://cluster_build:unused@127.0.0.1:1/cluster_build'
    $env:DATABASE_URL = $env:DIRECT_DATABASE_URL
    Run 'npm.cmd' @('run','db:generate') $source
  } finally {
    $env:DIRECT_DATABASE_URL = $oldDirect
    $env:DATABASE_URL = $oldDatabase
  }
  Run 'npm.cmd' @('run','build') $source
  Run 'node' @('tools/scripts/build-native-host.mjs') $source
  Run 'node' @('tools/scripts/build-server-launcher.mjs') $source
  # Auxiliary binaries are optional for web/server testing; not silently declared certified.
  foreach ($requiredFile in @('apps/server/dist/index.js','apps/web/dist/index.html','packages/shared/dist/index.js','bin/ClusterServer.exe','bin/cluster-host.exe','node_modules/@prisma/client/package.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $requiredFile) -PathType Leaf)) { Fail "Build missing required output: $requiredFile" }
  }
  # Native startup trusts this marker only as a build-readiness hint, never as a signature.
  # Without it, Cluster's launcher recompiles the already-built source on first start.
  $releaseMarker = @{
    schema = 1
    clusterVersion = [string]$versions.cluster
    prebuilt = @{ server = $true; web = $true; shared = $true }
    managedInstaller = $true
    archiveSha256 = $hash
  }
  # Windows PowerShell 5.1 Set-Content UTF8 adds a BOM; Go's JSON decoder rejects it.
  [IO.File]::WriteAllText((Join-Path $source 'CLUSTER_RELEASE.json'), ($releaseMarker | ConvertTo-Json -Depth 6), ([Text.UTF8Encoding]::new($false)))
  if ($BuildOnly) { Say "Build-only success: $source"; exit 0 }
  # This repository historically shipped hundreds of root-level development
  # checklists/reports alongside the server. They are NOT application runtime
  # resources. Remove only recognized root-level documentation/report types;
  # never remove Prisma migrations, tools, compiled app files or user data.
  $pruned = 0
  foreach ($candidate in @(Get-ChildItem -LiteralPath $source -File)) {
    if ($candidate.Name -eq 'README.md') { continue }
    if ($candidate.Extension -in @('.md','.txt','.patch') -or
        ($candidate.Extension -eq '.json' -and $candidate.Name -ne 'CLUSTER_RELEASE.json' -and $candidate.Name -ne 'package.json')) {
      Remove-Item -LiteralPath $candidate.FullName -Force
      $pruned++
    }
  }
  Remove-Item -LiteralPath (Join-Path $source 'SOURCE_FILE_MANIFEST.sha256') -Force
  Say "Removed $pruned development-only root documents/reports from the installed runtime."
  ApplyRevision $source $hash
  if (-not $SkipLaunch) { LaunchClusterServer $target }
  Say 'Cluster installed. To update, place a full source ZIP beside Cluster-Installer.exe and reopen it.'
  exit 0
} catch {
  Write-Host ('[Cluster Installer] FAILED: ' + $_.Exception.Message) -ForegroundColor Red
  if ($script:log) { Add-Content -LiteralPath $script:log -Value ('FAILED: ' + $_.Exception.ToString()) -Encoding UTF8 }
  exit 1
}
