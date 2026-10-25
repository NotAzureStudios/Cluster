# Cluster G26 MSI launch intent and forensic receipt hardening | Continuation handoff

## Canonical source

Based on the **Cluster v0.546.0 TD6 G26 Model Conversion Runtime & Delivery Authority** full source. This checkpoint preserves all model-conversion, Packet, Inventory/Vault, Library and earlier native Package fixes. It changes neither Prisma schema nor previously packaged Windows native executable.

## Implemented

- The native Package installer persists a new `msi_prepared_not_launched` receipt before consuming an installation grant. A failed replay/consumption leaves that record for inspection and cannot run msiexec.
- After the grant succeeds, the signed MSI is reverified and a distinct `msi_started_outcome_unknown` record with `launchCommittedAt` is saved **before process creation**. If the launch or installer crashes, no automatic retry is allowed.
- The read-only operator inspection recognizes the pre-launch state, validates optional launch timestamps and pre/post-process ordering, and continues reading older version-1 receipts without inventing a timestamp.
- MSI receipts are read from a stable opened regular file, with identity and size checks before/after read, and replaced path detection.
- The Desktop Package view now distinguishes preparation from process launch and avoids interpreting the absence of an exit code as success.
- Go adversarial tests cover grant replay after preparation, failure to create a receipt without consumption, pre-launch review, impossible timeline states, legacy schema, and swapped/symlinked receipt paths.

## Non-negotiable remaining gates

- Node 24+ workspace install and dependency-backed build, generated Prisma and live PostgreSQL 18 migrations have not been performed here; the lean bundle has no dependency lockfile.
- Native Windows MSI signed test installation, exit 3010 reboot, post-restart observation, repair/uninstall isolation, OS recovery and Qt integration are **not certified**.
- Automatic MSI repair/retry, physical storage disposal and credential-provider revocation remain disabled or external-review-only. No newly privileged commands were introduced.
- Authenticated browser/Qt tests and real S3/NAS generation fencing remain open.

## Next execution

Provision Node 24, PostgreSQL 18 and a disposable Windows VM. Compile the full source, test fresh migrations, exercise true MSI fault boundaries and multiple-account permissions. Continue G27 only after recording known G26 certification risks separately; do not claim all of G26 is certified from Linux/Go source tests.
