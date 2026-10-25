# TD1 Pass 9 Validation

- Baseline: TD1 Pass 8 full source ZIP.
- Changed areas: shared Project Calendar contract, server Project setting service/admin API, Prisma schema/migration, Tool Config editor, Settings provenance test wording, new parent-lock regression suite, inherited Project route test, package script.
- `npm run techdebt:td1:project-lock`: 10/10 new cases.
- `npm run techdebt:td1:project-inheritance`: 15/15 inherited/extended cases.
- `npm run techdebt:td1:user-inheritance`: 12/12.
- All 15 `techdebt:*` test scripts (excluding static scanner): passed, combined 142 targeted assertions.
- `npm run tool:registry:tests`: 9/9.
- `npm run techdebt:source:static`: 993 TS/TSX, zero syntax diagnostics; one unresolved generated Prisma relative import (not included in lean ZIP).
- Isolated strict shared-contract TypeScript compile: success.
- No full dependency-backed Node 24 app build, PostgreSQL migration/runtime or Windows/native validation. Native EXE unchanged.
