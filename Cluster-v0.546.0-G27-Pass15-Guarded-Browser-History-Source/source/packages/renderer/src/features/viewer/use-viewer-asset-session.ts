import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssetMetadataEnvelope, ReviewAssetCapabilities, SensitiveMetadataEnvelope, ViewableResource, ViewableResourceLocator } from "@cluster/shared";
import { api } from "../../core/api";
import { listNativeFileWatches, mountedHandleViewableResource, previewNativeHandle, startNativeFileWatch, stopNativeFileWatch, subscribeNativeFileWatch } from "../../core/desktop";
import type { ViewerAssetSession, ViewerAssetSessionInput, ViewerAssetSessionResult, ViewerReviewContext, ViewerShellState } from "./viewer-contracts";

const BASIC_VIEW_CAPABILITIES: ReviewAssetCapabilities = {
  viewAsset: true,
  viewBasicMetadata: true,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metadataFromAsset(asset: Record<string, unknown> | null): AssetMetadataEnvelope | null {
  if (!asset) return null;
  const metadata = record(asset.metadata);
  return metadata ? metadata as AssetMetadataEnvelope : null;
}

function reviewContextFromAsset(asset: Record<string, unknown> | null): ViewerReviewContext | null {
  if (!asset) return null;
  const comments = Array.isArray(asset.comments) ? asset.comments : [];
  const unresolvedCount = comments.filter((comment) => {
    const value = record(comment);
    const status = String(value?.status || "open").toLowerCase();
    return !["resolved", "closed", "done"].includes(status);
  }).length;
  const reviewerIds = Array.isArray(asset.reviewerIds) ? asset.reviewerIds.map(String).filter(Boolean) : asset.reviewerId ? [String(asset.reviewerId)] : [];
  return {
    assetId: typeof asset.id === "string" ? asset.id : null,
    status: typeof asset.status === "string" ? asset.status : null,
    approvalState: typeof asset.approvalState === "string" ? asset.approvalState : null,
    reviewRound: typeof asset.reviewRound === "string" || typeof asset.reviewRound === "number" ? asset.reviewRound : null,
    assigneeId: typeof asset.assigneeId === "string" ? asset.assigneeId : null,
    reviewerIds,
    unresolvedCount,
  };
}

async function loadRemoteSession(locator: Exclude<ViewableResourceLocator, { provider: "mounted_handle" }>, signal: AbortSignal): Promise<ViewerAssetSession> {
  if (locator.provider === "review_asset") {
    const payload = await api<{ asset: Record<string, unknown>; capabilities: ReviewAssetCapabilities; resource: ViewableResource }>(`/api/review-assets/${encodeURIComponent(locator.assetId)}/session`, { signal });
    return {
      resource: payload.resource,
      capabilities: payload.capabilities || BASIC_VIEW_CAPABILITIES,
      asset: payload.asset || null,
      metadata: metadataFromAsset(payload.asset || null),
      review: reviewContextFromAsset(payload.asset || null),
    };
  }
  if (locator.provider === "project_file") {
    const payload = await api<{ resource: ViewableResource }>(`/api/project-files/${encodeURIComponent(locator.fileId)}/viewable-resource`, { signal });
    return { resource: payload.resource, capabilities: BASIC_VIEW_CAPABILITIES, metadata: null, review: null };
  }
  const payload = await api<{ resource: ViewableResource }>(`/api/library/${encodeURIComponent(locator.itemId)}/viewable-resource`, { signal });
  return { resource: payload.resource, capabilities: BASIC_VIEW_CAPABILITIES, metadata: null, review: null };
}

function stateForResource(resource: ViewableResource): ViewerShellState {
  if (resource.source.support === "unsupported") return "unsupported";
  if (resource.source.support === "degraded") return "degraded";
  if (resource.source.support === "derivative" && !resource.preferredDerivativeId) return "degraded";
  return "ready";
}

export function useViewerAssetSession(input: ViewerAssetSessionInput | null): ViewerAssetSessionResult {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ViewerShellState>(input ? "loading" : "idle");
  const [session, setSession] = useState<ViewerAssetSession | null>(null);
  const [error, setError] = useState<unknown>(null);
  const identity = useMemo(() => {
    if (!input) return "none";
    if (input.resource) return `${input.resource.source.provider}:${input.resource.source.id}:${input.resource.source.versionId || ""}`;
    const locator = input.locator;
    return locator.provider === "review_asset" ? `${locator.provider}:${locator.assetId}`
      : locator.provider === "project_file" ? `${locator.provider}:${locator.fileId}`
      : locator.provider === "library_item" ? `${locator.provider}:${locator.itemId}`
      : `${locator.provider}:${locator.handleId}:${locator.revision || ""}`;
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setSession(null);
    if (!input) { setState("idle"); return () => controller.abort(); }
    setState("loading");
    if (input.resource) {
      const next: ViewerAssetSession = {
        resource: input.resource,
        capabilities: input.capabilities || BASIC_VIEW_CAPABILITIES,
        asset: input.asset || null,
        metadata: metadataFromAsset(input.asset || null),
        review: reviewContextFromAsset(input.asset || null),
      };
      setSession(next);
      setState(stateForResource(next.resource));
      return () => controller.abort();
    }
    if (input.locator.provider === "mounted_handle") {
      setError(new Error("Mounted handles require a locally resolved ViewableResource; raw native handles are never sent to the server."));
      setState("error");
      return () => controller.abort();
    }
    void loadRemoteSession(input.locator, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSession(next);
        setState(stateForResource(next.resource));
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        setError(nextError);
        setState("error");
      });
    return () => controller.abort();
  }, [identity, revision]);

  useEffect(() => {
    const resource = session?.resource;
    if (!resource || resource.source.locator.provider !== "mounted_handle") return;
    let disposed = false;
    let watchId = "";
    const handle = resource.source.locator.handleId;
    const refreshPreview = async () => {
      try {
        const preview = await previewNativeHandle(handle);
        if (disposed) return;
        const nextResource = mountedHandleViewableResource(preview);
        if (!nextResource) { setError(new Error("The native handle no longer resolves to a supported local media resource.")); setState("error"); return; }
        setSession((current) => current ? { ...current, resource: nextResource } : current);
        setError(null);
        setState(stateForResource(nextResource));
      } catch (nextError) {
        if (!disposed) { setError(nextError); setState("error"); }
      }
    };
    let lastChangeSeq = 0;
    const reconcileWatch = async () => {
      if (!watchId || disposed || document.visibilityState !== "visible") return;
      try {
        const watches = await listNativeFileWatches();
        if (disposed) return;
        const watch = watches.find((item) => item.watchId === watchId);
        if (!watch) return;
        const nextSeq = Math.max(0, Number(watch.changeSeq || 0));
        if (watch.exists === false) {
          setError(new Error("The local file behind this temporary Desktop handle is no longer available."));
          setState("error");
          lastChangeSeq = nextSeq;
          return;
        }
        if (nextSeq > lastChangeSeq) void refreshPreview();
        lastChangeSeq = nextSeq;
      } catch {
        // A temporary service outage should not invalidate an otherwise usable local preview.
      }
    };
    const unsubscribe = subscribeNativeFileWatch((event) => {
      if (disposed || !watchId || event.watchId !== watchId) return;
      if (event.exists === false) {
        setError(new Error("The local file behind this temporary Desktop handle is no longer available."));
        setState("error");
        return;
      }
      void refreshPreview();
    });
    // Native watcher events drive normal updates. This slow poll is only reconciliation for a
    // missed broker event and does not run while the renderer is hidden.
    const reconciliationTimer = window.setInterval(() => { void reconcileWatch(); }, 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void reconcileWatch(); };
    const onFocus = () => { void reconcileWatch(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    void startNativeFileWatch(handle).then((watch) => {
      if (disposed) { void stopNativeFileWatch(watch.watchId); return; }
      watchId = watch.watchId;
      lastChangeSeq = Math.max(0, Number(watch.changeSeq || 0));
    }).catch(() => undefined);
    return () => {
      disposed = true;
      window.clearInterval(reconciliationTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      if (watchId) void stopNativeFileWatch(watchId);
    };
  }, [session?.resource.source.provider, session?.resource.source.id]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const loadSensitiveMetadata = useCallback(async () => {
    if (!session?.capabilities.viewSensitiveMetadata || session.resource.source.locator.provider !== "review_asset") return null;
    const payload = await api<{ sensitiveMetadata?: SensitiveMetadataEnvelope }>(`/api/review-assets/${encodeURIComponent(session.resource.source.locator.assetId)}/sensitive-metadata`);
    const sensitiveMetadata = payload.sensitiveMetadata || {};
    setSession((current) => current ? { ...current, sensitiveMetadata } : current);
    return sensitiveMetadata;
  }, [session]);

  return { state, session, error, reload, loadSensitiveMetadata };
}
