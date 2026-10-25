# Cluster v0.546.0 | F2 P1 Windows Service & Control Panel Closeout

**Exact parent:** `Cluster-v0.546.0-F3-P4-Native-Emergency-Readiness-Source.zip` (SHA-256 `3b7a5635e3b23fbfee7b54b6591c8625d904063a1fa1bf09d37ed7f0efce5934`).

**Status:** Source implementation and Windows x64 Go cross-compile; **NOT tested on a real Windows Service Control Manager**. No packaged binary or live server deployment was produced. Do not mark F2 fully certified.

## Source additions

- `apps/server-launcher-go/windows_service.go`: native Win32 `StartServiceCtrlDispatcherW`, `RegisterServiceCtrlHandlerExW`, `SetServiceStatus`, create/start/stop/query/delete service and service-owned Host lifecycle. Fixed name `ClusterStudioServer`. Automatic system-boot startup uses a dedicated SCM process under **LocalService**, not LocalSystem. Failed service execution returns a nonzero reported result for SCM recovery policy. A bounded shutdown uses a separate service control file and a 150-second Host drain, followed by forced process-tree cleanup only on timeout. The SCM receives periodic stop-pending updates during long drains. The native emergency journal still handles service/host failures independently of PostgreSQL.
- `apps/server-launcher-go/service_actions_windows.go` and `service_actions_linux.go`: `--service`, `--service-install`, `--service-remove` entrypoints, with Windows administrator elevation required for install/remove. The ordinary GUI mode remains available independently for setup/repair.
- `apps/server-launcher-go/launcher_ui_windows.go`: installed-service discovery through SCM status, start/stop/restart via SCM, no duplicate host on sign-in, and **control-panel Exit does not stop the service**. Unmanaged standalone mode retains its explicit Stop-and-exit confirmation. Stop/Restart also require confirmation when typed into the native command box. The GUI shows SCM process state, not a claim that the application API is healthy.
- `apps/server-launcher-go/server_config_windows.go`: persisted Always On Top, Minimize to Tray, Close to Tray, Start Minimized preferences. Native notification-area icon and popup controls, double-click restoration and re-registration after Explorer restarts. `Start with Windows` still opens the GUI via logon Scheduled Task; when the independent service is installed, the GUI attaches rather than spawning another managed Host.
- `tools/windows/Install-ClusterNativeService.ps1`: explicit elevated provisioning for the `S-1-5-19` LocalService SID. Adds read/execute ACL to release tree, Modify only to `runtime` and `data`, then installs native service and applies bounded SCM failure restart policy. It rejects missing binary/build inputs, accepts PowerShell `-WhatIf`, and does not implicitly enable startup on existing installations.

## Intended Windows deployment (NOT executed by this pass)

1. Publish a **prebuilt** Windows release under a dedicated protected local path. First complete interactive Cluster setup, private Node/PostgreSQL provision, build dependencies, database readiness and tested backup. Keep program/source files nonwritable to untrusted accounts.
2. Start an administrator PowerShell terminal, inspect the ACL plan: `./tools/windows/Install-ClusterNativeService.ps1 -Root 'D:\Cluster-Server' -WhatIf`.
3. Run the provisioning script without `-WhatIf`. It grants LocalService access as stated above and creates service `ClusterStudioServer` with automatic boot startup. Execute `sc.exe start ClusterStudioServer` after verifying service-account requirements.
4. Open the native UI normally. Configure Start With Windows to display the UI at sign-in if desired. Test Stop/Restart from the UI, minimize/close-to-tray, and Exit Control Panel while the service remains active. Check `data/system/logs/windows-service.log` and the Windows Event Viewer Service Control Manager log on failed starts.
5. Before production, rehearse both abrupt host crash and planned restart, reboot without interactive sign-in, offline database startup failure, restart exhaustion and filesystem credential failure. Confirm actual readiness through `/health/ready` and API Operations. The SCM process state alone does not prove the service is ready.

## Explicit safety boundaries

- The service is opt-in and **refuses to install without an already prepared release and provisioning marker**. The marker only documents operator provisioning; it does not prove effective ACL access on a live machine. Direct CLI `--service-install` is not a substitute for the audited provisioning script.
- `LocalService` may not have access to SMB/NAS shares, remote PostgreSQL credentials, network certificates, or custom storage roots. A service-identity policy and real operator account tests remain a release blocker. It must not silently switch to LocalSystem.
- No signed MSI install/update lifecycle or Windows binary was rebuilt from pinned Go 1.27.1. All Windows code was cross-compiled using a temporary Go 1.23 compatibility version of the module files; the checked-in modules remain 1.27.1.
- The control panel uses service PID/status, but lacks a full standalone status/health IPC channel, service-console log tail and detailed Windows Service UI. Resource metrics currently sample the SCM process PID, not aggregate managed Host/Node/PostgreSQL children.
- Proper Windows Job Objects and tested service teardown of all descendants still remain. Timeout fallback uses `taskkill /T /F`; a job-less hard crash can leave descendant processes.
- No real SCM, actual Explorer system-tray interaction, Windows shutdown/preshutdown timing, Windows Event Log or operator credential/storage tests were executed. All are F6 certification requirements. Production enablement remains **NO GO**.
- F3 P2/P3 pending Prisma migrations and all live Node24/PostgreSQL18/Qt/Garnet tests remain open.

## Verification actually performed

- Added 46 focused source integration assertions, including actual SCM calls, isolated executable lifetime, opt-in installation, least-privileged ACL intent, tray restoration and explicit Stop/Restart controls.
- Linux native launcher unit tests passed; shared native alert module tests passed with Go race detector.
- Native launcher Windows amd64 binary and test executable cross-compiled successfully from source with the available Go 1.23 toolchain using temporary, restored-only test module versions.
- Windows Go vet reports two inherited `unsafe.Pointer(uintptr)` warnings from the prior Win32 draw-item and clipboard logic. They are **not new F2 P1 code** and are not claimed resolved.
- Inherited F3 P4/P3/P2 source assertions passed. Real installed Windows Service testing remains unperformed.
