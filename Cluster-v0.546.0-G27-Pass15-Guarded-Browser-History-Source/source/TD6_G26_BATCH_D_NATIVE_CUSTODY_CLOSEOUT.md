# Cluster v0.546.0 TD6 G26 — Grouped Batch D Source Implementation

**Status:** native managed-file reliability and Inventory/Vault custody review implemented in source; **G26 OPEN, not production-certified**. Parent: `Cluster-v0.546.0-TD6-G26-BatchC-Library-Hierarchy-Provider-Evidence-Source.zip`.

## Scope delivered together

### Native managed Package file update safety

- The Go Package helper now takes an exclusive destination-wide filesystem lock under the **exact destination directory** ledger. Previously operations were serialized only by Package key; two different Packages could have updated one folder simultaneously. The lock is not silently stolen after interruption. Read-only previews identify an active or abandoned destination lock.
- A bounded (256 entries / 8,192 foreign tracked files), read-only ownership scan checks other Package ledgers tied to the same exact destination before a new file sync/rollback. It refuses even double-confirmed/adopt mode when another Package tracks a relative path, including historical tracked members. Case-folded path comparison prevents Windows casing bypass. Malformed ownership evidence fails closed. This is NOT a globally atomic claim across different destination roots.
- The native tracked rollback/recovery path now validates the **entire** journal, all expected destination hashes, duplicate-case paths and all backup hashes before touching any file. Later conflicts or missing backups now fail before the earlier entries are restored. The filesystem is still not transactional: unexpected I/O failure or external mutation *during* restoration can leave partial results. Durable pending evidence remains the recovery boundary.
- Qt's native bridge carries `foreignOwnershipConflicts` and bounded path examples through to the Desktop Package update preview. The renderer explicitly explains that other Package ownership cannot be overridden. It still labels file updates as file operations, not OS installation or attested application health.
- No privileged MSI installer logic, shell commands, deployment grant semantics, trust store or pre-existing native executable was modified. No new migration.

### Inventory/Vault custody inspection

- New admin-only, on-demand, per-Pool `GET /api/admin/inventory/key-pools/:id/custody-review` endpoint. Bounded 50-assigned-key pages, indexed keyset cursor, secret-free public output and `private, no-store` caching.
- Evaluates closed pool, expired key assignment, revoked/expired linked Vault secret, missing or inactive user, then `no_known_custody_blocker`. That healthy category does **not** authorize reveal, skip PIN, issue a Package entitlement, or reveal the underlying key. Each response explicitly states its counts are page-scoped, not global totals.
- New author UI for Key Pools loads inspection only when requested, paginates with stale-selection fencing and offers review reasons without querying ciphertext, fingerprint, vault secret IDs or signed tokens. Normal per-key reveal and separate approval flows are untouched.

## Development validation

- Go native Package helper `go test ./...`, `go test -race ./...`, `go vet ./...` on Linux Go 1.23.2: passed. New tests cover foreign Package ownership, explicit adopt denial, shared destination lock, corrupt foreign state, multipath rollback fail-before-writing and case-fold duplicates. These are **not** Windows tests.
- Focused Inventory/Vault custody test: **14/14**. Older key-pool, Inventory and Vault workspace tests: **44/44, 31/31 and 18/18**.
- `npm run cluster:td6:g26:batch-d` passes the full inherited G26 Batch C/B/A and Workstreams 1–9 chain; TD5 `npm run techdebt:td5:source-closeout` passes 14 scripts / 167 cases. TypeScript/TSX/CSS/renderer-import scan passes.
- Full dependency-backed Node 24 compilation, real PostgreSQL migration/runtime tests, Qt compilation, Windows native process and Installer behavior, live Vault concurrency, Mac/Linux package installation, real storage providers and authenticated browser E2E remain **NOT RUN**.

## Next connected implementation / certification gaps

1. Separate destination roots that overlap (`C:\\Studio` vs `C:\\Studio\\Subfolder`) are NOT protected by the same exact-root lock/ownership index; add a globally scoped path-owner lock and cross-destination collision proof before considering arbitrary managed roots safe for wider use.
2. Windows MSI repair/uninstall/reboot resume and durable OS service receipts remain a distinct highly privileged workflow. Do not claim a signed MSI process exit or file copy is a successful OS installation. Preserve one-time grant consumption, immutable receipts and manual-review-on-uncertainty.
3. Vault expiration/offboarding *notifications* and administrative custody closeout are not implemented by the read-only review panel. Inventory/Vault approval and reveal remain independent. Recheck access at the time of every distribution or reveal.
4. Library provider generation-fenced destructive cleanup, dual-admin approval, complete graph/retention proof and dynamic inherited protection are still incomplete; **physical disposal stays disabled**.
5. Verify the existing Batch B database migration `20261101000000_td6_g26_package_inventory_seat_binding` and regenerate Prisma client on a real PostgreSQL 18 / Node 24 test environment.

G26 remains open. Do not close development solely because static suites passed.
