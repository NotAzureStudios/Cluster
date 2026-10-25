import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [
  stylesEntry,
  workspaceStyles,
  toolHeader,
  contextBar,
  dataView,
  compactNav,
  projectNav,
  projectPrimitives,
  board,
  boardCard,
  whiteboard,
  notificationInbox,
  admin,
  accountSettings,
  studioSettings,
  serverSettings,
  resourceHub,
  apiContracts,
  notes,
] = await Promise.all([
  text("packages/renderer/src/styles.css"),
  text("packages/renderer/src/styles/design-system/workspace-polish.css"),
  text("packages/renderer/src/components/ToolPageHeader.tsx"),
  text("packages/renderer/src/components/ProjectToolContextBar.tsx"),
  text("packages/renderer/src/components/DataView.tsx"),
  text("packages/renderer/src/components/CompactSectionNav.tsx"),
  text("packages/renderer/src/features/projects/ProjectWorkspaceNav.tsx"),
  text("packages/renderer/src/features/projects/ProjectWorkspacePrimitives.tsx"),
  text("packages/renderer/src/features/boards/BoardWorkspacePage.tsx"),
  text("packages/renderer/src/features/boards/BoardCardTile.tsx"),
  text("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx"),
  text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
  text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx"),
  text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  text("packages/renderer/src/features/settings/StudioSettingsPage.tsx"),
  text("packages/renderer/src/features/settings/ServerConfigPage.tsx"),
  text("packages/renderer/src/features/projects/ProjectResourceHubPanel.tsx"),
  text("packages/shared/src/api-contracts.ts"),
  text("RELEASE_NOTES_v0.391.0.md"),
]);

const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\brgb\([^)]*\)|\bhsl\([^)]*\)/;
check("pass 2 stylesheet is loaded before shared primitives", stylesEntry.indexOf("workspace-polish.css") > 0 && stylesEntry.indexOf("workspace-polish.css") < stylesEntry.indexOf("primitives.css"));
check("pass 2 stylesheet introduces no raw colors", !rawColorPattern.test(workspaceStyles));
check("pass 2 stylesheet defines shared workspace header", workspaceStyles.includes(".cluster-workspace-header-v391"));
check("pass 2 stylesheet defines shared context bar", workspaceStyles.includes(".cluster-context-bar-v391"));
check("pass 2 stylesheet defines shared section navigation", workspaceStyles.includes(".cluster-section-nav-v391"));
check("pass 2 stylesheet defines shared toolbar", workspaceStyles.includes(".cluster-toolbar-v391"));
check("pass 2 stylesheet defines shared status strips", workspaceStyles.includes(".cluster-status-strip-v391"));
check("pass 2 stylesheet defines shared empty states", workspaceStyles.includes(".cluster-empty-state-v391"));
check("pass 2 stylesheet defines shared segmented controls", workspaceStyles.includes(".cluster-segmented-v391"));
check("pass 2 stylesheet normalizes menus", workspaceStyles.includes(".more-menu > .menu-panel") && workspaceStyles.includes(".compact-section-menu-v204"));
check("pass 2 stylesheet normalizes form labels", workspaceStyles.includes("label.field") && workspaceStyles.includes("--cluster-font-size-sm"));
check("pass 2 stylesheet has narrow-window behavior", workspaceStyles.includes("@media (max-width: 720px)") && workspaceStyles.includes("grid-template-columns: 1fr"));

check("tool headers use shared workspace chrome", toolHeader.includes("cluster-workspace-header-v391") && toolHeader.includes("cluster-workspace-actions-v391"));
check("tool headers support eyebrow and description consistently", toolHeader.includes("{eyebrow ?") && toolHeader.includes("cluster-workspace-description-v391"));
check("project tool context bars use shared chrome", contextBar.includes("cluster-context-bar-v391") && contextBar.includes("cluster-context-actions-v391"));
check("data toolbars use shared toolbar semantics", dataView.includes("cluster-toolbar-v391") && dataView.includes('role="search"'));
check("compact section navigation uses shared navigation chrome", compactNav.includes("cluster-section-nav-v391"));
check("compact section navigation has no duplicate button type attributes", !/<button[^>]*type="button"[^>]*type="button"/s.test(compactNav));
check("project navigation uses shared navigation chrome", projectNav.includes("cluster-section-nav-v391"));
check("project navigation has no duplicate button type attributes", !/<button[^>]*type="button"[^>]*type="button"/s.test(projectNav));
check("project section headers use shared workspace section chrome", projectPrimitives.includes("cluster-workspace-section-head-v391"));
check("project surfaces and empty states use shared primitives", projectPrimitives.includes("cluster-surface-v391") && projectPrimitives.includes("cluster-empty-state-v391"));
check("project status and segmented controls use shared primitives", projectPrimitives.includes("cluster-status-strip-v391") && projectPrimitives.includes("cluster-segmented-v391"));

check("board workspace uses shared header chrome", board.includes("board-workspace-header-v256 cluster-workspace-header-v391"));
check("whiteboard workspace uses shared header chrome", whiteboard.includes("whiteboard-hero-v194 cluster-workspace-header-v391"));
check("notification inbox uses shared header and metrics chrome", notificationInbox.includes("notification-command-v252 cluster-workspace-header-v391") && notificationInbox.includes("cluster-workspace-metrics-v391"));
check("admin operations uses shared header chrome", admin.includes("operations-page-header-v245 cluster-workspace-header-v391") || admin.includes("<WorkspacePageShell"));
check("account settings navigation uses shared settings chrome", accountSettings.includes("<CompactSectionNav") && accountSettings.includes("settings-section-nav-v469"));
check("studio settings navigation uses shared settings chrome", studioSettings.includes("<CompactSectionNav") && studioSettings.includes("settings-section-nav-v469") && studioSettings.includes("studio-editor-tabs-v272 cluster-segmented-v391"));
check("server settings navigation uses shared settings chrome", serverSettings.includes("<CompactSectionNav") && serverSettings.includes("settings-section-nav-v469"));

check("board lane runtime style uses reviewed runtimeStyle", board.includes('runtimeStyle({ "--column-accent"') && !board.includes("as CSSProperties"));
check("board appearance runtime style uses reviewed runtimeStyle", board.includes("const boardAppearanceStyle = runtimeStyle"));
check("board card drag and cover style uses reviewed runtimeStyle", boardCard.includes("const style = runtimeStyle") && !boardCard.includes("as CSSProperties"));
check("project resource accent uses reviewed runtimeStyle", resourceHub.includes('runtimeStyle({ "--resource-accent"') && !resourceHub.includes("CSSProperties"));

check("pass 2 API capability is current", apiContracts.includes('version: "2026-08-02.63"') && apiContracts.includes('"ux-polish-pass-2-v1"'));
check("pass 2 release notes cover project/tool/settings/admin consistency", ["Projects", "Boards", "Whiteboards", "Timeline", "Notifications", "Settings", "Admin"].every((marker) => notes.includes(marker)));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster UX polish pass 2 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
