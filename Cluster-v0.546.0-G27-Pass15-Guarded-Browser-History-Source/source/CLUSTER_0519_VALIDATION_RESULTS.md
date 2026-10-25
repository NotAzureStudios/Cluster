# Cluster 0.519.0 validation

- Baseline: full verified Cluster v0.518 source tree. Authoritative Pass 15 changes retained.
- Source test suites: **35/35 passed**, using Node 22 `--experimental-strip-types` plus a disposable local symlink to globally installed TypeScript. The symlink was removed. Production policy specifies Node 24.20.
- Focused new native kit integration assertions: **16/16 passed**, including real Go CLI invocation with independent Ed25519 pin and strict rejection of missing pin, wrong pin, altered ZIP and unauthorized member names.
- Go stager: `go test ./... -count=1` passed.
- Current TS/TSX static syntax parse: **961 files, 0 parse diagnostics** (includes runtime renderer/server; historic recovered sources excluded).
- Current relative imports: **4,125 checked, one absent generated Prisma client** (`apps/server/generated/prisma/client.js`); no other unresolved imports.
- CSS: **108 files, zero delimiter issues**.
- Full Qt/MSVC compile, live device/session/OS behavior, PostgreSQL schema/runtime, full dependency-backed semantic TypeScript build, actual OS installation and independently attested device health **not tested**.
- The Qt native Desktop source contains a capability implementation and QProcess integration only; there is no prebuilt certified Desktop executable in this source archive.
- Source manifest, incremental patch replay and ZIP integrity: verified during packaging.
