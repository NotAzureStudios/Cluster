import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useEffect, useState, type ComponentType } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { SharedWorkEvidencePanel } from "../../components/SharedWorkEvidencePanel";
import { SharedWorkActivityPanel } from "../../components/SharedWorkActivityPanel";
import { api } from "../../core/api";
import { compactDateTime } from "../../core/date-time";
import { collaborationColor } from "../collaboration";
import type { Project, Whiteboard, WhiteboardElement } from "../application/application-models";
import { getElementText, whiteboardElementBounds } from "./whiteboard-elements";

export function WhiteboardRecoveryBanner({ draft, onRecover, onDiscard, onExport, staleServerSequence = false }: {
  draft: any; onRecover: () => void; onDiscard: () => void; onExport: () => void; staleServerSequence?: boolean;
}) {
  if (!draft) return null;
  return (
    <div className="collaboration-recovery-v196">
      <div><strong>Local recovery draft</strong><span>Saved {compactDateTime(draft.savedAt)} after unsaved or offline editing.</span>
        {staleServerSequence ? <span role="alert">The server has newer history. This snapshot cannot be restored directly over the new revision; export the copy and use conflict review.</span> : null}
      </div>
      <ClusterButton variant="secondary" onClick={onRecover} disabled={staleServerSequence} title={staleServerSequence ? "Server sequence changed: export draft for manual reference" : "Recover local edits"}>Recover</ClusterButton>
      <ClusterButton variant="secondary" onClick={onExport}>Export copy</ClusterButton>
      <ClusterButton variant="quiet" className="" onClick={onDiscard} size="compact">Discard</ClusterButton>
    </div>
  );
}

type WhiteboardSnapshotSummary = {
  id: string;
  sequence: number;
  revision: number;
  elementCount: number;
  createdAt: string;
};

type WhiteboardSnapshotList = {
  ok: true;
  currentSequence: number;
  snapshots: WhiteboardSnapshotSummary[];
};

type WhiteboardSnapshotRestoreResult = {
  ok: true;
  restoredSequence: number;
  currentSequence: number;
  whiteboard: Whiteboard;
};

