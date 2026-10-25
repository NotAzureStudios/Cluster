# Cluster implementation roadmap | revision 47

**Baseline:** v0.546.0 TD4 R47, directly from the exact R46 Source Control provider archive. Historical ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Production acceptance: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source implementation | Next work |
| --- | --- | --- |
| TD0–TD2 | Closed | Reopen only for demonstrated defects |
| TD3 | Closed since R30 | Preserve native/renderer design and shared action behavior |
| TD4 | **Active** | Remaining provider + Action/Search consumers, typed events, lifecycle; Library deferred work |
| TD5 | Partially built | Native/background/diagnostic implementation with real consumers |
| TD6 | Major mandatory workload | CD-01 through CD-20 user journeys |
| TD7 | Not started | Canonical-authority cleanup and source freeze |

## R47 completed source scope: privacy-safe command Search admission

1. Shared Search now applies **the owning Library ACL**, including inherited folder permissions, rather than treating a Library index hit as a generic Project file with generic target authorization.
2. Search's workspace-admin fast path no longer bypasses **Personnel Records attachment exclusion**, Packet Library folder access or Packet/Studio Policy audience constraints. Private Calendar's existing strict policy continues to run first.
3. Library index entries now include the canonical `ownerId` and `source` fields required by the existing Library permission service; search denies trashed/archived/destroyed items and malformed/mismatched Library rows.
4. Library ACL and Studio audience membership reads now use the existing **strict, fail-closed** server access providers; a failed permission read is an error, not an empty permission set.
5. Protected Records IDs are resolved in **one query per bounded Search admission batch**, not one database query per candidate. The ranking cache remains permission-agnostic and visible results are reauthorized on each request.
6. New executable policy and actual command-route mocked integration suites cover owner/folder access, Records exclusions (including admins), audience/tool changes, database failures, batching and Calendar preservation.
7. No Prisma migration, changed native executable, redesigned Search UI or change to the separate R42–R46 resource-change providers.

## Mandatory TD4 work still open

- Remaining privacy/governance providers, including People, announcements, onboarding and related resources. Do not assume unrecognized kinds have safe generic authorization.
- Canonical Action adapters and additional Search resource kinds, provider-owned invalidations, typed producer/consumer events, and consistent deep-link/resource IDs.
- Provider enable/disable/draining/unsubscribe/cleanup integrated with TD2 Tool Infrastructure.
- Durable, authorized hierarchy-wide Library jobs and safe retry/rollback semantics beyond bounded file-only operations.
- Retention/provenance/write-fenced quarantine and physical file disposal. R40/R41 audits and reviews are **not** permission to delete blobs.
- Finite TD4 closeout audit after implementation owners are complete. Node 24 dependency-backed compilation, live PostgreSQL, authenticated multi-user/SSE and Windows/Qt acceptance remain in the separate release-certification ledger.
