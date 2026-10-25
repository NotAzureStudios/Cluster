# Next Cluster closeout after F4 P1

Authoritative source ZIP: `Cluster-v0.546.0-F4-P1-Configurable-Operations-Cadence-Source.zip`. Parent was F2 P6. Preserve every previous F2/F3/G27 source pass and the verified manifest.

## Next coherent development slice (F4 P2)
1. Maintenance-mode state contract: Healthy/Normal, Read-only, Maintenance, Draining, Recovery/Restore, Updating, and Degraded are not interchangeable. Server must enforce restrictions on writes, jobs, API and UI consistently. Reuse authoritative existing lifecycle states and permission engine.
2. One admin-authorized, PIN/revision-guarded schedule policy with bounded window and blackout handling, timezone awareness, deduplicated execution IDs, preflight and post-action verification; no automatic irreversible repairs or DB restore.
3. Synchronize selected health-check cadence immediately after committed settings save by safely rearming existing nonoverlapping scheduler jobs. Do not create a second timer registry.
4. Define rollback-safe operational actions and approval levels. Add maintenance status to Operations/Server Config, tagged to actual canonical events and alerts.
5. Preserve native Supervisor independent operation while Node/PostgreSQL are unavailable; checks must continue offline safely.

## Cross-release blockers
Windows 10 native service+ACL and actual network access; pinned Go/Node and PostgreSQL 18 migrations; Garnet command-by-command validation; backup+restore disaster drill; signed build/update pipeline; unauthorized/fail-closed checks; full feature-ledger reconciliation; manual/external connectivity rollback.
