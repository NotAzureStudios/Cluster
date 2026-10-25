# Cluster implementation roadmap | revision 74

**Canonical source:** v0.546.0 TD4 R74, directly derived from verified R73. Historical technical-debt ledger: `TECH_DEBT_MASTER_ROADMAP.md`; runtime acceptance: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Direction |
| --- | --- | --- |
| TD0–TD3 | Source-closed | Preserve and regression-test |
| TD4 | **Active R74** | Close finite producer/consumer and provider lifecycle ownership; validate remaining search/action destinations |
| TD5 | Partial | Native platform, robust runtime and storage provider certification |
| TD6 | Backlog | Full application, automation, announcements and studio workflow convergence |
| TD7 | Not started | Final canonical source freeze after remaining work |

## Delivered R74

1. **Approval Search:** Added the existing canonical `approval` resource to bounded global Search, with a 2,000-row cap, status/title and immutable ID. No requester identity, reason, comments, review note, or raw decision payload is queried or added as fields to Search. Titles may themselves contain user-entered names, so results are administrator-only.
2. **Live admission and privacy:** Freshly reread each candidate's record kind, title, status, revision, archive/deleted state. Missing/changed/revoked results are withheld before Search can publish the previous indexed text. Admin identity checked before generic admin bypass. Global approval list/detail/decision routes now require administrator identity rather than broad Project manage permission.
3. **Exact approval navigation:** Verified `cluster://resource/approval/<id>` and shared web work links resolve into the real Admin Approval Center, not a generic Project page; direct GET with existing approvals access guard and `private, no-store` retrieves older/hidden or resolved requests beyond the 500-record queue. Supports existing avatar-audit decisions without indexing their personal details.
4. **Reviewer UI:** Deep-linked target clears filters, cannot fall back to an unrelated approval if missing, fetches exact record separately, preserves it during queue refresh, restores navigation section and exposes canonical Copy Link using Work Actions.
5. **Tests:** 32/32 new focused checks; 51/51 TD4 selected executable suites, source parsing/import/CSS scan clean; 0 new normalized server or renderer TypeScript diagnostic signatures versus R73 in the incomplete local environment.

## Remain for TD4 source closure

- Real application and automation/announcement resource destinations not yet proven: keep unindexed rather than inventing unsupported navigation. Some belong in TD6 feature completion.
- `work.assignment.changed` typed producer has wildcard outbox consumers, but no dedicated assignment materializer. Decide if materializer is necessary and define replay/backfill/offset semantics before register-on-start; do not invent an empty subscriber.
- Non-TD2-configurable provider startup, drain, access-revocation, unsubscribe and restart owner matrix, including Git/Discord/storage integrations.
- Final finite contract and permission-negative audit. Transfer unfinished functionality explicitly with owner and receiving TD phase.
- **Safety exclusions:** Quarantine, physical disposal, automatic managed-blob GC and unsafe storage tier migration remain disabled until generation fences, backups and provider crash recovery are certified. Source closure cannot be mistaken for enabling these operations.

**Independent unverified release gates:** dependency-backed Node 24 build, generated Prisma client, live PostgreSQL/multiworker and migrations, authenticated multiuser/browser, native Windows/Qt, NAS/S3 generation/quarantine/restore.
