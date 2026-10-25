import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.412 Polish & Enhancement Phase A standardizes shared visual UX", async () => {
  const [pkgText, versionsText, contracts, tokens, phase, styles, notes, doc, packager] = await Promise.all([
    read("package.json"), read("config/toolchain-versions.json"), read("packages/shared/src/api-contracts.ts"),
    read("packages/renderer/src/styles/design-system/tokens.css"), read("packages/renderer/src/styles/design-system/phase-a-polish.css"),
    read("packages/renderer/src/styles.css"), read("RELEASE_NOTES_v0.422.0.md"), read("docs/POLISH_ENHANCEMENT_PHASE_A.md"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);
  const pkg = JSON.parse(pkgText);
  assert.equal(pkg.version, "0.422.0");
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"polish-enhancement-phase-a-v1"'));
  assert.ok(tokens.includes("--cluster-elevation-3") && tokens.includes("--cluster-interactive-pressed"));
  assert.ok(styles.indexOf('@import "./styles/design-system/phase-a-polish.css";') < styles.indexOf('@import "./styles/design-system/phase-k-polish.css";'));
  assert.ok(phase.includes("overflow-x: auto") && phase.includes("[role=\"dialog\"]") && phase.includes(":focus-visible"));
  assert.ok(notes.includes("Phase A is complete") && doc.includes("Release-blocking boundary"));
  assert.ok(pkg.scripts.audit.includes("polish-enhancement-phase-a-audit.mjs"));
  assert.ok(packager.includes("polish-enhancement-phase-a-audit.mjs") && packager.includes("docs/POLISH_ENHANCEMENT_PHASE_A.md"));
});
