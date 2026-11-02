# Cluster 1.0 | Source convergence and release admission

**Audit date:** 2026-11-02  
**Working branch:** `fix/1-0-unified-password-release-admission` targeting `development`.  
**Release identity:** `1.0.0-rc.50` in `config/release-candidate.json`, source `0.546.0`.

## Authority and evidence

- The GitHub `development` tree is the current **code integration baseline**. `main` is reserved for reviewed promotion.
- Historical RC73/RC74 source bundles are **not** an authoritative wholesale replacement for GitHub.
- PDF/3D viewer fixes from verified RC73 were selectively ported in PR #18. The entire RC73 and RC74 source differences remain **unreconciled**.
- This working environment does **not** have the original full RC74 archive. A path-by-path comparison therefore has **not** been performed; do not infer that RC74 transfer, viewer or UI changes are fully present.
- Existing security, signed-update staging, database safety, native installer and transfer improvements from PRs #9, #11, #13, #18 and #19 must be preserved during any future import.

## Changes in this branch

### Security

- Removes the privileged one-character password exception. All new Owner, admin, member, contractor and guest account passwords are checked against the same **12–1024 Unicode-codepoint** constraint.
- Updates initial localhost-only Owner setup, ordinary password setup and administrator-set-password routes.
- Updates UI hints and minimum lengths for initial setup and required password changes.
- Deletes the unused privileged-membership password bypass helper, without changing PIN handling.
- Preserves existing-password login verification, rather than making old password hashes suddenly unverifiable. Existing credentials and role-specific MFA enrollment must still be tested live.
- Adds regression checks for Unicode length, privilege spoofing, the old third-argument bypass, and setup/route/UI consistency.

The 12-character baseline removes a serious existing privilege exception but **does not by itself certify compliance** with NIST's 15-character recommendation for password-only authentication. MFA policy enforcement and final password length policy still require separate release review.

### Release build integrity

- `tools/scripts/cluster-platform-release.mjs --build` now requires a valid root `package-lock.json` with matching package identity/version.
- The build invokes `npm ci --no-audit --no-fund` **before** the selected target build, and fails closed if that clean install fails.
- Source-only `--list` / `--profile` planning still works without installing dependencies or claiming certification.
- Regression tests verify the ordering and failure guard. All build receipts remain `signed:false` and `certified:false` until independent release evidence is supplied.
- The tracked npm lockfile is **not yet available**. This pass must not fabricate one or claim a full build.

## Required verification

| Gate | State | Evidence required |
| --- | --- | --- |
| Password policy source fixes | Implemented in working branch | Node 24 role-policy and native installer checks in CI |
| Server / Qt / Web full build | Blocked | Validated lockfile, clean `npm ci`, full Windows toolchain |
| RC74 differences | Blocked | Original manifest-verified complete RC74 archive |
| Fresh Windows install / rollback | Unverified | Clean-machine install, update and fault-injection logs |
| PostgreSQL 18.6 restore | Unverified | Independent recovered database plus Library/config/secrets integrity |
| Authentication and MFA | Unverified | Live Owner/admin/member flow, role changes, recovery and revocation |
| Library / Transfer / media | Unverified | Authenticated browsers, ZIP/PDF/3D, resume, truncation, permissions |
| Endurance & performance | Unverified | 24-hour runtime with request, memory, worker and SSE metrics |

**Safe commands on a provisioned checkout:**

```sh
node --disable-warning=ExperimentalWarning tools/scripts/cluster-password-role-policy-tests.mjs
node tools/scripts/cluster-native-server-install-experience-tests.mjs
node tools/scripts/cluster-platform-release-tests.mjs
node tools/scripts/cluster-rc-preflight.mjs
```

The last command is a source-candidate preflight, **not** release certification.

## Next integration sequence

1. Review/merge this branch into `development` only after source CI is green. Never force-push `main` or replace an entire checkout with a historical ZIP.
2. Obtain the original RC74 complete source and its verified manifest, compare each source path against current `development`, port missing changes and document intentional omissions.
3. Generate and validate `package-lock.json` on pinned Node/npm with real registry access, then run clean full Server/Web/Qt/Go builds.
4. Finish signed executable distribution and supervised update apply/recovery.
5. Execute PostgreSQL/Library backup restore, multiuser permission checks, file-transfer recovery and Windows endurance certification.
6. Advance the release identity only when the source SHA, artifact receipts and tested binaries agree.

No release was built, installed, published or certified by this source pass.
