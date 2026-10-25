# Cluster 0.517.0 source validation

- Baseline: full uploaded `Cluster-v0.516(1).zip`, preserving authoritative Pass 15 reconciliation.
- Inherited regression suites: **31/31 passed**.
- Previous device-receipt assertions: **34/34 passed**.
- New Package reconciliation assertions: **21/21 passed**, including route authorization and paged report projection.
- Total source/mock-route test scripts: **33/33 passed**.
- Native Go package-stager: `go test ./... -count=1` passed, unchanged.
- Standalone TS/TSX syntax parsing: **959 files**, **0 syntax errors** (modern application/source tree, excluding `recovered/`).
- Relative-import scan: **4,119 links**, **1 known unavailable generated Prisma client** (`apps/server/src/generated/prisma/client.js`). No newly unresolved source link.
- CSS delimiter scan: **108 files**, **0 errors**.
- Prisma schema unchanged. No migration introduced.
- Tests ran on environment Node 22 rather than product-required Node 24.20; full semantic TypeScript compilation, PostgreSQL, Qt, Windows runtime and real end-to-end deployment remain **unverified**.
- ZIP/source-manifest/patch replay checks are performed after final packaging, independently from feature tests.
