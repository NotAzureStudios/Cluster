import { useId, useRef, useState, type ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface, type ClusterFloatingPlacement } from "./ClusterFloatingSurface";

export function ClusterPreviewCard({
  label,
  trigger,
  children,
  placement = "bottom-start",
  disabled = false,
  className = "",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  placement?: ClusterFloatingPlacement;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  return (
    <span className={className}>
      <ClusterButton
        ref={triggerRef}
        unstyled
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !disabled) { event.preventDefault(); setOpen(true); }
        }}
      >{trigger}</ClusterButton>
      <ClusterFloatingSurface
        open={open}
        anchorRef={triggerRef}
        surfaceRef={surfaceRef}
        id={id}
        role="dialog"
        label={label}
        placement={placement}
        mobileMode="sheet"
        autoFocus="surface"
        className="cluster-action-menu-panel-v428"
        onDismiss={() => setOpen(false)}
      >{children}</ClusterFloatingSurface>
    </span>
  );
}
