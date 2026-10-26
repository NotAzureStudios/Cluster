import { ClusterNativeSelect, ClusterInput } from "../../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterTextArea } from "../../../components/ClusterTextArea";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, queryApi } from "../../../core/api";
import { confirmCluster, promptCluster } from "../../../components/cluster-dialog-service";
import { downloadJsonFile, localId } from "../../../core/storage";
import { useServerState } from "../../../core/server-state";
import { compactDateTime, minutesToHuman } from "../../../core/date-time";
import { formatRelativeTime, levelLabel } from "../../../core/format";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import type { SharedCreateDrawerDependencies, SharedCreateDrawerFeatureProps } from "../../create/SharedCreateDrawer";
import { projectAssignedIds } from "../../projects/projects-utils";
import { displayUserName } from "../../people/people-utils";
import { ClientPerformancePanel } from "../ClientPerformancePanel";
import { ServerPerformancePanel } from "../ServerPerformancePanel";
import type { EntityKind, NormalizedEntitySummary, User, Project, ProjectSnapshot, WhiteboardSummary, Card, SecurityDiagnostics, TimeEntry, ScheduleBlock, UserActivitySummary, AttentionSeverity, AttachmentVisibility, AttachmentReviewState, AttachmentRecord, DetailDrawerItem, InboxWorkflowAction, NotificationWorkflowItem, DiagnosticsPayload, TimeCorrectionIssueType, TimeCorrectionStatus, TimeCorrectionRequest, ShiftRuleSettings, BreakLedgerEntry } from "../../application/application-models";
import { ClusterButton, ClusterIconButton } from "../../../components/ClusterButton";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterOverlayDrawer } from "../../../components/ClusterWorkspacePanel";

import { ATTACHMENT_ENTITY_OPTIONS, LazySharedCreateDrawerFeature, PRIORITY_CREATE_OPTIONS, attachmentNeedsReview, attachmentProjectName, buildOpsDiagnosticChecks, entityKindLabel } from "./operations-workflows";
import { boardOptions, fromDateTimeLocalInput, projectBuildProfile, projectTypeBadge, projectTypeMeta, projectTypePresetsFromSettings, quickCreateModeFromSetting } from "./operations-foundation";

