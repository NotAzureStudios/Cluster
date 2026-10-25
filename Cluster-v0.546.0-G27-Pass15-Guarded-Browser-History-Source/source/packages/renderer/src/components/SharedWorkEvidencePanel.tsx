import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  SHARED_WORK_ATTACHMENT_ROLES,
  type ClusterWorkflowRelationship,
  type ClusterWorkSourceKind,
  type SharedWorkAttachmentRole,
  type SharedWorkEvidenceCandidatePayload,
  type SharedWorkEvidenceItem,
  type SharedWorkEvidencePayload,
} from "@cluster/shared";
import { api } from "../core/api";
import { uploadApi } from "../core/api/uploads";
import { ClusterButton } from "./ClusterButton";
import { ClusterFileButton } from "./ClusterFileButton";
import { ClusterField } from "./ClusterField";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterSelect } from "./ClusterSelect";
import { ClusterTextInput } from "./ClusterTextInput";
import { emitProjectWorkflowUpdate, subscribeProjectWorkflowUpdate } from "../core/project-workflow-storage";
import { openClusterWorkNavigation } from "../features/workflow/work-navigation";
import { clusterResourceNavigation } from "../features/workflow/resource-navigation";
import "../features/workflow/linked-work.css";

const ROLE_RELATIONSHIP: Record<SharedWorkAttachmentRole, ClusterWorkflowRelationship> = {
  attachment: "references",
  evidence: "supports",
  reference: "informs",
  artifact: "delivers",
};

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function evidenceContext(item: SharedWorkEvidenceItem) {
  const metadata = item.metadata;
  return [
    humanize(item.role),
    metadata.context,
    metadata.reviewState ? humanize(metadata.reviewState) : metadata.status ? humanize(metadata.status) : null,
    metadata.versionLabel,
    formatBytes(metadata.sizeBytes),
  ].filter(Boolean).join(" · ");
}

function evidenceByline(item: SharedWorkEvidenceItem) {
  const metadata = item.metadata;
  const date = metadata.uploadedAt || metadata.updatedAt;
  const formattedDate = date ? new Date(date).toLocaleDateString() : "";
  if (metadata.uploadedByName && formattedDate) return `${metadata.uploadedByName} · ${formattedDate}`;
  return metadata.uploadedByName || formattedDate || "";
}

