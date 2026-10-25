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

const [performanceCore, api, prefetch, shell, tickets, library, notifications, myWork, activity, people, scheduler, loadingState, skeletonCss, docs, notes, pkgText, packager, contracts] = await Promise.all([
  text("packages/renderer/src/core/perceived-performance.ts"),
  text("packages/renderer/src/core/api.ts"),
  text("packages/renderer/src/features/shell/feature-prefetch.ts"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/tickets/TicketSystemPage.tsx"),
  text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
  text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
  text("packages/renderer/src/features/work/MyWorkPage.tsx"),
  text("packages/renderer/src/features/activity/ActivityPage.tsx"),
  text("packages/renderer/src/features/people/PeoplePages.tsx"),
  text("packages/renderer/src/features/time/TimeWorkspacePage.tsx"),
  text("packages/renderer/src/components/LoadingState.tsx"),
  text("packages/renderer/src/styles/design-system/skeletons.css"),
  text("docs/PERCEIVED_PERFORMANCE_PHASE9.md"),
  text("RELEASE_NOTES_v0.432.0.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("packages/shared/src/api-contracts.ts"),
]);

check("scroll restoration uses session storage only", performanceCore.includes("window.sessionStorage") && !performanceCore.includes("localStorage"));
check("scroll restoration bounds persisted offsets", performanceCore.includes("MAX_SCROLL_TOP") && performanceCore.includes("Math.min(MAX_SCROLL_TOP"));
check("scroll persistence is animation-frame throttled", performanceCore.includes("window.requestAnimationFrame") && performanceCore.includes("frameRef"));
check("scroll persistence degrades when storage is unavailable", performanceCore.includes("progressive enhancement") && performanceCore.includes("catch"));

check("query cache retains stale-while-revalidate support", api.includes("staleWhileRevalidate?: boolean") && api.includes("revalidateCachedQuery"));
check("query cache remains authenticated-scope keyed", api.includes('const memoryKey = `${getOfflineScope()}:${path}`'));
check("query cache retains durable network fallback", api.includes("isApiNetworkFailure(error)") && api.includes("durable.value"));
check("mutation writes still invalidate read queries", api.includes("invalidateApiQueries()") && api.includes("method !== \"GET\""));

check("navigation prefetch warms safe read data", prefetch.includes("const dataLoaders") && prefetch.includes("queryApi("));
check("navigation prefetch skips data while offline", prefetch.includes("navigator.onLine === false"));
check("navigation prefetch covers projects and tickets", prefetch.includes('projects: () => queryApi("/api/projects"') && prefetch.includes('tickets: () => queryApi("/api/tickets/workspace?detail=summary"'));
check("navigation prefetch covers work, activity, people, library and settings", ["mywork:", "status:", "profiles:", "knowledge:", "settings:"].every((token) => prefetch.includes(token)));
check("shell schedules intent prefetch instead of immediate request work", shell.includes("scheduleFeaturePrefetch") && !shell.includes("void prefetchFeature(next)"));

check("My Work consumes prefetched query reads", myWork.includes("queryApi<TeamAssignment[]>") && myWork.includes("queryApi<UpcomingPayload>") && myWork.includes("queryApi<ActivityEvent[]>"));
check("Activity consumes cached activity and people reads", activity.includes("queryApi<ActivityEvent[]>") && activity.includes("queryApi<UserActivitySummary[]>"));
check("People consumes cached directory and assignment reads", people.includes("queryApi<UserActivitySummary[]>") && people.includes("queryApi<TeamAssignment[]>"));

check("Library distinguishes same-query refresh from a new query", library.includes("const sameQueryRefresh = reset && lastLoadedQueryKey.current === queryKey"));
check("Library same-query refresh uses non-blocking state", library.includes("setRefreshing(true)") && library.includes('ClusterStatus state="loading" compact>Refreshing'));
check("Library workspace uses bounded query cache", library.includes("queryApi<LibraryWorkspace>") && library.includes("staleWhileRevalidate: true"));
check("Library uses structural list and grid skeletons", library.includes("CardGridLoadingState") && library.includes("LoadingState label=\"Loading Library items\""));
check("Library results expose refresh busy state", library.includes("aria-busy={loading || refreshing}"));
check("canonical skeletons retain reduced-motion support", skeletonCss.includes("prefers-reduced-motion: reduce") && loadingState.includes("CardGridLoadingState"));

check("Ticket virtual list restores session scroll", tickets.includes("usePersistedScrollPosition(props.scrollKey)"));
check("Ticket scroll context is filter-aware", tickets.includes('scrollKey={`tickets:${queue}:'));
check("Ticket virtual window clamps restored offset", tickets.includes("const effectiveScrollTop = Math.min(scrollTop"));
check("Library virtual list restores session scroll", library.includes("usePersistedScrollPosition(scrollKey)"));
check("Library virtual window clamps restored offset", library.includes("const effectiveScrollTop = Math.min(scrollTop"));
check("Inbox scroll is lane/group/query scoped", notifications.includes('usePersistedScrollPosition(`notifications:${filter}:${groupMode}:${needle}`)'));

check("Library refresh preserves only still-valid selections", library.includes("if (sameQueryRefresh) setSelectedIds") && library.includes("resultIds.has(id)"));
check("Library new queries clear prior selection", library.includes("else setSelectedIds(new Set())"));
check("Inbox refresh prunes missing selections", notifications.includes("availableIds.has(id)"));

check("Notification read state updates optimistically", notifications.indexOf("setItems((current) => current.map") < notifications.indexOf('await api("/api/notifications/read"'));
check("Notification optimistic read state keeps a targeted snapshot", notifications.includes("const previous = new Map(items.filter"));
check("Notification optimistic read state rolls back affected records", notifications.includes("const snapshot = previous.get(item.id)") && notifications.includes("Notification update rolled back"));
check("Notification unread summary rolls back by inverse delta", notifications.includes("current.unread - unreadDelta"));

check("My Work exposes non-blocking refresh state", myWork.includes("setRefreshing(true)") && myWork.includes('ClusterStatus state="loading" compact>Refreshing'));
check("Inbox exposes non-blocking refresh state", notifications.includes("setRefreshing(true)") && notifications.includes('ClusterStatus state="loading" compact>Refreshing'));
check("Scheduler manual refresh preserves the current workspace", scheduler.includes('onSelect: () => loadWorkspace(false)') && scheduler.includes("else if (workspace) setRefreshing(true)"));
check("Scheduler date/project changes remain blocking", scheduler.includes("loadWorkspace(true);") && scheduler.includes("if (showLoading) setLoading(true)"));

check("Phase 9 documentation records server-authoritative cache boundary", docs.includes("server remains authoritative") && docs.includes("does not add a second client cache"));
check("Phase 9 documentation limits optimistic mutation scope", docs.includes("precise rollback/undo contract") && docs.includes("optimistic destructive writes without rollback"));
check("Phase 9 documentation defines release-blocking boundary", docs.includes("## Release-blocking boundary") && docs.includes("perceived-performance-phase9-audit.mjs"));
check("Phase 9 release notes identify capability", notes.includes("perceived-performance-phase9-v1") && notes.includes("API contract: unchanged from `2026-08-02.62`"));
check("server API contract remains unchanged", contracts.includes('version: "2026-08-02.63"'));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 9 gate", String(pkg.scripts?.audit || "").includes("perceived-performance-phase9-audit.mjs"));
check("named Phase 9 audit exists", String(pkg.scripts?.["audit:perceived-performance-phase9"] || "").includes("perceived-performance-phase9-audit.mjs"));
check("master packager invokes Phase 9 gate", packager.includes("perceived-performance-phase9-audit.mjs"));
const packagedDocOccurrences = packager.split("docs/PERCEIVED_PERFORMANCE_PHASE9.md").length - 1;
check("master and source packages carry Phase 9 docs", packagedDocOccurrences >= 2);

console.log(`\nPerceived performance Phase 9 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
