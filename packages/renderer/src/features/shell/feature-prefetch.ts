import type { AppScreen } from "../../core/navigation";
import { queryApi } from "../../core/api";
import { isStandaloneToolRoute, preloadStandaloneTool } from "../application/modules/application-standalone-tool-registry";

type PrefetchableScreen = Extract<AppScreen,
  | "people"
  | "mywork"
  | "activity"
  | "projects"
  | "project"
  | "board"
  | "whiteboard"
  | "timeline"
  | "tickets"
  | "calendar"
  | "scheduler"
  | "library"
  | "packets"
  | "inventory"
  | "vault"
  | "admin"
  | "toolInfrastructure"
  | "integrations"
  | "settings"
  | "studioSettings"
  | "serverConfig"
>;

const loaders: Partial<Record<PrefetchableScreen, () => Promise<unknown>>> = {
  people: () => import("../people/PeoplePages"),
  mywork: () => import("../work/MyWorkPage"),
  activity: () => import("../activity/ActivityPage"),
  projects: () => import("../projects/ProjectsPage"),
  project: () => import("../projects/ProjectDetailPage"),
  board: () => import("../boards/BoardWorkspacePage"),
  whiteboard: () => import("../whiteboards/WhiteboardWorkspacePage"),
  timeline: () => import("../timeline/TimelineWorkspacePage"),
  tickets: () => import("../tickets/TicketSystemPage"),
  calendar: () => import("../calendar/CalendarPage"),
  scheduler: () => import("../time/TimeWorkspacePage"),
  library: () => import("../library/LibraryWorkspacePage"),
  packets: () => import("../packets/PacketsPage"),
  admin: () => import("../admin/AdminWorkspacePage"),
  toolInfrastructure: () => Promise.all([import("../admin/AdminWorkspacePage"), import("../admin/ProductionIntegrationAdminPages")]),
  settings: () => import("../settings/AccountSettingsPage"),
  studioSettings: () => import("../settings/StudioSettingsPage"),
  serverConfig: () => import("../settings/ServerConfigPage"),
};

const pending = new Map<string, Promise<unknown>>();
const dataPending = new Map<string, Promise<unknown>>();
const scheduled = new Set<string>();
const recentDataPrefetch = new Map<string, number>();
const DATA_PREFETCH_COOLDOWN_MS = 30_000;

const dataLoaders: Partial<Record<PrefetchableScreen, () => Promise<unknown>>> = {
  projects: () => queryApi("/api/projects", { staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["projects", "prefetch"] }),
  project: () => queryApi("/api/projects", { staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["projects", "prefetch"] }),
  tickets: () => queryApi("/api/tickets/workspace?detail=summary", { staleMs: 5_000, maxAgeMs: 30 * 60_000, tags: ["tickets", "workspace", "prefetch"] }),
  calendar: () => queryApi("/api/calendar/upcoming", { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["calendar", "prefetch"] }),
  activity: () => Promise.all([
    queryApi("/api/activity?limit=200", { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["activity", "prefetch"] }),
    queryApi("/api/users/activity", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "prefetch"] }),
  ]),
  mywork: () => Promise.all([
    queryApi("/api/team/assignments?scope=mine", { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "prefetch"] }),
    queryApi("/api/calendar/upcoming", { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["calendar", "prefetch"] }),
    queryApi("/api/activity?limit=100", { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["activity", "prefetch"] }),
  ]),
  people: () => Promise.all([
    queryApi("/api/users/activity", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "prefetch"] }),
    queryApi("/api/team/assignments", { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "prefetch"] }),
  ]),
  settings: () => queryApi("/api/settings", { staleMs: 30_000, maxAgeMs: 10 * 60_000, tags: ["settings", "prefetch"] }),
  studioSettings: () => queryApi("/api/settings", { staleMs: 30_000, maxAgeMs: 10 * 60_000, tags: ["settings", "prefetch"] }),
  serverConfig: () => queryApi("/api/server-config", { staleMs: 30_000, maxAgeMs: 10 * 60_000, tags: ["server-config", "prefetch"] }),
  library: () => queryApi("/api/library/workspace?parentId=root&scope=folder&q=&projectId=&ownerId=&type=all&status=active&mimeGroup=all&visibility=all&modified=any&pinned=all&sort=updated-desc&includeTreeFiles=0&limit=80", { staleMs: 10_000, maxAgeMs: 10 * 60_000, tags: ["library", "prefetch"] }),
};

function prefetchAllowed() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (typeof navigator === "undefined" || navigator.onLine === false) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  return !/^(slow-)?2g$/i.test(String(connection?.effectiveType || ""));
}

function prefetchFeatureData(screen: AppScreen) {
  const loader = dataLoaders[screen as PrefetchableScreen];
  if (!loader || !prefetchAllowed()) return Promise.resolve();
  const key = `data:${screen}`;
  const existing = dataPending.get(key);
  if (existing) return existing;
  const lastPrefetchAt = recentDataPrefetch.get(key) || 0;
  if (Date.now() - lastPrefetchAt < DATA_PREFETCH_COOLDOWN_MS) return Promise.resolve();
  recentDataPrefetch.set(key, Date.now());
  const task = loader().catch(() => undefined).finally(() => dataPending.delete(key));
  dataPending.set(key, task);
  return task;
}

export function prefetchFeature(screen: AppScreen) {
  const loader = isStandaloneToolRoute(screen)
    ? () => preloadStandaloneTool(screen)
    : loaders[screen as PrefetchableScreen];
  const existing = pending.get(screen);
  const moduleTask = existing || (loader ? loader().catch(() => undefined) : Promise.resolve());
  if (loader && !existing) pending.set(screen, moduleTask);
  return Promise.all([moduleTask, prefetchFeatureData(screen)]);
}

export function scheduleFeaturePrefetch(screen: AppScreen) {
  if (!prefetchAllowed() || scheduled.has(screen)) return;
  scheduled.add(screen);
  const run = () => { scheduled.delete(screen); void prefetchFeature(screen); };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const idleWindow = window as typeof window & { requestIdleCallback: (callback: () => void, options?: { timeout?: number }) => number };
    idleWindow.requestIdleCallback(run, { timeout: 1_200 });
  } else if (typeof window !== "undefined") {
    globalThis.setTimeout(run, 120);
  } else {
    scheduled.delete(screen);
  }
}
