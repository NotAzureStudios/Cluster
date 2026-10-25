import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");

async function tsxFiles(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await tsxFiles(absolute, out);
    else if (entry.name.endsWith(".tsx")) out.push(absolute);
  }
  return out;
}

const [accessibilityAudit, library, calendar, board, creator, timeline, operationsAdmin, projectControl, workspaces, operations, apiContracts, notes, doc, packageText, packager, colorBaselineText] = await Promise.all([
  text("tools/scripts/accessibility-static-audit.mjs"),
  text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
  text("packages/renderer/src/features/calendar/CalendarPage.tsx"),
  text("packages/renderer/src/features/boards/BoardWorkspacePage.tsx"),
  text("packages/renderer/src/features/create/SharedCreateDrawer.tsx"),
  text("packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx"),
  text("packages/renderer/src/features/operations/modules/operations-admin.tsx"),
  text("packages/renderer/src/features/projects/ProjectControlRecordCard.tsx"),
  text("packages/renderer/src/features/application/modules/application-workspaces.tsx"),
  text("packages/renderer/src/features/application/modules/application-operations.tsx"),
  text("packages/shared/src/api-contracts.ts"),
  text("RELEASE_NOTES_v0.393.0.md"),
  text("docs/UX_POLISH_PASS_4.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("config/design-system-color-baseline.json"),
]);

const nonSemanticTags = ["div", "article", "section", "span", "li", "label"];
let pointerOnly = 0;
for (const absolute of await tsxFiles(path.join(root, "packages", "renderer", "src"))) {
  const source = await readFile(absolute, "utf8");
  for (const tag of nonSemanticTags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*on(?:Click|DoubleClick)\\s*=`, "gs");
    pointerOnly += (source.match(pattern) || []).length;
  }
}
check("pointer-only non-semantic renderer controls are zero", pointerOnly === 0, `${pointerOnly} remaining`);
check("static accessibility audit blocks non-semantic pointer controls", accessibilityAudit.includes("nonSemanticInteractiveTags") && accessibilityAudit.includes("pointer-only <${tag}> interaction is prohibited"));

check("Library preview no longer depends on double click", !library.includes("onDoubleClick") && library.includes('aria-label={`${item.type === "folder" ? "Open" : "Preview"} ${item.title}`'));
check("Calendar month uses separate semantic controls", calendar.includes("calendar-day-select-v393") && calendar.includes("calendar-day-add-v393") && calendar.includes("calendar-chip") && calendar.includes("<section className={`calendar-day"));
check("Calendar week uses explicit select/add controls", calendar.includes("calendar-week-day-trigger-v393") && calendar.includes("calendar-week-add-v393") && !calendar.includes('className={`${sameDate(day, new Date()) ? "today" : ""} ${sameDate(day, selectedDate) ? "selected" : ""}`} onClick='));

check("Board editor backdrop is presentation-only and target checked", board.includes('card-editor-backdrop-v254" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}') && board.includes('aria-labelledby="card-editor-title-v393"'));
check("Shared create backdrop is presentation-only and target checked", creator.includes('shared-create-backdrop-v254" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}'));
check("Timeline modal backdrops are presentation-only and target checked", timeline.includes('timeline-editor-backdrop-v254" role="presentation"') && timeline.includes('timeline-detail-backdrop-v254" role="presentation"') && timeline.includes('aria-labelledby="timeline-editor-title-v393"') && timeline.includes('aria-labelledby="timeline-detail-title-v393"'));
check("Operations detail backdrop is presentation-only", operationsAdmin.includes('detail-drawer-backdrop-v123" role="presentation" onMouseDown={onClose}'));

check("Project selection uses native title button", projectControl.includes("project-control-title-button-v393"));
check("Project control article itself is not clickable", !/<article\b[^>]*project-control-card-v313[^>]*onClick=/s.test(projectControl));
check("Team profile selection uses native member button", workspaces.includes("team-member-profile-trigger-v393") && !/<article\b[^>]*team-card-v032[^>]*onClick=/s.test(workspaces));
check("Build queue details use explicit button", operations.includes("build-row-details-v393") && !/<article\b[^>]*build-queue-row-v115[^>]*onClick=/s.test(operations));

const colorBaseline = JSON.parse(colorBaselineText);
const rawColorTotal = Object.values(colorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0);
check("pass 4 preserves the pass 3 raw-color ratchet", colorBaseline.version === 3 && rawColorTotal <= 1576, `${rawColorTotal}/1576`);
check("pass 4 API capability is current", apiContracts.includes('version: "2026-08-02.63"') && apiContracts.includes('"ux-polish-pass-4-v1"'));
check("pass 4 release notes document interaction hardening", notes.includes("pointer-only") && notes.includes("2026-08-02.33") && notes.includes("ux-polish-pass-4-v1"));
check("pass 4 documentation defines the release-blocking boundary", doc.includes("release-blocking") && doc.includes("Calendar") && doc.includes("Library"));
const pkg = JSON.parse(packageText);
check("pass 4 audit is in aggregate audit command", String(pkg.scripts?.audit || "").includes("ux-polish-pass-four-audit.mjs"));
check("pass 4 audit is invoked by master packaging", packager.includes("ux-polish-pass-four-audit.mjs"));
check("pass 4 documentation is packaged", packager.includes("docs/UX_POLISH_PASS_4.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster UX polish pass 4 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
