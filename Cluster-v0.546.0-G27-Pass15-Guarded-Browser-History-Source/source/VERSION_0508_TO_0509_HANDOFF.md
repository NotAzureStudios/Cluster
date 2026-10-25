# Cluster v0.508 → v0.509 | Development-source milestone handoff

## Trusted continuation base
- v0.508.0 source archive: `Cluster-v0.508.zip`
- This source checkpoint: `Cluster-v0.509.zip` with `Cluster-v0.509.patch` for independent replay.
- Workstream: v0.508 People, Forms, Packets, Inventory and Vault. v0.509 starts Work System convergence.

## Implemented this pass
1. Form schema identity checks (duplicate case-insensitive keys/options), selection/acknowledgement/type/date/length validation, signed-in and public current published/accepting-version checks.
2. Immutable hashed Packet source manifests in a repeatable-read publication transaction, author-only list and publish action. **Not** derived deliveries or entitlements.
3. Inventory PostgreSQL models, validated assets, row-locked capacity allocation and active uniqueness, admin UI, confirmed revoke, People offboarding physical-return preview/gate and transactional allocation revocation.
4. Vault encrypted records with purpose-bound ciphertext, safe list projection, audit records, administrative routes and one-time fresh MFA plus confirmation before reveal. Metadata-only + create UI, with protected rotate/reveal APIs.
5. Updated release continuity and feature ledger, version manifests to 0.509.0.

## Tests and limitations
- Test scripts: `cluster-0508-foundations-assertions.mjs`, `cluster-0508-route-runtime-assertions.mjs`, `cluster-0508-people-provisioning-assertions.mjs` plus 12 inherited 0.507 focused suites.
- Static validation script scans repository TS/TSX, relative imports and CSS.
- Mock runtime and source tests do **not** prove complete runtime behavior. Full build requires Node 24.20+, installed React/JSX and generated Prisma client, plus an actual PostgreSQL server.
- Migration `20261008190000_inventory_vault_foundations` is new and **not yet applied**, Prisma client **not generated**. No Windows EXE rebuilt.
- The v0.506+ source lineage has **not** been conflict-merged with authoritative Pass 14/15. Never overwrite that source.

## Open highest-risk work
- Seat allocation and user-offboarding race across separate transactions; test concurrent assignments, issuance and offboarding on PostgreSQL.
- Vault reveal requires complete authenticator UI, independent policy review, recovery/re-encryption and logs-redaction tests.
- Packet source manifest is not physical frozen delivery; no recipient may receive direct Library source access by possession of a Packet.
- User/account lifecycle and scoped grant administration need further integration.
- Cross-workspace command/query/notification/undo authority is v0.509's main objective.
