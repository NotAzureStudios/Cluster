import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.390 UX polish pass 1 keeps debt, skeleton, and health boundaries", async () => {
  const [baseline, colors, loading, runtimeStyle, footer, health, contracts, notes, versions] = await Promise.all([
    read("config/ux-debt-baseline.json"),
    read("config/design-system-color-baseline.json"),
    read("packages/renderer/src/components/LoadingState.tsx"),
    read("packages/renderer/src/core/runtime-style.ts"),
    read("packages/renderer/src/components/AppVersionFooter.tsx"),
    read("apps/server/src/app/server-routes-health-operations.ts"),
    read("packages/shared/src/api-contracts.ts"),
    read("RELEASE_NOTES_v0.390.0.md"),
    read("config/toolchain-versions.json"),
  ]);
  const debt = JSON.parse(baseline);
  const palette = JSON.parse(colors);
  assert.equal(JSON.parse(versions).cluster, "0.422.0");
  assert.equal(debt.inlineStyleObjectMaximum, 0);
  assert.equal(debt.nativeDialogCallsMaximum, 0);
  assert.equal(debt.buttonWithoutExplicitTypeMaximum, 0);
  assert.ok(runtimeStyle.includes("ALLOWED_PROPERTIES"));
  assert.ok(loading.includes("SettingsLoadingState") && loading.includes("PolicyLoadingState") && loading.includes("CardGridLoadingState"));
  assert.ok(footer.includes("server-status-popover-v390") && footer.includes("Round trip") && footer.includes("API p95"));
  assert.ok(health.includes("signals: operational.checks.map"));
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"skeleton-loading-v1"') && contracts.includes('"public-health-status-v2"') && contracts.includes('"ux-polish-pass-1-v1"'));
  assert.ok(notes.includes("3,795 to 3,428"));
  assert.ok(Object.values(palette.files).reduce((sum, value) => sum + Number(value || 0), 0) <= 3428);
});
