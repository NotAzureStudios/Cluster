# Cluster v0.521.0 validation

- **PASS:** 55/55 source assertion suites, including positive and negative image source-policy and text-file-to-PDF paths.
- **PASS:** native Go stager tests (`go test ./... -count=1`, unchanged source).
- **PASS:** simple version-naming tests (5/5).
- **PASS:** 964 TS/TSX syntax parse checks, zero errors.
- **PASS:** 4,148 relative TS imports inspected; one unresolved generated Prisma client in the lean source package.
- **PASS:** 108 CSS files, zero delimiter errors.
- **Not tested:** real sharp/libvips image decode/encode; image tests use mocked decoder, PDF tests mock PDF renderer.
- **Not tested:** full semantic TypeScript build with dependencies + generated Prisma, PostgreSQL migration/transaction runtime, Qt6/MSVC Windows runtime, native OS installation/rollback/health attestation.
- **No migration:** `PacketReleaseDerivative` already carries arbitrary format identifiers and detached bytes; this pass uses a new safe WebP format with explicit server validation.
