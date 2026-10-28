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

/** Fetches authenticated Cluster files rather than claiming that a synthetic click succeeded.
 * Small/medium files are verified and handed to the browser as a Blob. Large files
 * use the server's streaming attachment response without buffering it in RAM.
 */
export async function downloadAuthenticatedClusterFile(input: { url: string; fileName: string }): Promise<{ state: "saved" | "handed-off"; transferId: string }> {
  const { API_URL } = await import("./api/config");
  if (typeof document === "undefined") throw new Error("Downloads require an active browser window.");
  const expectedOrigin = new URL(API_URL || window.location.origin, window.location.origin).origin;
  const resolved = new URL(input.url, API_URL || window.location.origin);
  if (resolved.origin !== expectedOrigin || !resolved.pathname.startsWith("/api/")) {
    throw new Error("Only authenticated Cluster API downloads are supported.");
  }
  const response = await clusterApiFetch(`${resolved.pathname}${resolved.search}`, { credentials: "include", cache: "no-store", headers: { Accept: "application/octet-stream, application/pdf, application/zip, */*" } });
  if (!response.ok) {
    const details = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null) as { message?: string; error?: string } | null : null;
    throw new Error(details?.message || details?.error || `Download failed: server returned HTTP ${response.status}.`);
  }
  const responseUrl = new URL(response.url || resolved.href, resolved.href);
  if (responseUrl.origin !== expectedOrigin || !responseUrl.pathname.startsWith("/api/") || response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    await response.body?.cancel();
    throw new Error("The download returned an HTML page instead of a file. Verify your session and server address.");
  }
  const fileName = input.fileName.replace(/[\\/\r\n]/g, "_").trim() || "cluster-download";
  const MAX_BUFFERED_BYTES = 128 * 1024 * 1024;
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > MAX_BUFFERED_BYTES) {
    await response.body?.cancel();
    // The server streams this file; its final browser save status is not observable.
    const link = document.createElement("a");
    link.href = resolved.href;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    return { state: "handed-off", transferId: recordBrowserDownloadHandoff({ fileName, url: resolved.pathname, state: "handed-off" }) };
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BUFFERED_BYTES) {
        await reader.cancel();
        throw new Error("Download is over 128 MiB without a Content-Length header. Use a server streaming download for this file.");
      }
      chunks.push(value);
    }
  }
  const blob = reader ? new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/octet-stream" }) : await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // A delayed revoke allows Chromium to consume the Blob URL after the click.
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
  return { state: "saved", transferId: recordBrowserDownloadHandoff({ fileName, url: resolved.pathname, state: "saved" }) };
}
