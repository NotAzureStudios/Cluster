# G26 handoff: Vault atomic security evidence → runtime certification

**Authoritative baseline:** `Cluster-v0.546.0-TD6-G26-Atomic-Vault-Audit-Source.zip` (replaces the Credential Disclosure Audit & Custody checkpoint).

## Preserve

- Credential plaintext reveals require confirmed persisted audit **before** disclosure and post-audit reauthorization. Do not switch back to best-effort security logs.
- Standalone Vault creates, edits, revocations and independently reviewed rotation transitions require a security audit write in the **same Prisma transaction**. Any audit error must roll back the mutation.
- Two-person independent Vault rotation, `ACTIVE` recipient checks, offboarding closure, controlled Inventory issuance, Library retention, media descriptor checks, and source/distribution separation remain required.
- Physical provider disposal and automatic MSI recovery remain blocked.

## Next execution plan in a provisioned environment

1. Install the declared Node.js **24.20.x** toolchain and exact pinned dependencies; generate Prisma. This lean ZIP does not include `node_modules`, the generated Prisma client or a dependency lockfile. Record `node -v`, `npm -v`, dependency resolution, `tsc` output and migration checks; do not mark a source scan as a compile.
2. Bootstrap a disposable **PostgreSQL 18** database with all migrations, including prior G26 Vault rotation/credential reminder migrations. Exercise the actual `recordSecurityInTransaction` writer under forced audit insertion failures (rollback all six mutation actions), concurrent independent approvals, stale revision updates, and concurrent Vault revocation/reveal. Verify audit chain integrity before and after failures.
3. Verify the **3-stage review** under two authenticated admins: independent second actor, requester-only commit, no secret-bearing audit payload, stale expiry handling, no unlogged writes after injected audit storage failures.
4. Continue Windows MSI launch/power-loss/reboot acceptance, Qt Desktop parity, provider-generation fencing, and real NAS/S3 custody tests. These are release-blocking but were not touched in this pass.

## Certification truth

This checkpoint is a **development-source implementation**, not a certified release. Do not mark G26 source fully closed or production-ready until real Node/PostgreSQL/Windows acceptance establishes the missing guarantees.
