import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton } from "./ClusterButton";
import { ClusterModal } from "./ClusterModal";

type DangerConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  resource?: string;
  consequence?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DangerConfirmDialog({
  open,
  title,
  description,
  resource,
  consequence,
  confirmLabel = "Confirm",
  busy = false,
  onCancel,
  onConfirm,
}: DangerConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;

  return (
    <ClusterModal open onClose={onCancel} busy={busy} backdropClassName="danger-confirm-backdrop-v289" className="danger-confirm-dialog-v289" role="alertdialog" labelledBy="cluster-danger-title" describedBy="cluster-danger-description">
        <header>
          <span aria-hidden="true"><ClusterIcon name="warning" /></span>
          <div>
            <p className="eyebrow">Destructive action</p>
            <h2 id="cluster-danger-title">{title}</h2>
          </div>
        </header>
        <div className="danger-confirm-body-v289">
          <p id="cluster-danger-description">{description}</p>
          {resource && <dl><dt>Resource</dt><dd>{resource}</dd></dl>}
          {consequence && <div className="danger-confirm-consequence-v289"><strong>What happens</strong><span>{consequence}</span></div>}
        </div>
        <footer>
          <ClusterButton autoFocus variant="secondary" disabled={busy} onClick={onCancel}>Cancel</ClusterButton>
          <ClusterButton variant="danger" busy={busy} busyLabel="Working…" onClick={onConfirm}>{confirmLabel}</ClusterButton>
        </footer>
    </ClusterModal>
  );
}
