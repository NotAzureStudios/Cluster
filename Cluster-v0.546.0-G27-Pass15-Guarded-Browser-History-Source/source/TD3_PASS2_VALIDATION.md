# TD3 Pass 2 validation

Source baseline TD3 Pass 1. Validation commands are recorded in `TD3_PASS2_REGRESSION_RESULTS.json`.

- `node tools/scripts/cluster-td3-ui-primitives-tests.mjs`: 33 focused interaction/source checks.
- `node tools/scripts/cluster-td3-css-contract-tests.mjs`: 9 CSS ownership, focus and readability checks.
- `tsc --strict --noEmit --lib es2022,dom --target es2022 packages/renderer/src/components/cluster-menu-navigation.ts`: passed.
- `python tools/scripts/cluster-td3-visual-smoke.py`: optional fixture-driven local Chromium smoke; 4/4 mode/width combinations passed, no horizontal page overflow. Results in `TD3_PASS2_CHROMIUM_VISUAL_METRICS.json`; actual screenshot images distributed separately. Requires Python Playwright and Chromium, does not compile or render the real app.
- Inherited TD0/TD1/TD2 and TD3 tests: run the test matrix and read `TD3_PASS2_REGRESSION_RESULTS.json` for the authoritative counts.
- No real Node 24 dependency build, installed Prisma client, Qt native build, Web/Qt application screenshots or user-driven keyboard/screen-reader certification. TD1/TD2 live certification remains postponed by request.
