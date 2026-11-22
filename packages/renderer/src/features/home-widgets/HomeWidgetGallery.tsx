import { useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterFloatingSurface } from "../../components/ClusterFloatingSurface";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import type { DashboardWidgetKey } from "../application/application-models";
import { DASHBOARD_WIDGET_GROUPS, HOME_WIDGET_REGISTRY } from "./home-widget-model";

/** The "+" in edit mode: every widget not already on Home, grouped, one click to add. */
export function HomeWidgetGallery({ available, placed, onAdd }: {
  available: Set<string>;
  placed: Set<string>;
  onAdd: (id: DashboardWidgetKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => DASHBOARD_WIDGET_GROUPS.map((group) => ({
    ...group,
    widgets: HOME_WIDGET_REGISTRY.filter((entry) => entry.group === group.key && available.has(entry.key) && !placed.has(entry.key)
      && (!needle || `${entry.label} ${entry.detail}`.toLowerCase().includes(needle))),
  })).filter((group) => group.widgets.length), [available, placed, needle]);

  return (
    <>
      <ClusterButton ref={anchorRef} variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ClusterIcon name="plus" />Add widget</ClusterButton>
      <ClusterFloatingSurface open={open} anchorRef={anchorRef} label="Add widget" placement="bottom-end" autoFocus="first" autoFocusSelector="input" onDismiss={() => setOpen(false)} className="hw-gallery">
        <ClusterTextInput type="search" value={query} placeholder="Search widgets" aria-label="Search widgets" onChange={(event) => setQuery(event.target.value)} />
        <div className="hw-gallery-list">
          {groups.length ? groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h4>{group.label}</h4>
              {group.widgets.map((entry) => (
                <ClusterButton key={entry.key} unstyled className="hw-gallery-row" onClick={() => onAdd(entry.key)}>
                  <ClusterIcon name={entry.icon} />
                  <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
                  <ClusterIcon name="plus" />
                </ClusterButton>
              ))}
            </section>
          )) : <p className="hw-gallery-empty">{needle ? "No matches" : "Everything's on Home"}</p>}
        </div>
      </ClusterFloatingSurface>
    </>
  );
}
