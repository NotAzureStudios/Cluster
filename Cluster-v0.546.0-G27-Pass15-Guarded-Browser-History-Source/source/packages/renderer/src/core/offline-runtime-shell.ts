import type { OfflineOperationalSnapshot } from "./offline-runtime";

const listeners = new Set<() => void>();
let runtimePromise: Promise<typeof import("./offline-runtime")> | null = null;
let runtimeUnsubscribe: (() => void) | null = null;
let connectivitySnapshot = (typeof navigator === "undefined" || navigator.onLine !== false ? 1 : 0) | 2;
let operationalSnapshot: OfflineOperationalSnapshot = {
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  serverReachable: true,
  serverState: "unknown",
  readAccessAllowed: true,
  mutationReplayAllowed: true,
  syncing: false,
  uploading: false,
  pulling: false,
  pending: 0,
  paused: 0,
  conflicts: 0,
  failed: 0,
  queuedUploads: 0,
  pausedUploads: 0,
  failedUploads: 0,
  queuePressure: "normal",
  lastCheckedAt: null,
  consecutiveFailures: 0,
  nextSyncAt: null,
  serverOpenConflicts: 0,
  serverQuarantinedConflicts: 0,
  lastError: null,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function attachRuntime(runtime: typeof import("./offline-runtime")) {
  if (runtimeUnsubscribe) return;
  const synchronize = () => {
    const nextConnectivity = runtime.getOfflineConnectivitySnapshot();
    const nextOperational = runtime.getOfflineOperationalSnapshot();
    const changed = nextConnectivity !== connectivitySnapshot || nextOperational !== operationalSnapshot;
    connectivitySnapshot = nextConnectivity;
    operationalSnapshot = nextOperational;
    if (changed) emit();
  };
  synchronize();
  runtimeUnsubscribe = runtime.subscribeOfflineSync(synchronize);
}

function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("./offline-runtime").then((runtime) => {
      attachRuntime(runtime);
      return runtime;
    });
  }
  return runtimePromise;
}

export function initializeOfflineRuntime() {
  void loadRuntime().then((runtime) => runtime.initializeOfflineRuntime());
}

export function setOfflineRuntimeAuthenticated(authenticated: boolean) {
  if (!authenticated && !runtimePromise) return;
  void loadRuntime().then((runtime) => runtime.setOfflineRuntimeAuthenticated(authenticated));
}

export function refreshOfflineSyncState(options: { flush?: boolean; pull?: boolean; forceUploads?: boolean } = {}) {
  return loadRuntime().then((runtime) => runtime.refreshOfflineSyncState(options));
}

export function getOfflineConnectivitySnapshot() {
  return connectivitySnapshot;
}

export function getOfflineOperationalSnapshot() {
  return operationalSnapshot;
}

export function subscribeOfflineSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
