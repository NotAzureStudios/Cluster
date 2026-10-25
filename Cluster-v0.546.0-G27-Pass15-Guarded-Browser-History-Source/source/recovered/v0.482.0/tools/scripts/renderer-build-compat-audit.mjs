import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const dialog = await read("packages/renderer/src/components/cluster-dialog-service.ts");
const desktop = await read("packages/renderer/src/core/desktop.ts");
const admin = await read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const backgroundJobs = await read("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx");
const integrations = await read("packages/renderer/src/features/admin/IntegrationProvidersPanel.tsx");
const shell = await read("packages/renderer/src/features/application/modules/application-shell.tsx");
const application = await read("packages/renderer/src/features/application/ClusterApplication.tsx");
const calendar = await read("packages/renderer/src/features/calendar/CalendarPage.tsx");
const desktopServices = await read("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx");
const copyrightReport = await read("packages/renderer/src/features/legal/CopyrightReportPage.tsx");
const copyrightAdmin = await read("packages/renderer/src/features/legal/CopyrightWorkflowAdminPanel.tsx");
const notifications = await read("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const operationsAdmin = await read("packages/renderer/src/features/operations/modules/operations-admin.tsx");
const operationsDelivery = await read("packages/renderer/src/features/operations/modules/operations-delivery.tsx");
const operationsWorkflows = await read("packages/renderer/src/features/operations/modules/operations-workflows.tsx");
const intelligence = await read("packages/renderer/src/features/projects/ProjectIntelligencePanel.tsx");
const projects = await read("packages/renderer/src/features/projects/ProjectsPage.tsx");

const rendererFiles = [
  dialog, desktop, admin, backgroundJobs, integrations, shell, application, calendar, desktopServices,
  copyrightReport, copyrightAdmin, notifications, operationsAdmin, operationsDelivery, operationsWorkflows,
  intelligence, projects,
];

const checks = [];
const check = (label, ok) => checks.push({ label, ok: Boolean(ok) });

check("dialog enqueue input distributes confirm and prompt request shapes", dialog.includes('type ClusterDialogInput = Omit<ClusterConfirmDialogRequest, "id"> | Omit<ClusterPromptDialogRequest, "id">') && dialog.includes("request: ClusterDialogInput"));
check("native file-watch listeners only accept watch events", desktop.includes("const nativeEventListeners = new Set<(event: ClusterDesktopFileWatchEvent) => void>();"));
check("native file-watch unsubscribe callbacks return void", desktop.includes("return () => { nativeEventListeners.delete(callback); };") && desktop.includes("return () => { nativeEventListeners.delete(listener); };"));
check("admin refresh action callback resolves void", admin.includes('onSelect: async () => { await loadAdminUsers(); }'));
check("renderer source avoids ES2021 String.replaceAll", !rendererFiles.some((source) => source.includes(".replaceAll(")));
check("background job label formatter remains ES2020 compatible", backgroundJobs.includes('.replace(/_/g, " ")'));
check("integration provider label formatter remains ES2020 compatible", integrations.includes('.replace(/-/g, " ")'));
check("copyright report formatter remains ES2020 compatible", copyrightReport.includes('.replace(/_/g, " ")'));
check("copyright admin formatter remains ES2020 compatible", copyrightAdmin.includes('.replace(/_/g, " ")'));
check("desktop project tabs receive the canonical current navigation route", shell.includes("screen, currentRoute, user") && shell.includes("activeRoute: String(currentRoute || screen)") && application.includes("currentRoute={currentNavigationRoute}"));
check("calendar unknown errors are boolean-narrowed before JSX", calendar.includes("{Boolean(upcomingError) && <RequestErrorState"));
check("notification unknown errors are boolean-narrowed before JSX", notifications.includes("{Boolean(loadError) && items.length > 0 && <RequestErrorState"));
check("desktop native services consume a void-returning file-watch unsubscribe", desktopServices.includes("const unsubscribe = subscribeNativeFileWatch") && desktop.includes("return () => { nativeEventListeners.delete(listener); };"));
check("shared create drawer lazy import resolves from operations/modules", operationsWorkflows.includes('import("../../create/SharedCreateDrawer")'));
check("shared create drawer dependencies remain part of the lazy feature contract", operationsAdmin.includes("dependencies={SHARED_CREATE_DEPENDENCIES}"));
check("operations delivery imports the shared prompt service", operationsDelivery.includes('import { promptCluster } from "../../../components/cluster-dialog-service"'));
check("project intelligence status tone uses an accepted semantic tone", intelligence.includes('const deliveryTone: "danger" | "good" | "warning"') && !intelligence.includes('const deliveryTone: "danger" | "good" | "accent"'));
check("portfolio attention scoring supplies project status", projects.includes("projectAttentionScore(fact.project, fact.status, fact.gaps.length, fact.completeness)"));
check("renderer ES2020 contract has no Array.at usage in repaired surfaces", !rendererFiles.some((source) => /\.at\s*\(/.test(source)));
check("renderer ES2020 contract has no findLast/findLastIndex usage in repaired surfaces", !rendererFiles.some((source) => /\.findLast(?:Index)?\s*\(/.test(source)));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nCluster renderer build compatibility audit: ${checks.length - failed.length}/${checks.length} passed.`);
if (failed.length) process.exit(1);
