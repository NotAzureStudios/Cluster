# Cluster G26 Batch H → Next Group

**Canonical input for next development session:** `Cluster-v0.546.0-TD6-G26-BatchH-Offboarding-Credential-Settlement-Source.zip`.
**Parent:** G26 Batch G. **State:** Batch H source implementation and local tests complete; G26 not closed, no production certification.

1. Offboarding now settles assigned Inventory keys + linked Vault secret reveal access, person-level Package entitlements, and pending Inventory/Package approvals in its existing atomic transaction. Existing digital seat/Package pin/identity/session protections remain.
2. Inventory and Package issuance now lock the recipient User row before authorization checks. The offboarding transaction locks that same User row before credential revocation.
3. Admin-only post-offboarding inspection provides bounded counts, residual access indicators, and legacy-evidence/exposed-key flags; it cannot remediate or disclose secrets.
4. Previously revealed commercial keys generate transactional owner/admin Inbox tasks for external revocation/rotation review. Already disclosed values cannot be clawed back. Role downgrade hides these tasks.
5. Bounded failures (keys/requests/admin roster/devices) fail closed. No schema migration or native binary change in Batch H.
6. Source scans, G26 inherited checks, the focused settlement suite and TD5 source closeout pass. **No live DB/OS/browser runs.**

**Next grouped milestones:** (1) independent reviewed Vault rotation/replacement and externally confirmed key disposition; (2) provisioned Windows MSI repair/rollback/restart recovery, device attestation and signed receipt acceptance; (3) provider-generation-fenced storage reconciliation/dynamic retention inheritance. Prioritize a real dependency-backed Node 24 and PostgreSQL 18 acceptance environment over accumulating theoretical guards. Do not enable destructive disposal by default.
