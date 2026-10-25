import type { MetadataExportPolicy, MetadataExportSelection } from "@cluster/shared";
import type { ViewerAssetSession } from "./viewer-contracts";
import { API_URL, api } from "../../core/api";
import { downloadNativeResource } from "../../core/desktop";
import { copyClusterText } from "../../core/clipboard";
import { recordBrowserDownloadHandoff } from "../../core/browser-download-transfers";
import { desktopWorkspaceRouteFromCurrentLocation, openCurrentWorkInDesktopWindow } from "../workflow/workspace-window";

export type ViewerMetadataExportPreview = {
  assetId: string;
  policy: MetadataExportPolicy;
  metadata: Record<string, unknown>;
  sensitiveMetadata: Record<string, unknown>;
  sensitiveMetadataRedacted: boolean;
  removedSensitiveCategories: string[];
};

export type ViewerExportResult = {
  status: "ready" | "queued";
  policy: MetadataExportPolicy;
  variantKey?: string;
  artifactId?: string;
  downloadUrl?: string;
  fileName?: string;
  checksumSha256?: string | null;
};

type ViewerExportList = {
  items: Array<{
    id: string;
    variantKey: string;
    metadataPolicy: MetadataExportPolicy;
    stale: boolean;
    downloadUrl: string;
    fileName?: string;
    checksumSha256?: string | null;
  }>;
};

function reviewAssetId(session: ViewerAssetSession) {
  const locator = session.resource.source.locator;
  return locator.provider === "review_asset" ? locator.assetId : null;
}

function browserDownload(url: string, fileName: string) {
  if (typeof document === "undefined") return null;
  const anchor = document.createElement("a");
  anchor.href = `${API_URL}${url}`;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return recordBrowserDownloadHandoff({ url, fileName });
}

function nativeCapabilityHost() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
}

export async function downloadViewerResource(input: { url: string; fileName: string; checksumSha256?: string | null }) {
  const relativeUrl = String(input.url || "");
  if (!relativeUrl.startsWith("/api/")) throw new Error("Viewer downloads must use an authenticated Cluster API resource path.");
  if (nativeCapabilityHost()) {
    try {
      const result = await downloadNativeResource({ url: relativeUrl, fileName: input.fileName, checksumSha256: input.checksumSha256 });
      if (result?.accepted) return { native: true, transferId: result.transferId };
    } catch {
      // Fall through to the authenticated browser endpoint if native transfer is unavailable.
    }
  }
  const transferId = browserDownload(relativeUrl, input.fileName);
  if (!transferId) throw new Error("This runtime cannot start a file download.");
  return { native: false, transferId };
}

export async function previewViewerExport(session: ViewerAssetSession, selection: MetadataExportSelection) {
  const assetId = reviewAssetId(session);
  if (!assetId) throw new Error("Metadata export preview is available only for canonical review assets.");
  return api<ViewerMetadataExportPreview>(`/api/review-assets/${encodeURIComponent(assetId)}/metadata-export-policy/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  });
}

export async function requestViewerExport(session: ViewerAssetSession, selection: MetadataExportSelection) {
  const assetId = reviewAssetId(session);
  if (!assetId) throw new Error("Metadata export is available only for canonical review assets.");
  const response = await api<ViewerExportResult>(`/api/review-assets/${encodeURIComponent(assetId)}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  });
  if (response.status === "ready" && response.downloadUrl && response.fileName) {
    await downloadViewerResource({ url: response.downloadUrl, fileName: response.fileName, checksumSha256: response.checksumSha256 });
    return { ...response, downloaded: true };
  }
  if (response.status !== "queued" || !response.variantKey) return { ...response, downloaded: false };

  // The worker is durable and may finish after the viewer closes. Poll briefly for the common case;
  // a later command invocation will reuse the exact same variant instead of creating another job.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const listing = await api<ViewerExportList>(`/api/review-assets/${encodeURIComponent(assetId)}/exports`);
    const artifact = listing.items.find((item) => item.variantKey === response.variantKey && !item.stale);
    if (!artifact) continue;
    const fallbackName = `${session.resource.source.title || "asset"}-${selection.policy}${session.resource.source.originalName.includes(".") ? `.${session.resource.source.originalName.split(".").pop()}` : ""}`;
    await downloadViewerResource({ url: artifact.downloadUrl, fileName: artifact.fileName || fallbackName, checksumSha256: artifact.checksumSha256 });
    return { ...response, downloaded: true };
  }
  return { ...response, downloaded: false };
}

export async function downloadViewerOriginal(session: ViewerAssetSession) {
  const assetId = reviewAssetId(session);
  if (!assetId) throw new Error("Original download is available only for canonical review assets.");
  return downloadViewerResource({
    url: `/api/review-assets/${encodeURIComponent(assetId)}/download`,
    fileName: session.resource.source.originalName || session.resource.source.title || "asset",
    checksumSha256: session.resource.source.checksumSha256 || null,
  });
}

export async function copyViewerReviewLink() {
  if (typeof window === "undefined") return false;
  return copyClusterText(window.location.href);
}

export function canDetachCurrentViewer() {
  return Boolean(desktopWorkspaceRouteFromCurrentLocation());
}

export async function detachCurrentViewer(title: string) {
  return openCurrentWorkInDesktopWindow(undefined, title);
}

export function populateViewerDragTransfer(event: Pick<DragEvent, "dataTransfer"> | { dataTransfer: DataTransfer }, session: ViewerAssetSession) {
  const assetId = reviewAssetId(session);
  if (!assetId || !session.capabilities.downloadOriginal || !event.dataTransfer || typeof window === "undefined") return false;
  const relative = `/api/review-assets/${encodeURIComponent(assetId)}/download`;
  const absolute = new URL(`${API_URL}${relative}`, window.location.href).toString();
  const fileName = session.resource.source.originalName || session.resource.source.title || "asset";
  const mime = session.resource.source.mimeType || "application/octet-stream";
  event.dataTransfer.effectAllowed = "copyLink";
  event.dataTransfer.setData("text/uri-list", absolute);
  event.dataTransfer.setData("text/plain", absolute);
  event.dataTransfer.setData("DownloadURL", `${mime}:${fileName}:${absolute}`);
  return true;
}
