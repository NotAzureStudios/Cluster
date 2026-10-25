# F4 P6 → Cluster 1.0 Handoff

**Authoritative parent:** F4 P6 Held Background Mutation Fence, derived byte-for-byte from the previous F4 P3 full-source archive plus the exact-parent patch. Current release status: SOURCE-INTEGRATED, NOT LIVE-CERTIFIED.

## New capability
- Operator-triggered maintenance intent preflight (preview only; no restart execution).
- Native supervisor health is deliberately distinct from held workspace readiness.
- Write-capable recurring callbacks obey read-only/maintenance/recovery/drain modes.

## Next work in priority order
1. Implement an exclusive *native-supervisor-owned* maintenance command and policy gate: explicit operator authorization; drain notices; accepted request cutoff; in-flight upload/job checkpoints; bounded quiescence wait; only then restart or mode change. Do not use a web-only state flag.
2. Native/DB maintenance window persistence and restart recovery, scheduling, blackout windows, acknowledgement/escalation and maintenance-induced alert suppression while preserving genuine critical incidents.
3. Garnet executable readiness/RESP command-compatibility checks and safe memory fallback; no secrets in logs and no arbitrary remote probes.
4. Windows 10 22H2 / ESU deployment with pinned Go 1.27.1, Node 24, PostgreSQL 18, unapplied F3 P2 / F3 P3 / F2 P4 Prisma migrations. Prove service restart, SCM drain, job tree cleanup, LocalService/SMB permissions, native alerts and server recovery.
5. Full 1.0 feature ledger (CD-01–20), TD7 source cleanup, dependency-backed TypeScript build and Windows release soak.

## Safety invariants
- Preflight `ok` is NEVER authority to execute. The native supervisor must recheck under exclusive service ownership and not assume all uploads are known from HTTP counters.
- `/health/ready` remains the client admission signal and returns unavailable for planned held modes. `/health/supervisor` indicates dependent-process readiness only.
- No client or daemon may execute destructive repairs from a quiet admin settings save; protected actions must be deliberate and auditable.
- Do not mark Windows 10 production-certified or apply unapplied Prisma migrations based on fixture/source checks.
