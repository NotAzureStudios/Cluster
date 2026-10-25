# TD6 G01 verification (source-level)

- 14/14 newly introduced grouped Inventory/People/key lease assertions (route harness + source integration).
- 31/31 inherited Inventory suite, 44/44 inherited key-pool suite, 10/10 inherited v0.508 Vault/Inventory/offboarding routes, 32/32 v0.508 foundations.
- 11/11 individual F01–F11 focused scripts passed in the grouped source.
- TypeScript/TSX syntactic parsing, renderer relative imports and CSS delimiter checks pass; detailed metrics in adjacent integrity report.
- This is not a full dependency-backed TypeScript compile, Prisma migration execution, PostgreSQL concurrency test, Windows/Qt runtime, or official release certification.
- The local test runner temporarily linked a globally-installed TypeScript dependency. `node_modules` is not packaged.
- Source behavior added: digital lease issue/renewal/expiry reclamation, timed key access/disclosure evidence, offboarding physical custody preservation, recipient/admin views, and an on-demand Inventory attention overview.
