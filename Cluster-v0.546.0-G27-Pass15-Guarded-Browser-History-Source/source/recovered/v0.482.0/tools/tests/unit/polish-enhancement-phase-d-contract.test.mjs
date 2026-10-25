import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root = process.cwd();
const text = (p) => fs.readFileSync(path.join(root, p), "utf8");
test("v0.415 Phase D search and command contract", () => {
  const contracts = text("packages/shared/src/api-contracts.ts");
  const palette = text("packages/renderer/src/features/search/CommandPalette.tsx");
  assert.match(contracts, /2026-08-02\.62/);
  assert.match(contracts, /polish-enhancement-phase-d-v1/);
  assert.match(palette, /startsWith\(\">\"\)/);
  assert.match(palette, /currentProjectId/);
  assert.match(palette, /currentScreen/);
  assert.match(palette, /SearchResultPreview/);
});
