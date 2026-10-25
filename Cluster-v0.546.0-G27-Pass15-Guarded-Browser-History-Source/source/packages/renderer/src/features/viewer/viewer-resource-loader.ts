import { clusterApiFetch, clusterApiUrl } from "@cluster/api-client";
import type { ViewableResource, ViewableResourceDerivative } from "@cluster/shared";
import { useEffect, useMemo, useState } from "react";
import { useViewerResourceScope } from "./viewer-resource-scope";

export type ViewerLoadedBlob = {
  state: "idle" | "loading" | "ready" | "error";
  objectUrl: string;
  blob: Blob | null;
  derivative: ViewableResourceDerivative | null;
  sourceUrl: string;
  error: unknown;
};

export function absoluteViewerResourceUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^(?:blob:|data:|file:|https?:)/i.test(trimmed)) return trimmed;
  return clusterApiUrl(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

export function chooseViewerDerivative(resource: ViewableResource, preferredKinds: readonly string[]) {
  if (!resource.derivatives.length) return null;
  const preferred = resource.preferredDerivativeId
    ? resource.derivatives.find((item) => item.id === resource.preferredDerivativeId) || null
    : null;
  if (preferred && (!preferredKinds.length || preferredKinds.includes(String(preferred.kind)))) return preferred;
  for (const kind of preferredKinds) {
    const match = resource.derivatives.find((item) => String(item.kind) === kind);
    if (match) return match;
  }
  return null;
}

export function resolveViewerResourceSource(resource: ViewableResource, preferredKinds: readonly string[] = []) {
  const derivative = chooseViewerDerivative(resource, preferredKinds);
  const shouldUseDerivative = Boolean(derivative && (resource.source.support === "derivative" || preferredKinds.includes(String(derivative.kind))));
  const selected = shouldUseDerivative ? derivative : null;
  return {
    derivative: selected,
    relativeUrl: selected?.url || resource.source.sourceUrl || "",
    url: absoluteViewerResourceUrl(selected?.url || resource.source.sourceUrl || ""),
    mimeType: selected?.mimeType || resource.source.mimeType,
    sizeBytes: selected?.sizeBytes || resource.source.sizeBytes,
  };
}

export async function fetchViewerResourceResponse(url: string, init: RequestInit = {}) {
  if (!url) throw new Error("This asset does not expose a safe viewer source.");
  if (/^(?:blob:|data:|file:)/i.test(url)) return fetch(url, init);
  const parsed = new URL(url, window.location.href);
  const base = new URL(clusterApiUrl("/"), window.location.href);
  return parsed.origin === base.origin
    ? clusterApiFetch(`${parsed.pathname}${parsed.search}`, init)
    : fetch(url, { ...init, credentials: init.credentials || "include" });
}

async function fetchViewerBlob(url: string, accept: string, signal: AbortSignal) {
  if (!url) throw new Error("This asset does not expose a safe viewer source.");
  const response = await fetchViewerResourceResponse(url, { signal, headers: { Accept: accept } });
  if (!response.ok) throw new Error(`Asset request failed (${response.status}).`);
  return response.blob();
}

export function useViewerResourceBlob(resource: ViewableResource, preferredKinds: readonly string[], accept: string, enabled = true): ViewerLoadedBlob {
  const scope = useViewerResourceScope();
  const selection = useMemo(
    () => resolveViewerResourceSource(resource, preferredKinds),
    [resource, preferredKinds.join("|")],
  );
  const [state, setState] = useState<ViewerLoadedBlob>({
    state: enabled && selection.url ? "loading" : "idle",
    objectUrl: "",
    blob: null,
    derivative: selection.derivative,
    sourceUrl: selection.url,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    let unregisterAbort = scope.registerCleanup(() => controller.abort());
    let unregisterObjectUrl: (() => void) | null = null;
    let activeObjectUrl = "";
    let active = true;
    setState({ state: enabled && selection.url ? "loading" : "idle", objectUrl: "", blob: null, derivative: selection.derivative, sourceUrl: selection.url, error: null });
    if (!enabled || !selection.url) return () => { unregisterAbort(); controller.abort(); };

    void fetchViewerBlob(selection.url, accept, controller.signal)
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrl = objectUrl;
        unregisterObjectUrl = scope.trackObjectUrl(objectUrl);
        setState({ state: "ready", objectUrl, blob, derivative: selection.derivative, sourceUrl: selection.url, error: null });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setState({ state: "error", objectUrl: "", blob: null, derivative: selection.derivative, sourceUrl: selection.url, error });
      });

    return () => {
      active = false;
      controller.abort();
      unregisterAbort();
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
      unregisterObjectUrl?.();
    };
  }, [accept, enabled, scope, selection.derivative?.id, selection.url]);

  return state;
}
