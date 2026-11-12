# Validate only the exact external updater processes are ignored by the
# Windows installer safety guard. All Node, Host, PostgreSQL and ordinary
# processes with the same Server root in their arguments must remain blockers.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Install-Cluster.ps1') -Raw
$begin = $source.IndexOf('function TestExternalClusterUpdateOwner(')
$end = $source.IndexOf('function AssertServerStopped(', $begin)
if ($begin -lt 0 -or $end -lt $begin) { throw 'Native update-owner process guard function is missing.' }
Invoke-Expression $source.Substring($begin, $end - $begin)

$root = Join-Path $env:TEMP 'Cluster Test Root\Cluster\Server'
$workRoot = Split-Path -Parent $root
$brokerExe = Join-Path $workRoot 'UpdateBroker\ClusterUpdateBroker.exe'
$workerUUID = 'ae198100-1bd0-49f5-8ad3-f46261c51c5e'
$protectedWorker = Join-Path $workRoot ('UpdateBroker\Cluster-Update-Worker-' + $workerUUID + '.exe')
$portableWorker = Join-Path $workRoot ('Cluster-Update-Worker-' + $workerUUID + '.exe')
$managedServer = Join-Path $root 'bin\ClusterServer.exe'
$foreignWorker = Join-Path $env:TEMP ('Cluster-Update-Worker-' + $workerUUID + '.exe')
$hostExe = Join-Path $workRoot 'Toolchains\node\node.exe'
$testCases = @(
  @{ name = 'running protected broker'; exe = $brokerExe; cmd = ('"' + $brokerExe + '" --update-broker-service --root "' + $root + '"'); expected = $true },
  @{ name = 'running protected worker'; exe = $protectedWorker; cmd = ('"' + $protectedWorker + '" --native-update-apply --broker-authorized --root "' + $root + '" --update-channel main'); expected = $true },
  @{ name = 'native interactive UAC worker'; exe = $portableWorker; cmd = ('"' + $portableWorker + '" --native-update-apply --root "' + $root + '" --update-channel main'); expected = $true },
  @{ name = 'managed Server process'; exe = $managedServer; cmd = ('"' + $managedServer + '" --service --root "' + $root + '"'); expected = $false },
  @{ name = 'managed Node process'; exe = $hostExe; cmd = ('"' + $hostExe + '" "' + $root + '\apps\server\dist\index.js"'); expected = $false },
  @{ name = 'foreign worker location'; exe = $foreignWorker; cmd = ('"' + $foreignWorker + '" --native-update-apply --root "' + $root + '" --update-channel main'); expected = $false },
  @{ name = 'broker with untrusted extra action'; exe = $brokerExe; cmd = ('"' + $brokerExe + '" --update-broker-service --root "' + $root + '" --native-update-apply'); expected = $false },
  @{ name = 'worker with extra command'; exe = $protectedWorker; cmd = ('"' + $protectedWorker + '" --native-update-apply --broker-authorized --root "' + $root + '" --update-channel main --repair'); expected = $false },
  @{ name = 'broker for different root'; exe = $brokerExe; cmd = ('"' + $brokerExe + '" --update-broker-service --root "' + $root + '-other"'); expected = $false },
  @{ name = 'worker without update authorization'; exe = $protectedWorker; cmd = ('"' + $protectedWorker + '" --root "' + $root + '" --update-channel main'); expected = $false }
)
foreach ($case in $testCases) {
  $actual = [bool](TestExternalClusterUpdateOwner ([pscustomobject]@{
    ExecutablePath = $case.exe
    CommandLine = $case.cmd
  }) $root)
  if ($actual -ne $case.expected) {
    $resolvedExe = [IO.Path]::GetFullPath($case.exe)
    $expectedBroker = Join-Path $workRoot 'UpdateBroker\ClusterUpdateBroker.exe'
    $brokerMatch = $resolvedExe.Equals($expectedBroker, [StringComparison]::OrdinalIgnoreCase)
    $escapedExe = '(?:"' + [regex]::Escape($resolvedExe) + '"|' + [regex]::Escape($resolvedExe) + ')'
    $escapedRoot = '(?:"' + [regex]::Escape($root) + '"|' + [regex]::Escape($root) + ')'
    $expectedRegex = '^' + $escapedExe + '\s+--update-broker-service\s+--root\s+' + $escapedRoot + '\s*$'
    Write-Output ('DEBUG broker path match: ' + $brokerMatch + '; regex match: ' + ($case.cmd -match $expectedRegex))
    Write-Output ('DEBUG actual: ' + $case.cmd)
    Write-Output ('DEBUG regex: ' + $expectedRegex)
    throw ('Installer update-owner guard regression for ' + $case.name + ': got ' + $actual + ', expected ' + $case.expected)
  }
}
Write-Output ('PASS: ' + $testCases.Count + ' exact Windows installer process-owner admission checks.')
