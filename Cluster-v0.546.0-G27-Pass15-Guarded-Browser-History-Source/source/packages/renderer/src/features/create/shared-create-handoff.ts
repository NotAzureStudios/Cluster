import {
  SHARED_CREATE_COMPLETED_EVENT,
  type ClusterWorkSource,
  type ClusterWorkflowRelationship,
} from "@cluster/shared";
import type { QuickCreateMode, SharedCreateCompletion, SharedCreateHandoff } from "../application/application-models";

let pendingSharedCreateHandoff: SharedCreateHandoff | null = null;

export function openSharedCreate(mode: QuickCreateMode, defaults: Omit<SharedCreateHandoff, "mode"> = {}) {
  const detail: SharedCreateHandoff = { mode, ...defaults };
  pendingSharedCreateHandoff = detail;
  window.dispatchEvent(new CustomEvent<SharedCreateHandoff>("cluster:open-shared-create", { detail }));
}

export function openContextualCreate(mode: QuickCreateMode, defaults: Omit<SharedCreateHandoff, "mode"> & { source: ClusterWorkSource }) {
  openSharedCreate(mode, { ...defaults, openOnComplete: defaults.openOnComplete ?? true });
}

export function readSharedCreateHandoff() {
  const handoff = pendingSharedCreateHandoff;
  pendingSharedCreateHandoff = null;
  return handoff;
}

export function emitSharedCreateCompleted(input: {
  mode: QuickCreateMode;
  entity: ClusterWorkSource;
  source?: ClusterWorkSource;
  relationship?: ClusterWorkflowRelationship;
}) {
  const detail: SharedCreateCompletion = input;
  window.dispatchEvent(new CustomEvent<SharedCreateCompletion>(SHARED_CREATE_COMPLETED_EVENT, { detail }));
}
