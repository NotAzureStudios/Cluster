import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedWorkSavedView } from "@cluster/shared";
import { queryApi } from "../../core/api";
import type { HomeWidgetRuntimeStatus } from "./home-widget-model";
import { createHomeRequestAuthority } from "./home-request-authority";
import type { HomeIntegrationProvider, HomeSourceRepository, HomeSourceReview, HomeSavedView } from "./home-widget-phase7-data";

type ClientStateRecord = { key: string; payload: unknown; updatedAt?: string };
type CatalogState = {
  owner: string;
  repositories: HomeSourceRepository[];
  providers: HomeIntegrationProvider[];
  reviews: HomeSourceReview[];
  savedViews: HomeSavedView[];
  sourceControlStatus: HomeWidgetRuntimeStatus;
  integrationStatus: HomeWidgetRuntimeStatus;
  savedViewsStatus: HomeWidgetRuntimeStatus;
};
function initialState(owner: string, sourceEnabled: boolean, integrationEnabled: boolean, savedViewsEnabled: boolean): CatalogState {
  return {
    owner, repositories: [], providers: [], reviews: [], savedViews: [],
    sourceControlStatus: { state: sourceEnabled ? "loading" : "ready" },
    integrationStatus: { state: integrationEnabled ? "loading" : "ready" },
    savedViewsStatus: { state: savedViewsEnabled ? "loading" : "ready" },
  };
}
function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Cluster could not refresh Widget 2.0 catalog data.";
}
function normalizeSavedViews(records: ClientStateRecord[]) {
  const rows: HomeSavedView[] = [];
  for (const record of records) {
    if (!record.key.startsWith("saved-views.") || !Array.isArray(record.payload)) continue;
    const fallbackScope = record.key.slice("saved-views.".length);
    for (const raw of record.payload as SharedWorkSavedView[]) {
      if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") continue;
      rows.push({ id: raw.id, name: raw.name, scope: raw.scope || fallbackScope, visibility: raw.visibility === "studio" ? "studio" : "personal", values: raw.values || {}, updatedAt: raw.updatedAt || raw.createdAt || record.updatedAt || "" });
    }
  }
  return rows.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")).slice(0, 60);
}

/** Data and failures from one account must never appear in another account's Home. */
export function useWidget2CatalogInsights(canSourceControl: boolean, canIntegrations: boolean, canSavedViews: boolean, accountId: string) {
  const owner = `${accountId}|source:${canSourceControl ? 1 : 0}|integrations:${canIntegrations ? 1 : 0}|views:${canSavedViews ? 1 : 0}`;
  const authorityRef = useRef(createHomeRequestAuthority(owner));
  // Synchronize during render, so the first render after a role/account switch is masked.
  authorityRef.current.setOwner(owner);
  const [state, setState] = useState<CatalogState>(() => initialState(owner, canSourceControl, canIntegrations, canSavedViews));
  const current = state.owner === owner ? state : initialState(owner, canSourceControl, canIntegrations, canSavedViews);

  const loadSourceControl = useCallback(async (force = false) => {
    const authority = authorityRef.current;
    if (!authority.isOwner(owner) || !canSourceControl || !accountId) return;
    const ticket = authority.claim("source-control");
    setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), sourceControlStatus: { state: "loading" } }));
    try {
      const [repositoryResult, reviewResult] = await Promise.all([
        queryApi<{ repositories: HomeSourceRepository[] }>("/api/admin/source-control/repositories", { staleMs: 20_000, maxAgeMs: 5 * 60_000, force, tags: ["source-control", "home"] }),
        queryApi<{ reviews: HomeSourceReview[] }>("/api/source-control/review-queue?limit=40", { staleMs: 15_000, maxAgeMs: 2 * 60_000, force, tags: ["source-control", "reviews", "home"] }),
      ]);
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), repositories: repositoryResult.repositories || [], reviews: reviewResult.reviews || [], sourceControlStatus: { state: "ready" } }));
    } catch (error) {
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), repositories: [], reviews: [], sourceControlStatus: { state: "error", error: errorText(error), onRetry: () => void loadSourceControl(true) } }));
    }
  }, [owner, accountId, canSourceControl, canIntegrations, canSavedViews]);

  const loadIntegrations = useCallback(async (force = false) => {
    const authority = authorityRef.current;
    if (!authority.isOwner(owner) || !canIntegrations || !accountId) return;
    const ticket = authority.claim("integrations");
    setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), integrationStatus: { state: "loading" } }));
    try {
      const result = await queryApi<{ providers: HomeIntegrationProvider[] }>("/api/admin/integrations/providers", { staleMs: 20_000, maxAgeMs: 5 * 60_000, force, tags: ["integrations", "home"] });
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), providers: result.providers || [], integrationStatus: { state: "ready" } }));
    } catch (error) {
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), providers: [], integrationStatus: { state: "error", error: errorText(error), onRetry: () => void loadIntegrations(true) } }));
    }
  }, [owner, accountId, canSourceControl, canIntegrations, canSavedViews]);

  const loadSavedViews = useCallback(async (force = false) => {
    const authority = authorityRef.current;
    if (!authority.isOwner(owner) || !accountId || !canSavedViews) return;
    const ticket = authority.claim("saved-views");
    setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), savedViewsStatus: { state: "loading" } }));
    try {
      const result = await queryApi<{ records: ClientStateRecord[] }>("/api/client-state/user?prefix=saved-views.", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force, tags: ["client-state", "saved-views", "home"] });
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), savedViews: normalizeSavedViews(result.records || []), savedViewsStatus: { state: "ready" } }));
    } catch (error) {
      if (!authority.isCurrent(ticket)) return;
      setState((previous) => ({ ...(previous.owner === owner ? previous : initialState(owner, canSourceControl, canIntegrations, canSavedViews)), savedViews: [], savedViewsStatus: { state: "error", error: errorText(error), onRetry: () => void loadSavedViews(true) } }));
    }
  }, [owner, accountId, canSourceControl, canIntegrations, canSavedViews]);

  useEffect(() => {
    // A fresh identity must not reuse a previous identity's cached projections.
    if (canSourceControl) void loadSourceControl(true);
    if (canIntegrations) void loadIntegrations(true);
    if (canSavedViews) void loadSavedViews(true);
    return () => {
      authorityRef.current.invalidate("source-control");
      authorityRef.current.invalidate("integrations");
      authorityRef.current.invalidate("saved-views");
    };
  }, [loadSourceControl, loadIntegrations, loadSavedViews, canSourceControl, canIntegrations, canSavedViews]);

  return {
    repositories: canSourceControl ? current.repositories : [],
    reviews: canSourceControl ? current.reviews : [],
    providers: canIntegrations ? current.providers : [],
    savedViews: canSavedViews ? current.savedViews : [],
    sourceControlStatus: current.sourceControlStatus,
    integrationStatus: current.integrationStatus,
    savedViewsStatus: current.savedViewsStatus,
    retrySourceControl: () => void loadSourceControl(true),
    retryIntegrations: () => void loadIntegrations(true),
    retrySavedViews: () => void loadSavedViews(true),
  };
}
