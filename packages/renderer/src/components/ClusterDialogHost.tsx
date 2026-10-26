import { useEffect, useMemo, useState } from "react";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton } from "./ClusterButton";
import { ClusterField } from "./ClusterField";
import { settleClusterDialog, subscribeClusterDialogs, type ClusterDialogRequest } from "./cluster-dialog-service";
import { ClusterModal } from "./ClusterModal";
import { ClusterInput } from "./ClusterNativeControls";
import { playClusterUiSound } from "../core/cluster-sounds";

export function ClusterDialogHost() {
  const [request, setRequest] = useState<ClusterDialogRequest | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => subscribeClusterDialogs(setRequest), []);

  useEffect(() => {
    if (!request) return;
    setValue(request.kind === "prompt" ? request.initialValue : "");
    playClusterUiSound("popup");
  }, [request?.id]);

  const promptValid = useMemo(() => {
    if (!request || request.kind !== "prompt") return true;
    return request.expectedValue === undefined || value === request.expectedValue;
  }, [request, value]);

  if (!request || typeof document === "undefined") return null;

  const cancel = () => settleClusterDialog(request.id, request.kind === "confirm" ? false : null);
  const submitDialog = () => {
    if (request.kind === "prompt") {
      if (!promptValid) return;
      playClusterUiSound("confirm");
      settleClusterDialog(request.id, value);
      return;
    }
    playClusterUiSound("confirm");
    settleClusterDialog(request.id, true);
  };
  const danger = request.tone === "danger";

  return (
    <ClusterModal open onClose={cancel} backdropClassName="cluster-dialog-backdrop-v389" className={`cluster-dialog-v389${danger ? " danger" : ""}`} labelledBy={`cluster-dialog-title-${request.id}`} describedBy={`cluster-dialog-message-${request.id}`}>
        <header>
          <span className="cluster-dialog-icon-v389" aria-hidden="true"><ClusterIcon name={danger ? "warning" : "check"} /></span>
          <div>
            <p className="eyebrow">{danger ? "Confirm action" : "Cluster"}</p>
            <h2 id={`cluster-dialog-title-${request.id}`}>{request.title}</h2>
          </div>
        </header>
        <div className="cluster-dialog-body-v389">
          <p id={`cluster-dialog-message-${request.id}`} style={{ whiteSpace: "pre-line" }}>{request.message}</p>
          {request.kind === "prompt" && (
            <ClusterField label={request.label} htmlFor={`cluster-dialog-input-${request.id}`}
              description={request.expectedValue !== undefined ? <>Type <strong>{request.expectedValue}</strong> exactly to continue.</> : undefined}
              className="cluster-dialog-field-v389">
              <ClusterInput id={`cluster-dialog-input-${request.id}`} autoFocus value={value}
                placeholder={request.placeholder} autoComplete="off" onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && promptValid) submitDialog(); }} />
            </ClusterField>
          )}
        </div>
        <footer>
          <ClusterButton autoFocus={request.kind === "confirm"} variant="secondary" onClick={cancel}>{request.cancelLabel}</ClusterButton>
          <ClusterButton variant={danger ? "danger" : "primary"} disabled={!promptValid} onClick={submitDialog}>{request.confirmLabel}</ClusterButton>
        </footer>
    </ClusterModal>
  );
}
