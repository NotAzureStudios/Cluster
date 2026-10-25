import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const filename=path.join(root,'tools/windows/Test-ClusterWindows10Readiness.ps1');
const src=fs.readFileSync(filename,'utf8');
let n=0;const check=(ok,name)=>{assert.ok(ok,name);n++};
for(const [name,pattern] of [
 ['read only intent',/read-only Windows 10 host readiness/],['baseline build',/19045/],
 ['runtime detection',/Microsoft\\\.NETCore\\\.App|Microsoft\.NETCore\.App/],
 ['Windows service',/Win32_Service/],['port ownership',/OwningProcess/],
 ['loopback restriction',/Test-Loopback/],['no runtime discovery secret',/Do not print process command lines/],
 ['network read only',/Get-NetTCPConnection/],['private Garnet',/Inspect-Port 'garnet' \$GarnetPort \$true/],
 ['private PostgreSQL',/Inspect-Port 'postgresql' \$PostgresPort \$true/],
 ['private API',/Inspect-Port 'api' \$ApiPort \$true/],
 ['Garnet Lua',/--lua/], ['no PubSub disable',/Pub\/Sub/],
 ['Garnet optional',/Garnet remains optional/],['JSON evidence output',/ConvertTo-Json/],
 ['unverified status',/certified=\$false/],['ESU caveat',/ESU enrollment/],['service account',/StartName/]
 ]) check(pattern.test(src),name);
 for(const command of ['Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule','New-Service','Start-Service','Stop-Service','Set-Service','Restart-Service','Start-Process','Invoke-RestMethod','Invoke-WebRequest','DownloadFile','Expand-Archive','Set-ItemProperty','Set-Content','Remove-Item','Register-ScheduledTask']) {
   check(!new RegExp('\\b'+command+'\\b','i').test(src),`no side effect ${command}`);
 }
check(src.includes('noChangesPerformed=$true'),'explicit no changes');
check(src.includes('No PostgreSQL migrations'),'discloses runtime limitation');
console.log(`${n}/${n} F4 P10 Windows 10 readiness contract assertions passed; execution on actual Windows is still required`);
