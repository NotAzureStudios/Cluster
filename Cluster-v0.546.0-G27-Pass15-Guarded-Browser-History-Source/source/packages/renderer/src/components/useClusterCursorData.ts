import { useCallback, useEffect, useRef, useState } from "react";
import type { ClusterDataAnalyticsEvidence, ClusterDataPageResult, ClusterDataQuery, ClusterDataSort, ClusterSemanticField } from "@cluster/shared";

export type ClusterCursorDataViewEvidence = {
  resourceKind?: string;
  fields?: readonly ClusterSemanticField[];
  query?: ClusterDataQuery;
  analytics?: ClusterDataAnalyticsEvidence | null;
  page?: ClusterDataPageResult;
  continuationSort?: ClusterDataSort[];
  semanticSortApplied?: boolean;
  scanned?: number;
  scanBounded?: boolean;
};

export type ClusterCursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  dataView?: ClusterCursorDataViewEvidence;
};

export function mergeClusterCursorRows<T>(current: readonly T[], incoming: readonly T[], rowKey: (row: T) => string) {
  const byKey = new Map(current.map((row) => [rowKey(row), row] as const));
  for (const row of incoming) byKey.set(rowKey(row), row);
  return [...byKey.values()];
}

function mergeDataViewEvidence(current: ClusterCursorDataViewEvidence | null, incoming?: ClusterCursorDataViewEvidence) {
  if (!incoming) return current;
  return {
    ...(current || {}),
    ...incoming,
    analytics: incoming.analytics ?? current?.analytics ?? null,
  };
}

/**
 * Ephemeral continuation state for server-authoritative Data Views. Cursors are
 * deliberately runtime-only and never become part of a Saved Data View.
 */
export function useClusterCursorData<T>(input: {
  loadPage: (cursor: string | null) => Promise<ClusterCursorPage<T>>;
  rowKey: (row: T) => string;
  resetKey: string;
  placeholderRows?: readonly T[];
  enabled?: boolean;
}) {
  const loadPageRef = useRef(input.loadPage);
  const rowKeyRef = useRef(input.rowKey);
  loadPageRef.current = input.loadPage;
  rowKeyRef.current = input.rowKey;
  const generationRef = useRef(0);
  const loadingRef = useRef(false);
  const [rows, setRows] = useState<T[]>(() => [...(input.placeholderRows || [])]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [dataView, setDataView] = useState<ClusterCursorDataViewEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const requestPage = useCallback(async (cursor: string | null, replace: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    const generation = generationRef.current;
    try {
      const page = await loadPageRef.current(cursor);
      if (generation !== generationRef.current) return;
      setRows((current) => replace ? [...page.items] : mergeClusterCursorRows(current, page.items, rowKeyRef.current));
      setNextCursor(page.nextCursor || null);
      setHasMore(Boolean(page.hasMore && page.nextCursor));
      setDataView((current) => mergeDataViewEvidence(replace ? null : current, page.dataView));
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause : new Error("Data page load failed."));
    } finally {
      if (generation === generationRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    setNextCursor(null);
    setHasMore(false);
    setDataView(null);
    setRows([...(input.placeholderRows || [])]);
    void requestPage(null, true);
  }, [input.placeholderRows, requestPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || !hasMore || loadingRef.current) return;
    void requestPage(nextCursor, false);
  }, [hasMore, nextCursor, requestPage]);

  useEffect(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    setNextCursor(null);
    setHasMore(false);
    setDataView(null);
    setError(null);
    setRows([...(input.placeholderRows || [])]);
    if (input.enabled !== false) void requestPage(null, true);
  }, [input.resetKey, input.enabled, requestPage]);

  return { rows, nextCursor, hasMore, dataView, loading, error, loadMore, reload };
}
