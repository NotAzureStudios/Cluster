import { useMemo } from "react";
import { useServerState } from "../../core/server-state";
import type { DashboardWidgetKey } from "../application/application-models";
import { addGridItem, moveGridItem, resizeGridItem } from "./home-widget-grid";
import {
  applyHomeWidgetGovernance,
  defaultHomeWidgetLayout,
  homeWidgetRegistryEntry,
  normalizeHomeWidgetConfig,
  normalizeHomeWidgetLayout,
  packHomeWidgetLayout,
  type HomeWidgetConfig,
  type HomeWidgetGovernance,
  type HomeWidgetLayout,
  type HomeWidgetPlacement,
  type HomeWidgetSize,
} from "./home-widget-model";
import "./home-widgets.css";

/** Home layout state: one stored grid per user, Studio governance applied on read and write. */
export function useDashboardWidgets(governance?: HomeWidgetGovernance) {
  const starting = governance?.recommended?.length ? governance.recommended : undefined;
  const [stored, setStored] = useServerState<HomeWidgetLayout>("user", "dashboard.layout-v2", defaultHomeWidgetLayout(starting), {
    merge: (serverValue, fallback) => normalizeHomeWidgetLayout(serverValue, fallback),
  });
  const governanceKey = `${(governance?.required || []).join(",")}|${(governance?.unavailable || []).join(",")}`;
  const layout = useMemo(() => applyHomeWidgetGovernance(normalizeHomeWidgetLayout(stored), governance), [stored, governanceKey]);
  const required = new Set(governance?.required || []);
  const unavailable = new Set(governance?.unavailable || []);

  function write(update: (items: HomeWidgetPlacement[]) => HomeWidgetPlacement[]) {
    setStored((current) => applyHomeWidgetGovernance({ schema: 3, items: update(applyHomeWidgetGovernance(normalizeHomeWidgetLayout(current), governance).items) }, governance));
  }

  return {
    layout,
    governance,
    has: (id: string) => layout.items.some((item) => item.id === id),
    canRemove: (id: string) => !required.has(id as DashboardWidgetKey),
    canAdd: (id: string) => !unavailable.has(id as DashboardWidgetKey),
    /** Commit a whole arrangement (the end of a drag or resize gesture). */
    commit: (items: HomeWidgetPlacement[]) => write(() => items),
    add: (id: DashboardWidgetKey) => write((items) => items.some((item) => item.id === id) || unavailable.has(id) ? items : addGridItem(items, { id, size: homeWidgetRegistryEntry(id)!.defaultSize })),
    remove: (id: string) => write((items) => required.has(id as DashboardWidgetKey) ? items : items.filter((item) => item.id !== id)),
    move: (id: string, x: number, y: number) => write((items) => moveGridItem(items, id, x, y)),
    resize: (id: string, size: HomeWidgetSize) => write((items) => resizeGridItem(items, id, size)),
    configure: (id: string, patch: Partial<HomeWidgetConfig>) => write((items) => items.map((item) => {
      if (item.id !== id) return item;
      const config = normalizeHomeWidgetConfig(id, { ...(item.config || {}), ...patch });
      const { config: _previous, ...rest } = item;
      return config ? { ...rest, config } : rest;
    })),
    pack: () => write((items) => packHomeWidgetLayout({ schema: 3, items }).items),
    reset: () => setStored(applyHomeWidgetGovernance(defaultHomeWidgetLayout(starting), governance)),
  };
}

export type DashboardWidgetsController = ReturnType<typeof useDashboardWidgets>;
