/** TD1: allowlisted, non-security Project Tool Config default. */
import { clusterResolveToolConfig } from "./tool-settings-contract.js";
export const CLUSTER_PROJECT_CALENDAR_VIEW_VALUES = ["agenda", "week", "month", "day"] as const;
export type ClusterCalendarView = (typeof CLUSTER_PROJECT_CALENDAR_VIEW_VALUES)[number];
export type ClusterProjectCalendarViewSnapshot = {
  value: ClusterCalendarView;
  source: "project" | "studio";
  revision: number | null;
  storedValue: ClusterCalendarView | null;
  /** Policy on explicit Project overrides only. Studio and permissions remain authoritative. */
  lockUserOverride: boolean;
};
export function isClusterCalendarView(value: unknown): value is ClusterCalendarView {
  return typeof value === "string" && (CLUSTER_PROJECT_CALENDAR_VIEW_VALUES as readonly string[]).includes(value);
}
export function clusterResolveProjectCalendarView(studioSettings: Record<string, unknown>, row?: { valueJson: string; revision: number; lockUserOverride?: boolean } | null): ClusterProjectCalendarViewSnapshot {
  const studioView = clusterResolveToolConfig("calendar", studioSettings).defaultView;
  const fallback = isClusterCalendarView(studioView) ? studioView : "agenda";
  if (!row) return { value: fallback, source: "studio", revision: null, storedValue: null, lockUserOverride: false };
  let parsed: unknown;
  try { parsed = JSON.parse(row.valueJson); } catch { throw new Error("Invalid stored Project Calendar view setting."); }
  if (!isClusterCalendarView(parsed) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Invalid stored Project Calendar view setting.");
  if (typeof row.lockUserOverride !== "boolean" && row.lockUserOverride !== undefined) throw new Error("Invalid stored Project Calendar lock policy.");
  return { value: parsed, source: "project", revision: row.revision, storedValue: parsed, lockUserOverride: row.lockUserOverride === true };
}

/** A personal choice is the top, optional layer. Missing/null values inherit
 * the permitted Project default, or the Studio default outside a Project.
 * The Project revision remains available as provenance, not as a user revision.
 */
export type ClusterEffectiveCalendarViewSnapshot = Omit<ClusterProjectCalendarViewSnapshot, "source"> & {
  source: "user" | "project" | "studio";
};
export function clusterResolveEffectiveCalendarView(
  inherited: ClusterProjectCalendarViewSnapshot,
  userPreference: unknown,
): ClusterEffectiveCalendarViewSnapshot {
  if (inherited.lockUserOverride || !isClusterCalendarView(userPreference)) return inherited;
  return { ...inherited, value: userPreference, source: "user" };
}
