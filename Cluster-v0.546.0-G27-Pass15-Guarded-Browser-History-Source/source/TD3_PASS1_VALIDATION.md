# TD3 Pass 1 validation

**Date:** 2026-10-12. **Node:** 22.16.0. **Checkpoint:** TD3 Pass 1 from TD2 Pass 23.

- **43 / 43** complete inherited-plus-new regression commands PASS. Details in `TD3_PASS1_REGRESSION_RESULTS.json`.
- **33 / 33** focused executable TD3 test cases PASS; **40** generated Qt/Web token values checked exactly (20 roles × 2 modes).
- Qt generation **--check** PASS. `Theme.qml` consumes generated values; native singleton registration reviewed in source.
- Focused `tsc --noEmit --strict` for modified appearance/accessibility core PASS.
- Static syntax audit: **0 errors across 994 TS/TSX files**; one unresolved relative import into the omitted generated Prisma client, unchanged from source-only parent.
- Live browser visual/density/mobile screenshot matrix: **NOT RUN**. Qt/Windows build and DPI checks: **NOT RUN**. Full Node 24 dependency-backed build: **NOT RUN**. Production deployment: **NOT CERTIFIED**.

The passing matrix does not substitute for native/widget visual and accessibility certification. TD3 remains OPEN.