export function WhiteboardServerHistoryPanel({ activeWhiteboard, dirty, onRestored }: { activeWhiteboard: Whiteboard; dirty: boolean; onRestored: (whiteboard: Whiteboard, restoredSequence: number) => void }) {
  const [snapshots, setSnapshots] = useState<WhiteboardSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySequence, setBusySequence] = useState<number | "capture" | null>(null);
  const [error, setError] = useState("");
  async function loadSnapshots() {
    setLoading(true);
    setError("");
    try {
      const payload = await api<WhiteboardSnapshotList>(`/api/whiteboards/${activeWhiteboard.id}/snapshots?limit=40`);
      setSnapshots(payload.snapshots || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Whiteboard history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadSnapshots(); }, [activeWhiteboard.id, activeWhiteboard.operationSequence, activeWhiteboard.revision]);
  async function captureSnapshot() {
    setBusySequence("capture");
    setError("");
    try {
      await api(`/api/whiteboards/${activeWhiteboard.id}/snapshots`, { method: "POST" });
      await loadSnapshots();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Restore point could not be captured.");
    } finally {
      setBusySequence(null);
    }
  }
  async function restoreSnapshot(snapshot: WhiteboardSnapshotSummary) {
    if (dirty) {
      setError("Save, discard, or resolve the current local edits before restoring server history.");
      return;
    }
    const confirmed = await confirmCluster({
      title: "Restore Whiteboard snapshot?",
      message: `Restore sequence ${snapshot.sequence} from ${compactDateTime(snapshot.createdAt)}? Cluster will preserve the current server state as a restore point first.`,
      confirmLabel: "Restore snapshot",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusySequence(snapshot.sequence);
    setError("");
    try {
      const payload = await api<WhiteboardSnapshotRestoreResult>(`/api/whiteboards/${activeWhiteboard.id}/snapshots/${snapshot.sequence}/restore`, { method: "POST" });
      onRestored(payload.whiteboard, payload.restoredSequence);
      await loadSnapshots();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Whiteboard snapshot could not be restored.");
    } finally {
      setBusySequence(null);
    }
  }
  return (
    <ClusterDisclosureGroup title="Server history" headerTrailing={snapshots.length} className="version-history-v195 version-history-v196 version-history-v198" contentClassName="version-history-body-v195">
        <div className="version-history-tools-v198">
          <span>{loading ? "Loading authoritative Whiteboard snapshots…" : `Current operation sequence ${Number(activeWhiteboard.operationSequence || 0)}`}</span>
          <ClusterButton size="compact" variant="secondary" busy={busySequence === "capture"} busyLabel="Capturing" onClick={() => void captureSnapshot()}>Capture restore point</ClusterButton>
        </div>
        {error ? <div className="error-box slim" role="alert">{error}</div> : null}
        {snapshots.map((snapshot) => (
          <article key={snapshot.id}>
            <div><strong>Sequence {snapshot.sequence}</strong><span>Revision {snapshot.revision} · {snapshot.elementCount} object{snapshot.elementCount === 1 ? "" : "s"} · {compactDateTime(snapshot.createdAt)}</span></div>
            <ClusterButton size="compact" variant="secondary" disabled={dirty || busySequence !== null} busy={busySequence === snapshot.sequence} busyLabel="Restoring" title={dirty ? "Save or discard local edits before restoring history" : "Restore this authoritative server snapshot"} onClick={() => void restoreSnapshot(snapshot)}>Restore</ClusterButton>
          </article>
        ))}
        {!loading && !snapshots.length ? <div className="empty-state compact-empty">No server restore points yet.</div> : null}
      
    </ClusterDisclosureGroup>
  );
}

export function WhiteboardRelationshipsPanel({ activeWhiteboard, whiteboardName, whiteboardProjectId, RelatedRecordsPanel, CustomFieldValuesPanel, collaborationUsers, currentUser, selectedCount, showSelectionDiscussion, selectionAnchor, dirty, onServerRestore, onAnchorSelect }: {
  activeWhiteboard: Whiteboard | null;
  whiteboardName: string;
  whiteboardProjectId: string;
  RelatedRecordsPanel: ComponentType<any>;
  CustomFieldValuesPanel: ComponentType<any>;
  collaborationUsers: any[];
  currentUser: any;
  selectedCount: number;
  showSelectionDiscussion: boolean;
  selectionAnchor: any;
  dirty: boolean;
  onServerRestore: (whiteboard: Whiteboard, restoredSequence: number) => void;
  onAnchorSelect: (anchor: any) => void;
}) {
  if (!activeWhiteboard) return null;
  return (
    <>
      <ClusterDisclosureGroup title="Relationships, fields & history" className="project-tool-meta-v195" contentClassName="project-tool-meta-grid-v195">
          <RelatedRecordsPanel compact entity={{ kind: "whiteboard", id: activeWhiteboard.id, label: activeWhiteboard.name, projectId: activeWhiteboard.projectId || null }} projectId={activeWhiteboard.projectId || null} />
          <CustomFieldValuesPanel compact entity="whiteboard" entityId={activeWhiteboard.id} projectId={activeWhiteboard.projectId || null} title="Whiteboard fields" />
          <WhiteboardServerHistoryPanel activeWhiteboard={activeWhiteboard} dirty={dirty} onRestored={onServerRestore} />
          <CollaborationPanel entityType="whiteboard" entityId={activeWhiteboard.id} title="Whiteboard discussion" users={collaborationUsers} currentUser={currentUser} compact onAnchorSelect={onAnchorSelect} />
          <SharedWorkEvidencePanel projectId={whiteboardProjectId} kind="whiteboard" entityId={activeWhiteboard.id} label={whiteboardName || "Whiteboard"} compact />
          <SharedWorkWatchControl entity={{ kind: "whiteboard", id: activeWhiteboard.id, projectId: whiteboardProjectId, label: whiteboardName || "Whiteboard" }} compact />
          <SharedWorkActivityPanel entity={{ kind: "whiteboard", id: activeWhiteboard.id, projectId: whiteboardProjectId, label: whiteboardName || "Whiteboard" }} compact />
        
      </ClusterDisclosureGroup>
      {selectedCount > 0 && showSelectionDiscussion && selectionAnchor ? (
        <div className="whiteboard-selection-discussion-v495">
          <CollaborationPanel entityType="whiteboard" entityId={activeWhiteboard.id} title="Selection review" users={collaborationUsers} currentUser={currentUser} anchor={selectionAnchor} anchorLabel={selectionAnchor.label} filterToAnchor compact />
        </div>
      ) : null}
    </>
  );
}

export function WhiteboardDetailsPanel({ visible, activeWhiteboard, projects, name, projectId, description, onNameChange, onProjectChange, onDescriptionChange, onSave, onCreate }: {
  visible: boolean;
  activeWhiteboard: Whiteboard | null;
  projects: Project[];
  name: string;
  projectId: string;
  description: string;
  onNameChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
  onCreate: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="whiteboard-manager panel whiteboard-manager-v194">
      <div className="field"><label>Name</label><ClusterTextInput value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Whiteboard name" /></div>
      <div className="field"><label>Project</label><ClusterSelect ariaLabel="Whiteboard project" value={projectId} placeholder="No project" onChange={onProjectChange} options={[{ value: "", label: "No project" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} /></div>
      <div className="field whiteboard-desc-field"><label>Description</label><ClusterTextInput value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Map flow, UI concept, boss ideas..." /></div>
      <div className="button-row whiteboard-management-actions"><ClusterButton variant="primary" onClick={activeWhiteboard ? onSave : onCreate}>{activeWhiteboard ? "Save details" : "Create whiteboard"}</ClusterButton></div>
    </div>
  );
}

export function WhiteboardPresentationControls({ frames, index, onFocus, onExit }: { frames: WhiteboardElement[]; index: number; onFocus: (index: number) => void; onExit: () => void }) {
  if (!frames.length) return null;
  return (
    <div className="whiteboard-presentation-controls-v489" role="toolbar" aria-label="Whiteboard presentation controls">
      <ClusterButton variant="secondary" size="compact" onClick={() => onFocus(Math.max(0, index - 1))} disabled={index <= 0}>Previous</ClusterButton>
      <div><strong>Frame {index + 1} of {frames.length}</strong><ClusterSelect ariaLabel="Presentation frame" value={String(index)} onChange={(value) => onFocus(Number(value))} options={frames.map((frame, frameIndex) => ({ value: String(frameIndex), label: getElementText(frame) || `Frame ${frameIndex + 1}`, meta: `${frameIndex + 1} / ${frames.length}` }))} /></div>
      <ClusterButton variant="secondary" size="compact" onClick={() => onFocus(Math.min(frames.length - 1, index + 1))} disabled={index >= frames.length - 1}>Next</ClusterButton>
      <ClusterButton variant="quiet" size="compact" onClick={onExit}>Exit</ClusterButton>
    </div>
  );
}

export function WhiteboardRemotePresenceOverlay({ presence, elements }: { presence: any[]; elements: WhiteboardElement[] }) {
  return (
    <>
      {presence.map((person) => {
        const selected = person.selection?.entityType === "whiteboard-element" ? elements.find((element) => element.id === person.selection?.entityId) : null;
        if (!selected) return null;
        const bounds = whiteboardElementBounds(selected);
        const color = collaborationColor(person.userId);
        return <g key={`remote-selection-${person.userId}-${person.clientId || "default"}`} pointerEvents="none"><rect className="remote-selection-outline-v196" x={bounds.x - 7} y={bounds.y - 7} width={bounds.width + 14} height={bounds.height + 14} rx="8" fill="none" stroke={color} strokeWidth="3" strokeDasharray={person.editing?.entityId === selected.id ? "0" : "8 6"} /><rect x={bounds.x - 7} y={Math.max(0, bounds.y - 29)} width={Math.max(72, person.userName.length * 8 + 20)} height="22" rx="7" fill={color} /><text x={bounds.x + 3} y={Math.max(15, bounds.y - 13)} fill="#fff" fontSize="12" fontWeight="800">{person.userName}{person.editing?.entityId === selected.id ? " editing" : ""}</text></g>;
      })}
      {presence.map((person) => person.cursor ? <g key={`remote-cursor-${person.userId}-${person.clientId || "default"}`} className="remote-cursor-v196" pointerEvents="none" transform={`translate(${person.cursor.x} ${person.cursor.y})`}><path d="M0 0 L0 20 L5 15 L10 24 L15 21 L10 12 L18 12 Z" fill={collaborationColor(person.userId)} stroke="#fff" strokeWidth="1.5" /><rect x="18" y="8" width={Math.max(70, person.userName.length * 8 + 18)} height="24" rx="7" fill={collaborationColor(person.userId)} /><text x="26" y="24" fill="#fff" fontSize="12" fontWeight="800">{person.userName}</text></g> : null)}
    </>
  );
}
