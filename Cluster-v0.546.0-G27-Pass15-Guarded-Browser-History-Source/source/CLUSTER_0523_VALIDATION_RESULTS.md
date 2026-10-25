# Cluster v0.523.0 source validation

- **PASS:** 72/77 source assertion scripts passed using Node 22 + temporary globally-installed TypeScript. This includes **23/23 new cross-layer assertions**, Package device receipts/reconciliation, native API wiring, existing Packet/PDF/Library security checks and historical source tests.
- **5 inherited failures, independently reproduced on the untouched v0.522 archive:** `wip57-pass2`, `wip57-pass3`, `wip57-pass4`, `wip57-pass8`, `wip57-pass15-admin-project-types`. These old scripts contain preexisting source reconstruction/toolchain/Discord/runtime expectations and are **not new v0.523 regressions**. They remain unresolved rather than silently excluded.
- **PASS:** native Go `go test ./... -count=1`, including valid five-entry staging-kit import, read-only stage audit, changed bytes, extra files, incorrect identity/fingerprint, unstaged-but-signed inputs and active pointer immutability.
- **PASS:** Go Windows/amd64 staging helper cross-compiled with `CGO_ENABLED=0` and recognized as a Windows PE32+ binary. **Not executed under Windows**.
- **OPEN:** Qt/C++ build and Desktop UI runtime; Node24 full dependency-backed semantic TypeScript/Prisma build; PostgreSQL/migration, Windows trust-directory/ACL semantics, native PDF/Sharp/Canvas processing, client-server live revocation and OS installation certification.
