# Build a complete Cluster 1.0.1 Server distribution on an isolated Windows x64
# workstation when GitHub-hosted Actions are unavailable. Builds only; never installs.
# Requires: Git checkout of main, Node 24.20.0, Go 1.27.1, internet for npm ci.
[CmdletBinding()]
param(
  [string] $OutputDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Require-Command([string] $Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. Install the pinned toolchain before building."
  }
}

function Invoke-Checked([string] $Program, [string[]] $Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program exited $LASTEXITCODE ($($Arguments -join ' ')). No installer should be distributed from this attempt."
  }
}

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) {
  throw "Cluster Server release packages must be built on Windows x64."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $root
try {
  Require-Command git
  Require-Command node
  Require-Command go

  if (-not (Test-Path -LiteralPath ".git" -PathType Container)) {
    throw "Build from a complete Git clone; do not build from a downloaded source ZIP."
  }
  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
    throw "The 1.0.1 Server installer must be built from the reviewed main branch, not $branch."
  }
  $commit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch "^[a-f0-9]{40}$") {
    throw "Cannot identify the source commit."
  }
  $trackedChanges = @(& git status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0 -or @($trackedChanges | Where-Object { $_ -ne "" }).Count -ne 0) {
    throw "Tracked source is modified. Commit/revert changes before producing a source-bound release."
  }

  $nodeVersion = (& node --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne "v24.20.0") {
    throw "Expected Node.js v24.20.0, found $nodeVersion."
  }
  $goVersion = (& go version).Trim()
  if ($LASTEXITCODE -ne 0 -or $goVersion -notmatch "\bgo1\.27\.1 windows/amd64\b") {
    throw "Expected Go 1.27.1 on Windows x64, found $goVersion."
  }

  $identity = Get-Content -LiteralPath "config/release-candidate.json" -Raw | ConvertFrom-Json
  if ($identity.release -ne "1.0.1" -or $identity.channel -ne "stable" -or $identity.sourceVersion -ne "1.0.1") {
    throw "The checked-out source does not declare Cluster Server 1.0.1 stable."
  }

  Write-Host "Checking 1.0.1 release identity, lockfile and both installer admission paths..."
  Invoke-Checked node @("tools/scripts/cluster-1-0-1-version-contract.mjs")
  Invoke-Checked node @("tools/scripts/cluster-release-lockfile-check.mjs")
  Invoke-Checked node @("tools/scripts/cluster-prebuilt-install-gate-tests.mjs")
  Invoke-Checked node @("tools/scripts/cluster-platform-release-tests.mjs")

  Write-Host "Compiling complete Windows Server/Prisma/Web and native installer from $commit..."
  $env:CLUSTER_INSTALLER_PAYLOAD = "prebuilt"
  $env:GOTOOLCHAIN = "local"
  Invoke-Checked node @("tools/scripts/cluster-platform-release.mjs","--profile","server-windows-x64","--channel","main","--build")

  # The packaging process must never mutate tracked source. Untracked outputs
  # are expected under bin/ and artifacts/ and are not source modifications.
  & git diff --quiet
  if ($LASTEXITCODE -ne 0) {
    & git diff --name-status
    throw "Compiler changed tracked source. Rejecting this distribution."
  }

  $receiptPath = "artifacts/release-profiles/server-windows-x64/build-receipt.json"
  if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
    throw "No release receipt was produced."
  }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.product -ne "cluster-server" -or $receipt.profile -ne "server-windows-x64" -or
      $receipt.channel -ne "main" -or $receipt.release -ne "1.0.1" -or
      $receipt.sourceVersion -ne "1.0.1" -or $receipt.commit -ne $commit -or
      -not $receipt.built -or $receipt.signed -or $receipt.certified) {
    throw "The build receipt has incorrect product, identity or verification state."
  }
  $lockHash = (Get-FileHash "package-lock.json" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($receipt.lockfileSha256 -ne $lockHash) {
    throw "Lockfile hash does not match the build receipt."
  }

  $names = @("bin/Cluster-Installer.exe", "bin/Cluster Server.exe")
  foreach ($name in $names) {
    $entries = @($receipt.artifacts | Where-Object { $_.path -eq $name })
    if ($entries.Count -ne 1 -or -not (Test-Path -LiteralPath $name -PathType Leaf)) {
      throw "Required Windows executable missing from output or receipt: $name"
    }
    $digest = (Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $entries[0].sha256) {
      throw "SHA-256 mismatch for $name"
    }
    $stream = [IO.File]::OpenRead((Resolve-Path -LiteralPath $name).Path)
    try {
      if ($stream.Length -lt 512 -or $stream.ReadByte() -ne 77 -or $stream.ReadByte() -ne 90) {
        throw "Invalid PE executable: $name"
      }
    } finally { $stream.Dispose() }
  }

  if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root "artifacts/cluster-1.0.1-windows-x64" }
  $destination = [IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $installerDestination = Join-Path $destination "Cluster-Installer-1.0.1-UNSIGNED.exe"
  $managerDestination = Join-Path $destination "Cluster Server.exe"
  Copy-Item -LiteralPath "bin/Cluster-Installer.exe" -Destination $installerDestination -Force
  Copy-Item -LiteralPath "bin/Cluster Server.exe" -Destination $managerDestination -Force
  Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $destination "build-receipt.json") -Force

  $sums = @(
    "$((Get-FileHash -LiteralPath $installerDestination -Algorithm SHA256).Hash.ToLowerInvariant())  Cluster-Installer-1.0.1-UNSIGNED.exe"
    "$((Get-FileHash -LiteralPath $managerDestination -Algorithm SHA256).Hash.ToLowerInvariant())  Cluster Server.exe"
  )
  [IO.File]::WriteAllLines((Join-Path $destination "SHA256SUMS.txt"), $sums)
  Write-Host ""
  Write-Host "COMPLETE: unsigned Cluster Server 1.0.1 build, source $commit"
  Write-Host "Output: $destination"
  Write-Host "The binary is not signed, Windows-installed, or certified by this script."
  Write-Host "Test it in a new empty directory before using it with studio data."
}
finally {
  Pop-Location
}
