# Cluster implementation roadmap | revision 46

**Baseline:** v0.546.0 TD4 R46, directly from R45. Historical master: `TECH_DEBT_MASTER_ROADMAP.md`. Release certification: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source implementation | Next boundary |
| --- | --- | --- |
| TD0–TD2 | Closed | Reopen on proven defects only |
| TD3 | Closed since R30 | Preserve shell, QML, Appearance, interaction behavior |
| TD4 | **Active** | Remaining providers, typed events, Search/Action consumers, lifecycle; Library deferred work |
| TD5 | Partial | Native/background/diagnostic implementation with consumers |
| TD6 | Major unfinished | Mandatory CD-01–CD-20 user journeys |
| TD7 | Not started | Fossil removal only after canonical replacements; code freeze |

## R46 implemented source

1. Source Control `source_repository`, `source_commit`, and `source_review` resource-change providers now load their real Prisma records and enforce Source Control permission plus current Project rules.
2. Repository and commit invalidations support **multiple live Project bindings**. Explicit Project scope must match an authorized binding. Unscoped changes may reach users through any authorized bound Project; they never inherit a different Project's grant. An individual review is tied to its own Project and an active binding to that repository.
3. Removed a fail-open `AccessRule.findMany().catch(() => [])` in the Source Review queue. Permission-store errors no longer act as unrestricted rule sets.
4. Added provider and actual `/api/changes` route tests for missing/forged identities, linked Projects, archived/unbound resources, membership, explicit deny rules, disabled tool, administrator spoofing, failure propagation and cursor safety. Preserved previous R42–R45 behavior.
5. No Prisma schema changes, migration, UI restyle or native executable changes.

## Remaining TD4 source work

- Remaining resource providers: People privacy, policies, announcements, onboarding and other governance resources. Do not silently enroll kinds via generic target rules.
- Typed producer contracts, provider-owned invalidation consumers, permission-safe Search and Action adapters; canonical resource identities across discovery/actions/notifications.
- Tool lifecycle integration including enable, disable, draining, unsubscribe and cleanup, respecting TD2 authority.
- Durable large **hierarchy-wide** move/archive/restore/delete workflows with fresh tree/revision/lock/Records checks and transactional checkpoints. Existing bounded file-only jobs remain.
- Retention/provenance-verified quarantine and physical blob disposal. R40/R41 candidate review deliberately does **not** authorize deletion.
- Source-level closeout audit after these mandatory contracts are complete. Node 24 builds, real PostgreSQL, multi-user/authenticated SSE and Windows/Qt tests belong solely to release certification.
