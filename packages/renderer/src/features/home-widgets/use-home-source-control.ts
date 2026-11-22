import { useCallback, useEffect, useRef, useState } from "react";
import { queryApi } from "../../core/api";
import type { HomeWidgetRuntimeStatus } from "./home-widget-model";
import { createHomeRequestAuthority } from "./home-request-authority";
import type { HomeSourceRepository, HomeSourceReview } from "./home-widget-sources";

type SourceState = { owner: string; repositories: HomeSourceRepository[]; reviews: HomeSourceReview[]; status: HomeWidgetRuntimeStatus };
function initialState(owner: string, enabled: boolean): SourceState {
  return { owner, repositories: [], reviews: [], status: { state: enabled ? "loading" : "ready" } };
}
function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Cluster could not refresh repositories.";
}

/** Repositories and reviews for Home. Data and failures from one account never appear in another account's Home. */
export function useHomeSourceControl(enabled: boolean, accountId: string) {
  const owner = `${accountId}|source:${enabled ? 1 : 0}`;
  const authorityRef = useRef(createHomeRequestAuthority(owner));
  // Synchronize during render, so the first render after a role/account switch is masked.
  authorityRef.current.setOwner(owner);
  const [state, setState] = useState<SourceState>(() => initialState(owner, enabled));
  const current = state.owner === owner ? state : initialState(owner, enabled);

  const load = useCallback(async (force = false) => {
    const authority = authorityRef.current;
    if (!authority.isOwner(owner) || !enabled || !accountId) return;
    const ticket = authority.claim("source-control");
    setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, enabled)), status: { state: "loading" } }));
    try {
      const [repositoryResult, reviewResult] = await Promise.all([
        queryApi<{ repositories: HomeSourceRepository[] }>("/api/admin/source-control/repositories", { staleMs: 60_000, maxAgeMs: 5 * 60_000, force, tags: ["source-control", "home"] }),
        queryApi<{ reviews: HomeSourceReview[] }>("/api/source-control/review-queue?limit=40", { staleMs: 45_000, maxAgeMs: 2 * 60_000, force, tags: ["source-control", "reviews", "home"] }),
      ]);
      if (!authority.isCurrent(ticket)) return;
      setState({ owner, repositories: repositoryResult.repositories || [], reviews: reviewResult.reviews || [], status: { state: "ready" } });
    } catch (error) {
      if (!authority.isCurrent(ticket)) return;
      setState({ owner, repositories: [], reviews: [], status: { state: "error", error: errorText(error), onRetry: () => void load(true) } });
    }
  }, [owner, accountId, enabled]);

  useEffect(() => {
    // Remounting Home is not a request to bypass the cache; the query cache is
    // account-scoped and permission-tag invalidated on writes.
    if (enabled) void load();
    return () => authorityRef.current.invalidate("source-control");
  }, [load, enabled]);

  return {
    repositories: enabled ? current.repositories : [],
    reviews: enabled ? current.reviews : [],
    status: current.status,
  };
}
