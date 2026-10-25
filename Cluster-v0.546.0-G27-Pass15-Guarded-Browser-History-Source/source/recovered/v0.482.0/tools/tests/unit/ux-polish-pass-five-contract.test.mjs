import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.394 UX polish pass 5 standardizes loading and recovery", async () => {
  const [versionsText, contracts, requestState, apiCore, footer, notifications, activity, performance, account, calendar, timeline, myWork, notes, doc, packageText, packager] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("packages/renderer/src/components/RequestState.tsx"),
    read("packages/renderer/src/core/api.ts"),
    read("packages/renderer/src/components/AppVersionFooter.tsx"),
    read("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
    read("packages/renderer/src/features/activity/ActivityPage.tsx"),
    read("packages/renderer/src/features/operations/ServerPerformancePanel.tsx"),
    read("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
    read("packages/renderer/src/features/calendar/CalendarPage.tsx"),
    read("packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx"),
    read("packages/renderer/src/features/work/MyWorkPage.tsx"),
    read("RELEASE_NOTES_v0.394.0.md"),
    read("docs/UX_POLISH_PASS_5.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"ux-polish-pass-5-v1"'));
  assert.ok(requestState.includes("apiErrorPresentation") && requestState.includes("detail.requestId") && requestState.includes("detail.contractVersion"));
  assert.ok(apiCore.includes("ClusterApiClientError") && apiCore.includes("error.retryAfterSeconds"));
  assert.ok(footer.includes("staleHealth") && footer.includes('addEventListener("offline"') && footer.includes("checkingRef.current"));
  assert.ok(notifications.includes("RequestEmptyState") && notifications.includes("Inbox refresh failed"));
  assert.ok(activity.includes("Activity refresh failed") && performance.includes("Performance refresh failed"));
  assert.ok(account.includes("SettingsLoadingState") && account.includes("Account settings unavailable"));
  assert.ok(calendar.includes("Upcoming reminders unavailable") && timeline.includes("Timeline unavailable") && myWork.includes("My Work unavailable"));
  assert.ok(notes.includes("ux-polish-pass-5-v1") && doc.includes("Release-blocking boundary"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("ux-polish-pass-five-audit.mjs"));
  assert.ok(packager.includes("ux-polish-pass-five-audit.mjs") && packager.includes("docs/UX_POLISH_PASS_5.md"));
});
