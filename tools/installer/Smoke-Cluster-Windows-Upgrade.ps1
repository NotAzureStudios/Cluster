# Disposable OFFLINE in-place upgrade test for the Cluster Windows installer.
# Exercises the real published 1.0.2 installer and prebuilt 1.0.4 candidate.
# Does not run a database or certify the native update executor.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PriorInstaller,
  [Parameter(Mandatory=$true)][string]$CandidateInstaller
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PriorInstaller = [IO.Path]::GetFullPath($PriorInstaller)
$CandidateInstaller = [IO.Path]::GetFullPath($CandidateInstaller)
foreach ($installer in @($PriorInstaller,$CandidateInstaller)) {
  if (!(Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Missing installer: $installer" }
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('Cluster-upgrade-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -ErrorAction Stop | Out-Null
$managed = Join-Path $scratch 'Cluster\Server'
$exe = Join-Path $scratch 'Cluster-Installer.exe'
$previousCI = $env:CLUSTER_INSTALLER_CI_INSTALL_ONLY
$env:CLUSTER_INSTALLER_CI_INSTALL_ONLY = '1'
function Invoke-BundledInstaller([string]$source) {
  Copy-Item -LiteralPath $source -Destination $exe -Force -ErrorAction Stop
  & $exe
  if ($LASTEXITCODE -ne 0) { throw "Installer returned $LASTEXITCODE; installation log: $(Join-Path $scratch 'Cluster\installer.log')" }
}
function Confirm-Release([int]$expected) {
  $marker = Join-Path $managed '.cluster-installer-managed.json'
  if (!(Test-Path -LiteralPath $marker -PathType Leaf)) { throw "Missing managed release marker" }
  $record = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($record.managedBy -ne 'cluster-installer' -or [int]$record.releaseSequence -ne $expected) {
    throw "Wrong installed release after update: expected sequence $expected"
  }
}
try {
  Write-Host 'Installing published 1.0.2 to a clean disposable folder...'
  Invoke-BundledInstaller $PriorInstaller
  Confirm-Release 52

  $dataRoot = Join-Path $managed 'data'
  $pgDir = Join-Path $dataRoot 'postgresql'
  $libDir = Join-Path $dataRoot 'library\projects\smoke'
  New-Item -ItemType Directory -Path $pgDir,$libDir -Force | Out-Null
  # Inactive fixtures check preserved bytes; NOT a substitute for a cold
  # PostgreSQL backup/restore of a real running server.
  [IO.File]::WriteAllText((Join-Path $pgDir 'CI-SENTINEL'), 'db-fixture-must-survive', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $libDir 'keep.txt'), 'library-fixture-must-survive', [Text.UTF8Encoding]::new($false))
  $envPath = Join-Path $managed 'apps\server\.env'
  [IO.File]::WriteAllText($envPath, 'CLUSTER_CI_PRESERVE=unchanged', [Text.UTF8Encoding]::new($false))
  $pgHash = (Get-FileHash -LiteralPath (Join-Path $pgDir 'CI-SENTINEL') -Algorithm SHA256).Hash
  $libHash = (Get-FileHash -LiteralPath (Join-Path $libDir 'keep.txt') -Algorithm SHA256).Hash
  $envHash = (Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash

  Write-Host 'Upgrading the SAME managed installation to 1.0.4 with auto-start disabled...'
  Invoke-BundledInstaller $CandidateInstaller
  Confirm-Release 54

  foreach ($pair in @(
      @{File=(Join-Path $pgDir 'CI-SENTINEL');Hash=$pgHash},
      @{File=(Join-Path $libDir 'keep.txt');Hash=$libHash},
      @{File=$envPath;Hash=$envHash}
  )) {
    if (!(Test-Path -LiteralPath $pair.File -PathType Leaf)) { throw "Preserved file disappeared: $($pair.File)" }
    if ((Get-FileHash -LiteralPath $pair.File -Algorithm SHA256).Hash -ne $pair.Hash) {
      throw "Preserved bytes changed: $($pair.File)"
    }
  }
  $rollback = Join-Path $scratch 'Cluster\Rollback'
  if (!(Test-Path -LiteralPath $rollback -PathType Container)) { throw 'Missing previous-application rollback root' }
  $oldRevisions = @(Get-ChildItem -LiteralPath $rollback -Directory -Filter 'previous-*')
  if ($oldRevisions.Count -lt 1) { throw 'Installer did not retain previous application revision' }
  if (Test-Path -LiteralPath (Join-Path $managed 'Cluster\Server')) {
    throw 'Unexpected nested Server installation'
  }
  Write-Host 'PASS: real 1.0.2->1.0.4 offline upgrade preserved PostgreSQL/Library/config fixtures and previous application snapshot.'
  Write-Host "Disposable smoke root: $scratch"
} finally {
  if ($null -eq $previousCI) { Remove-Item Env:CLUSTER_INSTALLER_CI_INSTALL_ONLY -ErrorAction SilentlyContinue }
  else { $env:CLUSTER_INSTALLER_CI_INSTALL_ONLY = $previousCI }
}