export function SharedWorkEvidencePanel({
  projectId,
  kind,
  entityId,
  label,
  compact = false,
  title = "Evidence & files",
}: {
  projectId?: string | null;
  kind: ClusterWorkSourceKind;
  entityId?: string | null;
  label?: string | null;
  compact?: boolean;
  title?: string;
}) {
  const [payload, setPayload] = useState<SharedWorkEvidencePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<SharedWorkAttachmentRole>("evidence");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<SharedWorkEvidenceCandidatePayload["candidates"]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!projectId || !entityId) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await api<SharedWorkEvidencePayload>(`/api/projects/${encodeURIComponent(projectId)}/evidence?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(entityId)}`);
      if (requestSequence.current === requestId) setPayload(next);
    } catch (nextError) {
      if (requestSequence.current !== requestId) return;
      setPayload(null);
      setError(nextError instanceof Error ? nextError.message : "Evidence could not be loaded.");
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, [projectId, kind, entityId]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  useEffect(() => subscribeProjectWorkflowUpdate((detail) => {
    if (detail.projectId === projectId && detail.kind === "relationship") void load();
  }), [projectId, load]);

  useEffect(() => {
    if (!projectId || !managing) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCandidateLoading(true);
      const params = new URLSearchParams({ q: query, limit: "40" });
      void api<SharedWorkEvidenceCandidatePayload>(`/api/projects/${encodeURIComponent(projectId)}/evidence-candidates?${params.toString()}`)
        .then((next) => { if (!cancelled) setCandidates(next.candidates); })
        .catch(() => { if (!cancelled) setCandidates([]); })
        .finally(() => { if (!cancelled) setCandidateLoading(false); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, managing, query]);

  const linkedKeys = useMemo(() => new Set((payload?.items || []).map((item) => `${item.resource.kind}:${item.resource.id}`)), [payload?.items]);
  const availableCandidates = useMemo(() => candidates.filter((candidate) => !linkedKeys.has(`${candidate.resource.kind}:${candidate.resource.id}`)), [candidates, linkedKeys]);

  const announceChange = useCallback(() => {
    if (projectId) emitProjectWorkflowUpdate({ kind: "relationship", projectId });
  }, [projectId]);

  async function attach(resource: SharedWorkEvidenceCandidatePayload["candidates"][number]["resource"], preferredRole = role, alreadyBusy = false) {
    if (!projectId || !entityId || (busy && !alreadyBusy)) return;
    if (!alreadyBusy) setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links`, {
        method: "POST",
        body: JSON.stringify({
          source: { kind, id: entityId, projectId, label: label || null },
          target: resource,
          relationship: ROLE_RELATIONSHIP[preferredRole],
          description: preferredRole === "attachment" ? "Attached file" : preferredRole === "artifact" ? "Delivery artifact" : preferredRole === "reference" ? "Reference" : "Evidence",
          critical: false,
        }),
      });
      setMessage(`${resource.label || "Item"} attached as ${preferredRole}.`);
      announceChange();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Evidence could not be attached.");
    } finally {
      if (!alreadyBusy) setBusy(false);
    }
  }

  async function detach(item: SharedWorkEvidenceItem) {
    if (!projectId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setMessage(`${item.metadata.title} detached. The Library/project asset was not deleted.`);
      announceChange();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Evidence could not be detached.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file || !projectId || !entityId || busy) return;
    setBusy(true);
    setError("");
    setMessage(`Uploading ${file.name}…`);
    try {
      const result = await uploadApi<{ id: string; title?: string | null }>(`/api/projects/${projectId}/files`, {
        file,
        label: `Upload evidence ${file.name}`,
        body: {
          title: file.name.replace(/\.[^.]+$/, "") || file.name,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          category: "evidence",
          assetRole: role === "artifact" ? "deliverable" : role === "reference" ? "reference" : "source",
          status: role === "evidence" ? "review" : "active",
          tags: ["shared-work"],
          duplicatePolicy: "reuse",
        },
        invalidate: [`/api/projects/${projectId}/media`, `/api/projects/${projectId}/assets`],
      });
      if (result.queued || !result.result?.id) {
        setMessage(`${file.name} is queued in the canonical upload pipeline. Attach it from Project Assets after sync completes.`);
      } else {
        await attach({ kind: "file", id: result.result.id, projectId, label: result.result.title || file.name }, role, true);
        setMessage(`${file.name} uploaded and attached as ${role}.`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Evidence upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const items = payload?.items || [];
  return <section className={`linked-work-panel-v491 ${compact ? "compact" : ""}`}>
    <header>
      <div>
        <p className="eyebrow">Evidence</p>
        <h4>{title}</h4>
      </div>
      <div className="linked-work-header-actions-v491">
        <span>{items.length}</span>
        {payload?.canEdit ? <ClusterButton size="compact" variant="quiet" onClick={() => setManaging((value) => !value)}>{managing ? "Done" : "Manage"}</ClusterButton> : null}
      </div>
    </header>

    {managing && payload?.canEdit ? <div className="linked-work-manager-v491">
      <div className="linked-work-manager-fields-v491">
        <ClusterField label="Role"><ClusterSelect ariaLabel="Evidence role" value={role} onChange={(value) => setRole(value as SharedWorkAttachmentRole)} options={SHARED_WORK_ATTACHMENT_ROLES.map((value) => ({ value, label: humanize(value) }))} /></ClusterField>
        <ClusterField label="Find existing"><ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project assets, Library, review" /></ClusterField>
        <ClusterField label="Upload">{payload.canUpload ? <ClusterFileButton label="Upload new file" size="compact" busy={busy} disabled={busy} onChange={upload}>Upload file</ClusterFileButton> : <span className="muted">Files permission required</span>}</ClusterField>
      </div>
      <div className="linked-work-candidates-v491">
        {candidateLoading ? <p className="muted tight">Finding evidence…</p> : availableCandidates.length ? availableCandidates.map((candidate) => <ClusterButton unstyled type="button" key={`${candidate.resource.kind}:${candidate.resource.id}`} disabled={busy} onClick={() => void attach(candidate.resource)}>
          <ClusterIcon name={candidate.resource.kind === "review_asset" ? "play" : candidate.resource.kind === "library" ? "library" : "file"} />
          <span><strong>{candidate.metadata.title}</strong><small>{[candidate.metadata.context, candidate.metadata.reviewState || candidate.metadata.status, formatBytes(candidate.metadata.sizeBytes)].filter(Boolean).join(" · ")}</small></span>
          <ClusterIcon name="plus" />
        </ClusterButton>) : <p className="muted tight">No unlinked evidence matches this search.</p>}
      </div>
    </div> : null}

    {loading ? <p className="muted tight">Loading evidence…</p> : null}
    {!loading && error ? <div className="linked-work-error-v491" role="alert"><span>{error}</span><ClusterButton size="compact" variant="quiet" onClick={() => void load()}>Retry</ClusterButton></div> : null}
    {message ? <p className="muted tight" role="status" aria-live="polite">{message}</p> : null}
    {!loading && !error && !items.length ? <p className="muted tight">No evidence or files attached yet.</p> : null}
    {!loading && items.length ? <div className="linked-work-list-v491">{items.map((item) => {
      const navigation = clusterResourceNavigation(item.resource);
      return <div className="linked-work-row-v491" key={item.id}>
        <ClusterButton unstyled className="linked-work-open-v491" type="button" disabled={!navigation} onClick={() => openClusterWorkNavigation(navigation)} title={navigation ? `Open ${item.metadata.title}` : "This evidence item cannot be opened here yet."}>
          <ClusterIcon name={item.resource.kind === "review_asset" ? "play" : item.resource.kind === "library" ? "library" : "file"} />
          <span><strong>{item.metadata.title}</strong><small>{evidenceContext(item)}</small>{evidenceByline(item) ? <em>{evidenceByline(item)}</em> : null}</span>
          {navigation ? <ClusterIcon name="chevron-right" /> : null}
        </ClusterButton>
        {payload?.canEdit ? <ClusterButton unstyled className="linked-work-edit-trigger-v491" type="button" disabled={busy} aria-label={`Detach ${item.metadata.title}`} title="Detach without deleting the source asset" onClick={() => void detach(item)}><ClusterIcon name="trash" /></ClusterButton> : null}
      </div>;
    })}</div> : null}
  </section>;
}
