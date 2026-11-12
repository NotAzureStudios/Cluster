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
  [switch]$AllowDevSourceBuild,
  [switch]$StartInstalled,
  [switch]$RepairInstalled
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
$releaseIdentity = $null

function Say([string]$message) {
  $line = '[Cluster Installer] ' + $message
  Write-Host $line
  if ($script:log) { Add-Content -LiteralPath $script:log -Value $line -Encoding UTF8 }
}
function Fail([string]$message) { throw $message }
function EnsureUnder([string]$path, [string]$parent) {
  $p = [IO.Path]::GetFullPath($path).TrimEnd('\','/')
  $r = [IO.Path]::GetFullPath($parent).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  if (-not $p.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { Fail "Unsafe path outside portable Cluster root: $path" }
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
function ProvisionPortableTools([switch]$RuntimeOnly) {
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
  if ($RuntimeOnly) {
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    Say 'Verified private Node runtime is ready. No npm install, Go download, or compilation is needed.'
    return
  }
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
  # Native stdout/stderr must BOTH reach the durable installer log. Previously
  # only the command name and exit code were saved, making build errors vanish.
  # PowerShell 5.1 converts redirected native stderr to ErrorRecords; Continue
  # avoids treating a warning as a terminating PowerShell exception. The real
  # subprocess exit code remains the source of truth.
  $previousPreference = $ErrorActionPreference
  $exitCode = $null
  try {
    $ErrorActionPreference = 'Continue'
    & $executable @arguments 2>&1 | ForEach-Object {
      $line = [string]$_
      Write-Host $line
      if ($script:log) {
        # Do not persist database URL passwords if a dependency prints one.
        $safeLine = $line -replace '(?i)(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s@]+@', '$1://[REDACTED]@'
        Add-Content -LiteralPath $script:log -Value $safeLine -Encoding UTF8 -ErrorAction Stop
      }
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
  }
  if ($null -eq $exitCode -or $exitCode -ne 0) {
    Fail "$executable failed (exit $exitCode); full stdout/stderr is in $script:log; existing Cluster installation was not replaced."
  }
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
  $listed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($line in [IO.File]::ReadLines($manifest)) {
    if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { Fail 'Invalid source SHA-256 manifest line.' }
    $expected = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
    if ($relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($relative)) { Fail 'Unsafe path in source manifest.' }
    $candidate = Join-Path $source $relative
    EnsureUnder $candidate $source
    if (-not $listed.Add([IO.Path]::GetFullPath($candidate))) { Fail "Duplicate manifest entry: $relative" }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { Fail "Manifest file missing: $relative" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail "Source integrity failure: $relative" }
    $checked++
  }
  if ($checked -lt 200) { Fail 'Source manifest contained too few files.' }
  # Manifest is a complete allowlist. An attacker must not append an unlisted
  # npm lifecycle script, path override or source file to an otherwise valid ZIP.
  foreach ($candidate in @(Get-ChildItem -LiteralPath $source -Recurse -File -Force)) {
    if ($candidate.FullName -ieq $manifest) { continue }
    if (-not $listed.Contains([IO.Path]::GetFullPath($candidate.FullName))) {
      Fail "Unlisted source file in archive: $($candidate.FullName)"
    }
  }
  Say "Verified $checked source-file hashes and complete manifest allowlist."
}
function TestPrebuiltRuntime([string]$source) {
  $metadataFile = Join-Path $source 'config/prebuilt-runtime.json'
  if (-not (Test-Path -LiteralPath $metadataFile -PathType Leaf)) { Fail 'Prebuilt runtime metadata missing; refusing an uncompiled release.' }
  $metadata = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
  if ($metadata.schema -ne 1 -or $metadata.product -ne 'cluster-server' -or
      $metadata.kind -ne 'prebuilt-windows-x64' -or
      $metadata.release -ne $releaseIdentity.release -or
      $metadata.sequence -ne $releaseIdentity.sequence -or
      $metadata.sourceVersion -ne $releaseIdentity.sourceVersion -or
      [string]$metadata.commit -notmatch '^[a-f0-9]{40}$') {
    Fail 'Prebuilt runtime identity does not match the packaged release.'
  }
  $required = @(
    'packages/shared/dist/index.js',
    'apps/server/dist/index.js',
    'apps/server/dist/generated/prisma/client.js',
    'apps/web/dist/index.html',
    'node_modules/@prisma/client/package.json',
    'bin/ClusterServer.exe',
    'bin/Cluster Server.exe',
    'bin/cluster-host.exe',
    'bin/cluster-update-helper.exe',
    'bin/cluster-workstation-service.exe',
    'tools/scripts/cluster-rc-preflight.mjs',
    'tools/scripts/cluster-rc-smoke.mjs',
    'tools/scripts/cluster-rc-runtime-admission.mjs'
  )
  if ($null -eq $metadata.requiredArtifacts) { Fail 'Prebuilt runtime has no artifact integrity record.' }
  foreach ($relative in $required) {
    $property = $metadata.requiredArtifacts.PSObject.Properties[$relative]
    if ($null -eq $property -or [string]$property.Value -notmatch '^[a-f0-9]{64}$') {
      Fail "Missing or invalid prebuilt artifact digest: $relative"
    }
    $candidate = Join-Path $source $relative
    EnsureUnder $candidate $source
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { Fail "Prebuilt artifact missing: $relative" }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne [string]$property.Value) { Fail "Prebuilt artifact integrity failure: $relative" }
    if ($relative.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
      $stream = [IO.File]::OpenRead($candidate)
      try {
        if ($stream.ReadByte() -ne 77 -or $stream.ReadByte() -ne 90) { Fail "Prebuilt Windows executable has invalid PE header: $relative" }
      } finally { $stream.Dispose() }
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $source 'package-lock.json') -PathType Leaf)) {
    Fail 'Prebuilt runtime requires the exact validated npm package-lock.json.'
  }
  $webAssets = Join-Path $source 'apps/web/dist/assets'
  if (-not (Test-Path -LiteralPath $webAssets -PathType Container) -or
      @(Get-ChildItem -LiteralPath $webAssets -Filter '*.js' -File).Count -lt 1) {
    Fail 'Prebuilt runtime missing compiled web assets.'
  }
  Say "Validated $($required.Count) prebuilt artifact digests for $($metadata.commit)."
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
# Only the independent, exactly named update owners may remain alive during
# signed installer application. This is NOT a generic exclusion for the Node,
# PostgreSQL, Host, API, or any managed Server executable.
function TestExternalClusterUpdateOwner([object]$process, [string]$serverRoot) {
  $exe = [string]$process.ExecutablePath
  $command = [string]$process.CommandLine
  if (-not $exe -or -not $command) { return $false }
  try {
    $exe = [IO.Path]::GetFullPath($exe)
    $serverRoot = [IO.Path]::GetFullPath($serverRoot).TrimEnd('\','/')
  } catch { return $false }
  if ($exe.StartsWith($serverRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $portableRoot = [IO.Path]::GetFullPath((Split-Path -Parent $serverRoot))
  $brokerDir = [IO.Path]::GetFullPath((Join-Path $portableRoot 'UpdateBroker'))
  $brokerExe = [IO.Path]::GetFullPath((Join-Path $brokerDir 'ClusterUpdateBroker.exe'))
  $isBroker = $exe.Equals($brokerExe, [StringComparison]::OrdinalIgnoreCase)
  $base = [IO.Path]::GetFileName($exe)
  $workerPattern = '^Cluster-Update-Worker-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.exe$'
  $directory = [IO.Path]::GetDirectoryName($exe)
  $isWorker = $base -match $workerPattern -and (
    $directory.Equals($brokerDir, [StringComparison]::OrdinalIgnoreCase) -or
    $directory.Equals($portableRoot, [StringComparison]::OrdinalIgnoreCase))
  if (-not $isBroker -and -not $isWorker) { return $false }
  # SCM may store an 8.3 DOS path (RUNNER~1) for argv[0] while CIM returns
  # the long ExecutablePath. Normalize both actual and claimed EXE identities;
  # never trust the prefix text alone or waive the strict update-only flags.
  $arg0 = $null
  $tail = $null
  if ($command -match '^"([^"]+\.exe)"\s+(.+)$') {
    $arg0 = $matches[1]
    $tail = $matches[2]
  } elseif ($command -match '^(\S+\.exe)\s+(.+)$') {
    $arg0 = $matches[1]
    $tail = $matches[2]
  } else { return $false }
  try { $canonicalArg0 = [IO.Path]::GetFullPath($arg0) } catch { return $false }
  if (-not $canonicalArg0.Equals($exe, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $rootArgument = '(?:"' + [regex]::Escape($serverRoot) + '"|' + [regex]::Escape($serverRoot) + ')'
  if ($isBroker) {
    return $tail -match ('^--update-broker-service\s+--root\s+' + $rootArgument + '\s*$')
  }
  return $tail -match ('^--native-update-apply\s+(?:--broker-authorized\s+)?--root\s+' + $rootArgument + '\s+--update-channel\s+(?:main|development)\s*$')
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
    if (TestExternalClusterUpdateOwner $_ $root) { return $false }
    ($_.CommandLine -and $_.CommandLine -match $escaped) -or ($_.ExecutablePath -and $_.ExecutablePath -match $escaped)
  })
  if ($processes.Count -gt 0) {
    $ids = ($processes | ForEach-Object { $_.ProcessId }) -join ','
    Fail "Cluster Server has active processes (PIDs $ids). Stop it before installing revision files."
  }
}
# Check the actual target volume and managed-install state before downloading
# multiple private toolchains or compiling anything. Never change live data.
function AssertInstallPreflight() {
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Cluster Server requires 64-bit Windows.' }
  $root = [IO.Path]::GetPathRoot($WorkRoot)
  if (-not $root) { Fail "Could not resolve the installation drive for $WorkRoot." }
  try {
    $drive = [IO.DriveInfo]::new($root)
    if (-not $drive.IsReady) { Fail "The installation drive $root is not ready." }
    # Source RC installs currently build Go, Node, Prisma and Web on the target.
    # This threshold is a preflight safety floor, not a quoted installed size.
    [long]$minimum = 4GB
    if ($drive.AvailableFreeSpace -lt $minimum) {
      Fail ("Not enough free space on $root for a Cluster source-build installation. " +
        ("Available: {0:N1} GiB; minimum: {1:N1} GiB. Free space or choose another portable folder." -f
          ($drive.AvailableFreeSpace / 1GB), ($minimum / 1GB)))
    }
    Say ("Preflight: {0:N1} GiB free on {1}; source-build minimum 4.0 GiB." -f ($drive.AvailableFreeSpace / 1GB), $root)
  } catch {
    if ($_.Exception.Message -match 'Not enough free space|not ready|Could not resolve') { throw }
    Fail "Cannot inspect installation drive ${root}: $($_.Exception.Message)"
  }
  $probe = Join-Path $WorkRoot ('.cluster-write-test-' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($probe, 'Cluster installation write test')
  } catch {
    Fail "Installation folder is not writable: $WorkRoot. $($_.Exception.Message)"
  } finally {
    if (Test-Path -LiteralPath $probe -PathType Leaf) { Remove-Item -LiteralPath $probe -Force }
  }
  if (-not $BuildOnly -and (Test-Path -LiteralPath $target -PathType Container)) {
    if (-not (Test-Path -LiteralPath (Join-Path $target $ownerMarker) -PathType Leaf)) {
      Fail "Installation target exists but is not managed by Cluster: $target. Existing files were not modified."
    }
    AssertServerStopped $target
  }
  Say 'Preflight passed: destination writable; free space and managed install safety checked.'
}
# npm workspaces on Windows use NTFS junctions with absolute staging paths.
# Relocating node_modules without reconstructing them leaves @cluster/shared,
# @cluster/server, etc. pointing at the deleted temporary build directory.
function RepairWorkspaceJunctions([string]$installedRoot) {
  $scope = Join-Path $installedRoot 'node_modules/@cluster'
  if (-not (Test-Path -LiteralPath $scope -PathType Container)) { New-Item -ItemType Directory -Path $scope -Force | Out-Null }
  if ((Get-Item -LiteralPath $scope -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'Workspace link root cannot be a reparse point.' }
  $workspaces = @('apps/server','apps/web','packages/shared','packages/api-client','packages/renderer','integrations/discord-bot')
  foreach ($relative in $workspaces) {
    $destination = Join-Path $installedRoot $relative
    $manifest = Join-Path $destination 'package.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { Fail "Missing workspace package: $relative" }
    $package = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $packageName = [string]$package.name
    if (-not $packageName.StartsWith('@cluster/', [StringComparison]::Ordinal) -or $packageName.Substring(9) -notmatch '^[a-z0-9-]+$') {
      Fail "Unexpected Cluster workspace package identity: $packageName"
    }
    $link = Join-Path $scope $packageName.Substring(9)
    $old = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($null -ne $old) {
      if (-not ($old.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Fail "Expected a workspace junction, refusing to replace a physical directory: $link"
      }
      # Directory.Delete with recursive=false removes the junction, not its target.
      # Never recursively delete an NTFS junction: some PowerShell versions
      # follow it and could delete the source workspace itself.
      [IO.Directory]::Delete($link, $false)
    }
    New-Item -ItemType Junction -Path $link -Target $destination -ErrorAction Stop | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $link 'package.json') -PathType Leaf)) {
      Fail "Installed workspace junction did not resolve: $packageName"
    }
  }
  Say 'Rebuilt 6 Windows npm workspace junctions against the installed server root.'
}
# Publish the already-built native entry point beside the installer, for example
# D:\Cluster-Server\Cluster Server.exe. The managed runtime/data remain under
# D:\Cluster-Server\Cluster\Server; this is a tiny entry point, not a second server.
function PublishRootServerLauncher([string]$installedRoot) {
  $portableRoot = Split-Path -Parent $WorkRoot
  # If Cluster-Installer.exe was run from C:\ (or any drive root), this
  # convenience launcher would be staged at C:\Cluster Server.exe.cluster-staging.
  # Standard users cannot write there, although the verified installation
  # under C:\Cluster\Server is already complete. Do not fail the release
  # because a nonessential drive-root shortcut cannot be created.
  $portableVolume = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($portableRoot))
  if ($portableRoot.TrimEnd('\','/') -ieq $portableVolume.TrimEnd('\','/')) {
    Say "Skipping optional Server launcher beside installer: $portableRoot is a Windows drive root. Use the managed Server Manager under $installedRoot\bin instead."
    return
  }
  $entry = Join-Path $installedRoot 'bin/Cluster Server.exe'
  $launcher = Join-Path $portableRoot 'Cluster Server.exe'
  $ownershipFile = Join-Path $WorkRoot 'root-launcher.manifest.json'
  if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { Fail "Built root launcher missing: $entry" }
  if (-not (Test-Path -LiteralPath (Join-Path $installedRoot $ownerMarker) -PathType Leaf)) { Fail 'Cannot publish root launcher before managed installation commit.' }
  $expected = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
  $existing = Test-Path -LiteralPath $launcher
  if ($existing) {
    $existingFile = Get-Item -LiteralPath $launcher -Force
    if ($existingFile.PSIsContainer -or ($existingFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Fail "Refusing to replace a directory or link at $launcher"
    }
    $actual = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      if (-not (Test-Path -LiteralPath $ownershipFile -PathType Leaf)) {
        Fail "Root executable already exists and is not managed by this installer: $launcher. Move it aside yourself if you want Cluster to use this filename."
      }
      $record = Get-Content -LiteralPath $ownershipFile -Raw | ConvertFrom-Json
      if ($record.managedBy -ne 'cluster-installer' -or
          $record.installRoot -ine $WorkRoot -or
          $record.launcherPath -ine $launcher -or
          $record.sha256 -ine $actual) {
        Fail "Root executable ownership verification failed; refusing to overwrite: $launcher"
      }
    }
  }
  $staged = "$launcher.cluster-staging"
  $backup = "$launcher.cluster-previous"
  if (Test-Path -LiteralPath $staged) { Fail "Root launcher staging file already exists: $staged" }
  if (Test-Path -LiteralPath $backup) { Fail "Root launcher backup already exists: $backup" }
  $oldMoved = $false
  $newMoved = $false
  try {
    if (-not $existing -or $actual -ne $expected) {
      Copy-Item -LiteralPath $entry -Destination $staged -ErrorAction Stop
      if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { Fail 'Root launcher copy failed integrity verification.' }
      if ($existing) {
        Move-Item -LiteralPath $launcher -Destination $backup -ErrorAction Stop
        $oldMoved = $true
      }
      Move-Item -LiteralPath $staged -Destination $launcher -ErrorAction Stop
      $newMoved = $true
    }
    $record = @{
      schema = 1
      managedBy = 'cluster-installer'
      installRoot = $WorkRoot
      launcherPath = $launcher
      sha256 = $expected
    }
    $manifestStaging = "$ownershipFile.writing"
    if (Test-Path -LiteralPath $manifestStaging) { Fail 'Root launcher manifest staging already exists.' }
    try {
      [IO.File]::WriteAllText($manifestStaging, ($record | ConvertTo-Json -Depth 3), ([Text.UTF8Encoding]::new($false)))
      Move-Item -LiteralPath $manifestStaging -Destination $ownershipFile -Force -ErrorAction Stop
    } finally {
      if (Test-Path -LiteralPath $manifestStaging) { Remove-Item -LiteralPath $manifestStaging -Force }
    }
    if ($oldMoved) { Remove-Item -LiteralPath $backup -Force }
    Say "Root server executable ready: $launcher"
  } catch {
    if ($newMoved -and (Test-Path -LiteralPath $launcher -PathType Leaf)) { Remove-Item -LiteralPath $launcher -Force }
    if ($oldMoved -and (Test-Path -LiteralPath $backup -PathType Leaf)) { Move-Item -LiteralPath $backup -Destination $launcher -ErrorAction Stop }
    throw
  } finally {
    if (Test-Path -LiteralPath $staged -PathType Leaf) { Remove-Item -LiteralPath $staged -Force }
  }
}

function ApplyRevision([string]$source, [string]$hash) {
  EnsureUnder $target $WorkRoot
  # Never allow a packaged release to overwrite preserved operational data.
  foreach ($protectedName in $preserved) {
    if (Test-Path -LiteralPath (Join-Path $source $protectedName)) {
      Fail "Revision payload contains protected $protectedName; refusing to overwrite retained data."
    }
  }
  if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath (Join-Path $target $ownerMarker) -PathType Leaf)) {
      Fail "Refusing to overwrite an unmanaged folder: $target. Existing production servers are never valid targets."
    }
    AssertServerStopped $target
  } else { New-Item -ItemType Directory -Path $target -Force | Out-Null }
  $previous = Join-Path $backupRoot ('previous-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff') + '-' + $hash.Substring(0,8))
  if (@(Get-ChildItem -LiteralPath $target -Force | Where-Object { $preserved -notcontains $_.Name }).Count -gt 0) { New-Item -ItemType Directory -Path $previous -Force | Out-Null }
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
    # Verify the DEPLOYED tree, not just the pre-move staging directory.
    # A failure here triggers the existing application rollback.
    RepairWorkspaceJunctions $target
    Run 'node' @('tools/scripts/cluster-rc-runtime-admission.mjs') $target
    $record = @{ schema=3; releaseCandidate=[string]$releaseIdentity.release; releaseSequence=[int]$releaseIdentity.sequence; archiveSha256=$hash; appliedUtc=[DateTime]::UtcNow.ToString('o'); installRoot=$WorkRoot; managedBy='cluster-installer' }
    # Windows PowerShell 5.1's -Encoding UTF8 writes a BOM, which Go's JSON decoder rejects.
    [IO.File]::WriteAllText((Join-Path $target $ownerMarker), ($record | ConvertTo-Json -Depth 5), ([Text.UTF8Encoding]::new($false)))
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
  if (Test-Path -LiteralPath $previous -PathType Container) {
    Say "Updated managed Cluster installation. Previous application snapshot: $previous"
  } else { Say 'Installed independent fresh Cluster release candidate.' }
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
    PublishRootServerLauncher $target
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
  Say 'Installer logging: native stdout/stderr retained (credentials redacted)'
  $current = Join-Path $target $ownerMarker
  if ($RepairInstalled) {
    if ($AllowDevSourceBuild -or $BuildOnly -or $CheckOnly -or $StartInstalled -or -not $SkipLaunch) {
      Fail 'Same-release repair requires a trusted prebuilt payload and no automatic server launch.'
    }
    if (-not (Test-Path -LiteralPath $current -PathType Leaf)) {
      Fail 'Same-release repair requires an existing managed Cluster installation.'
    }
    $existing = Get-Content -LiteralPath $current -Raw | ConvertFrom-Json
    if ($existing.managedBy -ne 'cluster-installer' -or $existing.installRoot -ine $WorkRoot -or $existing.archiveSha256 -ine $hash) {
      Fail 'Repair package does not match this exact managed installation. Use an explicit verified update instead.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'apps/server/.env') -PathType Leaf)) {
      Fail 'Existing Server secrets are missing. Recover the environment file from a verified backup before repair.'
    }
    Say 'Exact-match in-place repair authorized. PostgreSQL data, Library, runtime, secrets and settings are preserved.'
  }
  if (-not $BuildOnly -and -not $CheckOnly -and (Test-Path -LiteralPath $current -PathType Leaf)) {
    $installed = Get-Content -LiteralPath $current -Raw | ConvertFrom-Json
    if (-not $RepairInstalled -and $installed.archiveSha256 -eq $hash -and $installed.managedBy -eq 'cluster-installer' -and $installed.installRoot -ieq $WorkRoot) {
      Say 'Installed revision is current; launching without rebuilding.'
      PublishRootServerLauncher $target
      if (-not $SkipLaunch) { LaunchClusterServer $target }
      exit 0
    }
  }
  TestZip $Archive
  $stage = Join-Path $buildRoot ('revision-' + $hash.Substring(0,16))
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Say '[1/6] Verifying the source archive in isolated staging.'
  Say 'Extracting validated source into isolated build directory.'
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $stage)
  $source = Join-Path $stage 'source'
  TestManifest $source
  $releaseFile = Join-Path $source 'config/release-candidate.json'
  if (-not (Test-Path -LiteralPath $releaseFile -PathType Leaf)) { Fail 'Installer source lacks release-candidate identity.' }
  $releaseIdentity = Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
  $sourceToolchain = Get-Content -LiteralPath (Join-Path $source 'config/toolchain-versions.json') -Raw | ConvertFrom-Json
  if ($releaseIdentity.schema -ne 1 -or $releaseIdentity.channel -notin @('rc','stable') -or $releaseIdentity.sequence -lt 1 -or $releaseIdentity.sourceVersion -ne $sourceToolchain.cluster -or
      ($releaseIdentity.channel -eq 'stable' -and $releaseIdentity.release -ne $releaseIdentity.sourceVersion)) {
    Fail 'Invalid Cluster release identity; refusing to install.'
  }
  Say "Building clean-room candidate $($releaseIdentity.release) (source $($releaseIdentity.sourceVersion))."
  if ($CheckOnly) { Say 'Source archive verified; no installation or build was performed.'; exit 0 }
  Say '[2/6] Checking installation environment before downloading toolchains.'
  AssertInstallPreflight
  $versions = $sourceToolchain
  $isPrebuilt = Test-Path -LiteralPath (Join-Path $source 'config/prebuilt-runtime.json') -PathType Leaf
  if ($isPrebuilt) {
    Say '[3/6] Verifying prebuilt Windows runtime and private Node runtime.'
    TestPrebuiltRuntime $source
    ProvisionPortableTools -RuntimeOnly
    $env:CLUSTER_VERSION = [string]$releaseIdentity.sourceVersion
    Say '[4/6] Runtime already compiled on the release build machine. No npm install, Prisma generation, or native compilation.'
  } elseif ($AllowDevSourceBuild) {
    Say 'DEVELOPER MODE: compiling unverified full source on this machine. This is not a normal installation.'
  if (-not (Test-Path -LiteralPath (Join-Path $source 'package-lock.json') -PathType Leaf)) {
    Say 'WARNING: this source candidate lacks package-lock.json; installation is development-only, not reproducible stable 1.0.'
  }
  Say '[3/6] Preparing private Node and Go build tools.'
  ProvisionPortableTools
  $versions = Get-Content -LiteralPath (Join-Path $source 'config/toolchain-versions.json') -Raw | ConvertFrom-Json
  Say "Building Cluster v$($versions.cluster). Installed server remains untouched until builds succeed."
  $env:GOTOOLCHAIN = 'local'
  $env:CLUSTER_VERSION = [string]$versions.cluster
  Say '[4/6] Building native Server, API and Web in staging; installed files remain untouched.'
  # RC gate: native binaries are part of the product. Compile/test them BEFORE
  # the slower npm/Vite work so Go source mistakes cannot survive into packaging.
  # Uses the private pinned Go toolchain provisioned above, not system Go.
  Run 'node' @('tools/scripts/cluster-rc-native-checks.mjs') $source
  Run 'node' @('tools/scripts/build-native-host.mjs') $source
  Run 'node' @('tools/scripts/build-server-launcher.mjs') $source
  Run 'node' @('tools/scripts/build-cluster-server-entry.mjs') $source
  Run 'node' @('tools/scripts/build-update-helper.mjs') $source
  Run 'node' @('tools/scripts/build-workstation-service.mjs') $source
  $lockfile = Join-Path $source 'package-lock.json'
  if (Test-Path -LiteralPath $lockfile -PathType Leaf) {
    Say 'Locked dependency install: npm ci'
    Run 'npm.cmd' @('ci','--include=dev','--no-audit','--no-fund','--no-progress') $source
  } else {
    Say 'RC WARNING: package-lock.json is missing. Dependency graph cannot be certified reproducible; stable release is BLOCKED.'
    Run 'npm.cmd' @('install','--include=dev','--no-audit','--no-fund','--no-progress') $source
  }
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
  } else {
    Fail 'Standard Cluster Installer requires a prebuilt runtime. Source compilation is developer-only.'
  }
  # Auxiliary binaries are optional for web/server testing; not silently declared certified.
  foreach ($requiredFile in @('apps/server/dist/index.js','apps/web/dist/index.html','packages/shared/dist/index.js','bin/ClusterServer.exe','bin/Cluster Server.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe','node_modules/@prisma/client/package.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $requiredFile) -PathType Leaf)) { Fail "Build missing required output: $requiredFile" }
  }
  Say '[5/6] Validating compiled artifacts and release integrity.'
  # Validate the actual compiled artifacts before making installation changes.
  # The prebuilt ZIP deliberately excludes absolute npm workspace junctions.
  # Reconstruct staging links for smoke tests; ApplyRevision repairs them again
  # against the final installed root after the directory move.
  if ($isPrebuilt) { RepairWorkspaceJunctions $source }
  Run 'node' @('tools/scripts/cluster-rc-preflight.mjs','--built') $source
  if ($isPrebuilt) {
    # The source-only smoke matrix includes tools/installer and fixtures which
    # are deliberately NOT distributed with prebuilt Windows runtime payloads.
    # Verify the actual compiled API, web assets and reconstructed workspace
    # links here; the same admission is run again after moving to the final
    # installed directory, with automatic application-file rollback on failure.
    Say 'Prebuilt release: validating staged runtime dependencies (source-only tests stay on the build runner).'
    Run 'node' @('tools/scripts/cluster-rc-runtime-admission.mjs') $source
  } else {
    Run 'node' @('tools/scripts/cluster-rc-smoke.mjs') $source
  }
  # Native startup trusts this marker only as a build-readiness hint, never as a signature.
  # Without it, Cluster's launcher recompiles the already-built source on first start.
  $releaseMarker = @{
    schema = 1
    clusterVersion = [string]$versions.cluster
    prebuilt = @{ server = $true; web = $true; shared = $true }
    managedInstaller = $true
    releaseChannel = [string]$releaseIdentity.channel
    releaseCandidate = [string]$releaseIdentity.release
    releaseSequence = [int]$releaseIdentity.sequence
    certification = 'install-test-pending'
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
  # Keep the full source in the distributable ZIP, not in the installed runtime.
  # These paths are preview fixtures, repository-only tests or installer
  # bootstrap code, not application dependencies.
  foreach ($unused in @('docs','tools/fixtures','tools/installer')) {
    $folder = Join-Path $source $unused
    if (Test-Path -LiteralPath $folder -PathType Container) { Remove-Item -LiteralPath $folder -Recurse -Force; $pruned++ }
  }
  $testPatterns = @('*-tests.mjs','*-test.mjs','*-assertions.mjs','*-source-scan.mjs')
  $scriptsDir = Join-Path $source 'tools/scripts'
  foreach ($pattern in $testPatterns) {
    foreach ($testScript in @(Get-ChildItem -LiteralPath $scriptsDir -Filter $pattern -File -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $testScript.FullName -Force
      $pruned++
    }
  }
  foreach ($releaseTool in @('cluster-rc-preflight.mjs','cluster-rc-smoke.mjs','cluster-rc-readiness.mjs')) {
    $toolFile = Join-Path $scriptsDir $releaseTool
    if (Test-Path -LiteralPath $toolFile -PathType Leaf) { Remove-Item -LiteralPath $toolFile -Force; $pruned++ }
  }
  Remove-Item -LiteralPath (Join-Path $source 'SOURCE_FILE_MANIFEST.sha256') -Force
  Say "Pruned $pruned development-only files/directories from the installed runtime."
  Say '[6/6] Applying validated files to the managed installation.'
  ApplyRevision $source $hash
  # Build staging has been consumed by the atomic apply. Eliminate redundant
  # copies to avoid accumulating gigabytes over RC iterations.
  if (Test-Path -LiteralPath $stage -PathType Container) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
  # A copy of the tiny entry point is placed in the portable root only after
  # successful verified deployment. Never overwrite an unrelated root EXE.
  PublishRootServerLauncher $target
  if (-not $SkipLaunch) { LaunchClusterServer $target }
  Say 'Cluster managed release installed. The installed Server Manager remains available under Server\bin.'
  exit 0
} catch {
  Write-Host ('[Cluster Installer] FAILED: ' + $_.Exception.Message) -ForegroundColor Red
  if ($script:log) { Add-Content -LiteralPath $script:log -Value ('FAILED: ' + $_.Exception.ToString()) -Encoding UTF8 }
  exit 1
}
