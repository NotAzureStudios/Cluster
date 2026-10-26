import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClusterActionButton } from "./ClusterActionButton";
import { ClusterButton } from "./ClusterButton";
import { ClusterToolbar } from "./ClusterToolbar";

export function ClusterEditablePropertyRow({
  label,
  value,
  editor,
  onSave,
  onCancel,
  disabled = false,
  editLabel,
  savingLabel = "Saving…",
  savedLabel = "Saved",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  editor: ReactNode;
  onSave: () => Promise<unknown> | unknown;
  onCancel?: () => void;
  disabled?: boolean;
  editLabel?: string;
  savingLabel?: string;
  savedLabel?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const regionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const control = regionRef.current?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]:not([tabindex="-1"])');
    control?.focus({ preventScroll: true });
  }, [editing]);

  function cancel() {
    setEditing(false);
    onCancel?.();
  }

  return (
    <div ref={regionRef} className={`cluster-field-v425 ${className}`.trim()} data-cluster-state={disabled ? "disabled" : editing ? "selected" : "default"}>
      <div className="cluster-field-label-v425"><span>{label}</span></div>
      {editing ? editor : <div>{value}</div>}
      <ClusterToolbar label={`${typeof label === "string" ? label : "Property"} actions`}>
        {editing ? (
          <>
            <ClusterActionButton action={async () => { await onSave(); setEditing(false); }} workingLabel={savingLabel} successLabel={savedLabel} size="compact" disabled={disabled}>Save</ClusterActionButton>
            <ClusterButton size="compact" variant="quiet" onClick={cancel} disabled={disabled}>Cancel</ClusterButton>
          </>
        ) : <ClusterButton size="compact" variant="quiet" onClick={() => setEditing(true)} disabled={disabled}>{editLabel || "Edit"}</ClusterButton>}
      </ClusterToolbar>
    </div>
  );
}
