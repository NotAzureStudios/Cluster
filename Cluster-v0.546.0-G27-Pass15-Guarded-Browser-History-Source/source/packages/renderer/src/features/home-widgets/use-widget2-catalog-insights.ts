import { useCallback, useEffect, useState } from "react";
import type { SharedWorkSavedView } from "@cluster/shared";
import { queryApi } from "../../core/api";
import type { HomeWidgetRuntimeStatus } from "./home-widget-model";
import type { HomeIntegrationProvider, HomeSourceRepository, HomeSourceReview, HomeSavedView } from "./home-widget-phase7-data";

type ClientStateRecord = { key: string; payload: unknown; updatedAt?: string };

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

export function useWidget2CatalogInsights(canSourceControl: boolean, canIntegrations: boolean) {
  const [repositories, setRepositories] = useState<HomeSourceRepository[]>([]);
  const [providers, setProviders] = useState<HomeIntegrationProvider[]>([]);
  const [reviews, setReviews] = useState<HomeSourceReview[]>([]);
  const [savedViews, setSavedViews] = useState<HomeSavedView[]>([]);
  const [sourceControlStatus, setSourceControlStatus] = useState<HomeWidgetRuntimeStatus>({ state: canSourceControl ? "loading" : "ready" });
  const [integrationStatus, setIntegrationStatus] = useState<HomeWidgetRuntimeStatus>({ state: canIntegrations ? "loading" : "ready" });
  const [savedViewsStatus, setSavedViewsStatus] = useState<HomeWidgetRuntimeStatus>({ state: "loading" });

  const loadSourceControl = useCallback(async (force = false) => {
    if (!canSourceControl) {
      setRepositories([]); setReviews([]); setSourceControlStatus({ state: "ready" }); return;
    }
    setSourceControlStatus({ state: "loading" });
    try {
      const [repositoryResult, reviewResult] = await Promise.all([
        queryApi<{ repositories: HomeSourceRepository[] }>("/api/admin/source-control/repositories", { staleMs: 20_000, maxAgeMs: 5 * 60_000, force, tags: ["source-control", "home"] }),
        queryApi<{ reviews: HomeSourceReview[] }>("/api/source-control/review-queue?limit=40", { staleMs: 15_000, maxAgeMs: 2 * 60_000, force, tags: ["source-control", "reviews", "home"] }),
      ]);
      setRepositories(repositoryResult.repositories || []);
      setReviews(reviewResult.reviews || []);
      setSourceControlStatus({ state: "ready" });
    } catch (error) {
      setSourceControlStatus({ state: "error", error: errorText(error), onRetry: () => void loadSourceControl(true) });
    }
  }, [canSourceControl]);

  const loadIntegrations = useCallback(async (force = false) => {
    if (!canIntegrations) {
      setProviders([]); setIntegrationStatus({ state: "ready" }); return;
    }
    setIntegrationStatus({ state: "loading" });
    try {
      const providerResult = await queryApi<{ providers: HomeIntegrationProvider[] }>("/api/admin/integrations/providers", { staleMs: 20_000, maxAgeMs: 5 * 60_000, force, tags: ["integrations", "home"] });
      setProviders(providerResult.providers || []);
      setIntegrationStatus({ state: "ready" });
    } catch (error) {
      setIntegrationStatus({ state: "error", error: errorText(error), onRetry: () => void loadIntegrations(true) });
    }
  }, [canIntegrations]);

  const loadSavedViews = useCallback(async (force = false) => {
    setSavedViewsStatus({ state: "loading" });
    try {
      const result = await queryApi<{ records: ClientStateRecord[] }>("/api/client-state/user?prefix=saved-views.", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force, tags: ["client-state", "saved-views", "home"] });
      setSavedViews(normalizeSavedViews(result.records || []));
      setSavedViewsStatus({ state: "ready" });
    } catch (error) {
      setSavedViewsStatus({ state: "error", error: errorText(error), onRetry: () => void loadSavedViews(true) });
    }
  }, []);

  useEffect(() => { void loadSourceControl(); }, [loadSourceControl]);
  useEffect(() => { void loadIntegrations(); }, [loadIntegrations]);
  useEffect(() => { void loadSavedViews(); }, [loadSavedViews]);

  return { repositories, providers, reviews, savedViews, sourceControlStatus, integrationStatus, savedViewsStatus, retrySourceControl: () => void loadSourceControl(true), retryIntegrations: () => void loadIntegrations(true), retrySavedViews: () => void loadSavedViews(true) };
}
