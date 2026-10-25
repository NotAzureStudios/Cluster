# G26: transactional audit export → actual PostgreSQL/Windows acceptance

Use `Cluster-v0.546.0-TD6-G26-Audit-Snapshot-Consistency-Source.zip` as the new development baseline. Do not revert any Batch A–H, Vault, Library, Package, MSI, or media authority safeguards.

## Immediate real-runtime test plan

1. Obtain a disposable Node 24.20.x + PostgreSQL 18 deployment, restore a pinned dependency lockfile and generated Prisma client, and run a full TypeScript build.
2. Seed 1,000+ chained audit entries, then concurrently append new entries during filtered export. Verify that `events`, `integrity.totalEvents`, `lastSequence`, and `tipHash` describe a single snapshot and the response digest verifies. The later `security.audit_exported` append must be outside that captured snapshot.
3. Force a snapshot start timeout, transaction timeout, lost connection, and corrupted metadata. Ensure no export body or SHA header is returned. Force the *subsequent* audit-write failure separately and verify a no-data 503.
4. Test damaged chains, unsupported integrity versions, filtered queries matching zero events, and large chains nearing the 30-second transaction bound. Measure memory and database impact; do not silently downgrade to nontransactional reads.
5. Retest independently reviewed Vault replacement during concurrent approvals, offboarding and real DB errors.
6. Resume remaining G26 blockers: Windows MSI repair/reboot attestation, verified external secret-provider revocation, generation-fenced physical-storage cleanup and browser/Qt acceptance. Keep unsafe automatic destructive actions disabled.

**Source implemented != production certified.** No Node 24/PostgreSQL 18/Windows acceptance claims in this handoff.
