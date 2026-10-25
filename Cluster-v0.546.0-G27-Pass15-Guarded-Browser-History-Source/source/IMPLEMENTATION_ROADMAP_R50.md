# Cluster implementation roadmap | revision 50

**Baseline:** v0.546.0 TD4 R50, derived from the exact R49 package. Historical ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Production gates remain in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Remaining owner |
| --- | --- | --- |
| TD0–TD2 | Source closed | Reopen for demonstrated defects only |
| TD3 | Source closed at R30 | Preserve shell, Appearance, accessibility and Qt source parity |
| TD4 | **Active** | Typed producer/consumer resource events, shared Search/Action adapters, provider cleanup; deferred durable Library workflows |
| TD5 | Partially implemented | Native diagnostics and transfer/background consumers |
| TD6 | Major outstanding work | Required CD-01 to CD-20 workflows; preserve existing Forms drafts |
| TD7 | Not started | Obsolete-owner removal and code freeze after replacements |

## R50: People and governance change-feed authority

1. Enrolled seven additional resource identity kinds through the existing provider snapshot: **user, team, department, job_role, announcement, policy, onboarding_assignment**. No second resource registry, push service, or schema migration.
2. People identities require actual canonical database records and active People directory permissions. Archived identities require People manage; privacy-erased users never enter the shared feed. The current user may still receive their own non-archived identity invalidations without acquiring access to every profile. The feed contains identifiers only and grants no private profile or Personnel Records access.
3. Studio announcements require published status and current audience membership for ordinary members; Studio Systems reviewers may see actual draft records. Policies require active status, an existing published version and matching audience. Invalid/exclusion audience metadata fails closed. All record IDs and project scopes are verified.
4. Onboarding assignments only reach the actual assignee with an active published plan/version, or a Studio Systems reviewer. Previously accessible assignments can still invalidate a stale client list following assignment revocation. Recipient access to another person's assignment never follows a generic People permission.
5. The already-enrolled provider snapshot performs current session/role/team rechecks, strict Studio audience reads and authoritative ID lookups. R49's TD2 tool-availability filtering and SSE resets remain unchanged.

## Development evidence (not runtime certification)

- `tools/scripts/cluster-td4-r50-governance-feed-tests.mjs` executes the real HTTP change-feed route against a mocked Prisma/authorization boundary, covering 34 negative and positive assertions.
- `TD4_R50_REGRESSION_RESULTS.json`: 66/66 selected inherited/new development suites passed on Node 22.16.0, global TypeScript fallback.
- `TD4_R50_SOURCE_SCAN.json`: 1,030 active TS/TSX, 110 CSS, 4,467 relative imports; no syntax/CSS/missing authored imports; omitted generated Prisma client is separately reported.
- `TD4_R50_PEOPLE_GOVERNANCE_PROVIDER_AUDIT.md` records exact preservation and remaining scope.

## TD4 still unfinished

1. **Typed producer/subscriber events:** replace remaining independent event strings/projections with shared versioned contracts; check each producer's canonical ID and lifecycle mapping.
2. **Search, Resource Actions and deep links:** finish cross-workspace adapters, including People/governance users and feature-disabled/permission-denied states.
3. **Remaining event identities:** review approvals, background jobs, integrations, automation, meeting/scheduler/control/review assets for adequate record-level authorization. Enroll when warranted; do not permit generic admin shortcuts for private records.
4. **Provider lifecycle:** review owners beyond the six existing Studio switches, subscriber draining/cleanup, cross-process freshness and reconciliation.
5. **Library:** durable large hierarchy-wide operations, retention/provenance-governed physical quarantine and disposal. R40/R41 review remains non-destructive.
6. **Finite closeout:** remove replaced contracts only after complete canonical consumers; inventory all active producers and negative-path tests.

**Release certification is separate:** full Node 24 dependency-backed build, generated Prisma, live PostgreSQL, authenticated multi-user/SSE and installed Qt/Windows behavior are not proven by these checks.
