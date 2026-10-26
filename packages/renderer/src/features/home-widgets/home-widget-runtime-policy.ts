import type { HomeWidgetConfig } from "./home-widget-model";

export type HomeWidgetRuntimeContext = {
  currentUserId: string;
  currentRoleId?: string | null;
  currentProjectId?: string | null;
  savedViews?: Array<{ id: string; values: Record<string, string> }>;
  now?: Date;
};

export type HomeWidgetFilterableItem = {
  id: string;
  title: string;
  detail?: string;
  projectId?: string | null;
  userId?: string | null;
  roleId?: string | null;
  at?: string | null;
  savedViewId?: string | null;
  workTarget?: { projectId?: string | null; inspectScope?: string | null; inspectId?: string | null } | null;
};

export type ResolvedHomeWidgetContext = {
  kind: "studio" | "project" | "user" | "role";
  id?: string | null;
};

export function resolveHomeWidgetContext(config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext): ResolvedHomeWidgetContext {
  const mode = config?.context || "studio";
  if (mode === "current-project") return { kind: "project", id: runtime.currentProjectId || null };
  if (mode === "project") return { kind: "project", id: config?.contextId || null };
  if (mode === "me") return { kind: "user", id: runtime.currentUserId };
  if (mode === "user") return { kind: "user", id: config?.contextId || null };
  if (mode === "my-role") return { kind: "role", id: runtime.currentRoleId || null };
  if (mode === "role") return { kind: "role", id: config?.contextId || null };
  return { kind: "studio" };
}

export function homeWidgetTimeCutoff(config: HomeWidgetConfig | undefined, now = new Date()): number | null {
  const range = config?.timeRange || "all";
  if (range === "all") return null;
  const end = now.getTime();
  if (range === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0); return start.getTime();
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return end - days * 86_400_000;
}

export function filterHomeWidgetItems<T extends HomeWidgetFilterableItem>(items: T[], config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext): T[] {
  const context = resolveHomeWidgetContext(config, runtime);
  const cutoff = homeWidgetTimeCutoff(config, runtime.now || new Date());
  const savedViewId = (config?.savedViewId || "").trim();
  const savedView = savedViewId ? runtime.savedViews?.find((view) => view.id === savedViewId) : undefined;
  // A missing context or deleted saved view is not permission to show studio-wide records.
  if ((context.kind !== "studio" && !context.id) || (savedViewId && !savedView)) return [];
  const savedValues = savedView?.values || {};
  const viewNeedle = String(savedValues.q || savedValues.query || savedValues.search || "").trim();
  const needle = [config?.filterText || "", viewNeedle].filter(Boolean).join(" ").trim().toLowerCase();
  const viewProjectId = String(savedValues.projectId || savedValues.project || "").trim();
  const viewUserId = String(savedValues.userId || savedValues.ownerId || savedValues.assigneeId || "").trim();
  const viewRoleId = String(savedValues.roleId || savedValues.role || "").trim();
  return items.filter((item) => {
    const projectId = item.projectId || item.workTarget?.projectId || null;
    const userId = item.userId || (item.workTarget?.inspectScope === "person" ? item.workTarget.inspectId : null);
    // Scoping is strict: an item without ownership evidence cannot match a scoped widget.
    if (context.kind === "project" && projectId !== context.id) return false;
    if (context.kind === "user" && userId !== context.id) return false;
    if (context.kind === "role" && item.roleId !== context.id) return false;
    if (viewProjectId && projectId !== viewProjectId) return false;
    if (viewUserId && userId !== viewUserId) return false;
    if (viewRoleId && item.roleId !== viewRoleId) return false;
    if (cutoff !== null) {
      const timestamp = item.at ? Date.parse(item.at) : NaN;
      if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
    }
    if (savedViewId && item.savedViewId && item.savedViewId !== savedViewId) return false;
    if (needle && !`${item.title} ${item.detail || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** A client-side list filter is not an authoritative aggregate query.
 * The payload's count/ratio metrics are studio-wide and may include records
 * absent from the bounded list projection. Never label them as scoped totals. */
export function homeWidgetNeedsScopedAggregates(config?: HomeWidgetConfig): boolean {
  if (!config) return false;
  return Boolean(
    (config.context && config.context !== "studio") ||
    (config.timeRange && config.timeRange !== "all") ||
    config.filterText?.trim() ||
    config.savedViewId?.trim(),
  );
}

export const HOME_SCOPED_AGGREGATES_UNAVAILABLE =
  "Scoped totals unavailable. Counts require a server-side aggregate for this filter; visible lists may be incomplete.";

export function homeWidgetConfiguredLimit(config: HomeWidgetConfig | undefined, fallback: number) {
  const detailDefault = config?.detailLevel === "compact" ? Math.min(3, fallback) : config?.detailLevel === "detailed" ? Math.max(6, fallback) : fallback;
  const requested = config?.listLimit ?? detailDefault;
  return Math.max(1, Math.min(12, requested));
}
