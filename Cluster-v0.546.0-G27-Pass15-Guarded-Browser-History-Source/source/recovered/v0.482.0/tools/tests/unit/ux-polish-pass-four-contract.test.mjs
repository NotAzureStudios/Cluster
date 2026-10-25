import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.393 UX polish pass 4 hardens semantic interaction paths", async () => {
  const [versionsText, contracts, accessibilityAudit, library, calendar, projectControl, workspaces, operations, notes, doc, packageText, packager, colorBaselineText] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("tools/scripts/accessibility-static-audit.mjs"),
    read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
    read("packages/renderer/src/features/calendar/CalendarPage.tsx"),
    read("packages/renderer/src/features/projects/ProjectControlRecordCard.tsx"),
    read("packages/renderer/src/features/application/modules/application-workspaces.tsx"),
    read("packages/renderer/src/features/application/modules/application-operations.tsx"),
    read("RELEASE_NOTES_v0.393.0.md"),
    read("docs/UX_POLISH_PASS_4.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
    read("config/design-system-color-baseline.json"),
  ]);
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"ux-polish-pass-4-v1"'));
  assert.ok(accessibilityAudit.includes("nonSemanticInteractiveTags") && accessibilityAudit.includes("pointer-only <${tag}> interaction is prohibited"));
  assert.ok(!library.includes("onDoubleClick") && library.includes("library-grid-preview-v217"));
  assert.ok(calendar.includes("calendar-day-select-v393") && calendar.includes("calendar-week-day-trigger-v393"));
  assert.ok(projectControl.includes("project-control-title-button-v393"));
  assert.ok(workspaces.includes("team-member-profile-trigger-v393"));
  assert.ok(operations.includes("build-row-details-v393"));
  const colorBaseline = JSON.parse(colorBaselineText);
  const total = Object.values(colorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  assert.equal(colorBaseline.version, 3);
  assert.ok(total <= 1576);
  assert.ok(notes.includes("ux-polish-pass-4-v1") && doc.includes("release-blocking"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("ux-polish-pass-four-audit.mjs"));
  assert.ok(packager.includes("ux-polish-pass-four-audit.mjs") && packager.includes("docs/UX_POLISH_PASS_4.md"));
});
