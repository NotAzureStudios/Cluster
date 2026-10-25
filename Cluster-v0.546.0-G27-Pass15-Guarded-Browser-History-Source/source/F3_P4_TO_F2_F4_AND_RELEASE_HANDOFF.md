# F3 P4 → F2/F4 + release handoff

## Authoritative parent

Continue only from `Cluster-v0.546.0-F3-P4-Native-Emergency-Readiness-Source.zip`, not F3 P3, P2 or the uploaded original G27. Keep the same v0.546.0 pre-release product version until the final version gate.

## Next connected implementation slices

1. **F4 native → canonical incident reconciliation.** Import locally journalled emergency event IDs via a restricted, authenticated, idempotent server-owned path after SQL recovery; preserve the original UTC evidence; enforce current system-admin permissions and map recovered signals to the existing Operations Incident and Inbox flow, never a parallel incident table. Treat `.sent` and `.pending` as evidence, not authorization. Mark imported only after a durable transaction. Preserve the ability to recover and view events on the Win32 panel if the API never returns.
2. **F2 independent Windows Service supervision.** Split boot-time service from the optional logon-time GUI, with SCM lifecycle, permissions, proper process-tree ownership and Job Objects, graceful drain, tray icon, window persistence, always-on-top and close-but-keep-running semantics. Don't claim current on-logon Scheduled Task meets service-at-boot requirements.
3. **F3 network and maintenance controls.** Explicit port/listener inventory, binding and firewall preflight, TLS and gateway readiness, safe restart windows and staged reversible config changes. Existing native control panel may run locally even when API routes are broken.
4. **F4 assigned/on-call alerts.** Extend F3 P3 authorized recipients beyond admins using explicit scoped incident permissions, shifts, teams, Timezone/DST-safe handoffs, quiet hours, escalation and delivery evidence. No grant solely from notification membership.
5. **F3 Garnet.** Independently verify actual Redis protocol commands, TLS/binding, fallback, native process lifetime and cache invalidation; PostgreSQL stays durable.
6. **Final F0 feature ledger reconciliation + F5 TD7 cleanup, then F6/F7 live Windows, PostgreSQL, storage and restore certification.** New migrations from F3 P2 and P3 must be applied to a disposable real PostgreSQL 18 first.

## Release blockers that this pass does not close

- No live Windows/SCM/E2E native launch test.
- Native emergency webhook is currently environment configured, not exposed as a PIN-authorized protected secret editor in the UI. Never persist it in cleartext.
- The operating system must protect native event directory ACLs; testing remains open.
- Current Close button still stops the server after confirmation, rather than allowing tray-only UI closure with an independent service.
- Current startup-on-Windows is a sign-in Scheduled Task, not service-at-boot.
- Full JavaScript/Prisma build and migrations, Qt, Garnet, remote gateway and storage provider fault tests not yet run.
