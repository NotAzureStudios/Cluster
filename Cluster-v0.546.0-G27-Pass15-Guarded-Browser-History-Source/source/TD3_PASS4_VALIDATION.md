# TD3 Pass 4 — validation

- New inspector source contracts: **22/22 passed** (`node tools/scripts/cluster-td3-inspector-surface-tests.mjs`).
- New static Chromium visual/layout scenarios: **10/10 passed** (`python tools/scripts/cluster-td3-inspector-visual-smoke.py`), dark and light desktop/phone, tablet, Flat, Glass, high contrast, 125% and 150% simulated DPR.
- Inherited executable regression commands: **45/45 passed** (`TD3_PASS4_INHERITED_REGRESSION_RESULTS.json`).
- TD3 Appearance: **33/33**; shared UI primitives: **33/33**; CSS ownership: **9/9**; Material/Modal: **12/12**; executable modal focus: **6/6**.
- Renderer syntax scan: **529 TS/TSX**, **0** parse diagnostics.
- Relative imports resolved: **3,175**, **0** missing.
- Database migration: **none**. Native binary changes: **none**.

Scope is static/executable local checks and screenshots of production CSS fixtures. **Do not interpret as end-to-end React, native Qt or Windows runtime certification.**
