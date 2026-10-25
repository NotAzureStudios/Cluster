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

const [requestState, loadingState, apiCore, featureBoundary, serverFooter, notifications, activity, performance, account, calendar, timeline, myWork, projectControl, styles, accessibilityAudit, apiContracts, notes, doc, packageText, packager, colorBaselineText] = await Promise.all([
  text("packages/renderer/src/components/RequestState.tsx"),
  text("packages/renderer/src/components/LoadingState.tsx"),
  text("packages/renderer/src/core/api.ts"),
  text("packages/renderer/src/components/FeatureBoundary.tsx"),
  text("packages/renderer/src/components/AppVersionFooter.tsx"),
  text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
  text("packages/renderer/src/features/activity/ActivityPage.tsx"),
  text("packages/renderer/src/features/operations/ServerPerformancePanel.tsx"),
  text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  text("packages/renderer/src/features/calendar/CalendarPage.tsx"),
  text("packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx"),
  text("packages/renderer/src/features/work/MyWorkPage.tsx"),
  text("packages/renderer/src/features/projects/ProjectControlCenterPanel.tsx"),
  text("packages/renderer/src/styles/design-system/workspace-polish.css"),
  text("tools/scripts/accessibility-static-audit.mjs"),
  text("packages/shared/src/api-contracts.ts"),
  text("RELEASE_NOTES_v0.394.0.md"),
  text("docs/UX_POLISH_PASS_5.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("config/design-system-color-baseline.json"),
]);

check("shared request error state uses structured API presentation", requestState.includes("apiErrorPresentation") && requestState.includes("detail.code") && requestState.includes("detail.requestId") && requestState.includes("detail.contractVersion") && requestState.includes("detail.retryAfterSeconds"));
check("shared request state exposes explicit retry action", requestState.includes("onRetry") && requestState.includes("retryLabel") && (requestState.includes("<ClusterButton") || requestState.includes('type="button"')));
check("shared request empty state is reusable", requestState.includes("RequestEmptyState") && requestState.includes("description") && requestState.includes("actions"));
check("request-state stylesheet is token-only", styles.includes("cluster-request-state-v394") && styles.includes("server-status-recovery-v394") && !/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(styles.slice(styles.indexOf("/* v0.394 request/loading/recovery states */"))));

check("shared client transport errors normalize into renderer ApiError", apiCore.includes("ClusterApiClientError") && apiCore.includes("error.retryAfterSeconds") && apiCore.includes("error.contractVersion") && apiCore.includes("error.requestId"));
check("ApiError presentation retains retry metadata", apiCore.includes("retryAfterSeconds?: number | null") && apiCore.includes("contractVersion?: string | null"));
check("lazy feature boundary uses structural loading state", featureBoundary.includes("<LoadingState") && !featureBoundary.includes("<strong>Loading {label.toLowerCase()}"));
check("structural loading primitives remain available", ["LoadingState", "CardGridLoadingState", "SettingsLoadingState", "PolicyLoadingState", "WorkspaceLoadingState"].every((name) => loadingState.includes(`function ${name}`)));

check("sidebar health preserves stale snapshot on failed checks", serverFooter.includes("staleHealth") && !serverFooter.includes("setHealth(null)") && serverFooter.includes("lastHealthyAt"));
check("sidebar health distinguishes device offline", serverFooter.includes('addEventListener("offline"') && serverFooter.includes("NETWORK_UNAVAILABLE"));
check("sidebar health suppresses overlapping checks", serverFooter.includes("checkingRef.current") && serverFooter.includes("if (checkingRef.current) return"));
check("sidebar health renders structured recovery context", serverFooter.includes("server-status-recovery-v394") && serverFooter.includes("consecutiveFailures") && serverFooter.includes("errorDetail.requestId"));

check("Notification inbox uses shared loading, error, and empty states", notifications.includes("<LoadingState") && notifications.includes("<RequestErrorState") && notifications.includes("<RequestEmptyState") && notifications.includes("Inbox refresh failed"));
check("Activity preserves recovery state", activity.includes("<LoadingState") && activity.includes("<RequestErrorState") && activity.includes("Activity refresh failed"));
check("Server Performance preserves stale data on refresh failure", performance.includes("error && data") && performance.includes("<RequestErrorState") && performance.includes("<LoadingState"));
check("Account Settings uses structural loading and retryable initial failure", account.includes("<SettingsLoadingState") && account.includes("Account settings unavailable") && account.includes("setLoadAttempt"));
check("Calendar reminders cannot remain stuck in text-only loading", calendar.includes("upcomingError") && calendar.includes("Upcoming reminders unavailable") && calendar.includes("<LoadingState") && calendar.includes("<RequestEmptyState"));
check("Timeline uses shared first-load and stale-refresh recovery", timeline.includes("<LoadingState") && timeline.includes("Timeline unavailable") && timeline.includes("Timeline refresh failed"));
check("My Work uses shared first-load and stale-refresh recovery", myWork.includes("<LoadingState") && myWork.includes("My Work unavailable") && myWork.includes("My Work refresh failed"));
check("Project Control first load uses structural skeleton", projectControl.includes('label="Loading project control data"') && projectControl.includes("<LoadingState"));

const nonSemanticTags = ["div", "article", "section", "span", "li", "label"];
let pointerOnly = 0;
for (const absolute of await tsxFiles(path.join(root, "packages", "renderer", "src"))) {
  const source = await readFile(absolute, "utf8");
  for (const tag of nonSemanticTags) pointerOnly += (source.match(new RegExp(`<${tag}\\b[^>]*on(?:Click|DoubleClick)\\s*=`, "gs")) || []).length;
}
check("pass 5 preserves zero pointer-only semantic debt", pointerOnly === 0 && accessibilityAudit.includes("nonSemanticInteractiveTags"), `${pointerOnly} remaining`);
const colorBaseline = JSON.parse(colorBaselineText);
const rawColorTotal = Object.values(colorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0);
check("pass 5 preserves pass 3 raw-color ratchet", colorBaseline.version === 3 && rawColorTotal <= 1576, `${rawColorTotal}/1576`);

check("pass 5 API capability is current", apiContracts.includes('version: "2026-08-02.63"') && apiContracts.includes('"ux-polish-pass-5-v1"'));
check("pass 5 release notes document recovery contract", notes.includes("stale usable data") && notes.includes("2026-08-02.34") && notes.includes("ux-polish-pass-5-v1"));
check("pass 5 documentation defines release-blocking boundary", doc.includes("Release-blocking boundary") && doc.includes("ClusterApiClientError") && doc.includes("stale data"));
const pkg = JSON.parse(packageText);
check("pass 5 audit is in aggregate audit command", String(pkg.scripts?.audit || "").includes("ux-polish-pass-five-audit.mjs"));
check("pass 5 audit has named package script", String(pkg.scripts?.["audit:ux-polish-pass-five"] || "").includes("ux-polish-pass-five-audit.mjs"));
check("pass 5 audit is invoked by master packaging", packager.includes("ux-polish-pass-five-audit.mjs"));
check("pass 5 documentation is packaged", packager.includes("docs/UX_POLISH_PASS_5.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster UX polish pass 5 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
