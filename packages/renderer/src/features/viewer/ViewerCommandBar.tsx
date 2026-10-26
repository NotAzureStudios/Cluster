import { useEffect, useId, useRef, useState } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterFloatingSurface } from "../../components/ClusterFloatingSurface";
import { focusMenuItem } from "../../components/cluster-menu-navigation";
import { useClusterMenuExecution } from "../../components/useClusterMenuExecution";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { ViewerCommandContext, ViewerCommandDefinition } from "./viewer-contracts";
import type { ViewerCommandRegistry } from "./viewer-command-registry";

/** The viewer uses the same floating/action ownership as the rest of Cluster.
 * A viewer's scroll/clip container must not trap its command menu. */
export function ViewerCommandBar({ registry, context }: { registry: ViewerCommandRegistry; context: ViewerCommandContext }) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const execution = useClusterMenuExecution();
  const commands = registry.list(context).filter((command) => command.group !== "shell");
  const primary = commands.filter((command) => !command.overflow && (command.priority ?? 50) <= 60);
  const overflow = commands.filter((command) => command.overflow || (command.priority ?? 50) > 60);

  function enabled(command: ViewerCommandDefinition) {
    return command.enabled ? command.enabled(context) : true;
  }

  // Preserve browser user-gesture authority. The registry calls the command
  // synchronously before returning its Promise; the menu lock is immediate.
  function run(command: ViewerCommandDefinition, closeOnSuccess: boolean) {
    execution.execute(command.id, async () => {
      const completed = await registry.execute(command.id, context);
      if (!completed) throw new Error("Viewer command is no longer available.");
    }, () => { if (closeOnSuccess) { setOverflowOpen(false); if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true }); } });
  }

  useEffect(() => { if (!overflow.length) setOverflowOpen(false); }, [overflow.length]);

  return <div className="cluster-viewer-command-bar" role="toolbar" aria-label="Viewer commands">
    <div className="cluster-viewer-command-primary">
      {primary.map((command) => command.icon
        ? <ClusterIconButton key={command.id} label={command.label} title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label} size="compact" variant="quiet" disabled={!enabled(command) || execution.busy} data-command-id={command.id} data-priority={command.priority ?? 50} onClick={() => run(command, false)}><ClusterIcon name={command.icon} /></ClusterIconButton>
        : <ClusterButton key={command.id} size="compact" variant="quiet" disabled={!enabled(command) || execution.busy} data-command-id={command.id} data-priority={command.priority ?? 50} title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label} onClick={() => run(command, false)}>{command.label}</ClusterButton>)}
    </div>
    {overflow.length ? <div className="cluster-viewer-command-overflow">
      <ClusterIconButton ref={triggerRef} label="More viewer commands" size="compact" variant="quiet" selected={overflowOpen} disabled={execution.busy} aria-haspopup="menu" aria-expanded={overflowOpen} aria-controls={overflowOpen ? menuId : undefined} onClick={() => { if (!execution.isExecuting()) setOverflowOpen(value => !value); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOverflowOpen(true); } }}><ClusterIcon name="more" /></ClusterIconButton>
      <ClusterFloatingSurface open={overflowOpen} anchorRef={triggerRef} surfaceRef={menuRef} id={menuId} role="menu" label="Viewer commands" placement="bottom-end" mobileMode="sheet" autoFocus="first" autoFocusSelector={'button[role="menuitem"]:not(:disabled)'} className="cluster-viewer-command-menu cluster-action-menu-panel-v428" canDismiss={() => !execution.isExecuting()} onDismiss={() => { if (!execution.isExecuting()) setOverflowOpen(false); }} onKeyDown={(event) => { if (focusMenuItem(menuRef.current, event.key)) event.preventDefault(); }}>
        {overflow.map((command) => <ClusterButton key={command.id} type="button" role="menuitem" variant="quiet" size="compact" disabled={!enabled(command) || execution.busy} aria-busy={execution.pendingId === command.id} onClick={() => run(command, true)}><span>{command.icon ? <ClusterIcon name={command.icon} /> : null}{command.label}</span>{command.shortcut ? <kbd>{command.shortcut}</kbd> : null}</ClusterButton>)}
        {execution.error ? <p role="alert" className="cluster-menu-execution-error">{execution.error}</p> : null}
      </ClusterFloatingSurface>
    </div> : null}
    {!overflowOpen && execution.error ? <span role="alert" className="cluster-menu-execution-error">{execution.error}</span> : null}
  </div>;
}
