import { ClusterNativeSelect } from "../../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterIcon } from "../../../components/ClusterIcon";

import { lazy, useEffect, useState } from "react";
import { confirmCluster } from "../../../components/cluster-dialog-service";
import { api } from "../../../core/api";
import { canUseTool, isExternalCollaborator } from "../../../core/permissions";
import { dedupeBy, downloadJsonFile, localId } from "../../../core/storage";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { addDays, compactDateTime } from "../../../core/date-time";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../../core/format";
import { canUseProject } from "../../projects/project-access-policy";
import { CustomFieldValuesPanelFeature } from "../../projects/ProjectMetadataPanels";
import { isExternalProject, normalizeProjectStatus, projectHasGit, projectSetupGaps } from "../../projects/projects-utils";
import { displayUserName } from "../../people/people-utils";
import type { EntityKind, EntityReference, User, Project, ProjectSnapshot, BoardListSummary, Priority, Card, BoardList, ProjectMediaPayload, SecurityDiagnostics, TimelineEntry, UserActivitySummary, HomeRoleKey, DependencyStatus, WorkLinkRecord, RecurringWorkCadence, RecurringWorkRecord, WatcherRecord, ProjectCloseoutStatus, ProjectCloseoutChecklistKey, ProjectCloseoutRecord, ExternalPortalAccessLevel, ExternalPortalRule, AttentionItem, AttachmentRecord, OpsDiagnosticCheck, PersistenceKind, PersistenceSummary, PersistenceIntegritySummary, PersistenceRecord, CloseoutCheckEvaluation, DiagnosticsPayload, CustomFieldEntity } from "../../application/application-models";

import { customFieldValueIsEmpty, customFieldVisible, isPast, isToday, makeAttentionItem } from "./operations-foundation";

export const LazySharedCreateDrawerFeature = lazy(() => import("../../create/SharedCreateDrawer").then((module) => ({ default: module.SharedCreateDrawerFeature })));

export function CustomFieldValuesPanel(props: { entity: CustomFieldEntity; entityId: string; projectId?: string | null; title?: string; compact?: boolean; readOnly?: boolean; updatedBy?: string }) {
  return <CustomFieldValuesPanelFeature {...props} helpers={{ customFieldVisible, customFieldValueIsEmpty }} />;
}

export const PRIORITY_CREATE_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export function homeRoleForUser(user: User | null | undefined, projects: Project[]): HomeRoleKey {
  if (user?.isAdmin) return "admin";
  if (isExternalCollaborator(user)) return "external";
  const roleText = `${user?.workspaceRole || ""} ${user?.title || ""} ${user?.department || ""}`.toLowerCase();
  if (/qa|test|quality/.test(roleText) || canUseTool(user, "qa", "edit")) return "qa";
  if (/lead|producer|manager/.test(roleText) || projects.some((project) => project.memberships?.some((membership) => membership.userId === (user?.id || "") && (membership.status || "active") === "active") && canUseProject(user, project, "manage"))) return "lead";
  return "developer";
}

export const CLOSEOUT_CHECKLIST: Array<{
  key: ProjectCloseoutChecklistKey;
  label: string;
  detail: string;
}> = [
  {
    key: "cardsClosed",
    label: "All cards closed or moved",
    detail: "No active work should be stranded when the project leaves the board.",
  },
  {
    key: "ticketsResolved",
    label: "Tickets and QA resolved",
    detail: "Tickets, QA findings, and intake items are closed, moved, or explicitly waived.",
  },
  {
    key: "finalBuildLinked",
    label: "Final build linked",
    detail: "A final build, package, branch, or delivery artifact is attached.",
  },
  {
    key: "libraryApproved",
    label: "Library items approved",
    detail: "Specs, notes, decisions, and handoff items are approved or archived.",
  },
  {
    key: "timelineComplete",
    label: "Timeline complete",
    detail: "Milestones are complete or intentionally cancelled.",
  },
  {
    key: "hoursReviewed",
    label: "Hours reviewed",
    detail: "Time entries, corrections, and billing-sensitive logs have been reviewed.",
  },
  {
    key: "externalDeliverablesConfirmed",
    label: "External deliverables confirmed",
    detail: "Partner/client handoff is approved or not required.",
  },
  {
    key: "backupExportCreated",
    label: "Backup/export created",
    detail: "Project data has a final export or backup package.",
  },
  {
    key: "archiveApproved",
    label: "Archive approved",
    detail: "A project lead or administrator approved the closeout.",
  },
];

