import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLUSTER_WORKFLOW_RELATIONSHIPS,
  CLUSTER_WORKFLOW_RELATIONSHIP_META,
  CLUSTER_WORK_SOURCE_KINDS,
  SHARED_CREATE_COMPLETED_EVENT,
  sharedWorkAttachmentFromLink,
  type ClusterWorkflowLinkCandidatePayload,
  type ClusterWorkflowLinksPayload,
  type ClusterWorkflowRelationship,
  type ClusterWorkSourceKind,
} from "@cluster/shared";
import { api } from "../../core/api";
import { emitProjectWorkflowUpdate, subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterField } from "../../components/ClusterField";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { CLUSTER_MANAGE_LINKED_WORK_EVENT, type ClusterWorkActionContext } from "./work-actions";
import { openClusterWorkNavigation } from "./work-navigation";
import { clusterResourceNavigation } from "./resource-navigation";
import "./linked-work.css";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relationshipLabel(relationship: string, direction: "incoming" | "outgoing") {
  const meta = CLUSTER_WORKFLOW_RELATIONSHIP_META[relationship as ClusterWorkflowRelationship];
  return meta ? meta[direction] : direction === "outgoing" ? humanize(relationship) : `${humanize(relationship)} by`;
}

function relationshipBlocking(relationship: string) {
  return Boolean(CLUSTER_WORKFLOW_RELATIONSHIP_META[relationship as ClusterWorkflowRelationship]?.blocking);
}

function workIcon(kind: ClusterWorkSourceKind) {
  if (kind === "ticket") return "ticket" as const;
  if (kind === "calendar") return "calendar" as const;
  if (kind === "timeline") return "timeline" as const;
  if (kind === "library" || kind === "file") return "library" as const;
  if (kind === "user") return "user" as const;
  if (kind === "project") return "project" as const;
  return "work" as const;
}

