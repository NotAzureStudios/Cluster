# Cluster v0.546.0 | TD6 G26 Batch G
## Grouped credential-expiration delivery + MSI operator recovery evidence

**Parent source:** Cluster-v0.546.0-TD6-G26-BatchF-MSI-Evidence-Hardening-Source.zip.
**G26 state:** Open. **Production certification:** Not performed.

### Inventory/Vault lifecycle: implemented in source

- Added a daily durable maintenance producer `studio.inventory-credential-expiry` in the existing job runtime. It is not an extra independent interval loop in a browser.
- On-demand Inventory/Vault attention and custody inspections remain intact; notices now create real, administrator-directed Inbox records for **active digital/licensed seats**, **assigned keys**, and **unrevoked Vault credentials**.
- Notices advance through exact deadline-based stages: `seven_days`, `one_day`, `expired`. The deadline is authoritative; the scanner never grants access or extends a lease.
- Added Prisma model `StudioInventoryExpiryNotice` and migration `20261102000000_td6_g26_inventory_credential_expiry_notices`. Uniqueness over `(subjectKind, subjectId, expiresAt, stage)` survives retries, concurrent workers and restarts. Renewal produces a fresh deadline identity.
- A canonical row is locked and re-read *inside* the same transaction as the notice and Inbox write. A revoked secret, closed key pool, changed deadline, inactive recipient or retired digital asset cannot be promoted into a current warning after a stale initial scan.
- Notification creation and deduplication evidence commit together; failed deliveries don't burn the reminder. Administrator summary invalidation runs after commit.
- Recipients must be active Workspace owners/admins. Inbox visibility also denies these admin-only warnings to accounts that subsequently lose admin privileges.
- Inbox projections carry only **kind, stage and timestamp**, without Vault secret identifiers, ciphertext, fingerprints, revealed key values, personal data, or navigation into sensitive resources.
- Max 1,000 candidate rows per kind and 500 administrator membership rows. Overflow fails explicitly, before any notices are created. This is a development safety limit, not a certified large-studio scalability claim.
- No email, Discord or desktop-push delivery guarantee was added; the canonical in-app Inbox is the only implemented notification channel here.

### Native MSI recovery: implemented in source

- The existing read-only `msi-attempt-status` command now derives a conservative `recoveryAssessment` and `requiresRebootReview` from a validated local receipt, operation lock, and current-user Windows Installer registration lookup.
- Receipts showing exit `3010` explicitly require post-restart operator inspection. A matching installed-product version does **not** attest installer source, file health, installation completion, or safety to retry.
- Missing/incomplete/failed/contradictory receipt and registration evidence is separated in operator-facing Desktop UI.
- The native helper still has **no repair, replay, uninstall, automatic retry, removal of receipt/lock, or arbitrary process-execution path** in this inspection command.
- The cross-compiled Windows helper is test output only; it has not been executed on Windows or substituted for Cluster's packaged native executables.

### Source validation

- `npm run cluster:td6:g26:batch-g` includes inherited G26 Batch A–F's implemented suite (Batch E regression command), focused credential lifecycle assertions, and native Go source tests.
- `npm run techdebt:td5:source-closeout` validates the complete TD5 regression chain; its existing mock fixture was extended with the new scheduler dependency.
- Native Go `go test ./...`, `go test -race ./...`, `go vet ./...`, and Windows x64 cross-compilation were executed.
- TypeScript syntax, renderer-relative imports, CSS brace scans, SHA256 source manifest and patch replay are development confidence checks, **not** a dependency-backed release build.

### Unfinished / blocked requirements

- Actual Windows MSI repair/uninstall/reboot/resume and controlled recovery under authenticated Device, grant, installer and OS evidence remain open.
- Automatic fulfillment/revocation for offboarding and Vault rotation workflows remain open. Merely notifying admins does not revoke keys.
- The notification scanner intentionally fails rather than treating an oversize scan as complete; a paginated high-population production scan has not been implemented.
- Generation-fenced external storage cleanup, physical disposal, dynamic retention inheritance, and production release certification remain blocked.
- Live PostgreSQL 18 migration/transaction tests, Node 24 dependencies, native Qt, real Windows and authenticated multi-user browser testing have not been performed.
