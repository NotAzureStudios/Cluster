# TD4 R59 implementation audit | resource ordering and typed assignment identity

## Confirmed gap and scope

The R58 outbox already serialized **insertion commit order** with a transaction-scoped PostgreSQL advisory lock. Its workers nevertheless chose eligible jobs by `availableAt`, then `createdAt`; a failed earlier change to the same resource could be unavailable during backoff while a newer event was delivered first, creating cross-process stale projections and automation side effects.

R59 changes only the existing domain-event owner; no alternative queue, timer, subscriber framework, database migration, or native binary.

### 1. Claim-time per-resource ordering

- A claim is eligible only if no *pending* predecessor with the same canonical `resourceKind` and `resourceId` and smaller committed outbox `sequence` remains. The predecessor can be leased, waiting for its retry, or otherwise unprocessed.
- `FOR UPDATE SKIP LOCKED` still allows distinct resources to progress independently across workers. `availableAt` remains a priority among independently eligible candidates, with `sequence` as deterministic tie-break.
- Explicitly processed or dead-lettered predecessors unblock later events. Dead lettering is retained as operational failure evidence; it is **not** interpreted as a successful side effect. A subscriber must still make its own effects idempotent.
- Events without a canonical resource pair are not serialized behind one synthetic global lane. These events are not guaranteed semantic per-resource ordering; producers requiring resource order must supply a canonical resource address.
- Existing Prisma and physical PostgreSQL index `DomainEventOutbox_resourceKind_resourceId_sequence_idx` supports the predecessor check. No schema update was necessary.

### 2. Typed resource/identity integrity

- Known assignment events verify the persisted address against the durable payload, not only at append-time but **before any consumer** on replay. Invalid/partial persisted addresses are rejected; checkpoint advancement is impossible on those rejected attempts.
- Global resource identity is distinct from Project context. The Activity producer canonicalizes payload/resource once, so a Packet assignment mentioned in a Project no longer claims that Project as its resource owner. Project context on the outbox row remains for audit/consumer filtering.
- Same-ID collision checks now include correlation and causation IDs. A supposedly idempotent retry cannot silently reuse an existing event ID with different causal history.

### 3. Tested negative and concurrency paths

`tools/scripts/cluster-td4-r59-event-ordering-tests.mjs` executes 21 checks against the transpiled real runtime and real Activity producer with in-memory stores: pending retries, lease overlap, independent resources, cross-Project source commit, completed/dead-lettered release, deterministic ties, corrupted replay identities, missing address, global Packet placement, canonical Card scope, invalid producer rollback, and idempotency provenance. The tests assert the actual SQL claim contains the resource-lane guard, and exercise equivalent row selection through a controlled simulation. They are **not a substitute for live PostgreSQL transaction semantics or timing under load**.

The seven current durable subscriber owners and an assignment-event consumer gap are identified separately in `TD4_R59_EVENT_OWNER_MATRIX.md`. R58's 25 selected inherited regressions plus R57/R58 navigation checks pass again, including R54 typed-delivery and R56 lease-fencing tests. `TD4_R59_SOURCE_SCAN.json` records active TypeScript/TSX, CSS and relative-import checks (generated Prisma client not provided in the lean snapshot). Native executables remain byte-identical.

### Remaining risks

- PostgreSQL `NOT EXISTS` evaluation, query plan, concurrent worker scheduling, dead-letter ordering and contention require multi-process runtime certification. A predecessor that repeatedly fails can intentionally delay later events for that resource until retry/terminal resolution; operations monitoring must surface such backlog.
- This pass does not gate or fully own every provider subscriber lifecycle, re-enable replay, late subscription registration, or webhook backpressure. These stay on the TD4 closure checklist.
- This pass does not certify Node 24 with all dependencies, PostgreSQL, Qt/Windows protocol handling or end-to-end user authorization.
