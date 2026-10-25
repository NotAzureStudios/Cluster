# Cluster implementation roadmap | revision 48

**Baseline:** v0.546.0 TD4 R48, directly derived from the exact R47 source archive. Historical/source ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Release gates: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Next work |
|---|---|---|
| TD0–TD2 | Source closed | Reopen only for confirmed defects |
| TD3 | Source closed since R30 | Preserve shared UI, native design and interaction contracts |
| TD4 | **Active** | Shared Search/Action/provider contracts, lifecycle; Library deferred workflows |
| TD5 | Partially built | Native transfers, diagnostics, background integration alongside consumers |
| TD6 | Major unfinished workflow workload | Mandatory CD-01 to CD-20 source implementation |
| TD7 | Not started | Canonical-authority fossil cleanup and source freeze |

## R48 source implementation

- Enforced **fresh server authorization** for every Command Search result fetch across renderer consumers, bypassing cached permission-filtered search payloads while retaining non-sensitive caching and server-side ranking-cache performance.
- Connected live resource-change invalidation to the open taskbar Command Palette via the existing debounced subscription helper.
- Fixed the shared Resource Action registry's project-only assumption for standalone Whiteboard, personal Calendar, and standalone Timeline resources without broadening Project-only resource capabilities.
- Added executable Search/cache/action tests and reran selected Search, provider, Library, storage, TD2 and TD3 regressions.

## Mandatory TD4 work still open

1. Explicit domain-owned People, governance and other sensitive providers, with complete resource identity and permission checks.
2. Shared Search and Action adapters for additional result kinds and native/workspace consumers; typed producer/consumer event contracts and correct resource deep links.
3. Provider startup, tool enable/disable, drain, unsubscribe and cleanup integrated with TD2 lifecycle.
4. Authorized durable hierarchy-wide Library operations, safe conflict recovery and rollback semantics.
5. Retention/provenance-governed physical file quarantine/disposal after R40/R41 read-only evidence; no unsafe automatic deletion.
6. Finite TD4 source closeout audit after those owners converge.

Source-only validation does **not** certify Node 24 dependencies, a live PostgreSQL migration/concurrency test, multi-user/Windows Qt behavior, or production readiness. No new Prisma migration or native executable modification in R48.
