# Cluster implementation roadmap | revision 75

**Canonical code baseline:** Cluster v0.546.0 TD4 R75 (derived from verified R74). Historical technical debt remains in `TECH_DEBT_MASTER_ROADMAP.md`; runtime acceptance remains in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Follow-up |
| --- | --- | --- |
| TD0–TD3 | Source-closed | Preserve previously validated contracts |
| TD4 | **Active at R75** | Resolve last typed consumer/owner boundaries and produce finite source closure evidence |
| TD5 | Partially implemented | Native/runtime/storage certification and provider-safe quarantine execution |
| TD6 | Major backlog | End-to-end collaboration, automation, application, announcements and Forms workflows |
| TD7 | Not started | Final source cleanup and freeze after canonical convergence |

## R75 delivered

1. **Discord dispatch reauthorization.** Queued notification receipts now require a current, active connection in the same Studio, an active Project/connection binding for Project messages, and an exact match with the presently selected Project route, channel, connection, current event/priority policy and original notification scope. The service performs admission before marking a receipt running and once more immediately before outbound Discord dispatch, after awaited mention/presentation work.
2. **Discord mention-policy updates.** The final policy check uses fresh settings; a newly disabled mention mode clears the actual outgoing mentions even if the receipt was originally queued with linked mentions.
3. **Git provider job preflight.** Queued repository sync and working-copy workflows recheck that their repository connection still exists, remains enabled, and belongs to the Studio. Working-copy operations also require an unarchived, currently bound Project in the same Studio. Revoked work is rejected before recording an active operation or beginning Git network/filesystem execution. Cluster-hosted local repositories may have no external connection.
4. **Regression coverage.** 22 executable Discord negative/positive checks, 13 executable Git job preflight checks, 51/51 inherited TD4 suites, and active source parse/CSS/import scan. Incomplete TypeScript semantic comparison against R74 has **0 new server diagnostic signatures**; not a passing dependency-backed compiler run.

## Finite TD4 source-closeout obligations

- **Typed events:** the seven registered outbox consumers have explicit type ownership (R69). `work.assignment.changed` has wildcard consumers but no assignment-specific materializer. Record a signed-off determination that the event is a change signal consumed by generic services, or define an actual state projection with replay cutoff/backfill and permission scope. Never register a dummy consumer merely to satisfy a matrix.
- **Remaining providers:** finish explicit startup, drain, disable, re-enable and subscription/timer ownership audit; verify how already-started remote calls behave when policy changes. R75 adds admission guards, not global cancellation of in-flight Git or Discord network operations.
- **Resource destinations:** Source reviews/commits, Forms/submissions and approvals are source-integrated; unimplemented announcements, automations, public applications and secondary-repository navigation remain deliberately unindexed pending TD6 navigation/authorization integration.
- **Storage safety:** inspection, approval, and quarantine *simulation* are source-integrated. Actual quarantine, physical delete, managed-blob reclamation and tier migration remain **disabled**. Transfer provider-generation safety and real recovery acceptance to TD5 with a named owner. A simulated plan is not a physically recoverable quarantine.
- **Closeout:** finalize finite kind/consumer/provider matrix, negative authorization evidence, and explicit carry-forwards. Do not mark runtime certification complete.

## Runtime acceptance still missing

Dependency-backed Node 24 build and Prisma generation, live PostgreSQL multiworker/concurrency and migration tests, authenticated multi-user browser permission tests, native Windows/Qt integration, real NAS/S3 quarantine/recovery/retention, and remote-provider interruption tests.
