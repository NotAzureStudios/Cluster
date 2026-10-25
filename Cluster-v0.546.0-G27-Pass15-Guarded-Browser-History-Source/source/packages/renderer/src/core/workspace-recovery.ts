import { parseNavigationRoute } from "./navigation";
import { readOfflineMeta, writeOfflineMeta } from "./offline-storage";

const RECOVERY_KEY = "workspace.recovery";
const MAX_PROJECT_TABS = 12;
const MAX_DETACHED_WINDOWS = 8;
const INSPECTOR_TOKEN = /^[a-z0-9_-]{1,48}:[A-Za-z0-9._:-]{1,160}$/i;
const WINDOW_TOKEN = /^[A-Za-z0-9._:-]{1,96}$/;

export type WorkspaceRecoverySnapshot = {
  version: 1;
  route: string;
  projectTabs: string[];
  inspector: string | null;
  capturedAt: number;
  windowKind: "primary" | "detached";
  windowId?: string | null;
};

type WorkspaceRecoveryStore = {
  version: 2;
  primary: WorkspaceRecoverySnapshot | null;
  detached: WorkspaceRecoverySnapshot[];
};

function safeRoute(value: unknown) {
  const route = String(value || "").replace(/^#/, "").trim().slice(0, 320);
  return parseNavigationRoute(route) ? route : "dashboard";
}

function safeInspector(value: unknown) {
  const token = String(value || "").trim().slice(0, 220);
  return token && INSPECTOR_TOKEN.test(token) ? token : null;
}

function safeWindowId(value: unknown) {
  const token = String(value || "").trim().slice(0, 96);
  return token && WINDOW_TOKEN.test(token) ? token : null;
}

function sanitizeSnapshot(value: unknown): WorkspaceRecoverySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<WorkspaceRecoverySnapshot>;
  const capturedAt = Number(record.capturedAt || 0);
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return null;
  return {
    version: 1,
    route: safeRoute(record.route),
    projectTabs: Array.isArray(record.projectTabs) ? record.projectTabs.map(String).filter(Boolean).slice(-MAX_PROJECT_TABS) : [],
    inspector: safeInspector(record.inspector),
    capturedAt,
    windowKind: record.windowKind === "detached" ? "detached" : "primary",
    windowId: safeWindowId(record.windowId),
  };
}

function sanitizeStore(value: unknown): WorkspaceRecoveryStore {
  if (value && typeof value === "object" && !Array.isArray(value) && Number((value as WorkspaceRecoveryStore).version) === 2) {
    const record = value as WorkspaceRecoveryStore;
    const primary = sanitizeSnapshot(record.primary);
    const detached = Array.isArray(record.detached)
      ? record.detached.map(sanitizeSnapshot).filter((item): item is WorkspaceRecoverySnapshot => Boolean(item && item.windowKind === "detached")).sort((a, b) => b.capturedAt - a.capturedAt).slice(0, MAX_DETACHED_WINDOWS)
      : [];
    return { version: 2, primary: primary?.windowKind === "primary" ? primary : null, detached };
  }
  return { version: 2, primary: null, detached: [] };
}

async function readRecoveryStore() {
  return sanitizeStore(await readOfflineMeta<WorkspaceRecoveryStore>(RECOVERY_KEY));
}

function freshSnapshot(snapshot: WorkspaceRecoverySnapshot | null, maxAgeMs: number) {
  return snapshot && Date.now() - snapshot.capturedAt <= maxAgeMs ? snapshot : null;
}

async function readFreshRecoveryStore(maxAgeMs: number) {
  const store = await readRecoveryStore();
  const cutoff = Date.now() - Math.max(60_000, maxAgeMs);
  const primary = store.primary && store.primary.capturedAt >= cutoff ? store.primary : null;
  const detached = store.detached.filter((snapshot) => snapshot.capturedAt >= cutoff).slice(0, MAX_DETACHED_WINDOWS);
  if (primary !== store.primary || detached.length !== store.detached.length) {
    await writeOfflineMeta(RECOVERY_KEY, { version: 2, primary, detached } satisfies WorkspaceRecoveryStore);
  }
  return { version: 2, primary, detached } satisfies WorkspaceRecoveryStore;
}

export async function saveWorkspaceRecoverySnapshot(input: Omit<WorkspaceRecoverySnapshot, "version" | "capturedAt"> & { capturedAt?: number }) {
  const snapshot: WorkspaceRecoverySnapshot = {
    version: 1,
    route: safeRoute(input.route),
    projectTabs: input.projectTabs.map(String).filter(Boolean).slice(-MAX_PROJECT_TABS),
    inspector: safeInspector(input.inspector),
    capturedAt: input.capturedAt || Date.now(),
    windowKind: input.windowKind === "detached" ? "detached" : "primary",
    windowId: safeWindowId(input.windowId),
  };
  const store = await readRecoveryStore();
  if (snapshot.windowKind === "primary") {
    store.primary = snapshot;
  } else {
    const identity = snapshot.windowId || `${snapshot.route}|${snapshot.inspector || ""}`;
    store.detached = [snapshot, ...store.detached.filter((item) => (item.windowId || `${item.route}|${item.inspector || ""}`) !== identity)]
      .sort((a, b) => b.capturedAt - a.capturedAt)
      .slice(0, MAX_DETACHED_WINDOWS);
  }
  await writeOfflineMeta(RECOVERY_KEY, store);
  return snapshot;
}

export async function readWorkspaceRecoverySnapshot(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const store = await readFreshRecoveryStore(maxAgeMs);
  return freshSnapshot(store.primary, maxAgeMs);
}

export async function readDetachedWorkspaceRecoverySnapshots(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const store = await readFreshRecoveryStore(maxAgeMs);
  return store.detached.filter((snapshot) => Boolean(freshSnapshot(snapshot, maxAgeMs))).slice(0, MAX_DETACHED_WINDOWS);
}

function desktopRoute(snapshot: WorkspaceRecoverySnapshot) {
  if (!snapshot.inspector) return snapshot.route;
  const [scope, id] = snapshot.inspector.split(":", 2);
  return scope && id ? `${snapshot.route}/inspect/${scope.replace(/-/g, "_")}/${id}` : snapshot.route;
}

export async function cleanupWorkspaceRecoverySnapshots(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const store = await readFreshRecoveryStore(maxAgeMs);
  return { primary: Boolean(store.primary), detached: store.detached.length };
}

export async function restoreDetachedWorkspaceRecoverySnapshots(snapshots?: WorkspaceRecoverySnapshot[]) {
  const candidates = (snapshots || await readDetachedWorkspaceRecoverySnapshots()).slice(0, MAX_DETACHED_WINDOWS);
  let restored = 0;
  if (!candidates.length) return { restored, requested: 0 };
  const { openDesktopWorkspaceWindow } = await import("./desktop");
  for (const snapshot of candidates) {
    if (await openDesktopWorkspaceWindow(desktopRoute(snapshot), "Recovered workspace").catch(() => false)) restored += 1;
  }
  return { restored, requested: candidates.length };
}

export async function restoreWorkspaceRecoverySnapshot(snapshot?: WorkspaceRecoverySnapshot | null) {
  const recovered = snapshot || await readWorkspaceRecoverySnapshot();
  if (!recovered || typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (recovered.inspector) url.searchParams.set("inspect", recovered.inspector);
  else url.searchParams.delete("inspect");
  url.hash = `#${recovered.route}`;
  window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("hashchange"));
  window.dispatchEvent(new CustomEvent("cluster:workspace-recovered", { detail: recovered }));
  return true;
}
