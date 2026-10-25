# TD4 R67 implementation and safety audit

**Baseline:** R66. **Source-level:** implemented and selectively regression-tested; no real storage or PostgreSQL acceptance performed.

## 1. Quarantine simulation boundaries

`library-quarantine-simulation.ts` composes the independently evaluated R66 review with R64/R65 storage ownership evidence. The result has explicit fields `mode: SIMULATION_ONLY`, `quarantineAllowed: false`, `physicalDisposalAllowed: false` and required failures for unverified provider generations, backup retention and atomic quarantine adapters. The SHA-256 fingerprint binds *identifying, non-secret summary evidence*, not a provider generation lease. A 15-minute expiry is informational and does not grant future capability.

`GET /api/library/:itemId/disposition/quarantine-simulation` rechecks authenticated item `manage` access and administrator status before scanning. It neither caches authority nor constructs background jobs. Failures to complete bounded inventory return conflict and no simulation.

`POST /api/library/:itemId/disposition/quarantine-simulations` rechecks identical access; computes a fresh scan; then in a Serializable DB transaction revalidates the current two-person approval, original policy snapshot, request ID and optimistic decision revision. Idempotency keys cannot cross actor/item identity. The transaction writes a single immutable audit plan and initial journal event, with zero provider calls. A separate `GET` returns up to 25 audit entries. `POST .../:planId/withdraw` appends a withdrawal event without altering the original plan. A partial unique index prevents duplicate withdrawals.

New Prisma models and migration `20261016080000_td4_quarantine_simulation_journal` add referentially restricted plan/journal storage, DB trigger immutability (using R63's immutable evidence function) and deliberate append-only event semantics. Existing R66 request state remains unchanged. This is **not a true reversible quarantined-file journal**: no file moves have occurred and there is nothing to restore. Future real mutations must have their own durable, per-object state machine, lease and provider acknowledgment contract.

## 2. Existing storage lifecycle risk discovered

`storage-lifecycle-runtime.ts` previously reclaimed ManagedBlob bytes from zero DB reference counts and stale claim timestamps without proving provider-generation identity, backup snapshot expiry, active uploader fencing or conflicting source pointer authority. In R67 it still scans and counts candidates, but neither claims nor removes rows nor invokes `storage.delete` for managed GC. `gcDeferred` makes the backlog visible. The old locator remains after successful tier relocation, and ambiguous target copies are left for later reconciliation instead of eagerly deleting them after a CAS conflict or caught exception. This deliberately **trades storage space for data safety**.

The lower-level `ClusterStorageRuntime.copyToTier` and other upload/media/storage helpers have their own write/delete paths and are not covered by this particular guard. Tier migration still copies and updates a managed-blob pointer; do not describe R67 as a system-wide storage mutation freeze. Old copies and ambiguous targets must be inventoried and eventually cleaned by a separately approved provider-aware protocol, never by age alone.

## 3. Authorization and attack surface

- All four new HTTP handlers require administrator AND Library item management authority. A decision approval by itself does not expose the inspector to non-admins.
- No raw provider URLs or credentials are returned by the simulation. Prior ownership audit still contains relative local paths only for authorized admins.
- Snapshot fingerprints and plan keys are not bearer tokens and are not accepted by any write, job or storage execution service.
- A new legal hold, reference, item revision, approval revocation or decision revision prevents a new plan from being recorded. Old plans remain historical snapshots, not live authorization.
- Race windows in provider inventory remain explicitly unproven; the plan never acts as a filesystem lock.

## 4. Evidence and testing limits

- 20 mocked executable quarantine tests: snapshot/version/expiry, incomplete review, stale approvals, idempotency, withdrawal, wrong item, reasons, immutable replay.
- 10 source integration assertions: route gates, migration constraints, UI and no provider mutators.
- 4 mocked storage lifecycle tests: deferred GC, prior locator retention, CAS collision, copy failure.
- 42 inherited TD4 selected suites (R35 test requires temporarily linking global TypeScript in the lean package; symlink is removed before packaging).
- TypeScript/TSX parsing, CSS parsing and relative import resolution. This **does not** substitute for full dependency-backed `tsc`, live Prisma migration, Windows hosting or NAS concurrency and restore tests.

## 5. Unresolved certification/implementation blockers

Actual object identity/version fencing, atomic quarantine, bytes-written durability, backup retention, distributed leases, active multipart transfers, Packet source immutability and failure rollback must be implemented and tested before any operator may request a real quarantine or delete. Keep typed events/provider lifecycle and remaining Search/Action owner matrix in the TD4 backlog rather than declaring source closure.
