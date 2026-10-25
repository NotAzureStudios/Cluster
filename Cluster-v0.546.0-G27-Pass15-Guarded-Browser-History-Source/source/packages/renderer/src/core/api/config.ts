import { configureClusterApiClient, normalizeClusterApiBaseUrl } from "@cluster/api-client";
import { APP_VERSION } from "../version";
import { getOfflineScope } from "../offline-storage";
import { createDeviceProofHeaders } from "./device-proof";

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const desktopApiUrl = typeof window !== "undefined" ? window.clusterDesktop?.apiUrl : undefined;
export const API_URL = normalizeClusterApiBaseUrl(desktopApiUrl || runtimeEnv.VITE_API_URL || "");
export const API_TIMEOUT_MS = Number(runtimeEnv.VITE_API_TIMEOUT_MS || 20_000);
export const API_READ_RETRIES = Number(runtimeEnv.VITE_API_READ_RETRIES || 1);
export const API_RETRY_BASE_MS = Number(runtimeEnv.VITE_API_RETRY_BASE_MS || 250);
export const API_RETRY_MAX_MS = Number(runtimeEnv.VITE_API_RETRY_MAX_MS || 3_000);
configureClusterApiClient({
  baseUrl: API_URL,
  rendererHost: typeof window !== "undefined" && window.clusterDesktop ? "desktop" : "web",
  clientVersion: typeof window !== "undefined" ? window.clusterDesktop?.appVersion || APP_VERSION : APP_VERSION,
  maxReadRetries: API_READ_RETRIES,
  retryBaseDelayMs: API_RETRY_BASE_MS,
  retryMaximumDelayMs: API_RETRY_MAX_MS,
  requestHeaderProvider: async ({ pathname, method, requestId }) => createDeviceProofHeaders({ deviceId: installationDeviceId(), pathname, method, requestId }),
});

export type ApiRequestOptions = RequestInit & {
  skipCacheInvalidation?: boolean;
};

const SYNC_DEVICE_ID_KEY = "cluster-sync-device-id";
const INSTALLATION_DEVICE_ID_KEY = "cluster-installation-device-id";

export function syncDeviceId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const scope = getOfflineScope();
  const key = `${SYNC_DEVICE_ID_KEY}:${scope}`;
  const stored = window.localStorage.getItem(key);
  if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

export function resetSyncDeviceId() {
  if (typeof window !== "undefined") window.localStorage.removeItem(`${SYNC_DEVICE_ID_KEY}:${getOfflineScope()}`);
  return syncDeviceId();
}

export function installationDeviceId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const stored = window.localStorage.getItem(INSTALLATION_DEVICE_ID_KEY);
  if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
  const created = crypto.randomUUID();
  window.localStorage.setItem(INSTALLATION_DEVICE_ID_KEY, created);
  return created;
}

export function mutationIdempotencyKey(headers: Headers) {
  const existing = headers.get("X-Cluster-Idempotency-Key");
  if (existing) return existing;
  const created = crypto.randomUUID();
  headers.set("X-Cluster-Idempotency-Key", created);
  return created;
}
