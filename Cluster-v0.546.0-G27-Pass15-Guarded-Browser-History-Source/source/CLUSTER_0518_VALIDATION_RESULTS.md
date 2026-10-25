# Cluster 0.518.0 validation log

- Source base: complete, verified `Cluster-v0.517.zip`.
- Source-level test scripts: **34/34 passed** with Node 22 `--experimental-strip-types` and a temporary link to globally installed TypeScript; production's Node 24.20 is still the prescribed runtime. The temporary test link is omitted from the archive.
- New v0.518 manual kit / Go integration assertions: **8/8 passed**.
- Native Go verifier/stager: `go test ./... -count=1` passed.
- TypeScript/TSX static syntax parse: **961 TS/TSX files, 0 syntax errors**.
- Relative-import scan: **4,237 relative imports, 1 unavailable generated Prisma client**.
- CSS delimiter scan: **108 CSS files, 0 delimiter errors**.
- Source SHA-256 manifest: **VERIFIED**.
- Incremental patch replay: **VERIFIED**.
- ZIP verification: **VERIFIED**.
- Does not include a full semantic TypeScript/Prisma build, real database migration tests, Qt6/MSVC Windows build, or device installation/rollback certification.
