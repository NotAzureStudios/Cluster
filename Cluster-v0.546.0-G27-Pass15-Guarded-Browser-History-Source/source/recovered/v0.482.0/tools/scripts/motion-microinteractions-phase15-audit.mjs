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

const [tokens, base, boards, timeline, shell, workspaces, primitives, accessibility, skeletons, searchCss, libraryCss, pdfCss, syncCss, qmlShell, qmlSwitch, docs, pkgText, packager, notes, changelog] = await Promise.all([
  text("packages/renderer/src/styles/design-system/tokens.css"),
  text("packages/renderer/src/styles/layers/application-base.css"),
  text("packages/renderer/src/features/boards/board-workspace.css"),
  text("packages/renderer/src/features/timeline/timeline-workspace.css"),
  text("packages/renderer/src/features/shell/shell.css"),
  text("packages/renderer/src/styles/layers/application-workspaces.css"),
  text("packages/renderer/src/styles/design-system/primitives.css"),
  text("packages/renderer/src/styles/accessibility.css"),
  text("packages/renderer/src/styles/design-system/skeletons.css"),
  text("packages/renderer/src/features/search/search.css"),
  text("packages/renderer/src/features/library/library-workspace.css"),
  text("packages/renderer/src/features/library/cluster-pdf-viewer.css"),
  text("packages/renderer/src/features/application/styles/refinements-sync.css"),
  text("apps/desktop-qt/qml/Main.qml"),
  text("apps/desktop-qt/qml/components/ClusterSwitch.qml"),
  text("docs/MOTION_MICROINTERACTIONS_PHASE15.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.438.0.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
]);

check("Feedback motion token exists", tokens.includes("--cluster-motion-feedback: 100ms"));
check("Fast motion token remains bounded", tokens.includes("--cluster-motion-fast: 120ms"));
check("Panel motion token exists", tokens.includes("--cluster-motion-panel: 180ms"));
check("Enter easing token exists", tokens.includes("--cluster-ease-enter:"));
check("Exit easing token exists", tokens.includes("--cluster-ease-exit:"));

check("Whole pages no longer auto-animate", !/\.page\s*\{[^}]*animation:/s.test(base));
check("Legacy pageIn keyframes removed", !base.includes("@keyframes pageIn"));
check("Filter drawer entrance removed", !base.includes("animation: filterIn"));
check("Filter entrance keyframes removed", !base.includes("@keyframes filterIn"));
check("Routine task-card entrance removed", !base.includes("animation: cardIn"));
check("Task-card entrance keyframes removed", !base.includes("@keyframes cardIn"));
check("Board column entrance removed", !boards.includes("animation: columnIn"));
check("Board column stagger delays removed", !/\.board-list:nth-child\([^)]*\)\s*\{\s*animation-delay:/s.test(boards));
check("Board tab-panel entrance removed", !boards.includes("animation: tabPanelIn"));
check("Timeline entry entrance removed", !timeline.includes("animation: slideFadeIn"));
check("Timeline point pop-in removed", !timeline.includes("animation: timelinePop"));

check("Menus retain bounded spatial feedback", base.includes("animation: menuIn var(--cluster-motion-fast) var(--cluster-ease-enter)"));
check("Modal backdrop uses bounded motion", base.includes("animation: backdropIn var(--cluster-motion-fast)"));
check("Modal panel uses shared panel motion", base.includes("animation: modalIn var(--cluster-motion-panel) var(--cluster-ease-enter)"));
check("Chat panel uses shared panel motion", base.includes("animation: chatSlideIn var(--cluster-motion-panel) var(--cluster-ease-enter)"));
check("Taskbar search uses shared panel motion", shell.includes("animation: taskbarSearchOpenV144 var(--cluster-motion-panel) var(--cluster-ease-enter)"));
check("Composer uses shared fast motion", workspaces.includes("animation: composerIn-v071 var(--cluster-motion-fast) var(--cluster-ease-enter)"));
check("Row-action reveal uses shared motion token", primitives.includes("transition: opacity var(--cluster-motion-fast) var(--cluster-ease-standard)"));

check("User reduced-motion contract remains", accessibility.includes(':root[data-motion="reduced"] *'));
check("User no-motion contract remains", accessibility.includes(':root[data-motion="none"] *') && accessibility.includes("animation: none !important"));
check("System reduced-motion floor remains", accessibility.includes("@media (prefers-reduced-motion: reduce)") && accessibility.includes(':root[data-motion-preference="system"] *'));
check("Skeleton shimmer disables for reduced motion", skeletons.includes("prefers-reduced-motion: reduce") && skeletons.includes("animation: none"));
check("Search spinner has reduced-motion handling", searchCss.includes("prefers-reduced-motion: reduce"));
check("Library loading has reduced-motion handling", libraryCss.includes("prefers-reduced-motion: reduce"));
check("PDF loading spinner is bounded loading feedback", pdfCss.includes("cluster-pdf-spinner") && pdfCss.includes("cluster-pdf-spin"));
check("Sync spinner is bounded operation feedback", syncCss.includes("sync-spin") && syncCss.includes("prefers-reduced-motion: reduce"));

check("Qt signed-in shell avoids duplicate content animation", !qmlShell.includes("NumberAnimation") && !qmlShell.includes("Behavior on"));
check("Qt switch honors reduced and no-motion", qmlSwitch.includes("enabled: !Theme.reducedMotion && !Theme.noMotion"));

check("Phase 15 docs ban mount-only motion", docs.includes("Motion is not justified merely because content mounted"));
check("Phase 15 docs prohibit collection staggering", docs.includes("Staggered entrance animation for collections is prohibited"));
check("Phase 15 docs bound continuous animation", docs.includes("Infinite animation is reserved for active loading/progress indicators"));
check("Phase 15 docs retain manual motion review", docs.includes("Full, Reduced, None, and OS reduced-motion modes"));

const pkg = JSON.parse(pkgText);
check("Aggregate audit includes Phase 15 gate", String(pkg.scripts?.audit || "").includes("motion-microinteractions-phase15-audit.mjs"));
check("Named Phase 15 audit exists", String(pkg.scripts?.["audit:motion-microinteractions-phase15"] || "").includes("motion-microinteractions-phase15-audit.mjs"));
check("Master packager invokes Phase 15 gate", packager.includes("motion-microinteractions-phase15-audit.mjs"));
check("Master/source packages carry Phase 15 docs", packager.split("docs/MOTION_MICROINTERACTIONS_PHASE15.md").length - 1 >= 2);
check("Phase 15 notes identify capability", notes.includes("motion-microinteractions-phase15-v1"));
check("Phase 15 notes retain API contract", notes.includes("2026-08-02.63"));
check("Changelog includes v0.438.0", changelog.includes('version: "v0.438.0"') && changelog.includes("Motion and microinteraction pass"));

console.log(`\nMotion & microinteraction Phase 15 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
