import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../core/api";
import type { ClusterResourcePickerOption } from "./ClusterResourcePicker";

const PROJECT_KINDS = ["project", "board", "whiteboard", "library", "review_asset"] as const;
type ProjectKind = (typeof PROJECT_KINDS)[number];
type Page = { ok: true; targets: ClusterResourcePickerOption[]; nextCursor: string | null };

/**
 * One server-authorized discovery pipeline for Cluster resource selectors.
 * Client-side lists, project summaries and previously selected labels are never
 * substitutes for a live authorization response. Every page rechecks ACLs.
 */
export function useAuthorizedProjectResources({ projectId, minimum = "view", kinds, limit = 100, enabled = true }: {
  projectId: string;
  minimum?: "view" | "manage";
  kinds?: readonly ProjectKind[];
  limit?: number;
  enabled?: boolean;
}) {
  const kindsKey = useMemo(() => PROJECT_KINDS.filter((kind) => !kinds || kinds.includes(kind)).join(","), [kinds?.join(",")]);
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState<ClusterResourcePickerOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const pagingInFlight = useRef(false);
  const pageSize = Math.max(1, Math.min(100, Math.trunc(limit)));
  const effectiveQuery = query.trim();

  const urlFor = useCallback((cursor?: string) => {
    const params = new URLSearchParams({ projectId, minimum, q: effectiveQuery, limit: String(pageSize), kinds: kindsKey });
    if (cursor) params.set("cursor", cursor);
    return `/api/access/targets?${params}`;
  }, [projectId, minimum, effectiveQuery, pageSize, kindsKey]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    pagingInFlight.current = false;
    setResources([]);
    setNextCursor(null);
    setLoadingMore(false);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      if (!enabled || !projectId || !kindsKey) {
        if (sequence === requestSequence.current) { if (enabled) setError("Choose a supported project and resource type."); setLoading(false); }
        return;
      }
      try {
        const result = await api<Page>(urlFor());
        if (sequence !== requestSequence.current) return;
        const eligible = result.targets.filter((item) => item.projectId === projectId && kindsKey.split(",").includes(item.kind));
        setResources(eligible);
        setNextCursor(result.nextCursor || null);
      } catch (cause) {
        if (sequence !== requestSequence.current) return;
        setResources([]);
        setNextCursor(null);
        setError(cause instanceof Error ? cause.message : "Authorized resources could not be loaded.");
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, effectiveQuery ? 220 : 0);
    return () => { window.clearTimeout(timer); requestSequence.current += 1; };
  }, [projectId, minimum, kindsKey, pageSize, effectiveQuery, urlFor, enabled]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || pagingInFlight.current || !nextCursor) return;
    const sequence = requestSequence.current;
    pagingInFlight.current = true;
    setLoadingMore(true);
    try {
      const result = await api<Page>(urlFor(nextCursor));
      if (sequence !== requestSequence.current) return;
      setResources((previous) => {
        const seen = new Set(previous.map((item) => `${item.kind}:${item.id}`));
        return [...previous, ...result.targets.filter((item) => {
          if (item.projectId !== projectId || !kindsKey.split(",").includes(item.kind)) return false;
          const key = `${item.kind}:${item.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })];
      });
      setNextCursor(result.nextCursor || null);
      setError("");
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      // Never resume with the previous cursor after the server rejects a page.
      setNextCursor(null);
      setError(cause instanceof Error ? cause.message : "Resource list changed. Search again.");
    } finally {
      pagingInFlight.current = false;
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }, [enabled, loading, nextCursor, urlFor, projectId, kindsKey]);

  return { resources, query, setQuery, nextCursor, loading, loadingMore, error, loadMore };
}
