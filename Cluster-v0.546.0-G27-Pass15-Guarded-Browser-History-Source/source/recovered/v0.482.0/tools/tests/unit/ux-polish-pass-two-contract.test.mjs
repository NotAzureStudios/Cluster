import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.391 UX polish pass 2 keeps cross-workspace chrome consistent", async () => {
  const [styles, toolHeader, nav, projectPrimitives, board, whiteboard, inbox, admin, account, studio, server, contracts, versions, notes] = await Promise.all([
    read("packages/renderer/src/styles/design-system/workspace-polish.css"),
    read("packages/renderer/src/components/ToolPageHeader.tsx"),
    read("packages/renderer/src/components/CompactSectionNav.tsx"),
    read("packages/renderer/src/features/projects/ProjectWorkspacePrimitives.tsx"),
    read("packages/renderer/src/features/boards/BoardWorkspacePage.tsx"),
    read("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx"),
    read("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
    read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx"),
    read("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
    read("packages/renderer/src/features/settings/StudioSettingsPage.tsx"),
    read("packages/renderer/src/features/settings/ServerConfigPage.tsx"),
    read("packages/shared/src/api-contracts.ts"),
    read("config/toolchain-versions.json"),
    read("RELEASE_NOTES_v0.391.0.md"),
  ]);
  assert.equal(JSON.parse(versions).cluster, "0.422.0");
  assert.ok(styles.includes("cluster-workspace-header-v391") && styles.includes("cluster-context-bar-v391") && styles.includes("cluster-section-nav-v391"));
  assert.ok(toolHeader.includes("cluster-workspace-header-v391"));
  assert.ok(nav.includes("cluster-section-nav-v391"));
  assert.ok(projectPrimitives.includes("cluster-workspace-section-head-v391") && projectPrimitives.includes("cluster-empty-state-v391"));
  assert.ok(board.includes("cluster-workspace-header-v391"));
  assert.ok(whiteboard.includes("cluster-workspace-header-v391"));
  assert.ok(inbox.includes("cluster-workspace-metrics-v391"));
  assert.ok(admin.includes("cluster-workspace-header-v391"));
  assert.ok(account.includes("cluster-settings-nav-v391") && studio.includes("cluster-settings-nav-v391") && server.includes("cluster-settings-nav-v391"));
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"ux-polish-pass-2-v1"'));
  assert.ok(notes.includes("UX polish pass 2"));
});
