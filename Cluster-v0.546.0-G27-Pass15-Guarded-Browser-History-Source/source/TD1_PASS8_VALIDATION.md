# TD1 Pass 8 Validation

- **Baseline:** TD1 Pass 7, source-only v0.546.0.
- **New:** `techdebt:td1:user-inheritance` checks effective precedence, null-reset, concurrent Account saves, unauthorized patch, and Calendar UI/server wiring.
- **Inherited:** TD0 correctness, TD1 Settings authority and all TD1 subpasses, TD2 timers/queues/subscriptions/Library retention, canonical Tool Registry, and source scanner.
- **Source parser:** 993 active TS/TSX files, 0 syntax diagnostics; 1 expected missing generated Prisma relative import (lean archive).
- **Targeted shared typecheck:** `tsc --noEmit --skipLibCheck --strict --target ES2022 --module NodeNext --moduleResolution NodeNext` on `tool-settings-contract.ts` and `project-tool-setting-contract.ts` passed.
- **Limitations:** Most route tests use schema/storage mocks rather than actual Zod, Fastify and PostgreSQL. Full dependency-backed build with Node 24/Prisma client, migration bootstrap, multi-process event propagation, browser/Windows acceptance and resource benchmarks remain outstanding.
- **Package:** Source SHA manifest, ZIP CRC integrity and patch replay will be verified against exact TD1 Pass 7 source before release.
