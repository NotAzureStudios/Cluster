# Cluster v0.546.0 | TD6 G26 Batch H
## Grouped Offboarding Credential Settlement + Approval Closure + Administrator Reconciliation

**Parent:** `Cluster-v0.546.0-TD6-G26-BatchG-Credential-Lifecycle-MSI-Operator-Review-Source.zip`.
**Stage:** source implementation and mock-driven regression checks, **not** production certification.

### Why this batch exists
Batch G delivered warnings, but executing existing studio offboarding only revoked digital seat allocations and device Package pins. It did **not** close assigned commercial keys, their Vault reveal authority, approved Package entitlements or outstanding issuance/review requests. Disabling an account is not an adequate substitute for recording credential disposition. Some old approval jobs can also race with an account being disabled.

### Implemented as one offboarding transaction

- Canonical `studio-offboarding-routes.ts` invokes `settleOffboardingCredentials` **inside** the existing offboarding transaction, and records its counters in the case outcome and its personnel record.
- Acquires the recipient `User` row lock. Inventory request/review and Package request/review paths acquire the same row lock before checking a person and granting/regranting access. Transactions block/revalidate instead of trusting a stale active-user read.
- Revokes assigned commercial key records, closes linked Vault secret reveal authority, records actor/reason/revision, and **does not** restore keys to available inventory. Already revealed values require separate provider-side review.
- Revokes Package person-level entitlements, cancels pending Inventory and Package grants, and dismisses their in-app actionable review tasks. Physical asset allocations and separate standalone Vault credentials are not automatically transferred or rotated.
- For previously revealed keys, creates admin-only high-priority Inbox tasks for the verified active owner/admin roster, inside the same transaction. No ciphertext, key IDs, fingerprint or Vault IDs are copied into notices. Fails closed if the recipient roster cannot be verified.
- Adds a bounded, administrator-only `/api/studio-systems/offboarding/:caseId/credential-review` on-demand inspection for completed cases. Checks actual remaining seats, keys, Package entitlements, device pins and pending requests, preserving historical exposed-key and legacy-evidence warnings. No automatic mutation from an inspection.
- Extends the existing offboarding impact preview and completion UI with counts and external-provider caveats.
- **No migration.** Retains the Batch B/G migrations, existing security gates, and immutable offboarding history.

### Boundaries / open issues

- Max 1,000 assigned keys and 1,000 pending requests **per type** per transaction. Overflow fails explicitly. Live PostgreSQL concurrency and actual scale testing remain outstanding.
- External license/platform key redemption and remote revocation cannot be proven by Cluster. Revoking a Vault pointer cannot retract a key revealed to a human. External provider workflows must be handled separately.
- Standalone Vault credential rotation remains a manual, confirmed admin workflow; no automatic credential distribution/rotation to third-party systems.
- Offboarding physical equipment remains in custody pending a separate return/transfer/write-off record.
- No Windows MSI installation or recovery behavior changed in this batch; read-only native recovery protections from Batch G are preserved.
- Provider-fenced destructive storage reconciliation remains intentionally disabled.
- Live Node 24 compilation with installed packages, generated Prisma client and PostgreSQL 18, authenticated browser/role testing and Windows/Qt acceptance are still required.

### Verification instructions

```sh
npm run cluster:td6:g26:batch-h
npm run techdebt:td5:source-closeout
npm run techdebt:td6:source-scan
```

The new focused script tests settlement, Key/Vault governance, cancellation, out-of-scope fail-close, independent closure review, admin-only warnings, and source-level integration. Inherited G26 Batch G and TD5 tests should remain green. These are not live database tests.
