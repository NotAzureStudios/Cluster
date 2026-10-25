# Cluster 1.0 | F3 P2 + early F4 incident bridge | Source closeout

## Parent / checkpoint

- Exact parent: `Cluster-v0.546.0-F3-P1-API-Tool-Manager-Integrated-Source.zip`, SHA-256 `cc318a2cdad4f3a099653022ed3d92709ee6963785208e2051f42e5067c290bc`.
- Inherits G27 Batch 8 announcement-reload recovery + Domain/OOBE source. The external standalone F3/F4 policy kit was NOT blindly merged.
- This is **source implementation**, not a 1.0 production deployment certificate.

## Implemented

1. **Canonical dependency readiness monitor** (`apps/server/src/core/api-tool-readiness.ts`): one bounded in-process sampler covering `lifecycle`, `database`, `storage`, `background-tasks`. Uses Cluster's *existing* database/storage readiness probes and operational health evaluator. Domain-specific dependency projections reuse `SERVER_DOMAIN_CATALOG`; unrelated domains are not marked broken by irrelevant dependencies. `dependency-passing` means dependencies respond, not that each endpoint works. Unknown, missing, stale, untested are never inferred healthy. The API still reports `livenessChecked: false` for per-tool endpoints.
2. **Adaptive background sampling** every 120 seconds through the authoritative BackgroundTaskRegistry, maintenance workload class, without duplicate per-tool timers, external probes, or an HTTP request every dashboard render. Failures use the existing scheduler's backoff and failure counters.
3. **Operator diagnostic refresh** at `POST /api/admin/operations/api-tools/check`, admin-only, a 30-second cooldown, in-flight deduplication, no accepted probe addresses, audited success. Existing `GET /api/admin/operations/api-tools` stays passive and private `no-store`.
4. **Actual Operations UI integration:** an additional Dependency Readiness column with per-signal evidence, age/staleness reporting, and a deliberate “Check dependencies now” control. Explicit checks use fresh API readback, bypassing stale `queryApi` cache; regular 30-second visible refresh does not issue active checks.
5. **Durable sustained-incident bridge** (`apps/server/src/core/operations-dependency-incidents.ts`): two consecutive **real** hard failures of storage or scheduler checks can create or reopen exactly one canonical `OperationsIncident` per dependency. Two confirmed passes can auto-resolve an `open` or `monitoring` automated incident, but not one being `investigating` or `mitigating`. Manual incidents are untouched. The unique key is persisted with a nullable Prisma field + migration; failure and resolution add canonical timeline entries and impacted-resource links. Admin owners/recipients are selected from active WorkspaceMembers, bounded to 64, with Inbox notifications committed atomically with incident changes and published live only after commit. Cross-process create deduplication uses the database unique constraint; conditional status updates fence concurrent recovery/reopens.

## Integrity and threat boundaries

- No arbitrary URL (SSRF) input, admin endpoint is authorization gated; dashboard GET runs no probes.
- Do not call this “per-endpoint integrity checking.” Known dependencies do **not** prove business data correctness, correct access control, web client behavior, worker task delivery, outbound integrations, or ability to recover from actual corruption.
- The DB-backed bridge intentionally does **not** auto-create a PostgreSQL outage incident when PostgreSQL itself is unreachable. The **native Windows supervisor must provide a separate durable, out-of-process emergency alert path** before 1.0.
- No automatic restart, physical deletion, file repair, database restore, external gateway exposure, or OS-level service changes are triggered by this code.
- The first recipient fallback is admin/owner WorkspaceMember users. Custom team/department/on-call routing, assignment shifts, acknowledgments with deadlines, delivery escalation, reminder schedules, external Discord/email delivery, and preference-aware notifications are remaining F4 work. Existing Inbox ownership and persistence are reused, not replaced.
- No sender-signed release, Node 24 full dependency-backed build, Prisma generate, PostgreSQL 18 migration execution, Windows/Qt build, Garnet connection test, or browser/multiuser run in this environment.

## Validation

- `node tools/scripts/cluster-f3-p2-api-tool-readiness-tests.mjs` — 50/50 focused assertions.
- `node tools/scripts/cluster-f3-p2-incident-bridge-tests.mjs` — 46/46 focused assertions with transaction-style fixtures (not live PostgreSQL).
- `node tools/scripts/cluster-td6-g27-api-tool-manager-tests.mjs` — inherited 40/40.
- G27 Domain Management: 27 checks; G27 Domain Lifecycle: 32 checks; configuration rollback: 16 checks; announcement navigation: 13 checks.
- `node tools/scripts/cluster-td6-source-scan.mjs` — 1,119 TS/TSX files, 0 syntax errors; 3,258 relative renderer imports unresolved: 0; 110 CSS files, 0 detected brace errors.

## Required runtime order

1. Apply migration `20261108000000_f3_api_dependency_incident_automation` to a disposable PostgreSQL 18 instance, then regenerate Prisma client using project-supported toolchain.
2. Build/test under Node 24 and run authenticated endpoint + admin/non-admin checks.
3. Induce and recover from writable-storage degradation on an expendable test root, verify one incident/Inbox pair per episode, simultaneous process race and no auto-resolution of human-investigated incidents.
4. Verify proper notification visibility, cross-process cache invalidation, on-call fallback, native supervisor behavior while database unavailable, and no alert storms under repeated outages.
5. Only then advance these gates beyond “source-implemented.”
