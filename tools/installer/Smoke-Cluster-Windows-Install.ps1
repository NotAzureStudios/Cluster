# Execute the real embedded Windows installer against an isolated, empty
# writable folder. Prevents successful package hashes from being mistaken for
# successful installation. The installed Server is NOT started by this smoke.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [string] $InstallerPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if ($env:OS -ne "Windows_NT") { throw "This test requires Windows." }

$original = (Resolve-Path -LiteralPath $InstallerPath).Path
$expected = (Get-Content -LiteralPath "config/release-candidate.json" -Raw | ConvertFrom-Json).release
if ([string]::IsNullOrWhiteSpace([string]$expected)) { throw "Source release metadata is missing." }
$folder = Join-Path ([IO.Path]::GetTempPath()) ("cluster-real-install-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$targetInstaller = Join-Path $folder "Cluster-Installer.exe"
Copy-Item -LiteralPath $original -Destination $targetInstaller -Force
$previousCI = $env:CLUSTER_INSTALLER_CI_INSTALL_ONLY
$previousNoninteractive = $env:CLUSTER_NONINTERACTIVE
try {
  $env:CLUSTER_INSTALLER_CI_INSTALL_ONLY = "1"
  $env:CLUSTER_NONINTERACTIVE = "1"
  Write-Host "Running actual embedded Cluster $expected installer from isolated $folder"
  & $targetInstaller
  if ($LASTEXITCODE -ne 0) { throw "Real Windows installer exited $LASTEXITCODE; check $folder\Cluster\installer.log" }

  $managed = Join-Path $folder "Cluster\Server"
  $marker = Join-Path $managed ".cluster-installer-managed.json"
  $launcher = Join-Path $folder "Cluster Server.exe"
  $manifest = Join-Path $folder "Cluster\root-launcher.manifest.json"
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw "Installer returned success without a managed revision marker" }
  $state = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($state.managedBy -ne "cluster-installer" -or $state.releaseCandidate -ne $expected -or
      $state.installRoot -ine (Join-Path $folder "Cluster")) { throw "Installed ownership/version marker does not match the source" }
  foreach ($required in @(
    "bin\ClusterServer.exe", "bin\Cluster Server.exe",
    "apps\server\dist\index.js", "apps\web\dist\index.html",
    "node_modules\@prisma\client\package.json", "tools\scripts\database-command.mjs"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $managed $required) -PathType Leaf)) {
      throw "Real installer omitted $required"
    }
  }
  # Managed startup requires every external direct dependency to be pinned
  # exactly and installed at that version (2.0.0 shipped renderer font
  # ranges and failed this at startup). The lockfile is pruned from the
  # install, so compare each manifest with what is installed — the same six
  # manifests and sections the launcher's dependency check reads.
  foreach ($workspace in @('.', 'apps\server', 'apps\web', 'packages\shared', 'packages\api-client', 'packages\renderer')) {
    $manifestFile = Join-Path $managed (Join-Path $workspace 'package.json')
    if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw "Installed manifest missing: $workspace" }
    $manifestJson = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    $declaredDependencies = $manifestJson.PSObject.Properties | Where-Object { $_.Name -in @('dependencies', 'devDependencies', 'optionalDependencies') } | ForEach-Object { $_.Value.PSObject.Properties }
    foreach ($dependency in $declaredDependencies) {
      $name = [string]$dependency.Name
      $declared = [string]$dependency.Value
      if ($name.StartsWith('@cluster/') -or $declared -eq '*' -or $declared.StartsWith('workspace:') -or $declared.StartsWith('file:')) { continue }
      if ($declared -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$') { throw "Unpinned dependency in ${workspace}: $name $declared" }
      $relativeName = $name.Replace('/', '\')
      $candidates = @((Join-Path $managed ('node_modules\' + $relativeName + '\package.json')))
      if ($workspace -ne '.') { $candidates = @((Join-Path $managed (Join-Path $workspace ('node_modules\' + $relativeName + '\package.json')))) + $candidates }
      $installedManifest = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
      if (-not $installedManifest) { throw "Installed dependency missing for ${workspace}: $name" }
      $installedVersion = [string](Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json).version
      if ($installedVersion -ne $declared) { throw "Installed $name $installedVersion differs from pinned $declared ($workspace)" }
    }
  }
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or
      -not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Normal writable install did not publish owned root launcher"
  }
  $expectedHash = (Get-FileHash -LiteralPath (Join-Path $managed "bin\Cluster Server.exe") -Algorithm SHA256).Hash
  $copiedHash = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
  if ($expectedHash -ne $copiedHash) { throw "Root launcher differs from installed binary" }
  $rootManifest = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  if ($rootManifest.managedBy -ne "cluster-installer" -or
      $rootManifest.sha256 -ine $copiedHash) { throw "Convenience launcher is not owned or hash-bound" }
  if (Test-Path -LiteralPath (Join-Path $folder "Cluster\Build") -PathType Leaf) {
    throw "Unexpected installer temporary file"
  }
  Write-Host "PASS: Real compiled Windows EXE installed $expected, verified native binaries and launcher ownership."
} finally {
  $env:CLUSTER_INSTALLER_CI_INSTALL_ONLY = $previousCI
  $env:CLUSTER_NONINTERACTIVE = $previousNoninteractive
  # Only delete our randomly named disposable CI folder. Never touch an
  # existing studio installation, database directory, or drive-root path.
  if (Test-Path -LiteralPath $folder) {
    Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
  }
}
