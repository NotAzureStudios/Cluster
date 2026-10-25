# F3 P3 → F4 P4 / F2 Windows handoff

Start from `Cluster-v0.546.0-F3-P3-Incident-Routing-Acknowledgement-Source.zip`, not F3 P2 or the original G27 ZIP.

## First next connected implementation
1. Build **native Windows emergency alert evidence and delivery queue** independent of app API and PostgreSQL, bounded and crash-safe; test DB down/restart, offline transport, credentials redaction, no indefinite retry storm. Native supervisor owns Windows service actions.
2. Add **authorized response delegates and on-call rotations** (identity separate from authorization); exact assignment, schedules, shifts, time-zone and DST tests, actual recipient delivery preferences/quiet hours with critical override controls.
3. Extend **safe allowlisted per-tool readiness probes** beyond shared dependency posture and route failed probes into these canonical incidents, with tool ownership and bounded schedules; no SSRF or mutating health checks.
4. Add **network/port, firewall, TLS and gateway preflight** with actual listen-interface and operating-system process ownership evidence, staged config rollback, startup/shutdown workflow confirmation.
5. Garnet Redis-compatibility runtime checks, recovery bounded by retries/cooldowns, and maintenance windows; no automatic PostgreSQL data repair.

## Mandatory certification before 1.0
- Migrate disposable PostgreSQL 18 using both F3 P2 and P3 migrations and generate Prisma on pinned Node 24; exercise race of two app processes, two admins saving the same policies, one ack racing one reminder, incidents reopening multiple times.
- Authenticated admin/nonadmin/browser/Qt tests; notification read/ack independence; user account expiry/offboarding; team and department membership changes; client notification invalidation.
- Native server shutdown/restart/process cleanup, outage/restore of PostgreSQL and storage, emergency alert queue after reboot, installer and dependency integrity, backups and restore drills.
- Finish CD-01 through CD-20 unfinished feature ledger + TD7 cleanup before final stable deployment certification.
