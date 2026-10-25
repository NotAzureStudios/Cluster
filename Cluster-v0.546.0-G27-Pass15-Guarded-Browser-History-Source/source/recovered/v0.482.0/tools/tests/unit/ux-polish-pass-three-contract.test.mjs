import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.392 UX polish pass 3 centralizes repeated renderer palette debt", async () => {
  const [tokens, baselineText, contracts, versions, notes, doc, packageText, packager, uxDebtText] = await Promise.all([
    read("packages/renderer/src/styles/design-system/tokens.css"),
    read("config/design-system-color-baseline.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("config/toolchain-versions.json"),
    read("RELEASE_NOTES_v0.392.0.md"),
    read("docs/UX_POLISH_PASS_3.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
    read("config/ux-debt-baseline.json"),
  ]);
  const baseline = JSON.parse(baselineText);
  const total = Object.values(baseline.files).reduce((sum, value) => sum + Number(value || 0), 0);
  const uxDebt = JSON.parse(uxDebtText);
  assert.equal(JSON.parse(versions).cluster, "0.422.0");
  assert.equal(baseline.version, 3);
  assert.ok(total <= 1576);
  assert.ok(tokens.includes("--cluster-white: #ffffff;") && tokens.includes("--cluster-slate-900: #0f172a;") && tokens.includes("--cluster-blue-300: #93c5fd;"));
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"ux-polish-pass-3-v1"'));
  assert.equal(uxDebt.nativeDialogCallsMaximum, 0);
  assert.equal(uxDebt.buttonWithoutExplicitTypeMaximum, 0);
  assert.equal(uxDebt.inlineStyleObjectMaximum, 0);
  assert.ok(notes.includes("3,428") && notes.includes("1,576"));
  assert.ok(doc.includes("semantic review") && doc.includes("schema version 3"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("ux-polish-pass-three-audit.mjs"));
  assert.ok(packager.includes("ux-polish-pass-three-audit.mjs") && packager.includes("docs/UX_POLISH_PASS_3.md"));
});
