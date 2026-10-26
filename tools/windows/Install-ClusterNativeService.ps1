# Cluster 1.0 Windows Service provisioning. Explicit admin-only opt-in.
# Run after deploying a compiled, prebuilt Windows Cluster release and completing setup.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$Executable = Join-Path $Root 'ClusterServer.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run in an elevated PowerShell console; UAC is required.'
}
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw "Missing compiled server launcher: $Executable"
}
if ($Remove) {
  if ($PSCmdlet.ShouldProcess('ClusterStudioServer', 'Remove stopped Windows Service')) {
    & $Executable --root $Root --service-remove
    if ($LASTEXITCODE -ne 0) {throw "Service removal failed: exit $LASTEXITCODE"}
    Write-Host 'Service removed. Provisioned filesystem ACLs were not removed automatically.'
  }
  return
}
$prebuilt = @('CLUSTER_RELEASE.json','apps/server/dist/index.js','apps/web/dist/index.html',
  'packages/shared/dist/index.js','runtime/postgresql/bin/postgres.exe',
  'node_modules/prisma/package.json','node_modules/@prisma/client/package.json')
foreach ($relative in $prebuilt) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
    throw "Service installation requires a fully built and provisioned server. Missing: $relative"
  }
}
$release = Get-Content -LiteralPath (Join-Path $Root 'CLUSTER_RELEASE.json') -Raw | ConvertFrom-Json
if (-not ($release.prebuilt.server -and $release.prebuilt.web -and $release.prebuilt.shared)) {
  throw 'CLUSTER_RELEASE.json does not identify an installed prebuilt application.'
}
$runtime = Join-Path $Root 'runtime'
$data = Join-Path $Root 'data'
if ($PSCmdlet.ShouldProcess($Root, 'Provision LocalService ACLs and install Cluster Studio Server')) {
  # SID rather than localized account name. Read/execute on app binaries,
  # modify on local data and runtime only. No LocalSystem service identity.
  & icacls.exe $Root '/grant' '*S-1-5-19:(OI)(CI)RX' '/T' '/C' | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Could not grant LocalService read/execute access to the installation'}
  foreach ($directory in @($data, $runtime)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    & icacls.exe $directory '/grant' '*S-1-5-19:(OI)(CI)M' '/T' '/C' | Out-Null
    if ($LASTEXITCODE -ne 0) {throw "Could not grant LocalService modify access to $directory"}
  }
  $readyFolder = Join-Path $data 'system/config'
  New-Item -ItemType Directory -Force -Path $readyFolder | Out-Null
  # Marker records the explicit provisioning operation; it is NOT a runtime
  # access check and must not be used instead of actual Windows acceptance.
  Set-Content -LiteralPath (Join-Path $readyFolder 'windows-service-ready.marker') -Value 'localservice-workspace-v1' -Encoding ascii
  & $Executable --root $Root --service-install
  if ($LASTEXITCODE -ne 0) {throw "Service creation failed: exit $LASTEXITCODE"}
  Write-Host 'Installed ClusterStudioServer as LocalService (automatic startup).'
  Write-Host 'Start it with: sc.exe start ClusterStudioServer'
  Write-Host 'Test restarts, database, networking, and actual service-account permissions before enabling production traffic.'
}
# Bounded SCM recovery for unexpected nonzero service termination.
# Applied only when installation succeeded. A human Stop is not a failure.
if (-not $Remove -and -not $WhatIfPreference) {
  & sc.exe failure ClusterStudioServer reset= 86400 actions= restart/60000/restart/120000/none/0 | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Could not configure service restart recovery'}
  & sc.exe failureflag ClusterStudioServer 1 | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Could not enable non-crash service failure handling'}
}
