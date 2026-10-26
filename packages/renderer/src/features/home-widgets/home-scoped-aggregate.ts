import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import type { HomeWidgetConfig, HomeWidgetMetricBinding } from "./home-widget-model";
import { homeWidgetNeedsScopedAggregates, homeWidgetTimeCutoff, resolveHomeWidgetContext, type HomeWidgetRuntimeContext } from "./home-widget-runtime-policy";

/**
 * Only bindings with an exact canonical Data Metric equivalent are supported.
 * Other Home metrics are derived from differently filtered/bounded projections
 * and MUST NOT be treated as though they came from an authoritative query.
 */
export type HomeScopedCountBinding = Extract<HomeWidgetMetricBinding, "projects.total" | "people.total">;
export type HomeScopedCount = { value: number; generatedAt: string; scope: "authorized_query"; complete: true };
export type HomeScopedCountResult = { key: string; values: Partial<Record<HomeScopedCountBinding, HomeScopedCount>>; pending: boolean; error: string | null };
export type HomeScopedCountSpec = { binding: HomeScopedCountBinding; metricId: string; query: { filters?: { logic: "and"; conditions: Array<{ fieldId: string; operator: "equals"; value: string }> }; timeRange?: { fieldId: "updatedAt"; from: string } }; valueField: "value" | "count" };

export function homeScopedCountSpec(binding: HomeWidgetMetricBinding, config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext | undefined, now: Date): HomeScopedCountSpec | null {
  if (!runtime?.currentUserId || !homeWidgetNeedsScopedAggregates(config)) return null;
  // These search/saved-view fields cannot be assumed to have the same semantics
  // as the canonical Data Query engine. Never silently drop part of a filter.
  if (config?.filterText?.trim() || config?.savedViewId?.trim()) return null;
  const context = resolveHomeWidgetContext(config, runtime);
  if (context.kind !== "studio" && !context.id) return null;
  if (binding === "projects.total") {
    if (context.kind !== "studio" && context.kind !== "project") return null;
    const cutoff = homeWidgetTimeCutoff(config, now);
    return { binding, metricId: "projects.count", valueField: "value", query: {
      ...(context.kind === "project" ? { filters: { logic: "and" as const, conditions: [{ fieldId: "id", operator: "equals" as const, value: context.id! }] } } : {}),
      ...(cutoff !== null ? { timeRange: { fieldId: "updatedAt" as const, from: new Date(cutoff).toISOString() } } : {}),
    } };
  }
  if (binding === "people.total") {
    // The canonical People capacity metric already returns the *complete*
    // authorized People count; its numeric value is hours, NOT person count.
    if (context.kind !== "user") return null;
    if (config?.timeRange && config.timeRange !== "all") return null;
    return { binding, metricId: "people.capacity_total", valueField: "count", query: { filters: { logic: "and", conditions: [{ fieldId: "id", operator: "equals", value: context.id! }] } } };
  }
  return null;
}

function isCompleteAuthorizedCount(read: any, value: unknown): value is number {
  return read?.scope === "authorized_query" && read?.complete === true && typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value) && typeof read?.generatedAt === "string" && Number.isFinite(Date.parse(read.generatedAt));
}

/** Never persist permission-bearing Home aggregate responses or accept stale sessions. */
export function useHomeScopedCounts(bindings: readonly HomeWidgetMetricBinding[], config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext | undefined): HomeScopedCountResult {
  const actorId = runtime?.currentUserId || "";
  // One cutoff snapshot per render key, not a timer that turns the widget into a poller.
  const dateBucket = config?.timeRange === "today" ? new Date().toDateString() : "";
  const specs = useMemo(() => {
    const now = new Date();
    return [...new Set(bindings)].map((binding) => homeScopedCountSpec(binding, config, runtime, now)).filter((value): value is HomeScopedCountSpec => Boolean(value));
  }, [bindings.join("|"), config?.context, config?.contextId, config?.filterText, config?.savedViewId, config?.timeRange, actorId, runtime?.currentProjectId, runtime?.currentRoleId, dateBucket]);
  const key = JSON.stringify({ actorId, specs });
  const [snapshot, setSnapshot] = useState<HomeScopedCountResult>({ key: "", values: {}, pending: false, error: null });
  useEffect(() => {
    if (!actorId || !specs.length) return;
    let live = true;
    const controller = new AbortController();
    setSnapshot({ key, values: {}, pending: true, error: null });
    void Promise.all(specs.map(async (spec) => {
      const response = await api<{ ok: boolean; read: { scope?: string; complete?: boolean; value?: number | null; count?: number; generatedAt?: string } }>(`/api/data-metrics/${encodeURIComponent(spec.metricId)}/read`, {
        method: "POST", body: JSON.stringify({ query: spec.query }), signal: controller.signal,
      });
      const read = response.read;
      const number = read?.[spec.valueField];
      if (response.ok !== true || !isCompleteAuthorizedCount(read, number)) throw new Error("The server did not return a complete authorized count.");
      return [spec.binding, { value: number, generatedAt: read.generatedAt!, scope: "authorized_query", complete: true }] as const;
    })).then((values) => {
      if (live) setSnapshot({ key, values: Object.fromEntries(values), pending: false, error: null });
    }).catch(() => {
      if (live) setSnapshot({ key, values: {}, pending: false, error: "Authorized scoped counts could not be verified." });
    });
    return () => { live = false; controller.abort(); };
  }, [key]);
  return snapshot.key === key ? snapshot : { key, values: {}, pending: specs.length > 0, error: null };
}
