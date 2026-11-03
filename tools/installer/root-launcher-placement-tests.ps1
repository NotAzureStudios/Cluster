# Regress the actual PublishRootServerLauncher PowerShell function in isolation.
# It must not touch C:\ (or another Windows volume root) merely because the
# installer was placed directly at the root of a drive.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Install-Cluster.ps1'
$tokens=$null
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Installer PowerShell parsing failed' }
$fn=@($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'PublishRootServerLauncher'
},$true))
if ($fn.Count -ne 1) { throw 'Expected exactly one root launcher function' }
Invoke-Expression $fn[0].Extent.Text
$script:seen=@()
function Say([string]$message){$script:seen+= $message}
function Fail([string]$message){throw $message}
$temp=Join-Path ([IO.Path]::GetTempPath()) ("cluster-root-launcher-test-"+[guid]::NewGuid().ToString('N'))
try {
  $drive=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($temp))
  $WorkRoot=Join-Path $drive 'Cluster-VolumeRoot-Regression-DoNotCreate'
  $ownerMarker='.cluster-installer-managed.json'
  PublishRootServerLauncher (Join-Path $WorkRoot 'Server')
  if (-not ($script:seen -join ' ' -match 'Skipping optional Server launcher')) {
    throw 'Volume-root installer was not short-circuited'
  }
  # This test MUST NOT create/rename anything at the real volume root.
  New-Item -ItemType Directory -Force $temp | Out-Null
  $WorkRoot=Join-Path $temp 'Cluster'
  $installed=Join-Path $WorkRoot 'Server'
  $bin=Join-Path $installed 'bin'
  New-Item -ItemType Directory -Force $bin | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $bin 'Cluster Server.exe'),[byte[]](77,90,0,0,11,22))
  [IO.File]::WriteAllText((Join-Path $installed $ownerMarker),'{"managedBy":"cluster-installer"}')
  PublishRootServerLauncher $installed
  $launcher=Join-Path $temp 'Cluster Server.exe'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Normal writable install did not publish root launcher' }
  if (-not (Test-Path -LiteralPath (Join-Path $WorkRoot 'root-launcher.manifest.json') -PathType Leaf)) {throw 'Root launcher ownership receipt missing'}
  $originalHash=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
  PublishRootServerLauncher $installed
  if ((Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash -ne $originalHash) {throw 'Idempotent install altered a healthy launcher'}
  [IO.File]::WriteAllText($launcher,'unmanaged-tamper')
  $blocked=$false
  try { PublishRootServerLauncher $installed } catch {
    if ($_.Exception.Message -match 'ownership verification failed') {$blocked=$true}
    else {throw}
  }
  if (-not $blocked) {throw 'Modified root executable was overwritten'}
  if ((Get-Content -Raw $launcher) -ne 'unmanaged-tamper') {throw 'Tampered launcher was modified'}
  Write-Host '4/4 actual PowerShell root launcher placement, idempotence and ownership checks passed.'
} finally {
  if (Test-Path -LiteralPath $temp) {Remove-Item -LiteralPath $temp -Recurse -Force}
}