export function PersistenceBridgePanel() {
  const [summary, setSummary] = useState<PersistenceSummary | null>(null);
  const [records, setRecords] = useState<PersistenceRecord[]>([]);
  const [integrity, setIntegrity] = useState<PersistenceIntegritySummary | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedKind, setSelectedKind] = useState<PersistenceKind | "all">("all");
  const kinds = Array.from(new Set([...Object.keys(summary?.countsByKind || {}), ...records.map((record) => record.kind)])).sort();
  const visibleRecords = selectedKind === "all" ? records : records.filter((record) => record.kind === selectedKind);
  async function loadPersistence() {
    setLoading(true);
    try {
      const [nextSummary, nextRecords, nextIntegrity] = await Promise.all([
        api<PersistenceSummary>("/api/persistence/summary"),
        api<PersistenceRecord[]>("/api/persistence/records?archived=false&limit=300"),
        api<PersistenceIntegritySummary>("/api/persistence/integrity?limit=1000"),
      ]);
      setSummary(nextSummary);
      setRecords(nextRecords);
      setIntegrity(nextIntegrity);
      setStatus("Persistence registry loaded.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Persistence registry failed to load.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadPersistence(); }, []);
  async function archiveRecord(record: PersistenceRecord) {
    if (!await confirmCluster({ title: "Archive persisted record?", message: `Archive persisted ${record.kind} record "${record.title}"?`, confirmLabel: "Archive record" })) return;
    setLoading(true);
    try {
      await api(`/api/persistence/records/${record.id}`, { method: "DELETE" });
      setStatus("Persistence record archived.");
      await loadPersistence();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Archive failed.");
    } finally { setLoading(false); }
  }
  async function validateRecord(record: PersistenceRecord) {
    setLoading(true);
    try {
      const result = await api<{ record: PersistenceRecord }>(`/api/persistence/records/${record.id}/validate`, { method: "POST", body: JSON.stringify({}) });
      setStatus(`${result.record.title} validated: ${result.record.validationState || "checked"}.`);
      await loadPersistence();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Validation failed.");
    } finally { setLoading(false); }
  }
  async function toggleRecordLock(record: PersistenceRecord) {
    setLoading(true);
    try {
      const next = await api<PersistenceRecord>(`/api/persistence/records/${record.id}/lock`, { method: "POST", body: JSON.stringify({ locked: !record.locked, reason: "Admin Persistence panel" }) });
      setStatus(`${next.locked ? "Locked" : "Unlocked"} ${next.title}.`);
      await loadPersistence();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Lock update failed.");
    } finally { setLoading(false); }
  }
  async function runRepair(dryRun: boolean) {
    setLoading(true);
    try {
      const result = await api<{ dryRun: boolean; scanned: number; repaired: number; skippedLocked: string[] }>("/api/persistence/repair", { method: "POST", body: JSON.stringify({ dryRun, limit: 1000 }) });
      setStatus(`${dryRun ? "Previewed" : "Applied"} repair: ${result.repaired}/${result.scanned} checked, ${result.skippedLocked.length} locked skipped.`);
      await loadPersistence();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Repair failed.");
    } finally { setLoading(false); }
  }
  async function downloadPersistenceExport() {
    try {
      const payload = await api<{ version: string; generatedAt: string; records: PersistenceRecord[] }>(`/api/persistence/export${selectedKind === "all" ? "" : `?kind=${selectedKind}`}`);
      downloadJsonFile(`cluster-persistence-${selectedKind}-${new Date().toISOString().slice(0, 10)}.json`, payload);
      setStatus("Persistence export downloaded.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Export failed.");
    }
  }
  return (
    <section className="panel persistence-panel-v137">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Persistence registry</p>
          <h2>Server-backed workflow records</h2>
          <p className="muted tight">Inspect, validate, lock, repair, and export authoritative server records. Browser-store import controls were retired after automatic migrations replaced them.</p>
        </div>
        <div className="button-row">
          <ClusterButton type="button" className="" onClick={loadPersistence} disabled={loading} variant="secondary">Refresh</ClusterButton>
          <ClusterButton type="button" className="" onClick={() => runRepair(true)} disabled={loading} variant="secondary">Preview repair</ClusterButton>
          <ClusterButton type="button" className="" onClick={() => runRepair(false)} disabled={loading} variant="secondary">Apply validation</ClusterButton>
          <ClusterButton type="button" className="" onClick={downloadPersistenceExport} variant="secondary">Export JSON</ClusterButton>
        </div>
      </div>
      <div className="stat-strip persistence-stats-v137">
        <div className="stat-card panel"><span>Active records</span><strong>{summary?.totalRecords ?? records.length}</strong><em>{summary?.archivedRecords || 0} archived</em></div>
        <div className="stat-card panel"><span>Record kinds</span><strong>{kinds.length}</strong><em>server models</em></div>
        <div className="stat-card panel"><span>Locked</span><strong>{integrity?.lockedCount || 0}</strong><em>protected from repair</em></div>
        <div className="stat-card panel"><span>Backend integrity</span><strong>{integrity ? `${integrity.issueCounts.fail} fail` : "--"}</strong><em>{integrity ? `${integrity.issueCounts.warn} warnings` : "not loaded"}</em></div>
        <div className="stat-card panel"><span>Schema version</span><strong>{summary?.version || "current"}</strong><em>{summary?.generatedAt ? compactDateTime(summary.generatedAt) : "not loaded"}</em></div>
      </div>
      {integrity && (
        <div className="control-domain-list-v136 persistence-integrity-v138">
          <article className={`control-domain-card-v136 ${integrity.ok ? "good" : integrity.issueCounts.fail ? "danger" : "warning"}`}>
            <div><strong>Integrity scan</strong><span>{integrity.scanned} records scanned · {integrity.checksumMismatches} checksum mismatch(es)</span></div><em>{integrity.ok ? "pass" : integrity.issueCounts.fail ? "fail" : "warn"}</em>
          </article>
          {integrity.issues.slice(0, 4).map((issue, index) => <article className={`control-domain-card-v136 ${issue.severity === "fail" ? "danger" : "warning"}`} key={`${issue.code}-${index}`}><div><strong>{issue.code.split("_").join(" ")}</strong><span>{issue.message}</span></div><em>{issue.kind || "record"}</em></article>)}
        </div>
      )}
      <div className="persistence-records-v137">
        <div className="management-header-row">
          <div><h3>Persisted records</h3><p className="muted tight">Authoritative records that survive refreshes and device changes.</p></div>
          <ClusterNativeSelect value={selectedKind} onChange={(event) => setSelectedKind(event.target.value as PersistenceKind | "all")}><option value="all">All kinds</option>{kinds.map((kind) => <option key={kind} value={kind}>{levelLabel(kind)}</option>)}</ClusterNativeSelect>
        </div>
        <div className="persistence-record-list-v137">
          {visibleRecords.slice(0, 80).map((record) => <article className="persistence-record-row-v137" key={record.id}><div><strong>{record.locked ? <ClusterIcon name="lock" /> : null}{record.title}</strong><span>{record.kind} · {record.status || "active"} · {record.validationState || "unchecked"} · {record.sourceKey || "manual"}</span></div><div className="persistence-record-meta-v137"><em>{record.projectId ? `Project ${record.projectId.slice(0, 8)}` : "workspace"}</em><em>{compactDateTime(record.updatedAt)}</em></div><ClusterButton type="button" className="" onClick={() => validateRecord(record)} variant="secondary" size="compact">Validate</ClusterButton><ClusterButton type="button" className="" onClick={() => toggleRecordLock(record)} variant="secondary" size="compact">{record.locked ? "Unlock" : "Lock"}</ClusterButton><ClusterButton type="button" className="" onClick={() => archiveRecord(record)} variant="secondary" size="compact">Archive</ClusterButton></article>)}
          {!visibleRecords.length && <div className="empty-state small-empty-v092"><strong>No persisted records yet.</strong><span>Create records through server-backed tools.</span></div>}
        </div>
      </div>
      {status && <div className="status-box">{status}</div>}
    </section>
  );
}

export const ATTACHMENT_ENTITY_OPTIONS: Array<{ kind: EntityKind; label: string }> = [
  { kind: "project", label: "Project" },
  { kind: "card", label: "Card" },
  { kind: "ticket", label: "Ticket" },
  { kind: "build", label: "Build" },
  { kind: "timeline", label: "Timeline" },
  { kind: "library", label: "Library doc" },
  { kind: "whiteboard", label: "Whiteboard" },
  { kind: "comment", label: "Comment" },
];

export function attachmentProjectName(projects: Project[], projectId?: string | null) {
  return projects.find((project) => project.id === projectId)?.name || "Workspace";
}

export function attachmentNeedsReview(item: AttachmentRecord) {
  return item.reviewState === "needs-review" || item.reviewState === "changes" || (!item.url && item.visibility !== "private") || (item.visibility === "external" && item.reviewState !== "approved");
}

export function attachmentAttentionItems(projects: Project[] = [], attachments: AttachmentRecord[] = []) {
  const items: AttentionItem[] = [];
  const review = attachments.filter(attachmentNeedsReview);
  if (review.length) {
    items.push(
      makeAttentionItem({
        id: "attachments-review-queue",
        source: "attachment",
        severity: review.some((item) => item.visibility === "external" && item.reviewState !== "approved") ? "high" : "medium",
        title: `${review.length} attachment${review.length === 1 ? "" : "s"} need review`,
        detail: review
          .slice(0, 3)
          .map((item) => `${item.title} · ${attachmentProjectName(projects, item.projectId)}`)
          .join(" · "),
        actionLabel: "Open attachments",
        target: "library",
      }),
    );
  }
  const missing = attachments.filter((item) => !item.url && item.reviewState !== "archived");
  if (missing.length) {
    items.push(
      makeAttentionItem({
        id: "attachments-missing-files",
        source: "attachment",
        severity: missing.length > 3 ? "high" : "medium",
        title: `${missing.length} attachment record${missing.length === 1 ? "" : "s"} missing file links`,
        detail: "Metadata exists without a valid file URL or path.",
        actionLabel: "Run missing file check",
        target: "admin",
      }),
    );
  }
  return items;
}

export function maintenanceAttentionItems(projects: Project[] = [], attachments: AttachmentRecord[] = []) {
  const projectIds = new Set(projects.map((project) => project.id));
  const orphanAttachments = attachments.filter((item) => item.projectId && !projectIds.has(item.projectId));
  if (!orphanAttachments.length) return [];
  return [
    makeAttentionItem({
      id: "maintenance-orphan-attachments",
      source: "maintenance",
      severity: "medium",
      title: `${orphanAttachments.length} orphaned attachment${orphanAttachments.length === 1 ? "" : "s"}`,
      detail: "Attachment metadata points at projects that no longer exist or were restored differently.",
      actionLabel: "Open maintenance",
      target: "admin",
    }),
  ];
}
export function buildOpsDiagnosticChecks(input: { projects?: Project[]; projectSnapshots?: Record<string, ProjectSnapshot>; diagnostics?: DiagnosticsPayload | null; security?: SecurityDiagnostics | null; attachments?: AttachmentRecord[] }) {
  const projects = input.projects || [];
  const diagnostics = input.diagnostics;
  const attachments = input.attachments || [];
  const missingAttachments = attachments.filter((item) => !item.url && item.reviewState !== "archived");
  const reviewAttachments = attachments.filter(attachmentNeedsReview);
  const projectSetupWarnings = projects.filter((project) => input.projectSnapshots?.[project.id] ? !input.projectSnapshots[project.id].readiness.ready : projectSetupGaps(project).length > 0).length;
  const folderMissing = diagnostics?.folders?.filter((folder) => !folder.exists).length || 0;
  const counts = diagnostics?.counts;
  const backupCount = counts?.backups || 0;
  const requestP95 = diagnostics?.runtime?.performance?.requests?.p95Ms;
  const eventLoopP95 = diagnostics?.runtime?.performance?.eventLoop?.p95Ms;
  return [
    {
      key: "last-build",
      label: "Last build status",
      status: diagnostics?.ok ? "pass" : "warn",
      detail: diagnostics?.ok ? `Server diagnostics responded on v${diagnostics.version}.` : "Diagnostics endpoint has not responded yet.",
      owner: "Admin",
    },
    {
      key: "typecheck",
      label: "Typecheck status",
      status: "info",
      detail: "Local TS syntax checks pass in packaged builds; run npm build on the target machine for dependency-aware typechecking.",
      owner: "Dev",
    },
    {
      key: "lint",
      label: "Lint status",
      status: "info",
      detail: "A lint command is not currently connected to server health reporting.",
      owner: "Dev",
    },
    {
      key: "migration",
      label: "Migration status",
      status: counts ? "pass" : "warn",
      detail: counts ? `${counts.projects} projects, ${counts.cards} cards, ${counts.libraryItems} docs counted.` : "No database counts loaded yet.",
      owner: "Server",
    },
    {
      key: "endpoint",
      label: "Endpoint health",
      status: diagnostics?.ok ? "pass" : "fail",
      detail: diagnostics?.ok ? "Admin diagnostics endpoint is reachable." : "Admin diagnostics endpoint failed or is still loading.",
      owner: "Server",
    },
    {
      key: "request-performance",
      label: "Request performance",
      status: requestP95 == null ? "info" : requestP95 > 1_000 ? "fail" : requestP95 > 500 ? "warn" : "pass",
      detail: requestP95 == null ? "Runtime latency metrics have not been collected yet." : `API p95 ${requestP95}ms · average ${diagnostics?.runtime?.performance?.requests?.averageMs || 0}ms · ${diagnostics?.runtime?.performance?.requests?.inFlight || 0} in flight.`,
      owner: "Server",
    },
    {
      key: "event-loop",
      label: "Runtime responsiveness",
      status: eventLoopP95 == null ? "info" : eventLoopP95 > 250 ? "fail" : eventLoopP95 > 100 ? "warn" : "pass",
      detail: eventLoopP95 == null ? "Event-loop measurements have not been collected yet." : `Event-loop p95 ${eventLoopP95}ms · heap ${diagnostics?.runtime?.performance?.memory?.heapUsedMiB || 0} MiB.`,
      owner: "Server",
    },
    {
      key: "backup",
      label: "Backup health",
      status: backupCount > 0 ? "pass" : "warn",
      detail: backupCount > 0 ? `${backupCount} backup item${backupCount === 1 ? "" : "s"} found.` : "No backup files detected in the configured backup folder.",
      owner: "Admin",
    },
    {
      key: "imports",
      label: "Failed imports",
      status: "info",
      detail: "Import failures are tracked in the import panel preview, not persisted server-side yet.",
      owner: "Admin",
    },
    {
      key: "restore",
      label: "Recovery verification",
      status: backupCount > 0 ? "info" : "warn",
      detail: backupCount > 0 ? "Authoritative backup verification and isolated restore drills are available from Maintenance." : "Create an authoritative backup before running verification or an isolated restore drill.",
      owner: "Admin",
    },
    {
      key: "attachments",
      label: "Attachment integrity",
      status: missingAttachments.length ? "fail" : reviewAttachments.length ? "warn" : "pass",
      detail: missingAttachments.length ? `${missingAttachments.length} missing file link${missingAttachments.length === 1 ? "" : "s"}.` : reviewAttachments.length ? `${reviewAttachments.length} attachment${reviewAttachments.length === 1 ? "" : "s"} need review.` : `${attachments.length} attachment record${attachments.length === 1 ? "" : "s"} clean.`,
      owner: "Files",
    },
    {
      key: "workspace",
      label: "Studio setup",
      status: projectSetupWarnings ? "warn" : "pass",
      detail: projectSetupWarnings ? `${projectSetupWarnings} project${projectSetupWarnings === 1 ? "" : "s"} have setup gaps.` : "Project configuration checks are clean.",
      owner: "Production",
    },
    {
      key: "storage",
      label: "Storage folders",
      status: folderMissing ? "fail" : diagnostics ? "pass" : "warn",
      detail: diagnostics ? `${diagnostics.folders.length - folderMissing}/${diagnostics.folders.length} folders ready.` : "Folder diagnostics are not loaded yet.",
      owner: "Server",
    },
  ] satisfies OpsDiagnosticCheck[];
}

export function projectCloseoutCards(project: Project) {
  return project.boards.flatMap((board) =>
    (board.lists || []).flatMap((list) =>
      (((list as any).cards || []) as Card[]).map((card) => ({
        card,
        board,
        list,
      })),
    ),
  );
}

export function isCloseoutCardResolved(row: { card: Card; list: BoardListSummary | BoardList }) {
  const listTitle = String(row.list.title || "");
  const sourceIssue = row.card.externalLinks?.find((link) => link.providerEntityType === "source_issue");
  const issueState = String(sourceIssue?.metadata?.state || "").toLowerCase();
  return Boolean(row.list.isDone) || /done|complete|completed|closed|resolved|shipped|archive/i.test(listTitle) || issueState === "closed";
}

export function closeoutChecklistDefaults(project: Project, media?: ProjectMediaPayload | null): Partial<Record<ProjectCloseoutChecklistKey, boolean>> {
  const docs = project.libraryItems || [];
  const libraryApproved = docs.length === 0 || docs.every((item) => ["approved", "active", "archived"].includes(String(item.status || "active")));
  const hasFinalVideo = Boolean(media?.reviewAssets?.some((video) => video.pool === "final" && ["approved", "published"].includes(String(video.status || ""))));
  const hasFileDelivery = Boolean(media?.files?.length);
  const isCompleted = normalizeProjectStatus(project.status) === "completed";
  const rows = projectCloseoutCards(project);
  const openCards = rows.filter((row) => !isCloseoutCardResolved(row));
  const ticketRows = rows.filter((row) => row.card.labels.some((label) => /report|ticket|bug|qa/i.test(label)) || /report|ticket|bug|qa/i.test(`${row.card.title} ${row.card.description || ""}`));
  const openTickets = ticketRows.filter((row) => !isCloseoutCardResolved(row));
  return {
    cardsClosed: openCards.length === 0,
    ticketsResolved: openTickets.length === 0,
    finalBuildLinked: projectHasGit(project) || hasFinalVideo || hasFileDelivery,
    libraryApproved,
    timelineComplete: isCompleted,
    hoursReviewed: false,
    externalDeliverablesConfirmed: !isExternalProject(project),
    backupExportCreated: false,
    archiveApproved: Boolean(project.archived),
  };
}

export function closeoutCheckEvaluations(project: Project, record: ProjectCloseoutRecord, portalRules: ExternalPortalRule[], media?: ProjectMediaPayload | null): CloseoutCheckEvaluation[] {
  const docs = project.libraryItems || [];
  const rows = projectCloseoutCards(project);
  const openCards = rows.filter((row) => !isCloseoutCardResolved(row));
  const ticketRows = rows.filter((row) => row.card.labels.some((label) => /report|ticket|bug|qa/i.test(label)) || /report|ticket|bug|qa/i.test(`${row.card.title} ${row.card.description || ""}`));
  const openTickets = ticketRows.filter((row) => !isCloseoutCardResolved(row));
  const hasFinalVideo = Boolean(media?.reviewAssets?.some((video) => video.pool === "final" && ["approved", "published"].includes(String(video.status || ""))));
  const hasFileDelivery = Boolean(media?.files?.length);
  const hasFinalBuild = projectHasGit(project) || hasFinalVideo || hasFileDelivery;
  const libraryApproved = docs.length === 0 || docs.every((item) => ["approved", "active", "archived"].includes(String(item.status || "active")));
  const approvedPortalRules = portalRules.filter((rule) => rule.projectId === project.id && rule.approvalState === "approved" && rule.status !== "revoked");
  const externalDone = !isExternalProject(project) || approvedPortalRules.length > 0 || Boolean(record.checklist.externalDeliverablesConfirmed);
  const projectComplete = normalizeProjectStatus(project.status) === "completed" || Boolean(record.checklist.timelineComplete);
  const manual = (key: ProjectCloseoutChecklistKey) => Boolean(record.checklist[key]);
  const byKey: Partial<Record<ProjectCloseoutChecklistKey, Omit<CloseoutCheckEvaluation, "key" | "label" | "detail">>> = {
    cardsClosed: {
      done: openCards.length === 0,
      source: "auto",
      sourceLabel: "Auto",
      evidence: rows.length ? `${openCards.length} open / ${rows.length} total cards` : "No tracked cards found",
      locked: false,
    },
    ticketsResolved: {
      done: openTickets.length === 0,
      source: "auto",
      sourceLabel: "Auto",
      evidence: ticketRows.length ? `${openTickets.length} open / ${ticketRows.length} tracked QA or ticket items` : "No tracked QA or ticket items found",
      locked: false,
    },
    finalBuildLinked: {
      done: hasFinalBuild,
      source: "auto",
      sourceLabel: "Auto",
      evidence: projectHasGit(project) ? "Git repository linked" : hasFinalVideo ? "Approved final video found" : hasFileDelivery ? "Project file delivery found" : "No final build, repository, or delivery file linked",
      locked: false,
    },
    libraryApproved: {
      done: libraryApproved,
      source: "auto",
      sourceLabel: "Auto",
      evidence: docs.length ? `${docs.filter((item) => ["approved", "active", "archived"].includes(String(item.status || "active"))).length}/${docs.length} Library items approved or active` : "No Library items to approve",
      locked: false,
    },
    timelineComplete: {
      done: projectComplete,
      source: normalizeProjectStatus(project.status) === "completed" ? "auto" : "manual",
      sourceLabel: normalizeProjectStatus(project.status) === "completed" ? "Auto" : "Manual",
      evidence: normalizeProjectStatus(project.status) === "completed" ? "Project status is completed" : manual("timelineComplete") ? "Timeline completion confirmed manually" : "Mark complete when milestones are done or cancelled",
    },
    hoursReviewed: {
      done: manual("hoursReviewed"),
      source: "manual",
      sourceLabel: "Manual",
      evidence: manual("hoursReviewed") ? "Hours reviewed" : "Time and corrections need review",
    },
    externalDeliverablesConfirmed: {
      done: externalDone,
      source: isExternalProject(project) ? "manual" : "auto",
      sourceLabel: isExternalProject(project) ? "Manual" : "Auto",
      evidence: !isExternalProject(project) ? "Internal project, no external handoff required" : approvedPortalRules.length ? `${approvedPortalRules.length} approved portal rule${approvedPortalRules.length === 1 ? "" : "s"}` : manual("externalDeliverablesConfirmed") ? "External delivery confirmed manually" : "Confirm partner/client deliverables",
    },
    backupExportCreated: {
      done: manual("backupExportCreated"),
      source: "manual",
      sourceLabel: "Manual",
      evidence: manual("backupExportCreated") ? "Backup/export marked ready" : "Create final backup or export package",
    },
    archiveApproved: {
      done: ["verified", "archived"].includes(record.status) || Boolean(record.checklist.archiveApproved),
      source: "lead",
      sourceLabel: "Lead",
      evidence: record.status === "submitted" ? "Waiting for project lead verification" : record.status === "rejected" ? "Lead requested changes" : ["verified", "archived"].includes(record.status) ? `Verified by ${record.verifierName || record.approverName || "project lead"}` : "Submit completion for lead verification",
      locked: false,
    },
  };
  return CLOSEOUT_CHECKLIST.map((item) => ({
    ...item,
    ...(byKey[item.key] || {
      done: manual(item.key),
      source: "manual" as const,
      sourceLabel: "Manual",
      evidence: manual(item.key) ? "Marked ready" : "Needs review",
    }),
  }));
}

export function closeoutSubmissionReady(evaluations: CloseoutCheckEvaluation[]) {
  return evaluations.filter((item) => item.key !== "archiveApproved").every((item) => item.done);
}

export function closeoutReadinessScore(evaluations: CloseoutCheckEvaluation[]) {
  const required = evaluations.filter((item) => item.key !== "archiveApproved");
  if (!required.length) return 100;
  return Math.round((required.filter((item) => item.done).length / required.length) * 100);
}

export function normalizeCloseout(project: Project, input?: Partial<ProjectCloseoutRecord> | null, media?: ProjectMediaPayload | null): ProjectCloseoutRecord {
  const now = new Date().toISOString();
  const defaults = closeoutChecklistDefaults(project, media);
  return {
    id: input?.id || localId("closeout"),
    projectId: project.id,
    status: input?.status || (project.archived ? "archived" : "draft"),
    checklist: { ...defaults, ...(input?.checklist || {}) },
    notes: input?.notes || null,
    approverName: input?.approverName || null,
    requestedBy: input?.requestedBy || null,
    submittedBy: input?.submittedBy || null,
    submissionNote: input?.submissionNote || null,
    verifierName: input?.verifierName || null,
    verificationNote: input?.verificationNote || null,
    rejectionNote: input?.rejectionNote || null,
    createdAt: input?.createdAt || now,
    updatedAt: input?.updatedAt || now,
    submittedAt: input?.submittedAt || null,
    approvedAt: input?.approvedAt || null,
    verifiedAt: input?.verifiedAt || null,
    rejectedAt: input?.rejectedAt || null,
    archivedAt: input?.archivedAt || null,
  };
}

export function closeoutScore(record: ProjectCloseoutRecord) {
  const done = CLOSEOUT_CHECKLIST.filter((item) => record.checklist[item.key]).length;
  return Math.round((done / CLOSEOUT_CHECKLIST.length) * 100);
}

export function closeoutBlockingItems(record: ProjectCloseoutRecord) {
  return CLOSEOUT_CHECKLIST.filter((item) => !record.checklist[item.key]);
}

export function closeoutStatusLabel(status: ProjectCloseoutStatus) {
  return (
    (
      {
        draft: "Draft",
        submitted: "Lead verification",
        verified: "Verified",
        rejected: "Changes requested",
        archived: "Archived",
      } as Record<ProjectCloseoutStatus, string>
    )[status] || "Draft"
  );
}

export function portalAccessLabel(level: ExternalPortalAccessLevel) {
  return (
    (
      {
        viewer: "Viewer",
        commenter: "Commenter",
        reviewer: "Reviewer",
      } as Record<ExternalPortalAccessLevel, string>
    )[level] || "Viewer"
  );
}

export function projectExternalPortalSummary(project: Project, rules: ExternalPortalRule[]) {
  const projectRules = rules.filter((rule) => rule.projectId === project.id && rule.status !== "revoked");
  const approved = projectRules.filter((rule) => rule.approvalState === "approved" && ["invited", "active"].includes(rule.status));
  const unsafe = projectRules.filter((rule) => rule.canSeeBudget || rule.canSeeTime || rule.allowedSections.includes("internal"));
  return {
    total: projectRules.length,
    approved: approved.length,
    unsafe: unsafe.length,
  };
}

export const ENTITY_KIND_OPTIONS: Array<{ value: EntityKind; label: string }> = [
  { value: "project", label: "Project" },
  { value: "board", label: "Board" },
  { value: "card", label: "Card" },
  { value: "ticket", label: "Ticket" },
  { value: "build", label: "Build" },
  { value: "timeline", label: "Timeline" },
  { value: "meeting", label: "Meeting" },
  { value: "milestone", label: "Milestone" },
  { value: "library", label: "Library" },
  { value: "whiteboard", label: "Whiteboard" },
  { value: "time", label: "Time entry" },
  { value: "user", label: "User" },
];

export function entityKindLabel(kind?: string | null) {
  return ENTITY_KIND_OPTIONS.find((item) => item.value === kind)?.label || levelLabel(kind || "item");
}

export function normalizeLinkRecord(link: WorkLinkRecord): WorkLinkRecord {
  return {
    ...link,
    status: link.status || "open",
    dueDate: link.dueDate || null,
    ownerId: link.ownerId || null,
    ownerName: link.ownerName || null,
    notes: link.notes || null,
    updatedAt: link.updatedAt || link.createdAt,
  };
}

export function entityRefDisplay(ref?: EntityReference) {
  if (!ref) return "Unknown item";
  return `${entityKindLabel(ref.kind)} · ${ref.label || ref.id || "Untitled"}`;
}

export function WorkLinkManager({ projects }: { projects: Project[] }) {
  const [rawLinks, setLinks] = useProjectWorkflowList<WorkLinkRecord>("dependency", projects.map((project) => project.id));
  const links = rawLinks.map(normalizeLinkRecord);
  const [form, setForm] = useState({
    projectId: projects[0]?.id || "",
    sourceProjectId: projects[0]?.id || "",
    targetProjectId: projects[1]?.id || projects[0]?.id || "",
    relationship: "depends_on",
  });
  const projectLinks = links.filter((link) => !form.projectId || link.projectId === form.projectId || link.source?.projectId === form.projectId || link.target?.projectId === form.projectId);
  function addLink() {
    const sourceProject = projects.find((project) => project.id === form.sourceProjectId);
    const targetProject = projects.find((project) => project.id === form.targetProjectId);
    const projectId = sourceProject?.id || "";
    if (!sourceProject || !targetProject || !projectId || sourceProject.id === targetProject.id) return;
    const now = new Date().toISOString();
    const link: WorkLinkRecord = {
      id: localId("link"),
      projectId,
      source: { kind: "project", id: sourceProject.id, label: sourceProject.name, projectId: sourceProject.id },
      target: { kind: "project", id: targetProject.id, label: targetProject.name, projectId: targetProject.id },
      relationship: form.relationship,
      createdAt: now,
      updatedAt: now,
    };
    setLinks([link, ...links].slice(0, 240));
  }
  const relationshipCounts = projectLinks.reduce<Record<string, number>>(
    (acc, link) => ({ ...acc, [link.relationship]: (acc[link.relationship] || 0) + 1 }),
    {},
  );
  const kindCounts = projectLinks.reduce<Record<string, number>>((acc, link) => {
    if (link.source?.kind) acc[link.source.kind] = (acc[link.source.kind] || 0) + 1;
    if (link.target?.kind) acc[link.target.kind] = (acc[link.target.kind] || 0) + 1;
    return acc;
  }, {});
  return (
    <section className="panel work-link-manager-v121 work-link-manager-v125">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Work links</p>
          <h2>Canonical relationship map</h2>
          <p className="muted tight">Project relationships now write to Cluster's shared Resource Graph. Loose text-only links are retired; every new edge points at a real resource ID.</p>
        </div>
        <span className="soft-pill">{projectLinks.length} linked</span>
      </div>
      <div className="work-link-form-v121 work-link-form-v125">
        <div className="field">
          <label>Project context</label>
          <ClusterNativeSelect value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Source project</label>
          <ClusterNativeSelect value={form.sourceProjectId} onChange={(event) => setForm((prev) => ({ ...prev, sourceProjectId: event.target.value, projectId: event.target.value }))}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Relationship</label>
          <ClusterNativeSelect value={form.relationship} onChange={(event) => setForm((prev) => ({ ...prev, relationship: event.target.value }))}>
            {DEPENDENCY_RELATIONSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Target project</label>
          <ClusterNativeSelect value={form.targetProjectId} onChange={(event) => setForm((prev) => ({ ...prev, targetProjectId: event.target.value }))}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </ClusterNativeSelect>
        </div>
        <ClusterButton type="button" className="" onClick={addLink} disabled={!form.sourceProjectId || !form.targetProjectId || form.sourceProjectId === form.targetProjectId} variant="primary">
          Add relationship
        </ClusterButton>
      </div>
      <div className="work-link-summary-v121 work-link-summary-v125">
        {Object.entries(relationshipCounts).length ? Object.entries(relationshipCounts).map(([key, value]) => <span key={key}>{levelLabel(key)} <strong>{value}</strong></span>) : <span>No relationship types yet.</span>}
        {Object.entries(kindCounts).slice(0, 5).map(([key, value]) => <span key={key}>{entityKindLabel(key)} <strong>{value}</strong></span>)}
      </div>
      <div className="work-link-list-v121 work-link-list-v125">
        {projectLinks.length ? projectLinks.slice(0, 14).map((link) => (
          <article key={link.id}>
            <span>{entityRefDisplay(link.source)}</span>
            <em>{levelLabel(link.relationship)}</em>
            <strong>{entityRefDisplay(link.target)}</strong>
            <small>{compactDateTime(link.updatedAt || link.createdAt)}</small>
            <ClusterButton type="button" className="" onClick={() => setLinks(links.filter((item) => item.id !== link.id))} variant="quiet" size="compact">Remove</ClusterButton>
          </article>
        )) : <div className="empty-state compact-empty">No canonical work links yet.</div>}
      </div>
    </section>
  );
}

export const DEPENDENCY_RELATIONSHIP_OPTIONS = [
  { value: "blocks", label: "Blocks" },
  { value: "blocked_by", label: "Blocked by" },
  { value: "depends_on", label: "Depends on" },
  { value: "validates", label: "Validates" },
  { value: "references", label: "References" },
  { value: "relates_to", label: "Relates to" },
  { value: "duplicates", label: "Duplicates" },
  { value: "supersedes", label: "Supersedes" },
];

export const RECURRING_CADENCE_OPTIONS: Array<{
  value: RecurringWorkCadence;
  label: string;
  days: number;
}> = [
  { value: "daily", label: "Daily", days: 1 },
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "biweekly", label: "Every 2 weeks", days: 14 },
  { value: "monthly", label: "Monthly", days: 30 },
];

export function isBlockingRelationship(relationship?: string | null) {
  return ["blocks", "blocked_by", "depends_on"].includes((relationship || "").toLowerCase());
}

export function dependencyStatusLabel(status?: DependencyStatus) {
  if (status === "blocked") return "Blocked";
  if (status === "resolved") return "Resolved";
  if (status === "watching") return "Watching";
  return "Open";
}

export function nextRecurringDate(value: string, cadence: RecurringWorkCadence) {
  const base = value ? new Date(`${value}T00:00:00`) : new Date();
  const option = RECURRING_CADENCE_OPTIONS.find((item) => item.value === cadence) || RECURRING_CADENCE_OPTIONS[1];
  return addDays(base, option.days).toISOString().slice(0, 10);
}

export function workflowEntityOptions(projects: Project[], timelineEntries: TimelineEntry[] = []) {
  const projectRefs = projects.map((project) => ({
    key: `project-${project.id}`,
    ref: {
      kind: "project" as EntityKind,
      id: project.id,
      label: project.name,
      projectId: project.id,
    },
  }));
  const boardRefs = projects.flatMap((project) =>
    (project.boards || []).map((board) => ({
      key: `board-${board.id}`,
      ref: {
        kind: "board" as EntityKind,
        id: board.id,
        label: `${project.name} · ${board.name}`,
        projectId: project.id,
      },
    })),
  );
  const timelineRefs = timelineEntries.map((entry) => ({
    key: `timeline-${entry.id}`,
    ref: {
      kind: "timeline" as EntityKind,
      id: entry.id,
      label: entry.title,
      projectId: entry.project?.id || null,
    },
  }));
  // Operations relationship pickers stay limited to project-scoped resources.
  // Rich Library/file relationships use the resource-specific workflow-link surface,
  // which performs authorization before creating graph edges.
  return dedupeBy([...projectRefs, ...boardRefs, ...timelineRefs], (item) => item.key).slice(0, 120);
}

export function parseEntityOption(value: string, options: Array<{ key: string; ref: EntityReference }>, fallbackKind: EntityKind, fallbackLabel: string, projectId?: string | null): EntityReference {
  const match = options.find((option) => option.key === value);
  return (
    match?.ref || {
      kind: fallbackKind,
      label: fallbackLabel,
      projectId: projectId || null,
    }
  );
}

export function useWorkflowOpsData(projects: Project[]) {
  const projectIds = projects.map((project) => project.id);
  const [links, setLinks] = useProjectWorkflowList<WorkLinkRecord>("dependency", projectIds);
  const [recurring, setRecurring] = useProjectWorkflowList<RecurringWorkRecord>("recurring", projectIds);
  const [watchers, setWatchers] = useProjectWorkflowList<WatcherRecord>("watcher", projectIds);
  return {
    links: links.map(normalizeLinkRecord),
    setLinks,
    recurring,
    setRecurring,
    watchers,
    setWatchers,
  };
}

export function WorkflowOpsPanel({ projects, timelineEntries = [], users = [], currentUser = null, compact = false, onOpenTimeline, onOpenProjects, onOpenBuilds, onOpenNotifications }: { projects: Project[]; timelineEntries?: TimelineEntry[]; users?: Array<User | UserActivitySummary>; currentUser?: User | UserActivitySummary | null; compact?: boolean; onOpenTimeline?: () => void; onOpenProjects?: () => void; onOpenBuilds?: () => void; onOpenNotifications?: () => void }) {
  const { links, setLinks, recurring, setRecurring, watchers, setWatchers } = useWorkflowOpsData(projects);
  const entityOptions = workflowEntityOptions(projects, timelineEntries);
  const defaultProjectId = projects[0]?.id || "";
  const defaultEntityKey = entityOptions[0]?.key || "";
  const [dependencyForm, setDependencyForm] = useState({
    projectId: defaultProjectId,
    sourceKey: defaultEntityKey,
    relationship: "blocks",
    targetKey: entityOptions[1]?.key || defaultEntityKey,
    notes: "",
  });
  const [recurringForm, setRecurringForm] = useState({
    projectId: defaultProjectId,
    title: "Weekly playtest",
    targetKind: "timeline" as EntityKind,
    cadence: "weekly" as RecurringWorkCadence,
    nextRun: addDays(new Date(), 7).toISOString().slice(0, 10),
    ownerId: currentUser?.id || "",
    checklist: "",
  });
  const [watcherForm, setWatcherForm] = useState({
    entityKey: defaultEntityKey,
    userId: currentUser?.id || "",
    eventScope: "all" as WatcherRecord["eventScope"],
  });
  const activeDependencies = links.filter((link) => link.status !== "resolved" && isBlockingRelationship(link.relationship));
  const blockedDependencies = activeDependencies.filter((link) => link.status === "blocked" || isPast(link.dueDate));
  const dueRecurring = recurring.filter((item) => item.status === "active" && (!item.nextRun || new Date(`${item.nextRun}T23:59:59`).getTime() <= Date.now()));
  const activeWatchers = watchers.filter((watcher) => !watcher.muted);
  const selectedRecurringUser = users.find((user) => user.id === recurringForm.ownerId) || currentUser || null;
  const selectedWatcherUser = users.find((user) => user.id === watcherForm.userId) || currentUser || null;
  function addDependency() {
    const sourceOption = entityOptions.find((option) => option.key === dependencyForm.sourceKey);
    const targetOption = entityOptions.find((option) => option.key === dependencyForm.targetKey);
    if (!sourceOption?.ref.id || !targetOption?.ref.id || (sourceOption.ref.kind === targetOption.ref.kind && sourceOption.ref.id === targetOption.ref.id)) return;
    if (!sourceOption.ref.projectId || sourceOption.ref.projectId !== targetOption.ref.projectId) return;
    const now = new Date().toISOString();
    setLinks(
      [
        {
          id: localId("dep"),
          projectId: sourceOption.ref.projectId,
          source: sourceOption.ref,
          target: targetOption.ref,
          relationship: dependencyForm.relationship,
          status: isBlockingRelationship(dependencyForm.relationship) ? "blocked" as DependencyStatus : "open" as DependencyStatus,
          critical: isBlockingRelationship(dependencyForm.relationship),
          notes: dependencyForm.notes.trim() || null,
          createdAt: now,
          updatedAt: now,
        },
        ...links,
      ].slice(0, 320),
    );
    setDependencyForm((prev) => ({ ...prev, notes: "" }));
  }
  function setDependencyCritical(id: string, critical: boolean) {
    setLinks(links.map((link) => (link.id === id ? { ...link, critical, status: critical ? "blocked" : "open", updatedAt: new Date().toISOString() } : link)));
  }
  function addRecurring() {
    if (!recurringForm.title.trim()) return;
    const owner = users.find((user) => user.id === recurringForm.ownerId) || currentUser || null;
    const now = new Date().toISOString();
    setRecurring(
      [
        {
          id: localId("repeat"),
          projectId: recurringForm.projectId || null,
          title: recurringForm.title.trim(),
          targetKind: recurringForm.targetKind,
          cadence: recurringForm.cadence,
          nextRun: recurringForm.nextRun,
          ownerId: owner?.id || null,
          ownerName: owner ? displayUserName(owner) : null,
          checklist: recurringForm.checklist.trim() || null,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        },
        ...recurring,
      ].slice(0, 240),
    );
    setRecurringForm((prev) => ({ ...prev, title: "", checklist: "" }));
  }
  function advanceRecurring(id: string, mode: "generated" | "skip") {
    setRecurring(
      recurring.map((item) =>
        item.id === id
          ? {
              ...item,
              nextRun: nextRecurringDate(item.nextRun, item.cadence),
              lastGeneratedAt: mode === "generated" ? new Date().toISOString() : item.lastGeneratedAt || null,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }
  function addWatcher() {
    const option = entityOptions.find((item) => item.key === watcherForm.entityKey);
    const watcherUser = users.find((user) => user.id === watcherForm.userId) || currentUser || null;
    if (!option?.ref.id || !watcherUser?.id) return;
    setWatchers(
      [
        {
          id: localId("watch"),
          entity: option.ref,
          userId: watcherUser.id,
          userName: displayUserName(watcherUser),
          eventScope: watcherForm.eventScope,
          createdAt: new Date().toISOString(),
        },
        ...watchers,
      ].slice(0, 300),
    );
  }
  function toggleWatcher(id: string) {
    setWatchers(
      watchers.map((watcher) =>
        watcher.id === id
          ? {
              ...watcher,
              muted: !watcher.muted,
              updatedAt: new Date().toISOString(),
            }
          : watcher,
      ),
    );
  }
  return (
    <section className={`panel workflow-ops-panel-v131 ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Workflow ops</p>
          <h2>Dependencies, recurring work, and watchers</h2>
          <p className="muted tight">Track dependencies, recurring work, and change followers so planning stays explicit and reviewable.</p>
        </div>
        <span className="soft-pill">
          v0.131 · {activeDependencies.length} blockers · {dueRecurring.length} due · {activeWatchers.length} watchers
        </span>
      </div>
      <div className="workflow-ops-metrics-v131">
        <ClusterButton unstyled type="button" onClick={onOpenTimeline}>
          <span>Dependency risk</span>
          <strong>{blockedDependencies.length}</strong>
          <em>{activeDependencies.length} active dependency links</em>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={onOpenProjects}>
          <span>Recurring due</span>
          <strong>{dueRecurring.length}</strong>
          <em>{recurring.filter((item) => item.status === "active").length} active plans</em>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={onOpenNotifications}>
          <span>Followers</span>
          <strong>{activeWatchers.length}</strong>
          <em>{watchers.filter((item) => item.muted).length} muted</em>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={onOpenBuilds}>
          <span>Build gates</span>
          <strong>{links.filter((link) => link.target?.kind === "build" && link.status !== "resolved").length}</strong>
          <em>open build dependencies</em>
        </ClusterButton>
      </div>
      <div className="workflow-ops-grid-v131">
        <section className="workflow-ops-card-v131 dependency-card-v131">
          <header>
            <div>
              <p className="eyebrow">Dependencies</p>
              <h3>Blocker map</h3>
            </div>
            <b>{blockedDependencies.length ? `${blockedDependencies.length} blocked` : "Clear"}</b>
          </header>
          <div className="workflow-form-grid-v131">
            <div className="field">
              <label>Project</label>
              <ClusterNativeSelect
                value={dependencyForm.projectId}
                onChange={(event) => {
                  const projectId = event.target.value;
                  const options = entityOptions.filter((option) => option.ref.projectId === projectId);
                  setDependencyForm((prev) => ({
                    ...prev,
                    projectId,
                    sourceKey: options[0]?.key || "",
                    targetKey: options[1]?.key || options[0]?.key || "",
                  }));
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Source</label>
              <ClusterNativeSelect
                value={dependencyForm.sourceKey}
                onChange={(event) =>
                  setDependencyForm((prev) => ({
                    ...prev,
                    sourceKey: event.target.value,
                  }))
                }
              >
                {entityOptions.filter((option) => option.ref.projectId === dependencyForm.projectId).map((option) => (
                  <option key={option.key} value={option.key}>
                    {entityRefDisplay(option.ref)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Relationship</label>
              <ClusterNativeSelect
                value={dependencyForm.relationship}
                onChange={(event) =>
                  setDependencyForm((prev) => ({
                    ...prev,
                    relationship: event.target.value,
                  }))
                }
              >
                {DEPENDENCY_RELATIONSHIP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Target</label>
              <ClusterNativeSelect
                value={dependencyForm.targetKey}
                onChange={(event) =>
                  setDependencyForm((prev) => ({
                    ...prev,
                    targetKey: event.target.value,
                  }))
                }
              >
                {entityOptions.filter((option) => option.ref.projectId === dependencyForm.projectId).map((option) => (
                  <option key={option.key} value={option.key}>
                    {entityRefDisplay(option.ref)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field full">
              <label>Notes</label>
              <ClusterTextInput
                value={dependencyForm.notes}
                onChange={(event) =>
                  setDependencyForm((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                placeholder="What needs to clear before the target can move?"
              />
            </div>
            <ClusterButton type="button" className="" onClick={addDependency} disabled={!entityOptions.length} variant="primary">
              Add dependency
            </ClusterButton>
          </div>
          <div className="workflow-list-v131">
            {links.length ? (
              links.slice(0, compact ? 5 : 9).map((link) => (
                <article key={link.id} className={`dependency-row-v131 ${link.status || "open"} ${isPast(link.dueDate) && link.status !== "resolved" ? "overdue" : ""}`}>
                  <div>
                    <strong>{entityRefDisplay(link.source)}</strong>
                    <span>
                      {levelLabel(link.relationship)} → {entityRefDisplay(link.target)}
                    </span>
                    <em>{link.notes || (link.critical ? "Critical dependency" : "Canonical relationship")}</em>
                  </div>
                  <b>{link.critical ? "Critical" : "Linked"}</b>
                  <div className="button-row compact">
                    <ClusterButton type="button" className="" onClick={() => setDependencyCritical(link.id, !link.critical)} variant="quiet" size="compact">
                      {link.critical ? "Clear critical" : "Mark critical"}
                    </ClusterButton>
                    <ClusterButton type="button" className="" onClick={() => setLinks(links.filter((row) => row.id !== link.id))} variant="quiet" size="compact">
                      Remove
                    </ClusterButton>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state compact-empty">No dependency links yet.</div>
            )}
          </div>
        </section>

        <section className="workflow-ops-card-v131 recurring-card-v131">
          <header>
            <div>
              <p className="eyebrow">Recurring</p>
              <h3>Repeat work</h3>
            </div>
            <b>{dueRecurring.length} due</b>
          </header>
          <div className="workflow-form-grid-v131">
            <div className="field full">
              <label>Title</label>
              <ClusterTextInput
                value={recurringForm.title}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
                placeholder="Friday build, QA regression, backup review..."
              />
            </div>
            <div className="field">
              <label>Project</label>
              <ClusterNativeSelect
                value={recurringForm.projectId}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    projectId: event.target.value,
                  }))
                }
              >
                <option value="">Studio-wide</option>
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
                value={recurringForm.targetKind}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    targetKind: event.target.value as EntityKind,
                  }))
                }
              >
                {ENTITY_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Cadence</label>
              <ClusterNativeSelect
                value={recurringForm.cadence}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    cadence: event.target.value as RecurringWorkCadence,
                  }))
                }
              >
                {RECURRING_CADENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Next run</label>
              <ClusterTextInput
                type="date"
                value={recurringForm.nextRun}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    nextRun: event.target.value,
                  }))
                }
              />
            </div>
            <div className="field">
              <label>Owner</label>
              <ClusterNativeSelect
                value={recurringForm.ownerId}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    ownerId: event.target.value,
                  }))
                }
              >
                <option value="">Studio</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {displayUserName(user)}
                  </option>
                ))}
                {!users.length && selectedRecurringUser && <option value={selectedRecurringUser.id}>{displayUserName(selectedRecurringUser)}</option>}
              </ClusterNativeSelect>
            </div>
            <div className="field full">
              <label>Checklist</label>
              <ClusterTextInput
                value={recurringForm.checklist}
                onChange={(event) =>
                  setRecurringForm((prev) => ({
                    ...prev,
                    checklist: event.target.value,
                  }))
                }
                placeholder="Smoke test, branch tag, notes, upload, notify watchers..."
              />
            </div>
            <ClusterButton type="button" className="" onClick={addRecurring} variant="primary">
              Add recurring plan
            </ClusterButton>
          </div>
          <div className="workflow-list-v131">
            {recurring.length ? (
              recurring.slice(0, compact ? 5 : 9).map((item) => (
                <article key={item.id} className={`recurring-row-v131 ${item.status} ${isPast(item.nextRun) || isToday(item.nextRun) ? "due" : ""}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {entityKindLabel(item.targetKind)} · {projects.find((project) => project.id === item.projectId)?.name || "Studio"}
                    </span>
                    <em>{item.checklist || item.ownerName || "No checklist"}</em>
                  </div>
                  <b>
                    {levelLabel(item.cadence)} · {formatDueDate(item.nextRun)}
                  </b>
                  <div className="button-row compact">
                    <ClusterButton type="button" className="" onClick={() => advanceRecurring(item.id, "generated")} variant="quiet" size="compact">
                      Advance
                    </ClusterButton>
                    <ClusterButton type="button" className="" onClick={() => advanceRecurring(item.id, "skip")} variant="quiet" size="compact">
                      Skip
                    </ClusterButton>
                    <ClusterButton type="button"
                      className=""
                      onClick={() =>
                        setRecurring(
                          recurring.map((row) =>
                            row.id === item.id
                              ? {
                                  ...row,
                                  status: row.status === "paused" ? "active" : "paused",
                                  updatedAt: new Date().toISOString(),
                                }
                              : row,
                          ),
                        )
                      }
                     variant="quiet" size="compact">
                      {item.status === "paused" ? "Resume" : "Pause"}
                    </ClusterButton>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state compact-empty">No recurring studio work yet.</div>
            )}
          </div>
        </section>

        <section className="workflow-ops-card-v131 watchers-card-v131">
          <header>
            <div>
              <p className="eyebrow">Watchers</p>
              <h3>Followers</h3>
            </div>
            <b>{activeWatchers.length} active</b>
          </header>
          <div className="workflow-form-grid-v131">
            <div className="field">
              <label>Entity</label>
              <ClusterNativeSelect
                value={watcherForm.entityKey}
                onChange={(event) =>
                  setWatcherForm((prev) => ({
                    ...prev,
                    entityKey: event.target.value,
                  }))
                }
              >
                {entityOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {entityRefDisplay(option.ref)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Follower</label>
              <ClusterNativeSelect
                value={watcherForm.userId}
                onChange={(event) =>
                  setWatcherForm((prev) => ({
                    ...prev,
                    userId: event.target.value,
                  }))
                }
              >
                <option value="">Select follower</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {displayUserName(user)}
                  </option>
                ))}
                {!users.length && selectedWatcherUser && <option value={selectedWatcherUser.id}>{displayUserName(selectedWatcherUser)}</option>}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Notify on</label>
              <ClusterNativeSelect
                value={watcherForm.eventScope}
                onChange={(event) =>
                  setWatcherForm((prev) => ({
                    ...prev,
                    eventScope: event.target.value as WatcherRecord["eventScope"],
                  }))
                }
              >
                <option value="all">All changes</option>
                <option value="status">Status changes</option>
                <option value="comments">Comments</option>
                <option value="files">Files</option>
                <option value="approvals">Approvals</option>
              </ClusterNativeSelect>
            </div>
            <ClusterButton type="button" className="" onClick={addWatcher} disabled={!entityOptions.length || !watcherForm.userId} variant="primary">
              Follow item
            </ClusterButton>
          </div>
          <div className="workflow-list-v131">
            {watchers.length ? (
              watchers.slice(0, compact ? 5 : 9).map((watcher) => (
                <article key={watcher.id} className={`watcher-row-v131 ${watcher.muted ? "muted" : "active"}`}>
                  <div>
                    <strong>{watcher.userName}</strong>
                    <span>
                      {watcher.muted ? "Muted" : "Watching"} · {levelLabel(watcher.eventScope)}
                    </span>
                    <em>{entityRefDisplay(watcher.entity)}</em>
                  </div>
                  <b>{formatRelativeTime(watcher.updatedAt || watcher.createdAt)}</b>
                  <div className="button-row compact">
                    <ClusterButton type="button" className="" onClick={() => toggleWatcher(watcher.id)} variant="quiet" size="compact">
                      {watcher.muted ? "Unmute" : "Mute"}
                    </ClusterButton>
                    <ClusterButton type="button" className="" onClick={() => setWatchers(watchers.filter((item) => item.id !== watcher.id))} variant="quiet" size="compact">
                      Remove
                    </ClusterButton>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state compact-empty">No watchers yet.</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export function workflowAttentionItems(
  projects: Project[] = [],
  workflows: { links?: WorkLinkRecord[]; recurring?: RecurringWorkRecord[]; watchers?: WatcherRecord[] } = {},
) {
  const projectIds = new Set(projects.map((project) => project.id));
  const links = (workflows.links || [])
    .map(normalizeLinkRecord)
    .filter((link) => !link.projectId || projectIds.size === 0 || projectIds.has(link.projectId));
  const recurring = (workflows.recurring || []).filter((item) => !item.projectId || projectIds.size === 0 || projectIds.has(item.projectId));
  const watchers = workflows.watchers || [];
  const items: AttentionItem[] = [];
  links
    .filter((link) => link.status !== "resolved" && isBlockingRelationship(link.relationship) && (link.status === "blocked" || isPast(link.dueDate)))
    .slice(0, 8)
    .forEach((link) => {
      items.push(
        makeAttentionItem({
          id: `dependency-${link.id}`,
          source: "dependency",
          severity: link.status === "blocked" || isPast(link.dueDate) ? "high" : "medium",
          title: `${entityRefDisplay(link.target)} is blocked`,
          detail: `${entityRefDisplay(link.source)} ${levelLabel(link.relationship)} it${link.dueDate ? ` · review ${formatDueDate(link.dueDate)}` : ""}`,
          projectId: link.projectId || link.target?.projectId || link.source?.projectId || null,
          projectName: projects.find((project) => project.id === (link.projectId || link.target?.projectId || link.source?.projectId))?.name || null,
          createdAt: link.updatedAt || link.createdAt,
          actionLabel: "Open workflow ops",
          target: "timeline",
        }),
      );
    });
  recurring
    .filter((item) => item.status === "active" && (!item.nextRun || isPast(item.nextRun) || isToday(item.nextRun)))
    .slice(0, 8)
    .forEach((item) => {
      items.push(
        makeAttentionItem({
          id: `recurring-${item.id}`,
          source: "recurring",
          severity: isPast(item.nextRun) && !isToday(item.nextRun) ? "medium" : "low",
          title: item.title,
          detail: `${entityKindLabel(item.targetKind)} recurrence is due ${item.nextRun ? formatDueDate(item.nextRun) : "now"}${item.ownerName ? ` · ${item.ownerName}` : ""}`,
          projectId: item.projectId || null,
          projectName: projects.find((project) => project.id === item.projectId)?.name || null,
          createdAt: item.updatedAt || item.createdAt,
          actionLabel: "Open workflow ops",
          target: "timeline",
        }),
      );
    });
  if (watchers.length && !links.length) {
    items.push(
      makeAttentionItem({
        id: "watchers-without-dependencies",
        source: "watcher",
        severity: "low",
        title: "Watchers are active without dependency coverage",
        detail: `${watchers.filter((watcher) => !watcher.muted).length} active watchers, but no dependency map yet. Add dependency coverage so watcher notifications include useful context.`,
        actionLabel: "Open workflow ops",
        target: "timeline",
      }),
    );
  }
  return items;
}

export function closeoutAttentionItems(
  projects: Project[] = [],
  records: ProjectCloseoutRecord[] = [],
  portalRules: ExternalPortalRule[] = [],
) {
  const items: AttentionItem[] = [];
  projects
    .filter((project) => !project.archived && normalizeProjectStatus(project.status) === "completed")
    .forEach((project) => {
      const record = normalizeCloseout(
        project,
        records.find((item) => item.projectId === project.id),
      );
      const blockers = closeoutBlockingItems(record);
      if (blockers.length) {
        items.push(
          makeAttentionItem({
            id: `closeout-${project.id}`,
            source: "closeout",
            severity: blockers.length > 3 ? "high" : "medium",
            title: `${project.name} needs closeout`,
            detail: `${closeoutScore(record)}% ready · ${blockers
              .slice(0, 3)
              .map((item) => item.label)
              .join(" · ")}`,
            projectId: project.id,
            projectName: project.name,
            createdAt: record.updatedAt || record.createdAt,
            actionLabel: "Open closeout",
            target: "projects",
          }),
        );
      }
    });
  projects.filter(isExternalProject).forEach((project) => {
    const summary = projectExternalPortalSummary(project, portalRules);
    if (!summary.total)
      items.push(
        makeAttentionItem({
          id: `external-portal-missing-${project.id}`,
          source: "portal",
          severity: "medium",
          title: `${project.name} has no portal rules`,
          detail: "External project needs a restricted collaborator view before client/partner access.",
          projectId: project.id,
          projectName: project.name,
          createdAt: project.updatedAt,
          actionLabel: "Review portal",
          target: "projects",
        }),
      );
    if (summary.unsafe)
      items.push(
        makeAttentionItem({
          id: `external-portal-unsafe-${project.id}`,
          source: "portal",
          severity: "high",
          title: `${project.name} portal exposes restricted fields`,
          detail: `${summary.unsafe} rule${summary.unsafe === 1 ? "" : "s"} allow time, budget, or internal access. Review the affected rules before sharing access.`,
          projectId: project.id,
          projectName: project.name,
          createdAt: project.updatedAt,
          actionLabel: "Review portal",
          target: "projects",
        }),
      );
  });
  return items;
}
