# F2 P1 → F2 P2 and 1.0 closeout handoff

**Continue from:** `Cluster-v0.546.0-F2-P1-Windows-Service-Tray-Integrated-Source.zip` after verifying integrity report. Do not rebuild from G27, F3 P1/P2/P3 or the original F3 P4 source.

## Next connected source slice: F2 P2

1. Native SCM resource safety: protect process trees using Windows Job Objects, ensure no orphan Node/PostgreSQL workers, verify distinct DB stop ordering and dependency preflight. Keep service boot-mode CLI independent of control panel.
2. Make native GUI service-aware with accurate readiness status, native log streaming and resource attribution to Host/Node/PostgreSQL. Do not infer healthy app from `SERVICE_RUNNING`.
3. Service-account wizard: verified effective file and named share access, validated absolute root, ownership, ACL attestation, configurable least-privileged identity and exact service binary command checks. Convert temporary provisioning script into real signed installer with explicit startup/rollback policies and no LocalSystem fallback.
4. UI UX: service installation/status controls and settings save confirmation, persistent window placement, tray menu enable states/tooltip, Windows crash/restart and OS shutdown handling. Keep read-only UI separate from administrative actions where feasible.
5. Native emergency event reconciliation into canonical OperationsIncident/Inbox after SQL returns. This may be a separately grouped F4 slice if safer.
6. Network/ports, maintenance schedule and Garnet real compatibility checks, followed by final TD7 cleanup and release gating.

## Certification gates unchanged

- Windows 11 / Windows Server real SCM boot without logon, UAC and non-admin observer tests.
- Production pinned Go 1.27.1 rebuild, signed executable/installer verification.
- PostgreSQL 18 fresh install, applying F3 P2 and P3 migrations, verified backup/restore.
- Windows host/Node child process-tree cleanup, API health, read-only and offline restoration, remote TLS/gateway/firewall, browser clients/Qt, SMB/NAS shares and LocalService permissions.
- Tested alert delivery and 24-hour maintenance/automated restart soak.
- Zero P0/P1 release blockers before 1.0.0 Stable. This source pass does not certify deployment.
