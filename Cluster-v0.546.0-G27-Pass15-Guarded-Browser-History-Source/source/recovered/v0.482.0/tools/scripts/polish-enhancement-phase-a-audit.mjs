import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [tokens, phase, styles, visual, contracts, notes, doc, packageText, packager] = await Promise.all([
  text("packages/renderer/src/styles/design-system/tokens.css"),
  text("packages/renderer/src/styles/design-system/phase-a-polish.css"),
  text("packages/renderer/src/styles.css"),
  text("packages/renderer/src/styles/visual-polish.css"),
  text("packages/shared/src/api-contracts.ts"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/POLISH_ENHANCEMENT_PHASE_A.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
]);

const rawColor = /(?:#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/;
check("Phase A polish layer remains the foundation before Phase K", styles.indexOf('@import "./styles/design-system/phase-a-polish.css";') < styles.indexOf('@import "./styles/design-system/phase-k-polish.css";'));
check("Phase A shared layer is semantic-color only", !rawColor.test(phase));
check("Phase A tokens define shell and page rhythm", ["--cluster-shell-gap", "--cluster-page-pad-inline", "--cluster-page-pad-block"].every((token) => tokens.includes(token)));
check("Phase A tokens define shared elevation", ["--cluster-elevation-1", "--cluster-elevation-2", "--cluster-elevation-3"].every((token) => tokens.includes(token)));
check("Phase A tokens define shared interaction states", ["--cluster-interactive-hover", "--cluster-interactive-pressed", "--cluster-disabled-opacity"].every((token) => tokens.includes(token)));
check("Phase A uses one focus-visible language", phase.includes(':focus-visible') && phase.includes('--cluster-focus-width') && phase.includes('--cluster-focus-offset'));
check("Phase A normalizes shared form geometry", phase.includes('.cluster-select-trigger-v227') && phase.includes('min-height: var(--cluster-control-height)') && phase.includes('resize: vertical'));
check("Phase A normalizes common surfaces", phase.includes('.settings-card-v092') && phase.includes('.project-resource-panel-v044') && phase.includes('border-radius: var(--cluster-radius-panel)'));
check("Phase A normalizes floating menus and popovers", phase.includes('[role="menu"]') && phase.includes('[role="listbox"]') && phase.includes('.server-status-popover-v390') && phase.includes('--cluster-radius-popover'));
check("Phase A bounds floating UI to the viewport", phase.includes('max-width: min(420px, calc(100vw - 20px))') && phase.includes('max-height: min(70vh, 560px)'));
check("Phase A normalizes dialogs and sheets", phase.includes('[role="dialog"]') && phase.includes('max-height: calc(100dvh - 24px)') && phase.includes('.modal-actions'));
check("Phase A prevents sidebar label clipping", phase.includes('.sidebar-clean-v139') && phase.includes('text-overflow: ellipsis') && phase.includes('white-space: nowrap'));
check("Phase A taskbar recovers with horizontal scrolling", phase.includes('.taskbar-tabs-shell-v073') && phase.includes('overflow-x: auto') && phase.includes('scrollbar-width: none'));
check("Phase A standardizes empty and request states", phase.includes('.cluster-empty-state-v391') && phase.includes('.cluster-request-state-v394.empty') && phase.includes('.cluster-loading-state-v289'));
check("Phase A contains dense tables inside workspaces", phase.includes('.table-shell') && phase.includes('overscroll-behavior-inline: contain') && phase.includes(':where(td, th)'));
check("Phase A contains explicit light-theme parity", phase.includes(':root[data-theme="light"]') && phase.includes('var(--cluster-white)') && phase.includes('var(--cluster-slate-50)'));
check("Phase A contains explicit dark-theme parity", phase.includes(':root[data-theme="dark"]'));
check("Phase A includes responsive shell recovery", phase.includes('@media (max-width: 1100px)') && phase.includes('@media (max-width: 760px)'));
check("Phase A respects reduced motion", phase.includes('@media (prefers-reduced-motion: reduce)'));
check("high-visibility light taskbar icon raw color was tokenized", !visual.includes('#c8d4d8'));
check("Phase A API contract is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"polish-enhancement-phase-a-v1"'));
check("Phase A release notes declare roadmap completion", notes.includes('Polish & Enhancement Roadmap') && notes.includes('Phase A is complete') && notes.includes('2026-08-02.62'));
check("Phase A documentation defines release-blocking boundary", doc.includes('Release-blocking boundary') && doc.includes('phase-a-polish.css') && doc.includes('token-only'));
const pkg = JSON.parse(packageText);
check("Phase A audit is in aggregate audit command", String(pkg.scripts?.audit || "").includes('polish-enhancement-phase-a-audit.mjs'));
check("Phase A audit has a named package script", String(pkg.scripts?.['audit:polish-phase-a'] || "").includes('polish-enhancement-phase-a-audit.mjs'));
check("Phase A audit is invoked during master packaging", packager.includes('polish-enhancement-phase-a-audit.mjs'));
check("Phase A documentation is packaged", packager.includes('docs/POLISH_ENHANCEMENT_PHASE_A.md'));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster Polish & Enhancement Phase A audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
