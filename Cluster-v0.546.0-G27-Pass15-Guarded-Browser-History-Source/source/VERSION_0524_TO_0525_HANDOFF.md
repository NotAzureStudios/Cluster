# Cluster v0.524 → v0.525 handoff

**Baseline:** v0.524.0 full source ZIP, no active instances or compatibility requirements. **Result:** v0.525.0 full source ZIP and reproducible source patch.

## What actually changed

- Native helper: `audit-managed` verifies current or recorded previous managed copies against a freshly supplied, independently signed release kit, without grant consumption or state writes.
- Qt: fixed Go/Qt result field mismatch (`artifactSha256`) so successful managed copy and rollback are recognized; added audit command, output parsing, and meaningful UI status.
- Desktop: on-demand managed-copy auditing and one-time in-memory follow-up rollback receipt reporting to close an existing selection event chain.
- Integration: Go negative security tests plus TypeScript-signed artifact end-to-end native smoke; targeted TS receipt chain tests.

## Next engineering decisions

1. Finish supervised OS installation only after a **separately provisioned service trust root**, fresh device/entitlement authorization at point of mutation, explicit managed install allowlist, verified activation/health, recovery journal and reversible OS-level rollback are designed and tested. A signed ZIP or user-controlled Qt config is not an OS install authority.
2. Run actual Qt6 Windows build and multiple-client Windows NTFS/ACL/locking and PostgreSQL transaction/regression certification.
3. Continue substantial feature ledger: collaboration, Undo/Redo, Library/Admin/UX, Packet audio/video adapters. Avoid another series of narrowly scoped Package-only iterations.

**Note:** Failure to issue a rollback grant when a previous release is no longer an authorized target remains intentionally fail-closed. Recovery policy needs explicit design, not implicit bypasses.
