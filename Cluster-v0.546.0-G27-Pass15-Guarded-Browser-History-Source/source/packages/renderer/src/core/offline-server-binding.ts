export type OfflineServerBinding = {
  serverInstanceId: string | null;
  serverDataEpoch: string | null;
  serverVersion: string | null;
  contractVersion: string | null;
  mutationSchemaVersion: number | null;
  observedAt: number;
};

const PREFIX = "cluster-offline-server-binding-v1:";

function storageAvailable() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readOfflineServerBinding(scope: string): OfflineServerBinding | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${scope}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OfflineServerBinding>;
    return {
      serverInstanceId: String(value.serverInstanceId || "").trim() || null,
      serverDataEpoch: String(value.serverDataEpoch || "").trim() || null,
      serverVersion: String(value.serverVersion || "").trim() || null,
      contractVersion: String(value.contractVersion || "").trim() || null,
      mutationSchemaVersion: Number.isInteger(value.mutationSchemaVersion) ? Number(value.mutationSchemaVersion) : null,
      observedAt: Number(value.observedAt || 0),
    };
  } catch {
    return null;
  }
}

export function writeOfflineServerBinding(scope: string, binding: Omit<OfflineServerBinding, "observedAt"> & { observedAt?: number }) {
  const value: OfflineServerBinding = { ...binding, observedAt: Number(binding.observedAt || Date.now()) };
  if (storageAvailable()) window.localStorage.setItem(`${PREFIX}${scope}`, JSON.stringify(value));
  return value;
}

export function queuedWorkMatchesServerBinding(
  item: { serverInstanceId?: string | null; serverDataEpoch?: string | null; contractVersion?: string | null; mutationSchemaVersion?: number | null },
  binding: OfflineServerBinding | null,
) {
  if (!binding?.serverInstanceId || !binding.serverDataEpoch || !binding.contractVersion || !binding.mutationSchemaVersion) return { ok: false, reason: "Server identity or sync contract is not known yet." };
  if (!item.serverInstanceId) return { ok: false, reason: "This queued work predates server identity binding and cannot be replayed safely." };
  if (item.serverInstanceId !== binding.serverInstanceId) return { ok: false, reason: "This queued work belongs to a different Cluster server instance." };
  if (!item.serverDataEpoch || item.serverDataEpoch !== binding.serverDataEpoch) return { ok: false, reason: "The server dataset changed after this work was queued (for example, after a restore). Review or discard it instead of replaying automatically." };
  if (!item.contractVersion || item.contractVersion !== binding.contractVersion) return { ok: false, reason: "This queued work was created under a different API contract." };
  if (!item.mutationSchemaVersion || item.mutationSchemaVersion !== binding.mutationSchemaVersion) return { ok: false, reason: "This queued work uses a different mutation schema." };
  return { ok: true, reason: null };
}
