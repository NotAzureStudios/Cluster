# Cluster 1.0 / F4 P10: read-only Windows 10 host readiness inventory.
# Does not start, stop, install, configure, or connect to any service.
# Requires Windows PowerShell 5.1+, administrator rights recommended for
# process visibility. Never outputs passwords or environment variables.
[CmdletBinding()]
param(
    [ValidateRange(1,65535)][int]$WebPort = 3000,
    [ValidateRange(1,65535)][int]$ApiPort = 4000,
    [ValidateRange(1,65535)][int]$PostgresPort = 5432,
    [ValidateRange(1,65535)][int]$GarnetPort = 6379,
    [string]$ServiceName = 'ClusterServer',
    [string]$GarnetExe = '',
    [switch]$Json
)
$ErrorActionPreference = 'Stop'
$checks = New-Object System.Collections.ArrayList
function Add-Check([string]$id,[string]$status,[string]$detail) {
    [void]$checks.Add([pscustomobject]@{ id=$id; status=$status; detail=$detail })
}
function Test-Loopback([string]$ip) {
    return @('127.0.0.1','::1','[::1]') -contains $ip
}
# One consistent listener snapshot avoids errors on ports with no listener,
# and avoids interpreting four independent moments as one system state.
$script:listenerSnapshot = $null
try { $script:listenerSnapshot = @(Get-NetTCPConnection -State Listen -ErrorAction Stop) }
catch { $script:listenerSnapshot = $null }
function Inspect-Port([string]$name,[int]$number,[bool]$privateOnly) {
    if ($null -eq $script:listenerSnapshot) {
        Add-Check "port-$name" 'unknown' 'TCP listener inspection unavailable; run locally with permission.'
        return
    }
    $listeners = @($script:listenerSnapshot | Where-Object { [int]$_.LocalPort -eq $number })
    if ($listeners.Count -eq 0) {
        Add-Check "port-$name" 'notice' "$name port $number currently has no listener."
        return
    }
    $addresses = @($listeners | ForEach-Object { [string]$_.LocalAddress } | Sort-Object -Unique)
    $owners = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    # Do not print process command lines; these can contain secrets.
    $exposure = $false
    foreach ($address in $addresses) { if (-not (Test-Loopback $address)) { $exposure = $true } }
    $detail = "$name port $number addresses: $($addresses -join ', '); owner PID(s): $($owners -join ', ')."
    if ($privateOnly -and $exposure) {
        Add-Check "port-$name" 'blocker' "$detail Private dependency must bind to loopback; firewall rules alone do not fix public binding."
    } elseif ($exposure) {
        Add-Check "port-$name" 'review' "$detail Review firewall, gateway and TLS exposure."
    } else {
        Add-Check "port-$name" 'pass' $detail
    }
}
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or newer is required.' }
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $caption = [string]$os.Caption
    $build = [string]$os.BuildNumber
    if ($caption -match 'Windows 10' -and $build -eq '19045') {
        Add-Check 'windows' 'pass' 'Windows 10 22H2 build 19045 detected. ESU enrollment/security support still requires manual verification.'
    } elseif ($caption -match 'Windows 10') {
        Add-Check 'windows' 'blocker' "Windows 10 build $build detected; target baseline is Windows 10 22H2 build 19045."
    } else {
        Add-Check 'windows' 'review' "Detected $caption build $build; this check targets Windows 10 22H2."
    }
} catch { Add-Check 'windows' 'unknown' 'Operating-system build could not be inspected.' }
try {
    $s = Get-CimInstance Win32_Service -Filter "Name='$($ServiceName.Replace("'", "''"))'" -ErrorAction Stop
    if ($null -eq $s) { Add-Check 'cluster-service' 'notice' 'Cluster Windows Service is not installed or service name differs.' }
    else {
        $user = [string]$s.StartName
        if ($user -match 'LocalSystem|SYSTEM') {
            Add-Check 'cluster-service' 'blocker' "Service exists ($($s.State), $($s.StartMode)) but uses the privileged SYSTEM account."
        } else {
            Add-Check 'cluster-service' 'review' "Service exists ($($s.State), $($s.StartMode)); logon identity must be reviewed for local/NAS permissions."
        }
    }
} catch { Add-Check 'cluster-service' 'unknown' 'Windows Service configuration not accessible.' }
try {
    $runtimes = @(& dotnet --list-runtimes 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'dotnet unavailable' }
    if (@($runtimes | Where-Object { $_ -match '^Microsoft\.NETCore\.App\s+10\.' }).Count -gt 0) {
        Add-Check 'dotnet10' 'pass' '.NET 10 runtime detected for current Garnet target; binary execution still untested.'
    } else {
        Add-Check 'dotnet10' 'notice' 'Microsoft.NETCore.App 10.x not detected; a self-contained Garnet build may not need a separate runtime.'
    }
} catch { Add-Check 'dotnet10' 'notice' 'dotnet command unavailable; determine whether Garnet is self-contained before installation.' }
if ($GarnetExe) {
    try {
        if (-not (Test-Path -LiteralPath $GarnetExe -PathType Leaf)) {
            Add-Check 'garnet-exe' 'blocker' 'Specified Garnet executable does not exist.'
        } elseif ([IO.Path]::GetExtension($GarnetExe) -ne '.exe') {
            Add-Check 'garnet-exe' 'review' 'Specified Garnet executable does not have an .exe extension.'
        } else {
            Add-Check 'garnet-exe' 'review' 'Garnet executable exists. It has NOT been launched, authenticated, or checked for publisher signature.'
        }
    } catch { Add-Check 'garnet-exe' 'unknown' 'Specified Garnet executable path could not be inspected.' }
} else { Add-Check 'garnet-exe' 'notice' 'No Garnet executable path supplied; Garnet remains optional.' }
Inspect-Port 'web' $WebPort $false
Inspect-Port 'api' $ApiPort $true
Inspect-Port 'postgresql' $PostgresPort $true
Inspect-Port 'garnet' $GarnetPort $true
$configuredPorts = @($WebPort,$ApiPort,$PostgresPort,$GarnetPort)
if (@($configuredPorts | Select-Object -Unique).Count -lt 4) {
    Add-Check 'port-collision' 'blocker' 'One or more configured listeners use the same TCP port.'
} else { Add-Check 'port-collision' 'pass' 'Configured TCP port numbers are distinct.' }
Add-Check 'garnet-features' 'review' 'For Garnet, enable --lua and do not disable Pub/Sub; verify required commands through Operations UI. Bind locally and configure authentication.'
Add-Check 'deployment-certification' 'unknown' 'Read-only inspection only. No PostgreSQL migrations, Windows SCM tests, actual Garnet commands, TLS validation, restore drill, or OS ESU check was performed.'
$result = [pscustomobject]@{
    schemaVersion=1
    generatedAt=(Get-Date).ToUniversalTime().ToString('o')
    target='Windows 10 22H2 Cluster 1.0 preflight'
    noChangesPerformed=$true
    certified=$false
    checks=@($checks.ToArray())
    blockers=@($checks | Where-Object { $_.status -eq 'blocker' }).Count
}
if ($Json) { $result | ConvertTo-Json -Depth 7 }
else {
    $result.checks | Format-Table -AutoSize -Wrap
    Write-Host "Blockers: $($result.blockers). Not deployment certified."
}
