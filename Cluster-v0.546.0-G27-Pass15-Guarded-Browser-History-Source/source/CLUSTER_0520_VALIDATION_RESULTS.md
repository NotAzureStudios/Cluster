# Cluster 0.520.0 validation and limitations

- **52/52 regression assertion scripts passed** (including new v0.520 checks; Node 22 strip-types with disposable TypeScript test dependency)
- **PASS** (`go test ./... -count=1` native Go stager)
- **PASS, cross-compile only** (Go Windows AMD64 PE helper rebuilt from v0.520 source; not runtime executed on Windows)
- TypeScript/TSX parsing: **963 TS/TSX source files, 0 parse diagnostics**
- Relative source imports: **4,240 checked, one absent generated Prisma client**
- CSS delimiter parsing: **108 CSS source files, zero delimiter errors**
- Source SHA-256 manifest: **VERIFIED**
- Incremental text patch byte-for-byte replay against exact v0.519 source: **VERIFIED**
- Full ZIP integrity: **VERIFIED**
- **Not certified:** full semantic TypeScript + generated Prisma build, real PostgreSQL bootstrap/migration, Qt/MSVC Windows executable, native installation/rollback, OS attestation, actual multi-user runtime load tests.