export function DataModelStandardsPanel({ projects, users, whiteboards }: { projects: Project[]; users: Array<User | UserActivitySummary>; whiteboards: WhiteboardSummary[] }) {
  const cards = projects.flatMap((project) =>
    project.boards.flatMap((board) =>
      (board.lists || []).flatMap((list) =>
        ("cards" in list ? (list as any).cards || [] : []).map((card: Card) => ({
          ...card,
          projectId: project.id,
          projectName: project.name,
        })),
      ),
    ),
  );
  const libraryItems = projects.flatMap((project) =>
    (project.libraryItems || []).map((item) => ({
      ...item,
      projectName: project.name,
    })),
  );
  const summaries: NormalizedEntitySummary[] = [
    {
      kind: "project",
      label: "Projects",
      total: projects.length,
      withProject: projects.length,
      withOwner: projects.filter((project) => projectAssignedIds(project).length).length,
      archived: projects.filter((project) => project.archived).length,
      updated: projects.filter((project) => project.updatedAt).length,
    },
    {
      kind: "board",
      label: "Boards",
      total: projects.reduce((total, project) => total + project.boards.length, 0),
      withProject: projects.reduce((total, project) => total + project.boards.length, 0),
      withOwner: projects.reduce((total, project) => total + project.boards.filter((board) => (board.assignedUserIds || []).length).length, 0),
      archived: 0,
      updated: projects.reduce((total, project) => total + project.boards.filter((board) => board.updatedAt).length, 0),
    },
    {
      kind: "whiteboard",
      label: "Whiteboards",
      total: whiteboards.length,
      withProject: whiteboards.filter((item) => item.projectId).length,
      withOwner: 0,
      archived: 0,
      updated: whiteboards.filter((item) => item.updatedAt).length,
    },
    {
      kind: "library",
      label: "Library docs",
      total: libraryItems.length,
      withProject: libraryItems.filter((item) => item.projectId).length,
      withOwner: libraryItems.filter((item) => item.ownerId).length,
      archived: libraryItems.filter((item) => item.status === "archived").length,
      updated: libraryItems.filter((item) => item.updatedAt).length,
    },
    {
      kind: "card",
      label: "Cards",
      total: cards.length,
      withProject: cards.length,
      withOwner: cards.filter((card: any) => card.assigneeId).length,
      archived: 0,
      updated: 0,
    },
    {
      kind: "user",
      label: "Users",
      total: users.length,
      withProject: users.filter((user) => Object.keys((user as User).projectPermissions || {}).length).length,
      withOwner: users.length,
      archived: users.filter((user) => (user as User).archived).length,
      updated: users.filter((user) => (user as User).lastSeenAt).length,
    },
  ];
  const health = summaries.reduce((total, item) => total + (item.total ? Math.round(((item.withProject + item.withOwner + item.updated) / Math.max(1, item.total * 3)) * 100) : 100), 0);
  const score = summaries.length ? Math.round(health / summaries.length) : 100;
  const standardFields = ["id", "title/name", "description/body", "projectId", "owner/assignee", "status", "priority", "createdAt", "updatedAt", "archived", "external/visibility", "linkedItems"];
  return (
    <section className="panel data-model-panel-v125">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Data model</p>
          <h2>Entity standards</h2>
          <p className="muted tight">A boring readout for whether the main objects share the same spine. Boring foundations beat glamorous wreckage.</p>
        </div>
        <span className="soft-pill">{score}% normalized</span>
      </div>
      <div className="data-model-fields-v125">
        {standardFields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      <div className="data-model-grid-v125">
        {summaries.map((summary) => (
          <article key={summary.kind}>
            <div>
              <strong>{summary.label}</strong>
              <span>{entityKindLabel(summary.kind)}</span>
            </div>
            <b>{summary.total}</b>
            <p>
              {summary.withProject} linked · {summary.withOwner} owned · {summary.archived} archived · {summary.updated} updated
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DetailDrawer({ item, onClose, children }: { item: DetailDrawerItem | null; onClose: () => void; children?: ReactNode }) {
  if (!item) return null;
  return (
    <ClusterOverlayDrawer open label={`${item.kind} details`} onClose={onClose} className="detail-drawer-v123" backdropClassName="detail-drawer-backdrop-v123" panelClassName="detail-drawer-panel-v123 panel">
        <div className="detail-drawer-head-v123">
          <div>
            <p className="eyebrow">{item.kind}</p>
            <h2>{item.title}</h2>
            {item.subtitle && <span>{item.subtitle}</span>}
          </div>
          <ClusterIconButton type="button" size="compact" variant="quiet" onClick={onClose} label="Close details">
            <ClusterIcon name="close" />
          </ClusterIconButton>
        </div>
        {item.description && <p className="detail-drawer-description-v123">{item.description}</p>}
        {item.fields?.length ? (
          <div className="detail-drawer-fields-v123">
            {item.fields.map((field) => (
              <div key={field.label}>
                <span>{field.label}</span>
                <strong>{field.value || "Not set"}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {children}
        {item.actions?.length ? (
          <div className="detail-drawer-actions-v123">
            {item.actions.map((action) => (
              <ClusterButton type="button" key={action.label} variant={action.tone === "danger" ? "danger" : action.tone === "primary" ? "primary" : "secondary"} onClick={action.onClick}>
                {action.label}
              </ClusterButton>
            ))}
          </div>
        ) : null}
    </ClusterOverlayDrawer>
  );
}

export function conciseNotificationText(value?: string) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const firstSentence = normalized.match(/^(.{1,110}?[.!?])(?:\s|$)/)?.[1] || normalized;
  const concise = firstSentence.length <= 110 ? firstSentence : normalized;
  return concise.length > 110 ? `${concise.slice(0, 107).trimEnd()}…` : concise;
}

export function professionalizeNotification(item: NotificationWorkflowItem): NotificationWorkflowItem {
  let title = String(item.title || "").replace(/\s+/g, " ").trim();
  let message = item.message;

  const missingLead = title.match(/^(.+?) has no lead$/i);
  if (missingLead) {
    title = "Project lead required";
    message = "Assign a project lead.";
  }

  if (message?.toLowerCase().includes("group hallucination") || message?.toLowerCase().includes("ownership and accountability")) {
    message = "Assign a project lead.";
  }
  if (message?.toLowerCase().includes("payroll folklore")) {
    message = "Review active clocks.";
  }

  title = title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title;
  return { ...item, title, message: conciseNotificationText(message) };
}

export function InboxWorkflowPanel({ notifications, readIds, setReadIds, setDismissedIds, currentUser }: { notifications: NotificationWorkflowItem[]; readIds: string[]; setReadIds: (ids: string[]) => void; setDismissedIds: (setter: (ids: string[]) => string[]) => void; currentUser: User }) {
  const [actions, setActions] = useServerState<InboxWorkflowAction[]>("user", "notifications.workflow-actions", []);
  const [note, setNote] = useState("");
  const active = notifications.filter((item) => !actions.some((action) => action.notificationId === item.id && action.action === "done"));
  const snoozed = actions.filter((action) => action.action === "snoozed").length;
  function record(item: NotificationWorkflowItem, action: InboxWorkflowAction["action"]) {
    setActions(
      [
        {
          id: localId("inbox"),
          notificationId: item.id,
          action,
          note: note.trim(),
          createdAt: new Date().toISOString(),
        },
        ...actions,
      ].slice(0, 300),
    );
    if (!readIds.includes(item.id)) setReadIds([...readIds, item.id]);
    if (action === "done") setDismissedIds((ids) => [...new Set([...ids, item.id])]);
    setNote("");
  }
  return (
    <section className="panel inbox-workflow-v123">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Inbox workflow</p>
          <h2>Action queue</h2>
          <p className="muted tight">Use the inbox to open, snooze, assign, approve, comment on, or complete notification items.</p>
        </div>
        <span className="soft-pill">
          {active.length} active · {snoozed} snoozed
        </span>
      </div>
      <div className="inbox-action-note-v123">
        <ClusterTextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional triage note for the next action..." />
      </div>
      <div className="inbox-action-list-v123">
        {active.slice(0, 5).map((item) => (
          <article key={item.id} className={item.kind}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.projectName || "Workspace"} · {item.actor || "Cluster"} · {formatRelativeTime(item.createdAt)}
              </span>
              <p>{item.message}</p>
            </div>
            <div className="button-row compact">
              <ClusterButton type="button" size="compact" onClick={() => record(item, "snoozed")}>
                Snooze
              </ClusterButton>
              <ClusterButton type="button" size="compact" onClick={() => record(item, "assigned")}>
                Assign
              </ClusterButton>
              <ClusterButton type="button" size="compact" onClick={() => record(item, "approved")}>
                Approve
              </ClusterButton>
              <ClusterButton type="button" size="compact" onClick={() => record(item, "commented")}>
                Comment
              </ClusterButton>
              <ClusterButton type="button" size="compact" onClick={() => record(item, "done")}>
                Done
              </ClusterButton>
            </div>
          </article>
        ))}
        {!active.length && <div className="empty-state compact-empty">Inbox is clear. No items require attention.</div>}
      </div>
    </section>
  );
}

export function AttachmentsHubPanel({ projects, currentUser, compact = false }: { projects: Project[]; currentUser?: User | UserActivitySummary | null; compact?: boolean }) {
  const [attachments, setAttachments] = useServerState<AttachmentRecord[]>("studio", "operations.attachments", []);
  const defaultProjectId = projects[0]?.id || "";
  const [form, setForm] = useState({
    title: "",
    fileName: "",
    fileType: "design",
    sizeLabel: "",
    url: "",
    linkedKind: "project" as EntityKind,
    linkedLabel: "",
    projectId: defaultProjectId,
    visibility: "internal" as AttachmentVisibility,
    versionLabel: "v1",
    reviewState: "needs-review" as AttachmentReviewState,
    notes: "",
  });
  useEffect(() => {
    if (!form.projectId && defaultProjectId) setForm((prev) => ({ ...prev, projectId: defaultProjectId }));
  }, [defaultProjectId]);
  const visibleAttachments = [...attachments].sort((a, b) => new Date(b.updatedAt || b.uploadedAt).getTime() - new Date(a.updatedAt || a.uploadedAt).getTime());
  const reviewCount = attachments.filter(attachmentNeedsReview).length;
  const externalCount = attachments.filter((item) => item.visibility === "external" || item.visibility === "public").length;
  const missingCount = attachments.filter((item) => !item.url && item.reviewState !== "archived").length;
  function addAttachment() {
    const title = form.title.trim() || form.fileName.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const attachment: AttachmentRecord = {
      id: localId("attachment"),
      title,
      fileName: form.fileName.trim() || title,
      fileType: form.fileType.trim() || "file",
      sizeLabel: form.sizeLabel.trim() || null,
      url: form.url.trim() || null,
      linkedKind: form.linkedKind,
      linkedLabel: form.linkedLabel.trim() || title,
      projectId: form.projectId || null,
      visibility: form.visibility,
      versionLabel: form.versionLabel.trim() || null,
      reviewState: form.reviewState,
      uploadedBy: currentUser ? displayUserName(currentUser) : "Studio member",
      uploadedAt: now,
      updatedAt: now,
      notes: form.notes.trim() || null,
    };
    setAttachments([attachment, ...attachments].slice(0, 500));
    setForm((prev) => ({
      ...prev,
      title: "",
      fileName: "",
      sizeLabel: "",
      url: "",
      linkedLabel: "",
      notes: "",
    }));
  }
  function patchAttachment(id: string, patch: Partial<AttachmentRecord>) {
    setAttachments(attachments.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)));
  }
  function exportAttachments() {
    downloadJsonFile(`cluster-attachments-${new Date().toISOString().slice(0, 10)}.json`, {
      version: "0.169.0",
      generatedAt: new Date().toISOString(),
      attachments,
    });
  }
  return (
    <section className={`panel attachments-hub-v135 ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Attachments</p>
          <h2>File attachment registry</h2>
          <p className="muted tight">Track files, links, builds, screenshots, docs, and handoff artifacts against work items. Maintain a searchable index of files, links, builds, screenshots, documents, and handoff artifacts.</p>
        </div>
        <div className="button-row">
          <span className="soft-pill">{attachments.length} files</span>
          <ClusterButton type="button" variant="secondary" onClick={exportAttachments}>
            Export
          </ClusterButton>
        </div>
      </div>
      <div className="attachment-kpis-v135">
        <ClusterButton unstyled type="button">
          <span>Total</span>
          <strong>{attachments.length}</strong>
          <em>records</em>
        </ClusterButton>
        <ClusterButton unstyled type="button" className={reviewCount ? "warning" : "good"}>
          <span>Review</span>
          <strong>{reviewCount}</strong>
          <em>{reviewCount ? "needs action" : "clean"}</em>
        </ClusterButton>
        <ClusterButton unstyled type="button">
          <span>External/public</span>
          <strong>{externalCount}</strong>
          <em>visible</em>
        </ClusterButton>
        <ClusterButton unstyled type="button" className={missingCount ? "danger" : "good"}>
          <span>Missing links</span>
          <strong>{missingCount}</strong>
          <em>{missingCount ? "fix" : "ready"}</em>
        </ClusterButton>
      </div>
      {!compact && (
        <div className="attachment-form-v135">
          <div className="field">
            <label>Title</label>
            <ClusterTextInput value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Screenshot, build zip, design brief..." />
          </div>
          <div className="field">
            <label>File name</label>
            <ClusterTextInput value={form.fileName} onChange={(event) => setForm((prev) => ({ ...prev, fileName: event.target.value }))} placeholder="filename.ext" />
          </div>
          <div className="field">
            <label>Type</label>
            <ClusterTextInput value={form.fileType} onChange={(event) => setForm((prev) => ({ ...prev, fileType: event.target.value }))} placeholder="image, log, build, doc" />
          </div>
          <div className="field">
            <label>Size</label>
            <ClusterTextInput value={form.sizeLabel} onChange={(event) => setForm((prev) => ({ ...prev, sizeLabel: event.target.value }))} placeholder="12 MB" />
          </div>
          <div className="field">
            <label>Project</label>
            <ClusterNativeSelect value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">Workspace</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Linked entity</label>
            <ClusterNativeSelect
              value={form.linkedKind}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  linkedKind: event.target.value as EntityKind,
                }))
              }
            >
              {ATTACHMENT_ENTITY_OPTIONS.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Linked label</label>
            <ClusterTextInput
              value={form.linkedLabel}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  linkedLabel: event.target.value,
                }))
              }
              placeholder="Bug #14, Milestone, Build 0.2..."
            />
          </div>
          <div className="field">
            <label>Visibility</label>
            <ClusterNativeSelect
              value={form.visibility}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  visibility: event.target.value as AttachmentVisibility,
                }))
              }
            >
              <option value="internal">Internal</option>
              <option value="external">External</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Review</label>
            <ClusterNativeSelect
              value={form.reviewState}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  reviewState: event.target.value as AttachmentReviewState,
                }))
              }
            >
              <option value="draft">Draft</option>
              <option value="needs-review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="changes">Changes needed</option>
              <option value="archived">Archived</option>
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Version</label>
            <ClusterTextInput
              value={form.versionLabel}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  versionLabel: event.target.value,
                }))
              }
              placeholder="v1"
            />
          </div>
          <div className="field full">
            <label>URL / path</label>
            <ClusterTextInput value={form.url} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} placeholder="File URL, local path, shared drive link, build artifact..." />
          </div>
          <div className="field full">
            <label>Notes</label>
            <ClusterTextInput value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Review notes, version notes, visibility warnings..." />
          </div>
          <ClusterButton type="button" variant="primary" onClick={addAttachment}>
            Add attachment record
          </ClusterButton>
        </div>
      )}
      <div className="attachment-list-v135">
        {visibleAttachments.slice(0, compact ? 5 : 12).map((item) => (
          <article key={item.id} className={`${item.reviewState} ${attachmentNeedsReview(item) ? "needs-review" : "clean"}`}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.fileName} · {levelLabel(item.fileType)} · {attachmentProjectName(projects, item.projectId)}
              </span>
              <p>
                {entityKindLabel(item.linkedKind)}: {item.linkedLabel}
                {item.versionLabel ? ` · ${item.versionLabel}` : ""}
                {item.sizeLabel ? ` · ${item.sizeLabel}` : ""}
              </p>
              {item.notes && <em>{item.notes}</em>}
            </div>
            <div className="attachment-meta-v135">
              <span className={`visibility ${item.visibility}`}>{levelLabel(item.visibility)}</span>
              <span className={`review ${item.reviewState}`}>{levelLabel(item.reviewState)}</span>
              <span>{item.url ? "linked" : "missing link"}</span>
              <div className="button-row compact">
                <ClusterButton type="button" size="compact" onClick={() => patchAttachment(item.id, { reviewState: "approved" })}>
                  Approve
                </ClusterButton>
                <ClusterButton type="button" size="compact" onClick={() => patchAttachment(item.id, { reviewState: "changes" })}>
                  Changes
                </ClusterButton>
                <ClusterButton type="button" size="compact" onClick={() => patchAttachment(item.id, { reviewState: "archived" })}>
                  Archive
                </ClusterButton>
              </div>
            </div>
          </article>
        ))}
        {!visibleAttachments.length && <SmartEmptyState title="No attachment records" body="Add screenshots, logs, documents, build artifacts, or delivery files so project evidence stays centralized and traceable." />}
      </div>
    </section>
  );
}

export function AdminMaintenanceToolsPanel({ onOpenOperationsCenter }: { projects?: Project[]; users?: Array<User | UserActivitySummary>; onOpenOperationsCenter?: () => void }) {
  const [status, setStatus] = useState("Maintenance actions are idle.");
  const [busy, setBusy] = useState("");
  const [lastOperationId, setLastOperationId] = useState("");

  async function queueSearchRebuild() {
    setBusy("search-rebuild-preview");
    setStatus("Preparing search rebuild preview...");
    try {
      const preview = await api<{ ok: true; dryRun: true; preview: { summary: string; currentRevision: number; totalIndexed: number; rebuilding: boolean; dirty: boolean } }>("/api/admin/operations/search/rebuild", { method: "POST", body: JSON.stringify({ dryRun: true, reason: "Admin Maintenance" }) });
      const confirmed = await confirmCluster({ title: "Queue search rebuild?", message: `${preview.preview.summary}\n\nCurrent index: ${preview.preview.totalIndexed.toLocaleString()} records · ${preview.preview.dirty ? "refresh pending" : "clean"}${preview.preview.rebuilding ? " · rebuild already active" : ""}.`, confirmLabel: "Queue rebuild" });
      if (!confirmed) { setStatus("Search rebuild cancelled after preview."); return; }
      setBusy("search-rebuild");
      const result = await api<{ ok: true; operation: { id: string; status: string } }>("/api/admin/operations/search/rebuild", { method: "POST", body: JSON.stringify({ dryRun: false, reason: "Admin Maintenance" }) });
      setLastOperationId(result.operation.id);
      setStatus(`Search rebuild queued as operation ${result.operation.id}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Search rebuild could not be queued."); }
    finally { setBusy(""); }
  }

  async function verifyStorageIntegrity() {
    setBusy("storage-verify"); setStatus("Verifying storage integrity...");
    try { const result = await api<{ ok: boolean; verifiedAt?: string; verification?: { ok?: boolean } }>("/api/admin/storage/verify", { method: "POST" }); setStatus(result.verification?.ok === false ? "Storage verification completed with findings that need review." : `Storage verification passed${result.verifiedAt ? ` at ${compactDateTime(result.verifiedAt)}` : ""}.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Storage verification failed."); }
    finally { setBusy(""); }
  }

  async function refreshDataIntegrity() {
    setBusy("data-integrity"); setStatus("Refreshing data-integrity evidence...");
    try { const result = await api<{ ok: boolean; integrity?: { state?: string; checkedAt?: string; issues?: unknown[] } }>("/api/admin/operations/integrity/refresh", { method: "POST", body: JSON.stringify({ confirmation: "REFRESH INTEGRITY EVIDENCE" }) }); const findings = Array.isArray(result.integrity?.issues) ? result.integrity?.issues.length : 0; setStatus(`Data-integrity scan: ${result.integrity?.state || (result.ok ? "healthy" : "degraded")} · ${findings} finding${findings === 1 ? "" : "s"}.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Data-integrity scan failed."); }
    finally { setBusy(""); }
  }

  async function runStorageLifecycle() {
    const confirmed = await confirmCluster({ title: "Run storage lifecycle check?", message: "This invokes the server-owned storage lifecycle process. It can update internal housekeeping state; hold modes reject it. No physical Library destruction is enabled by this action.", confirmLabel: "Run check" });
    if (!confirmed) return;
    setBusy("storage-lifecycle"); setStatus("Running storage lifecycle check...");
    try { const result = await api<{ ok: boolean; lifecycle?: { state?: string; lastRunAt?: string } }>("/api/admin/operations/storage-lifecycle/run", { method: "POST", body: JSON.stringify({ confirmation: "RUN STORAGE LIFECYCLE" }) }); setStatus(`Storage lifecycle check finished: ${result.lifecycle?.state || (result.ok ? "healthy" : "degraded")}.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Storage lifecycle check failed."); }
    finally { setBusy(""); }
  }

  async function optimizeDatabase() {
    const confirmed = await confirmCluster({ title: "Run bounded database optimize?", message: "Cluster will run its bounded PostgreSQL ANALYZE maintenance pass. This updates planner statistics; it does not rewrite or delete workspace content.", confirmLabel: "Run optimize" });
    if (!confirmed) return;
    setBusy("database-optimize"); setStatus("Running bounded database optimize...");
    try { const result = await api<{ ok: boolean; optimizedAt?: string }>("/api/admin/database/optimize", { method: "POST" }); setStatus(`Database optimize completed${result.optimizedAt ? ` at ${compactDateTime(result.optimizedAt)}` : ""}.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Database optimize failed."); }
    finally { setBusy(""); }
  }

  async function downloadDiagnosticsBundle() {
    setBusy("diagnostics"); setStatus("Preparing redacted diagnostic bundle...");
    try { const bundle = await api<Record<string, unknown>>("/api/admin/diagnostics/bundle"); downloadJsonFile(`cluster-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, bundle); setStatus("Redacted diagnostic bundle downloaded."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Diagnostic bundle could not be generated."); }
    finally { setBusy(""); }
  }

  async function createBackupNow() {
    setBusy("backup-create"); setStatus("Creating authoritative server backup...");
    try {
      const result = await api<{ ok: boolean; fileName?: string; manifestPath?: string; error?: string }>("/api/admin/backups/now", { method: "POST" });
      if (!result.ok) throw new Error(result.error || "Backup creation failed.");
      setStatus(`Backup created: ${result.fileName || result.manifestPath || "verified manifest"}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Backup creation failed."); }
    finally { setBusy(""); }
  }

  async function latestBackupFileName() {
    const result = await api<{ ok: true; backups: Array<{ fileName?: string; createdAt?: string }> }>("/api/admin/backups");
    const fileName = String(result.backups?.[0]?.fileName || "").trim();
    if (!fileName) throw new Error("No server backup exists yet. Create a backup in Server Configuration first.");
    return fileName;
  }

  async function verifyLatestBackup() {
    setBusy("backup-verify"); setStatus("Verifying latest server backup...");
    try { const fileName = await latestBackupFileName(); const result = await api<{ ok: boolean; mismatches?: unknown[] }>(`/api/admin/backups/${encodeURIComponent(fileName)}/verify`, { method: "POST" }); setStatus(result.ok ? `Latest backup ${fileName} passed integrity verification.` : `Latest backup ${fileName} has ${result.mismatches?.length || 0} verification finding(s).`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Backup verification failed."); }
    finally { setBusy(""); }
  }

  async function runLatestRestoreDrill() {
    setBusy("restore-drill-preview");
    try {
      const fileName = await latestBackupFileName();
      const typed = await promptCluster({ title: "Run isolated restore drill", message: `Validate ${fileName} by restoring it into Cluster's isolated drill location. Live workspace data is not replaced.`, label: "Required confirmation", expectedValue: "RUN RESTORE DRILL", confirmLabel: "Run drill", tone: "danger" }) || "";
      if (typed !== "RUN RESTORE DRILL") { setStatus("Restore drill cancelled."); return; }
      setBusy("restore-drill"); setStatus(`Running isolated restore drill for ${fileName}...`);
      const result = await api<{ ok: boolean; mismatchCount?: number }>(`/api/admin/backups/${encodeURIComponent(fileName)}/restore-drill`, { method: "POST", headers: { "X-Cluster-Confirmation": "RUN RESTORE DRILL" } });
      setStatus(result.ok ? `Restore drill passed for ${fileName}. Live workspace data was not changed.` : `Restore drill found ${result.mismatchCount || 0} recovery mismatch(es).`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Restore drill failed."); }
    finally { setBusy(""); }
  }

  async function retryFailedOperations() {
    setBusy("retry-failed-preview"); setStatus("Preparing failed-operation retry preview...");
    try {
      const preview = await api<{ ok: boolean; requested: number; changeSet?: { executable?: boolean } }>("/api/admin/operations/jobs/retry-failed", { method: "POST", body: JSON.stringify({ dryRun: true, limit: 25 }) });
      if (!preview.requested) { setStatus("No failed or dead-letter operations are eligible for retry."); return; }
      const confirmed = await confirmCluster({ title: "Retry failed operations?", message: `${preview.requested} failed/dead-letter operation${preview.requested === 1 ? " is" : "s are"} eligible. Cluster will reauthorize each operation through the canonical retry command.`, confirmLabel: "Retry operations" });
      if (!confirmed) { setStatus("Operation retry cancelled after preview."); return; }
      setBusy("retry-failed");
      const result = await api<{ ok: boolean; requested: number; retried: number; failed: number; operationIds?: string[] }>("/api/admin/operations/jobs/retry-failed", { method: "POST", body: JSON.stringify({ dryRun: false, limit: 25 }) });
      if (result.operationIds?.[0]) setLastOperationId(result.operationIds[0]);
      setStatus(`Retried ${result.retried}/${result.requested} operation${result.requested === 1 ? "" : "s"}${result.failed ? ` · ${result.failed} failed validation/execution` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Failed operations could not be retried."); }
    finally { setBusy(""); }
  }

  async function reprocessFailedMedia() {
    setBusy("media-reprocess-preview"); setStatus("Preparing failed media reprocessing preview...");
    try {
      const preview = await api<{ ok: boolean; requested: number; preview?: Array<{ id: string; queue: string; type: string; status: string }> }>("/api/admin/media-processing/reprocess", { method: "POST", body: JSON.stringify({ dryRun: true, limit: 25 }) });
      if (!preview.requested) { setStatus("No failed, dead-letter, or cancelled media operations are eligible for reprocessing."); return; }
      const confirmed = await confirmCluster({ title: "Reprocess failed media?", message: `${preview.requested} media operation${preview.requested === 1 ? " is" : "s are"} eligible. Cluster will requeue the existing durable jobs instead of creating duplicate media records.`, confirmLabel: "Reprocess media" });
      if (!confirmed) { setStatus("Media reprocessing cancelled after preview."); return; }
      setBusy("media-reprocess");
      const result = await api<{ ok: boolean; requested: number; retried: number; outcomes?: Array<{ id: string; retried: boolean }> }>("/api/admin/media-processing/reprocess", { method: "POST", body: JSON.stringify({ dryRun: false, limit: 25 }) });
      const first = result.outcomes?.find((outcome) => outcome.retried)?.id; if (first) setLastOperationId(first);
      setStatus(`Requeued ${result.retried}/${result.requested} failed media operation${result.requested === 1 ? "" : "s"}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Failed media operations could not be reprocessed."); }
    finally { setBusy(""); }
  }

  async function runIntegrationDiagnostics() {
    setBusy("integration-diagnostics"); setStatus("Running live checks for configured integration providers...");
    try {
      const catalog = await api<{ providers?: Array<{ id: string; label: string; implementation: string; configured: boolean; healthCheck?: string }> }>("/api/admin/integrations/providers");
      const targets = (catalog.providers || []).filter((provider) => provider.implementation === "active" && provider.configured && provider.healthCheck === "live").slice(0, 20);
      const results = await Promise.all(targets.map(async (provider) => { try { const result = await api<{ health?: { state?: string } }>(`/api/admin/integrations/providers/${encodeURIComponent(provider.id)}/health`); return { provider, state: result.health?.state || "unknown" }; } catch { return { provider, state: "failed" }; } }));
      const unhealthy = results.filter((result) => result.state !== "healthy");
      setStatus(`${results.length} live integration check${results.length === 1 ? "" : "s"} completed · ${unhealthy.length} need review${unhealthy.length ? ` (${unhealthy.map((item) => item.provider.label).join(", ")})` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Integration diagnostics failed."); }
    finally { setBusy(""); }
  }

  async function runCollaborationDiagnostics() {
    setBusy("collaboration-diagnostics"); setStatus("Reading collaboration runtime diagnostics...");
    try {
      const result = await api<Record<string, unknown> & { ok?: boolean; rooms?: number; sessions?: number; presences?: number }>("/api/collaboration/diagnostics");
      const numeric = Object.entries(result).filter(([, value]) => typeof value === "number").slice(0, 4).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${value}`).join(" · ");
      setStatus(`Collaboration diagnostics healthy${numeric ? ` · ${numeric}` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Collaboration diagnostics failed."); }
    finally { setBusy(""); }
  }

  const actions = [
    { key: "search-rebuild", label: "Rebuild search index", detail: "Preview the current index posture, then queue a cancellable durable rebuild in Operations Center.", run: queueSearchRebuild, queued: true },
    { key: "storage-verify", label: "Verify storage", detail: "Verify authoritative storage and surface integrity findings without deleting files.", run: verifyStorageIntegrity },
    { key: "data-integrity", label: "Scan data integrity", detail: "Refresh registered data-integrity evidence, including orphan/missing managed-data findings.", run: refreshDataIntegrity },
    { key: "storage-lifecycle", label: "Run storage lifecycle", detail: "Run the bounded storage lifecycle authority and refresh its health evidence.", run: runStorageLifecycle },
    { key: "backup-create", label: "Create backup", detail: "Create an authoritative server backup now, using the same verified backup authority exposed by Server Configuration.", run: createBackupNow },
    { key: "backup-verify", label: "Verify latest backup", detail: "Cryptographically and structurally verify the newest authoritative server backup.", run: verifyLatestBackup },
    { key: "restore-drill", label: "Validate restore", detail: "Run an isolated restore drill against the newest backup without replacing live workspace data.", run: runLatestRestoreDrill },
    { key: "retry-failed", label: "Retry failed operations", detail: "Preview and reauthorize a bounded batch of failed/dead-letter durable jobs through the operation retry command.", run: retryFailedOperations, queued: true },
    { key: "media-reprocess", label: "Reprocess failed media", detail: "Preview and requeue failed/dead-letter/cancelled media jobs through the existing durable media worker authority.", run: reprocessFailedMedia, queued: true },
    { key: "integration-diagnostics", label: "Integration diagnostics", detail: "Run bounded live health checks for configured providers without exposing their secrets.", run: runIntegrationDiagnostics },
    { key: "collaboration-diagnostics", label: "Collaboration diagnostics", detail: "Inspect the live collaboration room/session/presence runtime without exposing message content.", run: runCollaborationDiagnostics },
    { key: "database-optimize", label: "Optimize database", detail: "Run Cluster's bounded PostgreSQL ANALYZE maintenance pass after explicit confirmation.", run: optimizeDatabase },
    { key: "diagnostics", label: "Generate diagnostic bundle", detail: "Download a sanitized support bundle with secrets, identities, addresses, and local paths redacted.", run: downloadDiagnosticsBundle },
  ];

  return (
    <section className="panel maintenance-tools">
      <div className="section-heading"><div><p className="eyebrow">Guarded maintenance</p><h3>Real server maintenance authorities</h3><p className="muted tight">Browser-only staged runs are retired. Actions call authoritative server workflows, use impact preview/confirmation when appropriate, and durable work remains traceable in Operations Center.</p></div>{onOpenOperationsCenter ? <ClusterButton type="button" variant="secondary" onClick={onOpenOperationsCenter}>Open Operations Center</ClusterButton> : null}</div>
      <div className="maintenance-actions">
        {actions.map((action) => <article key={action.key}><div><strong>{action.label}</strong><span>{action.detail}</span></div><ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void action.run()}>{busy.startsWith(action.key) ? "Working…" : action.queued ? "Preview & run" : "Run"}</ClusterButton></article>)}
      </div>
      {lastOperationId ? <div className="status-box"><strong>Durable operation</strong><span>{lastOperationId}</span>{onOpenOperationsCenter ? <ClusterButton type="button" size="compact" variant="quiet" onClick={onOpenOperationsCenter}>Track progress</ClusterButton> : null}</div> : null}
      <div className="status-box" role="status">{status}</div>
    </section>
  );
}

export function SystemDiagnosticsDashboardPanel({ projects, diagnostics = null, security = null, compact = false }: { projects: Project[]; diagnostics?: DiagnosticsPayload | null; security?: SecurityDiagnostics | null; compact?: boolean }) {
  const [attachments] = useServerState<AttachmentRecord[]>("studio", "operations.attachments", []);
  const [projectSnapshots, setProjectSnapshots] = useState<Record<string, ProjectSnapshot>>({});
  useEffect(() => {
    const ids = projects.map((project) => project.id).sort();
    if (!ids.length) { setProjectSnapshots({}); return; }
    let active = true;
    queryApi<{ snapshots: ProjectSnapshot[] }>(`/api/projects/snapshots?ids=${encodeURIComponent(ids.join(","))}`, { staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["operations", "projects", "project-snapshot"] })
      .then((result) => { if (active) setProjectSnapshots(Object.fromEntries((result.snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]))); })
      .catch(() => { if (active) setProjectSnapshots({}); });
    return () => { active = false; };
  }, [projects.map((project) => project.id).sort().join("|")]);
  const checks = buildOpsDiagnosticChecks({
    projects,
    projectSnapshots,
    diagnostics,
    security,
    attachments,
  });
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  const passCount = checks.filter((check) => check.status === "pass").length;
  async function exportSnapshot() {
    try {
      const bundle = await api<Record<string, unknown>>("/api/admin/diagnostics/bundle");
      downloadJsonFile(`cluster-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, bundle);
    } catch {
      downloadJsonFile(`cluster-diagnostics-local-${new Date().toISOString().slice(0, 10)}.json`, {
        generatedAt: new Date().toISOString(),
        checks,
        diagnostics,
        security,
        attachments: attachments.length,
        note: "Server diagnostic export was unavailable. This local fallback may contain less context.",
      });
    }
  }
  return (
    <section className={`panel ops-diagnostics-v135 ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          {!compact && <p className="eyebrow">Diagnostics</p>}
          <h2>{compact ? "Checks" : "Testing and stability"}</h2>
          {!compact && <p className="muted tight">Runtime, storage, security, backup, and recovery checks.</p>}
        </div>
        <div className="button-row">
          <span className={`soft-pill ${failCount ? "danger" : warnCount ? "warning" : "good"}`}>
            {failCount} fail · {warnCount} warn · {passCount} pass
          </span>
          <ClusterButton type="button" variant="secondary" onClick={() => void exportSnapshot()}>
            Export redacted bundle
          </ClusterButton>
        </div>
      </div>
      <div className="ops-diagnostic-grid-v135">
        {checks.slice(0, compact ? 6 : checks.length).map((check) => (
          <article key={check.key} className={check.status}>
            <span>{check.owner || "Cluster"}</span>
            <strong>{check.label}</strong>
            <p>{check.detail}</p>
            <em>{levelLabel(check.status)}</em>
          </article>
        ))}
      </div>
      <ServerPerformancePanel compact={compact} />
      <ClientPerformancePanel compact={compact} />
    </section>
  );
}

export function SmartEmptyState({ title, body, actionLabel, onAction, meta }: { title: string; body: string; actionLabel?: string; onAction?: () => void; meta?: string }) {
  return (
    <div className="empty-state smart-empty-state-v124 compact-empty">
      <div className="empty-icon-v124"><ClusterIcon name="spark" /></div>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {meta && <em>{meta}</em>}
      </div>
      {actionLabel && onAction && (
        <ClusterButton type="button" size="compact" onClick={onAction}>
          {actionLabel}
        </ClusterButton>
      )}
    </div>
  );
}

export function DemoEmptyStatesPanel() {
  const examples = [
    {
      title: "No builds yet",
      body: "Create an internal build or connect a Git or CI source.",
      meta: "Suggested: Shared Create → Build",
    },
    {
      title: "No tickets yet",
      body: "Use Tickets for bugs, blockers, client notes, and access requests.",
      meta: "Suggested: Shared Create → Ticket",
    },
    {
      title: "No timeline items",
      body: "Add milestones, playtests, meeting windows, or release dates to define the schedule.",
      meta: "Suggested: Shared Create → Timeline",
    },
  ];
  return (
    <section className="panel demo-empty-states-v124">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Empty states</p>
          <h3>Better blank-page guidance</h3>
          <p className="muted tight">Reusable empty states explain what belongs in each section and what to create first.</p>
        </div>
        <span className="soft-pill">Pattern library</span>
      </div>
      <div className="demo-empty-grid-v124">
        {examples.map((item) => (
          <div key={item.title}>
            <SmartEmptyState title={item.title} body={item.body} meta={item.meta} />
          </div>
        ))}
      </div>
    </section>
  );
}

export const SHARED_CREATE_DEPENDENCIES: SharedCreateDrawerDependencies = { PRIORITY_CREATE_OPTIONS, boardOptions, fromDateTimeLocalInput, projectBuildProfile, projectTypeBadge, projectTypeMeta, projectTypePresetsFromSettings, quickCreateModeFromSetting };

export function SharedCreateDrawer(props: Omit<SharedCreateDrawerFeatureProps, "dependencies">) {
  if (!props.open) return null;
  return (
    <LazyFeatureBoundary label="Create">
      <LazySharedCreateDrawerFeature key={props.currentUser.id} {...props} dependencies={SHARED_CREATE_DEPENDENCIES} />
    </LazyFeatureBoundary>
  );
}

export const TIME_CORRECTION_ISSUE_OPTIONS: Array<{
  value: TimeCorrectionIssueType;
  label: string;
  hint: string;
}> = [
  {
    value: "forgot-clock-out",
    label: "Forgot clock-out",
    hint: "Suggest an end time from the schedule.",
  },
  {
    value: "wrong-project",
    label: "Wrong project",
    hint: "Move the log to the correct project/card.",
  },
  {
    value: "wrong-duration",
    label: "Wrong duration",
    hint: "Fix start/end or direct duration.",
  },
  {
    value: "break-missing",
    label: "Break missing",
    hint: "Add or split paid/unpaid break time.",
  },
  {
    value: "duplicate-entry",
    label: "Duplicate entry",
    hint: "Flag a duplicate log for removal.",
  },
  {
    value: "other",
    label: "Other",
    hint: "Describe the correction and include any supporting details.",
  },
];

export const DEFAULT_SHIFT_RULES: ShiftRuleSettings = {
  enabled: true,
  paidBreakMinutes: 15,
  unpaidBreakMinutes: 30,
  requireBreakAfterHours: 6,
  autoBreakReminderMinutes: 240,
  maxShiftHours: 10,
  overtimeAfterHours: 8,
  lateClockOutMinutes: 30,
  expectedStart: "09:00",
  expectedEnd: "17:00",
  compareSchedule: true,
};

export function normalizeCorrectionRequest(request: TimeCorrectionRequest): TimeCorrectionRequest {
  return {
    ...request,
    issueType: request.issueType || "other",
    status: request.status || "open",
    suggestedValue: request.suggestedValue || suggestCorrectionValue(request.issueType || "other", request.requestedDate, request.requestedValue),
    comments: request.comments || [],
    history: request.history || [
      {
        id: localId("hist"),
        status: request.status || "open",
        actor: request.userName || "Requester",
        note: request.reason,
        createdAt: request.createdAt || new Date().toISOString(),
      },
    ],
  };
}

export function suggestCorrectionValue(issueType: TimeCorrectionIssueType, requestedDate: string, requestedValue: string) {
  if (requestedValue.trim()) return requestedValue.trim();
  if (issueType === "forgot-clock-out") return `${requestedDate} ${DEFAULT_SHIFT_RULES.expectedEnd}`;
  if (issueType === "break-missing") return `${DEFAULT_SHIFT_RULES.unpaidBreakMinutes}m unpaid break`;
  if (issueType === "duplicate-entry") return "Remove duplicate entry";
  if (issueType === "wrong-project") return "Move to selected project";
  if (issueType === "wrong-duration") return "Recalculate from corrected start/end";
  return "Admin review needed";
}

export function timeCorrectionIssueLabel(value?: TimeCorrectionIssueType) {
  return TIME_CORRECTION_ISSUE_OPTIONS.find((item) => item.value === value)?.label || "Other";
}

export function TimeCorrectionRequestPanel({ currentUser, users = [], projects, adminView = false }: { currentUser?: User | UserActivitySummary | null; users?: Array<User | UserActivitySummary>; projects: Project[]; adminView?: boolean }) {
  const [requestsRaw, setRequestsRaw] = useServerState<TimeCorrectionRequest[]>("studio", "time.correction-requests", []);
  const requests = useMemo(() => requestsRaw.map(normalizeCorrectionRequest), [requestsRaw]);
  const [form, setForm] = useState({
    projectId: "",
    issueType: "forgot-clock-out" as TimeCorrectionIssueType,
    entryLabel: "",
    requestedDate: new Date().toISOString().slice(0, 10),
    currentValue: "",
    requestedValue: "",
    reason: "",
  });
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const visible = adminView ? requests : requests.filter((request) => request.userId === currentUser?.id);
  const open = requests.filter((request) => ["open", "reviewing", "approved"].includes(request.status)).length;
  const userName = currentUser ? displayUserName(currentUser as User) : "Unknown user";
  function persist(next: TimeCorrectionRequest[]) {
    setRequestsRaw(next.map(normalizeCorrectionRequest).slice(0, 240));
  }
  function submit() {
    if (!currentUser || !form.reason.trim()) return;
    const suggestedValue = suggestCorrectionValue(form.issueType, form.requestedDate, form.requestedValue);
    const now = new Date().toISOString();
    const next: TimeCorrectionRequest = {
      id: localId("timefix"),
      userId: currentUser.id,
      userName,
      projectId: form.projectId || undefined,
      issueType: form.issueType,
      entryLabel: form.entryLabel.trim() || timeCorrectionIssueLabel(form.issueType),
      requestedDate: form.requestedDate,
      currentValue: form.currentValue.trim(),
      requestedValue: form.requestedValue.trim() || suggestedValue,
      suggestedValue,
      reason: form.reason.trim(),
      status: "open",
      comments: [],
      history: [
        {
          id: localId("hist"),
          status: "open",
          actor: userName,
          note: form.reason.trim(),
          createdAt: now,
        },
      ],
      createdAt: now,
    };
    persist([next, ...requests]);
    setForm((prev) => ({
      ...prev,
      entryLabel: "",
      currentValue: "",
      requestedValue: "",
      reason: "",
    }));
  }
  function updateStatus(id: string, status: TimeCorrectionStatus) {
    const actor = adminView ? "Admin" : userName;
    const note = adminNotes[id] || undefined;
    persist(
      requests.map((request) =>
        request.id === id
          ? {
              ...request,
              status,
              adminNote: note || request.adminNote,
              updatedAt: new Date().toISOString(),
              history: [
                ...(request.history || []),
                {
                  id: localId("hist"),
                  status,
                  actor,
                  note,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : request,
      ),
    );
  }
  function addComment(id: string) {
    const body = (commentDrafts[id] || "").trim();
    if (!body) return;
    persist(
      requests.map((request) =>
        request.id === id
          ? {
              ...request,
              comments: [
                ...(request.comments || []),
                {
                  id: localId("comment"),
                  author: adminView ? "Admin" : userName,
                  body,
                  createdAt: new Date().toISOString(),
                },
              ],
              updatedAt: new Date().toISOString(),
            }
          : request,
      ),
    );
    setCommentDrafts((current) => ({ ...current, [id]: "" }));
  }
  function remove(id: string) {
    persist(requests.filter((request) => request.id !== id));
  }
  return (
    <section className="panel time-correction-panel-v123 time-correction-panel-v132">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Corrections</p>
          <h2>{adminView ? "Time correction review queue" : "Request a time correction"}</h2>
          <p className="muted tight">Typed requests, before/after previews, comments, and approval history. Less payroll fanfiction, more audit trail.</p>
        </div>
        <span className="soft-pill">{open} actionable</span>
      </div>
      {!adminView && (
        <div className="time-correction-form-v123 time-correction-form-v132">
          <div className="field">
            <label>Issue type</label>
            <ClusterNativeSelect
              value={form.issueType}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  issueType: event.target.value as TimeCorrectionIssueType,
                }))
              }
            >
              {TIME_CORRECTION_ISSUE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </ClusterNativeSelect>
            <small>{TIME_CORRECTION_ISSUE_OPTIONS.find((item) => item.value === form.issueType)?.hint}</small>
          </div>
          <div className="field">
            <label>Project</label>
            <ClusterNativeSelect value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">No project / unsure</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Date</label>
            <ClusterTextInput
              type="date"
              value={form.requestedDate}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  requestedDate: event.target.value,
                }))
              }
            />
          </div>
          <div className="field">
            <label>Entry</label>
            <ClusterTextInput value={form.entryLabel} onChange={(event) => setForm((prev) => ({ ...prev, entryLabel: event.target.value }))} placeholder="Clock in, lunch, duplicate QA log..." />
          </div>
          <div className="field">
            <label>Current value</label>
            <ClusterTextInput
              value={form.currentValue}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  currentValue: event.target.value,
                }))
              }
              placeholder="What it says now"
            />
          </div>
          <div className="field">
            <label>Requested value</label>
            <ClusterTextInput
              value={form.requestedValue}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  requestedValue: event.target.value,
                }))
              }
              placeholder={suggestCorrectionValue(form.issueType, form.requestedDate, "")}
            />
          </div>
          <div className="field full">
            <label>Reason</label>
            <ClusterTextArea value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Explain the correction so an admin can apply it without mind-reading." />
          </div>
          <div className="correction-preview-v132">
            <span>Before</span>
            <strong>{form.currentValue || "Current log value"}</strong>
            <span>After</span>
            <strong>{form.requestedValue || suggestCorrectionValue(form.issueType, form.requestedDate, "")}</strong>
          </div>
          <ClusterButton type="button" variant="primary" onClick={submit} disabled={!form.reason.trim()}>
            Submit correction request
          </ClusterButton>
        </div>
      )}
      <div className="time-correction-list-v123 time-correction-list-v132">
        {visible.length ? (
          visible.slice(0, 14).map((request) => (
            <article key={request.id} className={`${request.status} ${request.issueType || "other"}`}>
              <div>
                <strong>{request.entryLabel}</strong>
                <span>
                  {request.userName} · {timeCorrectionIssueLabel(request.issueType)} · {request.requestedDate} · {projects.find((project) => project.id === request.projectId)?.name || "No project"}
                </span>
                <p>{request.reason}</p>
                <div className="correction-preview-v132 inline">
                  <span>Before</span>
                  <strong>{request.currentValue || "No current value"}</strong>
                  <span>After</span>
                  <strong>{request.requestedValue || request.suggestedValue || "Admin review"}</strong>
                </div>
                {request.adminNote && <em>Admin note: {request.adminNote}</em>}
              </div>
              <b>{levelLabel(request.status)}</b>
              {adminView ? (
                <div className="admin-correction-actions-v132">
                  <ClusterTextInput
                    value={adminNotes[request.id] || ""}
                    onChange={(event) =>
                      setAdminNotes((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Decision note"
                  />
                  <div className="button-row compact">
                    <ClusterButton type="button" size="compact" onClick={() => updateStatus(request.id, "reviewing")}>
                      Reviewing
                    </ClusterButton>
                    <ClusterButton type="button" size="compact" onClick={() => updateStatus(request.id, "approved")}>
                      Approve
                    </ClusterButton>
                    <ClusterButton type="button" size="compact" onClick={() => updateStatus(request.id, "applied")}>
                      Applied
                    </ClusterButton>
                    <ClusterButton type="button" size="compact" onClick={() => updateStatus(request.id, "rejected")}>
                      Reject
                    </ClusterButton>
                    <ClusterButton type="button" size="compact" onClick={() => remove(request.id)}>
                      Remove
                    </ClusterButton>
                  </div>
                </div>
              ) : null}
              <div className="correction-thread-v132">
                <details>
                  <summary>
                    {(request.comments || []).length} comments · {(request.history || []).length} history
                  </summary>
                  <div className="correction-thread-list-v132">
                    {(request.comments || []).map((comment) => (
                      <p key={comment.id}>
                        <strong>{comment.author}</strong> {comment.body}
                        <span>{formatRelativeTime(comment.createdAt)}</span>
                      </p>
                    ))}
                    {(request.history || []).slice(-5).map((item) => (
                      <p key={item.id}>
                        <strong>{item.actor}</strong> moved to {levelLabel(item.status)}
                        {item.note ? ` · ${item.note}` : ""}
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </p>
                    ))}
                  </div>
                </details>
                <div className="comment-compose-v132">
                  <ClusterTextInput
                    value={commentDrafts[request.id] || ""}
                    onChange={(event) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Add comment"
                  />
                  <ClusterButton type="button" size="compact" onClick={() => addComment(request.id)}>
                    Post
                  </ClusterButton>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state compact-empty">No correction requests yet.</div>
        )}
      </div>
    </section>
  );
}

export function readShiftRules(): ShiftRuleSettings {
  return { ...DEFAULT_SHIFT_RULES };
}

export function shiftMinutes(entry?: TimeEntry | null) {
  if (!entry) return 0;
  return Math.max(entry.computedDurationMinutes || 0, Math.round((Date.now() - new Date(entry.startedAt).getTime()) / 60000));
}

export function shiftRuleWarnings(rules: ShiftRuleSettings, activeEntry: TimeEntry | null, entries: TimeEntry[] = [], blocks: ScheduleBlock[] = []) {
  if (!rules.enabled)
    return [] as Array<{
      id: string;
      tone: AttentionSeverity;
      title: string;
      detail: string;
    }>;
  const warnings: Array<{
    id: string;
    tone: AttentionSeverity;
    title: string;
    detail: string;
  }> = [];
  const minutes = shiftMinutes(activeEntry);
  if (activeEntry && rules.autoBreakReminderMinutes > 0 && minutes >= rules.autoBreakReminderMinutes)
    warnings.push({
      id: "break-reminder",
      tone: minutes >= rules.requireBreakAfterHours * 60 ? "high" : "medium",
      title: "Break reminder",
      detail: `${minutesToHuman(minutes)} active. Review whether a break is required.`,
    });
  if (activeEntry && rules.overtimeAfterHours > 0 && minutes >= rules.overtimeAfterHours * 60)
    warnings.push({
      id: "overtime",
      tone: "high",
      title: "Overtime warning",
      detail: `${minutesToHuman(minutes)} active against ${rules.overtimeAfterHours}h overtime threshold.`,
    });
  if (activeEntry && rules.maxShiftHours > 0 && minutes >= rules.maxShiftHours * 60)
    warnings.push({
      id: "max-shift",
      tone: "critical",
      title: "Max shift warning",
      detail: `${minutesToHuman(minutes)} active against ${rules.maxShiftHours}h max shift.`,
    });
  const today = new Date().toDateString();
  const loggedToday = entries.filter((entry) => new Date(entry.startedAt).toDateString() === today).reduce((total, entry) => total + (entry.computedDurationMinutes || 0), 0);
  const scheduledToday = blocks.filter((block) => new Date(block.startsAt).toDateString() === today).reduce((total, block) => total + Math.max(0, Math.round((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60000)), 0);
  if (rules.compareSchedule && scheduledToday > 0 && loggedToday > scheduledToday + rules.lateClockOutMinutes)
    warnings.push({
      id: "schedule-overrun",
      tone: "medium",
      title: "Late clock-out risk",
      detail: `${minutesToHuman(loggedToday)} logged vs ${minutesToHuman(scheduledToday)} scheduled today.`,
    });
  if (rules.compareSchedule && scheduledToday > 0 && loggedToday < Math.max(0, scheduledToday - 60) && new Date().getHours() >= 15)
    warnings.push({
      id: "schedule-under",
      tone: "low",
      title: "Schedule mismatch",
      detail: `${minutesToHuman(loggedToday)} logged against ${minutesToHuman(scheduledToday)} planned.`,
    });
  return warnings;
}

export function TimeRulesPanel({ currentUser, projects, active, entries = [], blocks = [], adminView = false }: { currentUser?: User | UserActivitySummary | null; projects: Project[]; active?: TimeEntry | null; entries?: TimeEntry[]; blocks?: ScheduleBlock[]; adminView?: boolean }) {
  const [rules, setRules] = useServerState<ShiftRuleSettings>("studio", "time.shift-rules", DEFAULT_SHIFT_RULES, { merge: (value, fallback) => ({ ...fallback, ...value }) });
  const [breaks, setBreaks] = useServerState<BreakLedgerEntry[]>("studio", "time.break-ledger", []);
  const [breakForm, setBreakForm] = useState({
    projectId: "",
    type: "unpaid" as BreakLedgerEntry["type"],
    minutes: String(DEFAULT_SHIFT_RULES.unpaidBreakMinutes),
    status: "taken" as BreakLedgerEntry["status"],
    notes: "",
  });
  const warnings = shiftRuleWarnings(rules, active || null, entries, blocks);
  const visibleBreaks = adminView ? breaks : breaks.filter((item) => !currentUser?.id || item.userId === currentUser.id);
  function saveRules(next: ShiftRuleSettings) {
    const packed = { ...next, updatedAt: new Date().toISOString() };
    setRules(packed);
  }
  function addBreak() {
    const userName = currentUser ? displayUserName(currentUser as User) : "Unassigned";
    const minutes = Math.max(1, Number(breakForm.minutes) || (breakForm.type === "paid" ? rules.paidBreakMinutes : rules.unpaidBreakMinutes));
    const startedAt = new Date().toISOString();
    const endedAt = new Date(Date.now() + minutes * 60000).toISOString();
    setBreaks(
      [
        {
          id: localId("break"),
          userId: currentUser?.id || null,
          userName,
          projectId: breakForm.projectId || null,
          type: breakForm.type,
          minutes,
          status: breakForm.status,
          notes: breakForm.notes || null,
          startedAt,
          endedAt,
          createdAt: startedAt,
        },
        ...breaks,
      ].slice(0, 240),
    );
    setBreakForm((prev) => ({ ...prev, notes: "" }));
  }
  return (
    <section className="panel time-rules-panel-v132">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shift rules</p>
          <h2>Breaks, warnings, and schedule comparison</h2>
          <p className="muted tight">Apply time rules consistently so entries are ready for review.</p>
        </div>
        <span className={`soft-pill ${rules.enabled ? "good" : ""}`}>{rules.enabled ? "Rules on" : "Rules off"}</span>
      </div>
      <div className="time-rule-warning-grid-v132">
        {warnings.length ? (
          warnings.map((warning) => (
            <article key={warning.id} className={warning.tone}>
              <strong>{warning.title}</strong>
              <span>{warning.detail}</span>
            </article>
          ))
        ) : (
          <article className="low">
            <strong>No rule warnings</strong>
            <span>No current time-rule warnings.</span>
          </article>
        )}
      </div>
      <div className="time-rules-grid-v132">
        <div className="field">
          <label>Rules enabled</label>
          <ClusterNativeSelect value={rules.enabled ? "yes" : "no"} onChange={(event) => saveRules({ ...rules, enabled: event.target.value === "yes" })}>
            <option value="yes">Enabled</option>
            <option value="no">Disabled</option>
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Paid break minutes</label>
          <ClusterTextInput
            type="number"
            value={rules.paidBreakMinutes}
            onChange={(event) =>
              saveRules({
                ...rules,
                paidBreakMinutes: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Unpaid break minutes</label>
          <ClusterTextInput
            type="number"
            value={rules.unpaidBreakMinutes}
            onChange={(event) =>
              saveRules({
                ...rules,
                unpaidBreakMinutes: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Break required after hours</label>
          <ClusterTextInput
            type="number"
            value={rules.requireBreakAfterHours}
            onChange={(event) =>
              saveRules({
                ...rules,
                requireBreakAfterHours: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Break reminder after minutes</label>
          <ClusterTextInput
            type="number"
            value={rules.autoBreakReminderMinutes}
            onChange={(event) =>
              saveRules({
                ...rules,
                autoBreakReminderMinutes: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Overtime after hours</label>
          <ClusterTextInput
            type="number"
            value={rules.overtimeAfterHours}
            onChange={(event) =>
              saveRules({
                ...rules,
                overtimeAfterHours: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Max shift hours</label>
          <ClusterTextInput
            type="number"
            value={rules.maxShiftHours}
            onChange={(event) =>
              saveRules({
                ...rules,
                maxShiftHours: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Late clock-out grace minutes</label>
          <ClusterTextInput
            type="number"
            value={rules.lateClockOutMinutes}
            onChange={(event) =>
              saveRules({
                ...rules,
                lateClockOutMinutes: Number(event.target.value) || 0,
              })
            }
          />
        </div>
        <div className="field">
          <label>Expected start</label>
          <ClusterTextInput type="time" value={rules.expectedStart} onChange={(event) => saveRules({ ...rules, expectedStart: event.target.value })} />
        </div>
        <div className="field">
          <label>Expected end</label>
          <ClusterTextInput type="time" value={rules.expectedEnd} onChange={(event) => saveRules({ ...rules, expectedEnd: event.target.value })} />
        </div>
        <label className="toggle-line full">
          <ClusterInput type="checkbox" checked={rules.compareSchedule} onChange={(event) => saveRules({ ...rules, compareSchedule: event.target.checked })} /> Compare logged time against scheduled blocks
        </label>
      </div>
      <div className="break-ledger-v132">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Break ledger</p>
            <h3>Paid / unpaid breaks</h3>
          </div>
          <span className="soft-pill">{visibleBreaks.length} logged</span>
        </div>
        <div className="break-form-v132">
          <div className="field">
            <label>Project</label>
            <ClusterNativeSelect
              value={breakForm.projectId}
              onChange={(event) =>
                setBreakForm((prev) => ({
                  ...prev,
                  projectId: event.target.value,
                }))
              }
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Type</label>
            <ClusterNativeSelect
              value={breakForm.type}
              onChange={(event) =>
                setBreakForm((prev) => ({
                  ...prev,
                  type: event.target.value as BreakLedgerEntry["type"],
                  minutes: event.target.value === "paid" ? String(rules.paidBreakMinutes) : String(rules.unpaidBreakMinutes),
                }))
              }
            >
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Minutes</label>
            <ClusterTextInput
              type="number"
              value={breakForm.minutes}
              onChange={(event) =>
                setBreakForm((prev) => ({
                  ...prev,
                  minutes: event.target.value,
                }))
              }
            />
          </div>
          <div className="field">
            <label>Status</label>
            <ClusterNativeSelect
              value={breakForm.status}
              onChange={(event) =>
                setBreakForm((prev) => ({
                  ...prev,
                  status: event.target.value as BreakLedgerEntry["status"],
                }))
              }
            >
              <option value="taken">Taken</option>
              <option value="planned">Planned</option>
              <option value="missed">Missed</option>
            </ClusterNativeSelect>
          </div>
          <div className="field full">
            <label>Notes</label>
            <ClusterTextInput value={breakForm.notes} onChange={(event) => setBreakForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Lunch, eye break, duplicate cleanup, etc." />
          </div>
          <ClusterButton type="button" variant="secondary" onClick={addBreak}>
            Log break
          </ClusterButton>
        </div>
        <div className="break-list-v132">
          {visibleBreaks.slice(0, 8).map((item) => (
            <article key={item.id} className={item.status}>
              <div>
                <strong>
                  {levelLabel(item.type)} break · {minutesToHuman(item.minutes)}
                </strong>
                <span>
                  {item.userName} · {levelLabel(item.status)} · {projects.find((project) => project.id === item.projectId)?.name || "No project"}
                </span>
                {item.notes && <em>{item.notes}</em>}
              </div>
              <ClusterButton type="button" size="compact" onClick={() => setBreaks(breaks.filter((entry) => entry.id !== item.id))}>
                Remove
              </ClusterButton>
            </article>
          ))}
          {!visibleBreaks.length && <div className="empty-state compact-empty">No breaks logged yet.</div>}
        </div>
      </div>
    </section>
  );
}