export function LinkedWorkPanel({ projectId, kind, entityId, compact = false, title = "Linked work" }: {
  projectId?: string | null;
  kind: ClusterWorkSourceKind;
  entityId?: string | null;
  compact?: boolean;
  title?: string;
}) {
  const [payload, setPayload] = useState<ClusterWorkflowLinksPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateKind, setCandidateKind] = useState<"all" | ClusterWorkSourceKind>("all");
  const [candidates, setCandidates] = useState<ClusterWorkflowLinkCandidatePayload["candidates"]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [relationship, setRelationship] = useState<ClusterWorkflowRelationship>("relates_to");
  const [description, setDescription] = useState("");
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRelationship, setEditRelationship] = useState<ClusterWorkflowRelationship>("relates_to");
  const [editDescription, setEditDescription] = useState("");
  const [editCritical, setEditCritical] = useState(false);

  const load = useCallback(async () => {
    if (!projectId || !entityId) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setPayload(await api<ClusterWorkflowLinksPayload>(`/api/projects/${encodeURIComponent(projectId)}/workflow-links?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(entityId)}`));
    } catch (nextError) {
      setPayload(null);
      setError(nextError instanceof Error ? nextError.message : "Linked work could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId, kind, entityId]);

  const announceRelationshipChange = useCallback(() => {
    if (!projectId || typeof window === "undefined") return;
    emitProjectWorkflowUpdate({ kind: "relationship", projectId });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: { kind?: string; id?: string }; entity?: { kind?: string; id?: string } }>).detail;
      if (detail?.source?.kind === kind && detail.source.id === entityId) void load();
      else if (detail?.entity?.kind === kind && detail.entity.id === entityId) void load();
    };
    window.addEventListener(SHARED_CREATE_COMPLETED_EVENT, refresh);
    return () => window.removeEventListener(SHARED_CREATE_COMPLETED_EVENT, refresh);
  }, [kind, entityId, load]);
  useEffect(() => subscribeProjectWorkflowUpdate((detail) => {
    if (detail.projectId === projectId && detail.kind === "relationship") void load();
  }), [projectId, load]);

  useEffect(() => {
    const manage = (event: Event) => {
      const detail = (event as CustomEvent<ClusterWorkActionContext>).detail;
      if (!detail?.source || detail.source.kind !== kind || detail.source.id !== entityId) return;
      const sourceProjectId = detail.projectId || detail.source.projectId || null;
      if (projectId && sourceProjectId && projectId !== sourceProjectId) return;
      if (detail.relationship && CLUSTER_WORKFLOW_RELATIONSHIPS.includes(detail.relationship)) setRelationship(detail.relationship);
      if (detail.targetKind && (detail.targetKind === "all" || CLUSTER_WORK_SOURCE_KINDS.includes(detail.targetKind))) setCandidateKind(detail.targetKind);
      setManaging(true);
    };
    window.addEventListener(CLUSTER_MANAGE_LINKED_WORK_EVENT, manage);
    return () => window.removeEventListener(CLUSTER_MANAGE_LINKED_WORK_EVENT, manage);
  }, [kind, entityId, projectId]);

  useEffect(() => {
    if (!managing || !projectId || !entityId || !payload?.canEdit) return;
    const timer = window.setTimeout(() => {
      setCandidateLoading(true);
      const params = new URLSearchParams({ q: candidateQuery, excludeKind: kind, excludeId: entityId, limit: "80" });
      if (candidateKind !== "all") params.set("kind", candidateKind);
      void api<ClusterWorkflowLinkCandidatePayload>(`/api/projects/${encodeURIComponent(projectId)}/workflow-link-candidates?${params.toString()}`)
        .then((result) => setCandidates(result.candidates || []))
        .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Relationship candidates could not be loaded."))
        .finally(() => setCandidateLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [managing, projectId, entityId, kind, candidateQuery, candidateKind, payload?.canEdit]);

  const rows = useMemo(() => (payload?.links || []).map((link) => {
    const related = link.direction === "outgoing" ? link.target : link.source;
    const attachment = payload?.subject ? sharedWorkAttachmentFromLink(payload.subject, link) : null;
    return {
      ...link,
      related,
      relatedNavigation: clusterResourceNavigation(related),
      directionLabel: relationshipLabel(link.relationship, link.direction),
      blocking: relationshipBlocking(link.relationship),
      attachmentRole: attachment?.role || null,
    };
  }), [payload]);
  const attachmentCount = useMemo(() => rows.filter((row) => row.attachmentRole).length, [rows]);

  async function createLink(target: ClusterWorkflowLinkCandidatePayload["candidates"][number]) {
    if (!projectId || !entityId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links`, {
        method: "POST",
        body: JSON.stringify({
          source: { kind, id: entityId, projectId },
          target: { kind: target.kind, id: target.id, projectId: target.kind === "user" ? null : projectId },
          relationship,
          description: description.trim() || null,
          critical,
        }),
      });
      setDescription("");
      setCritical(false);
      setCandidateQuery("");
      await load();
      announceRelationshipChange();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Relationship could not be created.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(row: (typeof rows)[number]) {
    setEditId(row.id);
    setEditRelationship((CLUSTER_WORKFLOW_RELATIONSHIPS.includes(row.relationship as ClusterWorkflowRelationship) ? row.relationship : "relates_to") as ClusterWorkflowRelationship);
    setEditDescription(row.description || "");
    setEditCritical(row.critical);
  }

  async function saveEdit() {
    if (!projectId || !editId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        body: JSON.stringify({ relationship: editRelationship, description: editDescription.trim() || null, critical: editCritical }),
      });
      setEditId(null);
      await load();
      announceRelationshipChange();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Relationship could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(id: string) {
    if (!projectId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editId === id) setEditId(null);
      await load();
      announceRelationshipChange();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Relationship could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`linked-work-panel-v491 ${compact ? "compact" : ""}`}>
      <header>
        <div>
          <p className="eyebrow">Relationships</p>
          <h4>{title}</h4>
        </div>
        <div className="linked-work-header-actions-v491">
          <span>{rows.length}{attachmentCount ? ` · ${attachmentCount} evidence/file` : ""}</span>
          {payload?.canEdit ? <ClusterButton size="compact" variant="quiet" onClick={() => setManaging((value) => !value)}>{managing ? "Done" : "Manage"}</ClusterButton> : null}
        </div>
      </header>

      {managing && payload?.canEdit ? (
        <div className="linked-work-manager-v491">
          <div className="linked-work-manager-fields-v491">
            <ClusterField label="Relationship">
              <ClusterSelect ariaLabel="Relationship type" value={relationship} onChange={(value) => setRelationship(value as ClusterWorkflowRelationship)} options={CLUSTER_WORKFLOW_RELATIONSHIPS.map((value) => ({ value, label: CLUSTER_WORKFLOW_RELATIONSHIP_META[value].outgoing }))} />
            </ClusterField>
            <ClusterField label="Find work">
              <ClusterTextInput type="search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Search this project" />
            </ClusterField>
            <ClusterField label="Type">
              <ClusterSelect ariaLabel="Linked work type" value={candidateKind} onChange={(value) => setCandidateKind(value as "all" | ClusterWorkSourceKind)} options={[{ value: "all", label: "All work" }, ...CLUSTER_WORK_SOURCE_KINDS.map((value) => ({ value, label: humanize(value) }))]} />
            </ClusterField>
          </div>
          <ClusterField label="Note" className="linked-work-description-v491">
            <ClusterTextInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional relationship context" />
          </ClusterField>
          <ClusterButton className="linked-work-critical-v491" size="compact" variant="quiet" selected={critical} role="switch" aria-checked={critical} onClick={() => setCritical((value) => !value)}>Critical path / delivery-critical</ClusterButton>
          <div className="linked-work-candidates-v491">
            {candidateLoading ? <p className="muted tight">Finding work…</p> : candidates.length ? candidates.map((candidate) => (
              <ClusterButton unstyled type="button" key={`${candidate.kind}:${candidate.id}`} disabled={busy} onClick={() => void createLink(candidate)}>
                <ClusterIcon name={workIcon(candidate.kind)} />
                <span><strong>{candidate.label}</strong><small>{candidate.context || humanize(candidate.kind)}</small></span>
                <ClusterIcon name="plus" />
              </ClusterButton>
            )) : <p className="muted tight">No matching work in this project.</p>}
          </div>
        </div>
      ) : null}

      {loading ? <p className="muted tight">Loading linked work…</p> : null}
      {!loading && error ? <div className="linked-work-error-v491"><span>{error}</span><ClusterButton size="compact" variant="quiet" onClick={() => void load()}>Retry</ClusterButton></div> : null}
      {!loading && !error && !rows.length ? <p className="muted tight">No linked work yet.</p> : null}
      {!loading && rows.length ? (
        <div className="linked-work-list-v491">
          {rows.map((row) => (
            <div className={`linked-work-row-v491 ${row.blocking ? "blocking" : ""} ${row.critical ? "critical" : ""}`} key={row.id}>
              <ClusterButton unstyled className="linked-work-open-v491" type="button" disabled={!row.relatedNavigation} onClick={() => openClusterWorkNavigation(row.relatedNavigation)} title={row.relatedNavigation ? `Open ${row.related.label}` : "This linked item is not directly navigable yet."}>
                <ClusterIcon name={workIcon(row.related.kind)} />
                <span>
                  <strong>{row.related.label}</strong>
                  <small>{row.related.context || humanize(row.related.kind)} · {row.directionLabel}{row.attachmentRole ? ` · ${humanize(row.attachmentRole)}` : ""}{row.critical ? " · Critical" : ""}</small>
                  {row.description ? <em>{row.description}</em> : null}
                </span>
                {row.relatedNavigation ? <ClusterIcon name="chevron-right" /> : null}
              </ClusterButton>
              {payload?.canEdit ? <ClusterButton unstyled className="linked-work-edit-trigger-v491" type="button" aria-label={`Edit relationship to ${row.related.label}`} onClick={() => editId === row.id ? setEditId(null) : beginEdit(row)}><ClusterIcon name="more" /></ClusterButton> : null}
              {editId === row.id && payload?.canEdit ? (
                <div className="linked-work-editor-v491">
                  <ClusterField label="Relationship">
                    <ClusterSelect ariaLabel={`Relationship to ${row.related.label}`} value={editRelationship} onChange={(value) => setEditRelationship(value as ClusterWorkflowRelationship)} options={CLUSTER_WORKFLOW_RELATIONSHIPS.map((value) => ({ value, label: CLUSTER_WORKFLOW_RELATIONSHIP_META[value].outgoing }))} />
                  </ClusterField>
                  <ClusterField label="Note">
                    <ClusterTextInput value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                  </ClusterField>
                  <ClusterButton className="linked-work-critical-v491" size="compact" variant="quiet" selected={editCritical} role="switch" aria-checked={editCritical} onClick={() => setEditCritical((value) => !value)}>Critical</ClusterButton>
                  <div><ClusterButton size="compact" disabled={busy} onClick={() => void saveEdit()}>Save</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => setEditId(null)}>Cancel</ClusterButton><ClusterButton size="compact" variant="quiet" state="error" disabled={busy} onClick={() => void removeLink(row.id)}>Remove</ClusterButton></div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
