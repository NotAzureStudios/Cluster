# v0.541 → v0.542 handoff

Base source: `Cluster-v0.541.zip` (exact archived baseline). Output: `Cluster-v0.542.zip` and patch.

## Inventory scope

One subsystem only: commercial game/license-key pools. Admin Inventory UI and server routes now support pool creation and lifecycle, encrypted Vault-backed batch import, duplicate rejection, per-key assignment, redemption/revocation, privileged reveal, and paginated listings. Key/Vault schemas use migration `20261010192000_inventory_commercial_key_pools`. Do not weaken the key-pool state machine by enabling generic Vault reveal/rotation for linked secrets. Ordinary Inventory records, legacy Vault standalone secrets, and Windows managed file updater are preserved.

## Security invariants

- Vault owns secret bytes and encryption; Inventory stores fingerprints, relationships and lifecycle only.
- Pool imports are atomic and revision-bound; no partial secret/key inserts on failure.
- Lists exclude plaintext, ciphertext, key fingerprints and Vault foreign IDs.
- No reveal unless assigned, pool active, recipient eligible, secret unrevoked/unexpired, and privileged confirmation granted; audit occurs before disclosure.
- Revocation updates Inventory state and revokes the corresponding Vault secret in the same transaction.
- An administrative assignment is not provider-redeemed and does not grant external user self-service access.

## Testing boundary / next work

Source-level route simulations and inherited regressions ran; see `CLUSTER_0542_VALIDATION_RESULTS.md`. Actual Prisma migration, full dependency-backed compile, PostgreSQL contention and native/browser behavior remain outside this checkpoint. Next feature-completion priority should be chosen from untouched master-ledger areas, rather than another incremental Inventory micro-pass, unless runtime evidence reveals a critical bug.
