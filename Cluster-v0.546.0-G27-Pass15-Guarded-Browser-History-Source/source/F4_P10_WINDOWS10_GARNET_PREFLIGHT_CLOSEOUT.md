# F4 P10: Windows 10 22H2 read-only server & Garnet readiness probe

Parent: F4 P9. Run **locally on the Windows 10 server** with Windows PowerShell 5.1 or newer:

```powershell
powershell.exe -NoProfile -File .\tools\windows\Test-ClusterWindows10Readiness.ps1 -Json
```

Optionally supply `-WebPort`, `-ApiPort`, `-PostgresPort`, `-GarnetPort`, `-ServiceName`, and `-GarnetExe` (an already installed executable path). No network credentials or arbitrary remote hosts accepted.

- Inventories Windows 10 22H2 build 19045, service state and identity, .NET 10 runtime availability, presence of an optional Garnet executable, current local TCP listeners, listening PIDs and loopback exposure.
- Flags private API/PostgreSQL/Garnet listeners exposed beyond loopback, collisions among configured port numbers, and a privileged LocalSystem account.
- Does not launch programs, install binaries, change ports, change firewall rules, copy keys, change Windows Services, or contact external services.
- Prints a structured report that explicitly says **not production-certified**. Windows 10 ESU eligibility and actual enrollment require independent checks. Failure to see a listener may simply mean the service is stopped.

The validation suite is a static cross-platform contract (37/37), **not a PowerShell execution**. It must run on real Windows 10 to establish actual compatibility. No new Prisma migration.
