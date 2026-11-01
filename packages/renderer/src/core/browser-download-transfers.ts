import { clusterApiFetch } from "@cluster/api-client";
export type ClusterBrowserDownloadHandoff = {
  id: string;
  fileName: string;
  url: string;
  state: "handed-off" | "saved";
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

export function recordBrowserDownloadHandoff(input: { fileName: string; url: string; state?: "handed-off" | "saved" }) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  snapshot = [{ id, fileName: input.fileName, url: input.url, state: input.state || "handed-off", startedAt: Date.now() }, ...snapshot].slice(0, 12);
  emit();
  return id;
}

export function removeBrowserDownloadHandoff(id: string) {
  const next = snapshot.filter((item) => item.id !== id);
  if (next.length === snapshot.length) return;
  snapshot = next;
  emit();
}

/** Fetches authenticated Cluster files before asking the browser to save them.
 * Small files use a bounded Blob; larger files are handed to the browser's own
 * download pipeline, which streams to disk and does not expose final status.
 */
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
const MAX_OUTSTANDING_BLOBS = 4;
const BLOB_REVOKE_DELAY_MS = 60_000;
const pendingBlobUrls = new Map<string, number>();

export async function downloadAuthenticatedClusterFile(input: { url: string; fileName: string }): Promise<{ state: "saved" | "handed-off"; transferId: string }> {
  const { API_URL } = await import("./api/config");
  if (typeof document === "undefined") throw new Error("Downloads require an active browser window.");
  const expectedOrigin = new URL(API_URL || window.location.origin, window.location.origin).origin;
  const resolved = new URL(input.url, API_URL || window.location.origin);
  if (resolved.origin !== expectedOrigin || !resolved.pathname.startsWith("/api/")) {
    throw new Error("Only authenticated Cluster API downloads are supported.");
  }
  const response = await clusterApiFetch(resolved.pathname + resolved.search, { credentials: "include", cache: "no-store", headers: { Accept: "application/octet-stream, application/pdf, application/zip, */*" } });
  if (!response.ok) {
    const details = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null) as { message?: string; error?: string } | null : null;
    await response.body?.cancel().catch(() => undefined);
    throw new Error(details?.message || details?.error || "Download failed: server returned HTTP " + response.status + ".");
  }
  const responseUrl = new URL(response.url || resolved.href, resolved.href);
  if (responseUrl.origin !== expectedOrigin || !responseUrl.pathname.startsWith("/api/") || response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The download returned an HTML page instead of a file. Verify your session and server address.");
  }
  const fileName = input.fileName.replace(/[\\/\r\n]/g, "_").trim() || "cluster-download";
  const clickLink = (href: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  };
  const handoff = async (reader?: ReadableStreamDefaultReader<Uint8Array>) => {
    // A native browser download is a new request. Disk-save status is not observable.
    if (reader) await reader.cancel().catch(() => undefined);
    else await response.body?.cancel().catch(() => undefined);
    clickLink(resolved.href);
    return { state: "handed-off" as const, transferId: recordBrowserDownloadHandoff({ fileName, url: resolved.pathname, state: "handed-off" }) };
  };
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > MAX_BUFFERED_BYTES || !response.body || pendingBlobUrls.size >= MAX_OUTSTANDING_BLOBS) {
    return handoff();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BUFFERED_BYTES) return await handoff(reader);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    clickLink(blobUrl);
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    throw error;
  }
  const timer = window.setTimeout(() => {
    pendingBlobUrls.delete(blobUrl);
    URL.revokeObjectURL(blobUrl);
  }, BLOB_REVOKE_DELAY_MS);
  pendingBlobUrls.set(blobUrl, timer);
  return { state: "saved", transferId: recordBrowserDownloadHandoff({ fileName, url: resolved.pathname, state: "saved" }) };
}
