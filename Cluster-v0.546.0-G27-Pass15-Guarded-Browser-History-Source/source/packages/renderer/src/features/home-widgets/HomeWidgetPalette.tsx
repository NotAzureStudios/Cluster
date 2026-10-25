import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { DashboardWidgetKey } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterSelect } from "../../components/ClusterSelect";
import {
  DASHBOARD_WIDGET_GROUPS,
  DASHBOARD_WIDGETS,
  type HomeWidgetGovernance,
  type HomeWidgetLayoutState,
} from "./home-widget-model";
import type { HomeWidgetLibraryController } from "./home-widget-library";

type PaletteSource = "all" | "builtin" | "gallery" | "custom";

type PaletteItem = {
  id: string;
  label: string;
  detail: string;
  source: Exclude<PaletteSource, "all">;
  group: string;
  meta?: string;
  blocked?: string;
  required?: boolean;
};

function HomeWidgetPaletteCard({ item, enabled, onAdd }: { item: PaletteItem; enabled: boolean; onAdd: (id: string) => void }) {
  const draggable = useDraggable({
    id: `catalog:${item.id}`,
    disabled: enabled || Boolean(item.blocked),
    data: { type: "home-widget-catalog", widgetId: item.id },
  });
  return (
    <article
      ref={draggable.setNodeRef}
      className="home-widget-palette-card-v506"
      data-enabled={enabled ? "true" : "false"}
      data-dragging={draggable.isDragging ? "true" : "false"}
      data-blocked={item.blocked ? "true" : "false"}
    >
      <ClusterButton
        unstyled
        type="button"
        className="home-widget-palette-drag-v506"
        aria-label={enabled ? `${item.label} is already on Home` : item.blocked ? `${item.label} is unavailable` : `Drag ${item.label} onto Home`}
        title={enabled ? "Already on Home" : item.blocked || "Drag onto the grid"}
        disabled={enabled || Boolean(item.blocked)}
        ref={draggable.setActivatorNodeRef}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <ClusterIcon name={enabled ? "grid" : "drag"} />
      </ClusterButton>
      <div className="home-widget-palette-copy-v506">
        <strong>{item.label}</strong>
        <span>{item.detail}</span>
        <small>{item.blocked || item.meta || (item.required ? "Studio required" : item.source === "builtin" ? "Built in" : item.source === "gallery" ? "Curated gallery" : "Installed")}</small>
      </div>
      <ClusterButton
        type="button"
        variant={enabled ? "quiet" : "secondary"}
        size="compact"
        disabled={enabled || Boolean(item.blocked)}
        onClick={() => onAdd(item.id)}
      >
        {item.blocked ? "Blocked" : enabled ? "On Home" : "Add"}
      </ClusterButton>
    </article>
  );
}

