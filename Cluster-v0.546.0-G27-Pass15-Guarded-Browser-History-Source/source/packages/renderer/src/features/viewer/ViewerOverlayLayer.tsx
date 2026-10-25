import type { ReactNode } from "react";
import type { ViewerOverlayZone } from "./viewer-contracts";

export function ViewerOverlayLayer({
  visibleIds,
  placements,
  values,
  children,
}: {
  visibleIds: readonly string[];
  placements: Record<string, string>;
  values: Record<string, ReactNode>;
  children?: ReactNode;
}) {
  const zones = new Map<ViewerOverlayZone, Array<{ id: string; value: ReactNode }>>();
  for (const id of visibleIds) {
    const value = values[id];
    if (value === undefined || value === null || value === false) continue;
    const raw = placements[id] || "top-left";
    const zone = (["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as ViewerOverlayZone[]).includes(raw as ViewerOverlayZone)
      ? raw as ViewerOverlayZone
      : "top-left";
    const current = zones.get(zone) || [];
    current.push({ id, value });
    zones.set(zone, current);
  }
  return <div className="cluster-viewer-overlay-layer" aria-hidden="true">
    {[...zones.entries()].map(([zone, entries]) => <div key={zone} className="cluster-viewer-overlay-zone" data-zone={zone}>
      {entries.map((entry) => <div key={entry.id} className="cluster-viewer-overlay-chip" data-overlay-id={entry.id}>{entry.value}</div>)}
    </div>)}
    {children}
  </div>;
}
