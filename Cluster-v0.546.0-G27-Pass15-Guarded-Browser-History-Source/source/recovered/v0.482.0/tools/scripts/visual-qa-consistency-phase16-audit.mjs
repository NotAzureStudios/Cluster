import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [tokens, primitives, production, shell, library, collaboration, docs, pkgText, packager, notes, changelog] = await Promise.all([
  text("packages/renderer/src/styles/design-system/tokens.css"),
  text("packages/renderer/src/styles/design-system/primitives.css"),
  text("packages/renderer/src/styles/design-system/production-ui.css"),
  text("packages/renderer/src/features/shell/shell.css"),
  text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
  text("packages/renderer/src/components/CollaborationPanel.tsx"),
  text("docs/VISUAL_QA_CONSISTENCY_PHASE16.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.439.0.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
]);

check("Small icon token exists", tokens.includes("--cluster-icon-sm: 14px"));
check("Canonical icon token exists", tokens.includes("--cluster-icon-md: 16px"));
check("Large icon token exists", tokens.includes("--cluster-icon-lg: 20px"));
check("XL icon token exists", tokens.includes("--cluster-icon-xl: 24px"));
check("Canonical buttons consume icon token", primitives.includes(".cluster-button-v425 > svg { width: var(--cluster-icon-md)"));
check("Action menus consume icon token", primitives.includes(".cluster-action-menu-entry-v428 svg { width: var(--cluster-icon-md)"));

check("Action menus cap viewport height", primitives.includes("max-height: min(420px, calc(100dvh - var(--space-6)))"));
check("Action menus own internal scrolling", primitives.includes(".cluster-action-menu-panel-v428") && primitives.includes("overflow-y: auto") && primitives.includes("scrollbar-gutter: stable"));
check("Action-menu copy can wrap safely", primitives.includes(".cluster-action-menu-entry-v428 strong") && primitives.includes("overflow-wrap: anywhere"));
check("Master detail uses shared panel radius", primitives.includes(".cluster-master-detail-v429") && primitives.includes("border-radius: var(--cluster-radius-panel)"));
check("Master detail clips shared boundary", primitives.includes(".cluster-master-detail-v429") && primitives.includes("overflow: clip"));

check("Workspace heading min-width contract exists", production.includes(".cluster-workspace-heading-v391") && production.includes("min-width: 0"));
check("Long workspace titles wrap", production.includes(".cluster-workspace-title-v391 h1") && production.includes("overflow-wrap: anywhere"));
check("Workspace actions keep bounded width", production.includes(".cluster-workspace-actions-v391") && production.includes("justify-content: flex-end"));
check("Known scroll regions stabilize scrollbar gutters", production.includes("scrollbar-gutter: stable") && production.includes(".cluster-detail-pane-v429"));
check("Known scroll regions contain overscroll", production.includes("overscroll-behavior: contain"));
check("Table wrappers own horizontal overflow", production.includes(":where(.table-shell, .data-table-shell, .table-wrap)") && production.includes("overflow-x: auto"));
check("Tables retain full container width", production.includes(":where(table) { min-width: 100%; }"));
check("Dialog backdrop reserves viewport padding", production.includes(".cluster-dialog-backdrop-v389") && production.includes("padding: var(--space-4)"));
check("Dialogs cap viewport height", production.includes("max-height: calc(100dvh - (2 * var(--space-4)))"));
check("Dialog body scrolls independently", production.includes(".cluster-dialog-body-v389") && production.includes("overflow-y: auto"));
check("Small-window dialog actions wrap", production.includes(".cluster-dialog-v389 > footer") && production.includes("flex-wrap: wrap"));
check("Shared menu/popover viewport cap exists", production.includes(".taskbar-search-popover-v143") && production.includes("max-height: min(440px"));

check("Clean sidebar uses shared panel", shell.includes(".sidebar-clean-v139 { width: var(--cluster-sidebar-width); background: var(--panel) !important"));
check("Clean sidebar shadow is removed", shell.includes(".sidebar-clean-v139 { width: var(--cluster-sidebar-width)") && shell.includes("box-shadow: none; }"));
check("Clean sidebar logo avoids decorative gradient", shell.includes(".sidebar-clean-v139 .logo-mark.small { border-radius: var(--cluster-radius-card); background: var(--accent)"));
check("Clean sidebar nav uses shared control radius", shell.includes(".sidebar-clean-v139 .nav-list button") && shell.includes("border-radius: var(--cluster-radius-control) !important"));
check("Clean sidebar labels avoid decorative uppercase", shell.includes(".nav-subhead-v111") && shell.includes("text-transform: none"));
check("Clean taskbar uses shared panel", shell.includes(".taskbar-clean-v139") && shell.includes("background: var(--panel) !important"));
check("Clean taskbar disables blur", shell.includes(".taskbar-clean-v139") && shell.includes("backdrop-filter: none"));
check("Clean taskbar removes routine shadow", shell.includes(".taskbar-clean-v139") && shell.includes("box-shadow: none !important"));
check("Collapsed shell grid matches 86px navigation", shell.includes("@media (max-width: 1180px) { .app-shell { grid-template-columns: 86px minmax(0, 1fr) !important; } }"));
check("Mobile shell becomes one column", shell.includes("@media (max-width: 760px) { .app-shell { grid-template-columns: 1fr !important; }"));
check("Taskbar tabs use shared card radius", shell.includes(".taskbar-tabs-shell-v073") && shell.includes("border-radius: var(--cluster-radius-card) !important"));
check("Taskbar icons use shared icon token", shell.includes(".taskbar-icon-v073 { width: var(--cluster-icon-lg) !important"));
check("Taskbar search popover uses shared popover radius", shell.includes(".taskbar-search-popover-v143") && shell.includes("border-radius: var(--cluster-radius-popover)"));
check("Taskbar search input uses shared control height", shell.includes(".taskbar-search-popover-v143 input") && shell.includes("min-height: var(--cluster-control-height)"));

check("Library imports canonical action menu", library.includes('import { ClusterActionMenu } from "../../components/ClusterContextActions";'));
check("Library primary header action uses ClusterButton", library.includes('<ClusterButton variant="primary" onClick={() => fileInput.current?.click()}>Upload files</ClusterButton>'));
check("Library secondary header action uses ClusterButton", library.includes('<ClusterButton variant="secondary" onClick={() => setCreateDraft'));
check("Library legacy details overflow menu removed", !library.includes('details className="cluster-action-menu-v228"'));
check("Library overflow action uses canonical menu", library.includes('label="More Library actions"') && library.includes('id: "upload-model-bundle"'));

check("Collaboration imports canonical buttons", collaboration.includes('import { ClusterButton, ClusterIconButton } from "./ClusterButton";'));
check("Collaboration refresh uses canonical icon button", collaboration.includes('<ClusterIconButton label="Refresh comments"'));
check("Collaboration post uses canonical busy button", collaboration.includes('busyLabel="Posting"'));
check("Collaboration pin action has explicit label", collaboration.includes('label={pinned ? "Unpin comment" : "Pin comment"}'));
check("Collaboration delete uses canonical danger icon button", collaboration.includes('label="Delete comment"') && collaboration.includes('variant="danger"'));
check("Legacy text refresh glyph removed", !collaboration.includes('>↻</button>'));

check("Phase 16 docs cover light and dark review", docs.includes("Light and Dark"));
check("Phase 16 docs cover density review", docs.includes("Compact and Comfortable density"));
check("Phase 16 docs cover 200% scale review", docs.includes("200%"));
check("Phase 16 docs cover long-content review", docs.includes("Long project/user/ticket/library names"));
check("Phase 16 docs cover short-height dialogs", docs.includes("Dialogs at short viewport heights"));
check("Phase 16 docs retain manual review boundary", docs.includes("Static release gates do not replace this manual matrix"));

const pkg = JSON.parse(pkgText);
check("Aggregate audit includes Phase 16 gate", String(pkg.scripts?.audit || "").includes("visual-qa-consistency-phase16-audit.mjs"));
check("Named Phase 16 audit exists", String(pkg.scripts?.["audit:visual-qa-consistency-phase16"] || "").includes("visual-qa-consistency-phase16-audit.mjs"));
check("Master packager invokes Phase 16 gate", packager.includes("visual-qa-consistency-phase16-audit.mjs"));
check("Master/source packages carry Phase 16 docs", packager.split("docs/VISUAL_QA_CONSISTENCY_PHASE16.md").length >= 3);
check("Release notes identify Phase 16 capability", notes.includes("visual-qa-consistency-phase16-v1"));
check("Release notes retain API contract", notes.includes("2026-08-02.63"));
check("Release notes retain production build foundation marker", notes.includes("production-build-foundation-v1"));
check("Changelog includes v0.439.0", changelog.includes('version: "v0.439.0"') && changelog.includes("Visual QA and consistency sweep"));

console.log(`\nVisual QA & consistency Phase 16 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