export function HomeWidgetPalette({
  layout,
  library,
  isAdmin,
  availableWidgetIds,
  governance,
  onAdd,
  onAdvanced,
  collapsed,
  onCollapsed,
}: {
  layout: HomeWidgetLayoutState;
  library: HomeWidgetLibraryController;
  isAdmin: boolean;
  availableWidgetIds?: string[];
  governance?: HomeWidgetGovernance;
  onAdd: (id: string) => void;
  onAdvanced: () => void;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<PaletteSource>("all");
  const enabled = useMemo(() => new Set(layout.items.filter((item) => item.enabled).map((item) => item.id)), [layout]);
  const available = availableWidgetIds ? new Set(availableWidgetIds) : null;
  const unavailable = new Set(governance?.unavailable || []);
  const required = new Set(governance?.required || []);
  const blockedById = new Map(library.blockedManifests.map((item) => [item.manifest.id, item.reason]));
  const needle = query.trim().toLowerCase();

  const items = useMemo<PaletteItem[]>(() => {
    const next: PaletteItem[] = [];
    if (source === "all" || source === "builtin") {
      for (const definition of DASHBOARD_WIDGETS) {
        if (available && !available.has(definition.key)) continue;
        if (definition.adminOnly && !isAdmin) continue;
        if (definition.desktopOnly && !library.desktop) continue;
        const group = DASHBOARD_WIDGET_GROUPS.find((entry) => entry.key === definition.group)?.label || definition.group;
        next.push({
          id: definition.key,
          label: definition.label,
          detail: definition.detail,
          source: "builtin",
          group,
          meta: definition.tool || group,
          blocked: unavailable.has(definition.key as DashboardWidgetKey) ? "Unavailable by Studio" : undefined,
          required: required.has(definition.key as DashboardWidgetKey),
        });
      }
    }
    if (source === "all" || source === "gallery") {
      for (const manifest of library.galleryManifests) {
        if (available && !available.has(manifest.id)) continue;
        next.push({
          id: manifest.id,
          label: manifest.name,
          detail: manifest.description || `Curated declarative widget · v${manifest.version}`,
          source: "gallery",
          group: manifest.gallery?.category || "Gallery",
          meta: manifest.gallery?.tags?.slice(0, 3).join(" · ") || "Curated gallery",
          blocked: blockedById.get(manifest.id),
        });
      }
    }
    if (source === "all" || source === "custom") {
      for (const manifest of library.installedManifests) {
        if (available && !available.has(manifest.id)) continue;
        next.push({
          id: manifest.id,
          label: manifest.name,
          detail: manifest.description || `Declarative widget · v${manifest.version}`,
          source: "custom",
          group: "Installed",
          meta: manifest.publisher ? `${manifest.publisher} · v${manifest.version}` : `v${manifest.version}`,
          blocked: blockedById.get(manifest.id),
        });
      }
    }
    return next.filter((item) => !needle || `${item.label} ${item.detail} ${item.group} ${item.meta || ""}`.toLowerCase().includes(needle));
  }, [availableWidgetIds, blockedById, isAdmin, library.desktop, library.galleryManifests, library.installedManifests, needle, source, governance]);

  const availableCount = items.filter((item) => !enabled.has(item.id) && !item.blocked).length;

  return (
    <aside className="home-widget-palette-v506" data-collapsed={collapsed ? "true" : "false"} aria-label="Widget palette">
      <header className="home-widget-palette-head-v506">
        <div>
          <p className="eyebrow">Widget palette</p>
          <strong>Drag onto Home</strong>
          <span>{availableCount} available in this view</span>
        </div>
        <div className="home-widget-palette-head-actions-v507">
          {!collapsed && <ClusterButton type="button" variant="quiet" size="compact" onClick={onAdvanced} aria-label="Open advanced Home settings" title="Advanced Home settings">
            <ClusterIcon name="settings" />
          </ClusterButton>}
          <ClusterButton type="button" variant="quiet" size="compact" onClick={() => onCollapsed(!collapsed)} aria-label={collapsed ? "Expand widget palette" : "Collapse widget palette"} title={collapsed ? "Expand palette" : "Collapse palette"}>
            {collapsed ? "›" : "‹"}
          </ClusterButton>
        </div>
      </header>
      {!collapsed && <div className="home-widget-palette-tools-v506">
        <div className="home-widget-palette-search-v506">
          <ClusterIcon name="search" />
          <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a widget" aria-label="Find a widget" />
        </div>
        <ClusterSelect
          ariaLabel="Widget palette source"
          value={source}
          options={[
            { value: "all", label: "All" },
            { value: "builtin", label: "Built in" },
            { value: "gallery", label: "Gallery" },
            { value: "custom", label: "Installed" },
          ]}
          onChange={(value) => setSource(value as PaletteSource)}
        />
      </div>}
      {!collapsed && <div className="home-widget-palette-list-v506">
        {items.map((item) => <HomeWidgetPaletteCard key={`${item.source}:${item.id}`} item={item} enabled={enabled.has(item.id)} onAdd={onAdd} />)}
        {!items.length && <div className="home-widget-palette-empty-v506"><strong>No matching widgets</strong><span>Try a broader search or another source.</span></div>}
      </div>}
      {!collapsed && <footer className="home-widget-palette-foot-v506">
        <ClusterIcon name="grid" />
        <span>Drop on a widget to place beside it, or drop on open grid space to add it at the end.</span>
      </footer>}
    </aside>
  );
}
