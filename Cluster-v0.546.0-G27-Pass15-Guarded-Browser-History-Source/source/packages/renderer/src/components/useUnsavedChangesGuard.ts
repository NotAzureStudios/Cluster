import { useCallback, useEffect, useRef } from "react";
import { confirmCluster } from "./cluster-dialog-service";

const unsavedOwners = new Set<symbol>();

function syncUnsavedMarker() {
  if (typeof document === "undefined") return;
  if (unsavedOwners.size) {
    document.documentElement.dataset.clusterUnsavedChanges = String(unsavedOwners.size);
  } else {
    delete document.documentElement.dataset.clusterUnsavedChanges;
  }
}

export function hasUnsavedChanges() {
  return unsavedOwners.size > 0 || (typeof document !== "undefined" && Boolean(document.documentElement.dataset.clusterUnsavedChanges));
}

export function useUnsavedChangesGuard({
  dirty,
  title = "Discard unsaved changes?",
  message = "You have unsaved changes. Leave this work and discard them?",
  confirmLabel = "Discard changes",
}: {
  dirty: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
}) {
  const ownerRef = useRef(Symbol("cluster-unsaved-work"));

  useEffect(() => {
    const owner = ownerRef.current;
    if (!dirty) {
      unsavedOwners.delete(owner);
      syncUnsavedMarker();
      return;
    }
    unsavedOwners.add(owner);
    syncUnsavedMarker();
    return () => {
      unsavedOwners.delete(owner);
      syncUnsavedMarker();
    };
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirmCluster({ title, message, confirmLabel, tone: "danger" });
  }, [confirmLabel, dirty, message, title]);

  return { dirty, confirmDiscard };
}
