import assert from "node:assert/strict";
import { reportPassed, safeReportSlug, summarizeAxeResult } from "../../scripts/accessibility-ci-lib.mjs";

const summary = summarizeAxeResult({
  violations: [
    { id: "button-name", impact: "critical", description: "Buttons must have names", nodes: [{ target: ["#bad"], html: "<button></button>", failureSummary: "Fix the button." }] },
    { id: "color-contrast", impact: "moderate", description: "Contrast", nodes: [] },
  ],
  incomplete: [{ id: "aria-prohibited-attr", impact: "minor", nodes: [] }],
  passes: [{ id: "document-title" }],
});
assert.equal(summary.blocking.length, 2, "critical/serious and color-contrast axe findings block the gate");
assert.equal(summary.violations.length, 2, "all axe violations remain in the report");
assert.equal(summary.incomplete.length, 1, "manual-review/incomplete findings remain visible");
assert.equal(summary.passes, 1, "axe pass count is retained");
assert.equal(safeReportSlug("Settings / Accessibility ♥"), "settings-accessibility", "report filenames are portable");
assert.equal(reportPassed({ surfaces: [{ status: "passed", blockingViolations: 0 }], keyboardChecks: [{ passed: true }] }), true, "clean runtime report passes");
assert.equal(reportPassed({ surfaces: [{ status: "passed", blockingViolations: 1 }], keyboardChecks: [{ passed: true }] }), false, "blocking violations fail certification");
assert.equal(reportPassed({ surfaces: [{ status: "passed", blockingViolations: 0 }], keyboardChecks: [{ passed: false }] }), false, "keyboard regressions fail certification");

console.log("Accessibility CI helper tests passed (8 assertions).");
