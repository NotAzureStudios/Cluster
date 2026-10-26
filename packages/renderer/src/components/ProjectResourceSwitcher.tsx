import { ClusterButton } from "./ClusterButton";
import { ClusterSelect } from "./ClusterSelect";
import { useRef, useState, type KeyboardEvent } from "react";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { useClusterMenuExecution } from "./useClusterMenuExecution";
import type { ClusterMenuActionResult } from "./cluster-menu-action-outcome";
import { focusMenuItem } from "./cluster-menu-navigation";

export type ProjectResourceSwitcherItem = {
  id: string;
  label: string;
  projectName?: string | null;
  detail?: string | null;
};

export function ProjectResourceSwitcher({
  label,
  value,
  items,
  onChange,
  onOpenWindow,
  canOpenWindow = false,
}: {
  label: string;
  value: string;
  items: ProjectResourceSwitcherItem[];
  onChange: (id: string) => void;
  onOpenWindow?: (item: ProjectResourceSwitcherItem) => ClusterMenuActionResult | Promise<ClusterMenuActionResult>;
  canOpenWindow?: boolean;
}) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const browseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const browseSurfaceRef = useRef<HTMLDivElement | null>(null);
  const actions = useClusterMenuExecution();
  const dismiss = () => { if (!actions.isExecuting()) setBrowseOpen(false); };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (focusMenuItem(browseSurfaceRef.current, event.key)) event.preventDefault();
  };
  const openWindow = (item: ProjectResourceSwitcherItem) => {
    if (!onOpenWindow) return;
    actions.execute(`window:${item.id}`, () => onOpenWindow(item), () => setBrowseOpen(false));
  };
  const active = items.find((item) => item.id === value) || null;
  return (
    <div className="project-resource-switcher-v489">
      <ClusterSelect
        ariaLabel={label}
        value={value}
        placeholder={`Choose ${label.toLowerCase()}`}
        onChange={onChange}
        options={items.map((item) => ({ value: item.id, label: item.label, meta: item.projectName || item.detail || undefined }))}
      />
      {canOpenWindow && active && onOpenWindow ? (
        <ClusterButton size="compact" variant="quiet" onClick={() => openWindow(active)} disabled={actions.busy} title={`Open ${active.label} in a separate Cluster window`}>
          Window
        </ClusterButton>
      ) : null}
      {items.length > 1 ? (
        <div className="project-resource-browser-v489">
          <ClusterButton ref={browseTriggerRef} type="button" size="compact" variant="quiet"
            aria-haspopup="menu" aria-expanded={browseOpen} disabled={actions.busy}
            onClick={() => setBrowseOpen((previous) => !previous)}>Browse</ClusterButton>
          <ClusterFloatingSurface open={browseOpen} anchorRef={browseTriggerRef} surfaceRef={browseSurfaceRef}
            label={`Browse ${label}`} role="menu" placement="bottom-end" mobileMode="sheet"
            autoFocus="first" autoFocusSelector='button[role="menuitem"]:not(:disabled)'
            className="project-resource-browser-menu-v489 panel" canDismiss={() => !actions.isExecuting()}
            onDismiss={dismiss} onKeyDown={navigate}>
            {items.map((item) => (
              <div key={item.id} className={item.id === value ? "active" : ""}>
                <ClusterButton size="compact" variant="quiet" role="menuitem" disabled={actions.busy}
                  selected={item.id === value} onClick={() => { if (actions.isExecuting()) return; onChange(item.id); dismiss(); }}>
                  <span>{item.label}</span>
                  {item.projectName || item.detail ? <em>{item.projectName || item.detail}</em> : null}
                </ClusterButton>
                {canOpenWindow && onOpenWindow ? (
                  <ClusterButton size="compact" variant="quiet" role="menuitem" disabled={actions.busy}
                    aria-busy={actions.pendingId === `window:${item.id}`}
                    onClick={() => openWindow(item)} title={`Open ${item.label} in a separate Cluster window`}>
                    Window
                  </ClusterButton>
                ) : null}
              </div>
            ))}
            {actions.error ? <p role="alert" className="cluster-menu-execution-error">{actions.error}</p> : null}
          </ClusterFloatingSurface>
        </div>
      ) : null}
    </div>
  );
}
