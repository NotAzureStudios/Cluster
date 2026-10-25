# TD3 Pass 3 Validation

Source-only checkpoint. Commands run against the updated full source:

```bash
npm run techdebt:td3:ui-primitives
npm run techdebt:td3:css-contract
npm run techdebt:td3:material-portal
npm run techdebt:td3:modal-focus
npm run techdebt:td3:visual-fixture
npm run techdebt:td3:shell-visual
# Strict helper compilation:
tsc --strict --noEmit --lib es2022,dom --target es2022 packages/renderer/src/core/dialog-focus.ts
```

In addition, the exact 45 inherited Pass 2 commands were replayed and their results captured in `TD3_PASS3_INHERITED_REGRESSION_RESULTS.json`. The isolated browser modal test compiles the real TypeScript helper before evaluating its keyboard behavior, but does not mount React. The static CSS browser tests load the actual renderer stylesheets and verify computed browser values rather than only checking text substrings.

Screenshots are reference-only fixtures under the separate visual-preview artifact; do not substitute for a compiled server or native Qt application screenshot. See `TD3_PASS3_SHELL_VISUAL_METRICS.json` and the Pass 2 visual metrics. Generated screenshots, package and source manifest checks are included in handoff evidence.
