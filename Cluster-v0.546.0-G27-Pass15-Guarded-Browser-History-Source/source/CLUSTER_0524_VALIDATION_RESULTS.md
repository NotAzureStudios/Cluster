# Cluster v0.524 source certification ledger

- **73/78 source assertion scripts passed** in the lean Node22 test environment using an ephemeral global TypeScript link. The same five historical WIP57 assertions fail as in v0.523; no newly introduced failures after version contract metadata was synchronized.
- **10/10 targeted signed-grant assertions passed** including control-key absence, 60-second grant expiry, canonical signed payload and independent fingerprint verification, unique grant nonces, nonattested device report advancement and live device authorization source integration.
- **Go tests passed**, including new rollback/deployment negative cases for replay, expired/wrong signed grants, symlinks and tampered copied contents.
- **Real cross-language integration passed:** a TypeScript-issued grant and Ed25519-signed Package ZIP were accepted by a compiled Go verifier, copied to the managed root and atomically selected; a second use of the grant was refused.
- **Windows x64 helper cross-compiled**, recognized as PE32+; not executed on Windows.
- **No Prisma schema change or migration** in this pass. Native Qt compilation, PostgreSQL runtime, Windows file ACL/lock/rename testing and dependency-backed semantic build remain open.
- The new managed-content copy is **not** system software installation; no executables run, OS package directories change, privileged services restart or health attestations are claimed. Separate pinned trust is per-user rather than hardware-backed, and there is an up-to-60-second online revocation window for already issued bearer grants.
