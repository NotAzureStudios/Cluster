export type ClusterBrowserDownloadHandoff = {
  id: string;
  fileName: string;
  url: string;
  state: "handed-off";
  startedAt: number;
};

let snapshot: ClusterBrowserDownloadHandoff[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getBrowserDownloadSnapshot() {
  return snapshot;
}

export function subscribeBrowserDownloads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordBrowserDownloadHandoff(input: { fileName: string; url: string }) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  snapshot = [{ id, fileName: input.fileName, url: input.url, state: "handed-off" as const, startedAt: Date.now() }, ...snapshot].slice(0, 12);
  emit();
  return id;
}

export function removeBrowserDownloadHandoff(id: string) {
  const next = snapshot.filter((item) => item.id !== id);
  if (next.length === snapshot.length) return;
  snapshot = next;
  emit();
}
