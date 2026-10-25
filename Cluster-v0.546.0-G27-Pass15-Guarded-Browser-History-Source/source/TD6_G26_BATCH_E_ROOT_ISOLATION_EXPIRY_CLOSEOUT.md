# Cluster v0.546.0 | TD6 G26 Batch E: Native Root Isolation + Inventory Expiry Evidence

**Status:** Source implementation and targeted regression checks passed. **G26 REMAINS OPEN.** Parent: Batch D source. No production runtime certification.

## 1. Native managed Package destination registry

* The Go file-update writer now acquires an exclusive, persisted `.registry.lock` around *all* managed destination file operations, before the previous exact-directory lock. Separate configured roots no longer perform concurrent native modifications. A stale registry lock is deliberately **not** automatically reclaimed.
* Bounded read-only registry scanning validates package owner state files against destination SHA-256 directory names. A destination parent/child relationship with any other tracked Package root is refused, whether or not the current release includes a colliding filename. Windows-style case folding and directory-separator boundaries are evaluated.
* The preview reports `overlappingRoots` and sample root paths. Qt transports them to Desktop Package settings. The UI explicitly explains that adoption, update and rollback are blocked until ownership is reviewed and isolated.
* Both initial preview and authoritative in-lock preflight recheck root overlap; the existing recovery/recompare path is preserved. Unknown, malformed, linked, oversized or excessive ownership records fail closed.
* The bounded registry permits up to 1,024 destination entries and 4,096 Package owner records. **Tradeoff:** a registry-global lock intentionally serializes unrelated destination updates. Exact package-id deduplication and max destination limits remain, and no permission to remove an orphan lock is created here.
* This remains **managed content synchronization only**, not executable installation, signed MSI success, Win32 service status or application-health attestation.

## 2. Proactive Inventory/Vault expiry governance

* Existing admin-only on-demand key-custody review now classifies `key_expires_soon`, `vault_expires_soon`, and `recipient_access_expires_soon` within 7 days, after stronger expired, revoked, closed-pool and inactive-recipient blockers.
* Studio Inventory's established on-demand attention endpoint now includes aggregate counts for **unrevoked Vault secrets expiring within 7 days** and **expired Vault secrets**. Existing key and digital-seat counts remain. No ciphertext, Vault record IDs, signatures, tokens or keys are returned.
* The existing Inventory admin UI renders new evidence without polling. No independent notification scheduler, automatic credential rotation, forced revocation or implied key-reveal entitlement is introduced.

## Verification

* Inherited `npm run cluster:td6:g26:batch-e` chain: passed (G26 Batch D/C/B/A and Workstreams 1–9). New expiry tests **17/17**, inherited Batch D custody **14/14**.
* `npm run techdebt:td5:source-closeout`: 14/14 scripts, 167/167 cases.
* Native Go: `go test -count=1 ./...`, `go test -race -count=1 ./...`, `go vet ./...`, Windows x64 *cross-compilation*: passed. New Go registry tests test parent-child conflicts, disjoint roots, orphan locks, corrupted records, Windows case-folded paths.
* TS/TSX syntactic parse, relative renderer import and CSS brace scan: passed.
* No new DB migration. Built-in native Windows binaries remain unchanged. The cross-compiled helper was a temporary local compile artifact, **not** integrated or executed on Windows.

## Open issues

1. **G26:** secure MSI repair/uninstall/reboot-resume, OS-verified installation receipts and actual Windows crash/failure recovery are still open. File synchronization cannot substitute for an installed-software lifecycle.
2. **G26:** credential expiry **notifications**, employee offboarding custody closure and automated recovery/reconciliation are not delivered by on-demand evidence.
3. **G26:** provider generation-fenced destructive storage reconciliation, dynamic Library retention inheritance and independent approval evidence remain open. No physical deletion.
4. **Certification:** Node 24 dependency-backed full build, Prisma generate and PostgreSQL 18 migration/concurrency, authenticated browsers, Windows Qt/runtime, SMB/NAS/S3 and genuine MSI tests remain unverified.
5. **G27/G28:** preserve open requirements rather than silently marking the overarching roadmap complete.
