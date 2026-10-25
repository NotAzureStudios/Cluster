# Cluster 0.523 | Native Package trust enrollment, nonmutating stage re-audit and truthful receipts

## Implemented end-to-end source slice

1. **Native Desktop trust onboarding**: Device Packages now expose a native, per-server-profile trust status and a manual operator fingerprint-enrollment dialog. The renderer can only request the dialog; it never supplies a key, fingerprint, path, or replacement flag. Qt requires a signed-in, online Desktop profile, independent 64-character DER/SPKI SHA-256 fingerprint entry twice, explicit approval for changes, unchanged server profile/session before commit, symlink guards and `QSaveFile` atomic publication with restrictive user permissions. Trust lives in the existing per-profile `package-trust/<profile>.pin` store. This is user-local configuration, **not tamper-proof system trust**.
2. **Native staged-content re-audit**: Go `--action verify-stage --kit ...` reopens an approved five-entry signed kit, validates the out-of-band signing-key pin and exact selected Package identity, re-hashes the frozen ZIP against every staged file, rejects missing/modified/extra/symlink content and emits structured `CLUSTER_STAGE_AUDIT_RESULT`. It never changes a selection pointer, activates, installs, executes or sends an OS-health claim. Qt provides an explicit audited-content file-picker workflow and matching native status, while the renderer displays it without emitting Package staging receipts.
3. **Honest deployment status contract**: The server no longer permits the fabricated `activated` device report state. The remaining states describe offered artifacts, verification, staging, local content selection, selection rollback or failure, all still self-reported. Rollback is valid only after a selected-content report, not after a failed stage. Admin reconciliation distinguishes `reported_selected` from progress without claiming installation. Staging receipts remain bound to current authenticated device proof and one-time nonces.
4. **Regression coverage**: Existing tests updated for this intentional breaking state contract (no active deployments require compatibility). New Go tests cover read-only identity checks, real signed staging kits, tampered files, extra files, and pointer immutability. New assertions verify C++/renderer capability and authorization separation.

## Not delivered or certified

- **No OS installer:** Native helper still stages or audits inert content and optionally maintains a local content-selection pointer. Nothing executes a binary or modifies a user's arbitrary directories.
- **No server-issued activation authorization:** Stager cannot yet cryptographically verify that current server rollout/entitlement remains valid at an OS deployment boundary. Native activation must stay disconnected from UI until that exists.
- **No platform certification:** Qt Desktop Windows compilation/runtime, Node 24/Prisma dependency build, live PostgreSQL, native image/PDF libraries and OS attestation still require certification.
- Historical WIP57 tests with obsolete assumptions remain failing on **both** 0.522 and 0.523 source (not newly introduced).

## Next connected batch

Build an independently signed short-lived deployment authorization grant, bound to current device registration and exact Package digest and revocation generation, with verifiable server key trust *separate* from Package signing. Then implement an unprivileged, policy-limited managed-content installer and safe rollback/repair under a dedicated managed root; validate Qt, Windows ACL/locks/restarts, PostgreSQL and multi-device revocation. Do not permit arbitrary executable/package scripts before OS-level trust and rollback are proven. Resume broader Work/Library/UX roadmap afterwards.
