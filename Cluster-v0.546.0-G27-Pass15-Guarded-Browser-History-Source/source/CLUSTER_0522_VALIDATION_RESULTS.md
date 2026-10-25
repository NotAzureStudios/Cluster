# Cluster v0.522.0 validation

- **PASS:** 58/58 source-level regression scripts, including 19/19 Pass15 reconciliation assertions after the Admin context fix.
- **PASS:** new Packet source-PDF tests (9/9, mocked PDF.js/Canvas/Sharp/PDF-lib); existing text/image adapters and recipient routes pass inherited security assertions.
- **PASS:** `go test ./... -count=1` for native staging, signed selection, rollback-pointer and read-only stage-audit integrity.
- **PASS:** cross-compiled updated Go helper for Windows x64 from source (not executed on Windows).
- **PASS:** TypeScript/TSX active source AST parse 966 files, 0 parse diagnostics; 4,246 relative imports, only absent generated Prisma client unresolved; 108 CSS, no delimiter errors.
- **OPEN:** Full dependency-backed `tsc`/Prisma generation, actual native PDF.js + canvas + sharp on Windows, hostile PDF corpus, worker isolation, real PostgreSQL + Qt + Go Windows runtime and actual supervised OS package installation.
- **Schema:** No new Prisma migrations; PacketReleaseDerivative already stores detached format `pdf` and bytes. Out-of-transaction conversion with commit-time frozen source-manifest check remains required.
