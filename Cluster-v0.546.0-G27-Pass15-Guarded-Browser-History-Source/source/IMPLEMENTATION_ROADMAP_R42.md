# Cluster implementation roadmap | active TD4 view | revision 42

Baseline: v0.546.0 TD4 R42. Historical source ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Release certification: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Status | Next source work |
|---|---|---|
| TD0–TD2 | Core/source closed | Preserve contracts, fix confirmed regressions |
| TD3 | Source closed (R30) | Do not reopen without a source-grounded regression |
| TD4 | **Active** | Complete provider enrollment, typed events/action/search adapters, provider lifecycle, large hierarchy operations and retention-governed disposal |
| TD5 | Partial | Native/diagnostic/background implementation alongside consuming workflows |
| TD6 | Major mandatory backlog | Complete CD-01–CD-20 user journeys |
| TD7 | Not started | Canonical-path fossil removal and source freeze |

## Source work shipped to date

R31–R36: Library collection sharing, authorized matching, durable metadata and file-only archive jobs. R37–R39: hierarchy transaction safety and durable filesystem reconciliation. R40–R41: read-only orphan evidence and non-destructive destruction. **R42:** Resource-change feed now enforces the canonical Library folder/owner ACL for Library/file events, excludes Personnel Records, checks canonical project identity for card/calendar/library events, and stops treating Access Rule read failures as an empty permission list. Each feed batch uses live session/account/role/team state; idle stream access is periodically rechecked. Library ACL reads can be requested in strict fail-closed mode for event delivery.

## Remaining TD4 required work

1. Finish common resource/action/search adapters, explicit per-kind provider registration and typed change-event producers. R42 hardens the existing feed but **does not claim full provider federation**.
2. Finish provider enable/disable/subscription lifecycles, cancellation/draining and consumer contracts across all required workspaces.
3. Implement authorized, durable hierarchy-wide moves/lifecycle actions with filesystem reconciliation, including proper per-descendant conflict and permission handling.
4. Implement approved retention/provenance-aware disposal with write fences and quarantine. R40–R42 do not physically delete orphan files.
5. Perform finite TD4 source closeout audit. Node24/Prisma/PostgreSQL/Qt/multi-user release acceptance stays on the separate certification roadmap.

No percentage or runtime certification is claimed from source checks alone.
