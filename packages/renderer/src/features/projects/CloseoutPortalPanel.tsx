import { CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS, CLUSTER_EXTERNAL_PORTAL_SECTIONS, CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS } from "@cluster/shared";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { copyClusterText } from "../../core/clipboard";
import { api, formatApiError } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { formatRelativeTime } from "../../core/format";
import type {
  CloseoutCheckEvaluation, ExternalPortalAccessLevel, ExternalPortalRule, Project, ProjectCloseoutChecklistKey,
  ProjectCloseoutRecord, ProjectMediaPayload, ProjectShareLink, User, UserActivitySummary,
} from "../application/application-models";
import { isExternalProject } from "./projects-utils";
import { canUseProject, projectPermissionReason } from "./project-access-policy";
import "./project-operations.css";
import { runtimeStyle } from "../../core/runtime-style";

export interface CloseoutPortalPanelHelpers {
  CLOSEOUT_CHECKLIST: Array<{ key: ProjectCloseoutChecklistKey; label: string; detail: string }>;
  EXTERNAL_PORTAL_SECTIONS: string[];
  closeoutCheckEvaluations: (project: Project, record: ProjectCloseoutRecord, rules: ExternalPortalRule[], media?: ProjectMediaPayload | null) => CloseoutCheckEvaluation[];
  closeoutReadinessScore: (evaluations: CloseoutCheckEvaluation[]) => number;
  closeoutStatusLabel: (status: ProjectCloseoutRecord["status"]) => string;
  closeoutSubmissionReady: (evaluations: CloseoutCheckEvaluation[]) => boolean;
  normalizeCloseout: (project: Project, input?: Partial<ProjectCloseoutRecord> | null, media?: ProjectMediaPayload | null) => ProjectCloseoutRecord;
  portalAccessLabel: (level: ExternalPortalAccessLevel) => string;
  projectExternalPortalSummary: (project: Project, rules: ExternalPortalRule[]) => { total: number; approved: number; unsafe: number };
}

type ServerCloseoutRecord = ProjectCloseoutRecord & { revision: number };
type ServerEvaluation = { key: ProjectCloseoutChecklistKey; label: string; detail: string; done: boolean; source: "auto" | "manual" | "mixed" | "lead"; evidence: string };
type CloseoutState = { record: ServerCloseoutRecord; evaluations: ServerEvaluation[]; readiness: number; submissionReady: boolean; shareLinks: ProjectShareLink[] };

export function CloseoutPortalPanelFeature({ project, projects, currentUser, compact = false, onArchiveProject, helpers }: { project?: Project | null; projects: Project[]; media?: ProjectMediaPayload | null; currentUser?: User | UserActivitySummary | null; compact?: boolean; onArchiveProject?: () => void; helpers: CloseoutPortalPanelHelpers }) {
  const selectedProject = project || projects.find(isExternalProject) || projects[0] || null;
  const [selectedProjectId, setSelectedProjectId] = useState(selectedProject?.id || "");
  const actualProject = project || projects.find((item) => item.id === selectedProjectId) || selectedProject;
  const [state, setState] = useState<CloseoutState | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [newShareUrl, setNewShareUrl] = useState("");
  const safeSections = CLUSTER_EXTERNAL_PORTAL_SECTIONS;
  const canContribute = Boolean(actualProject && canUseProject(currentUser, actualProject, "contribute"));
  const canManage = Boolean(actualProject && canUseProject(currentUser, actualProject, "manage"));
  const permissionReason = actualProject ? projectPermissionReason(currentUser, actualProject) : "No project selected.";
  const [shareForm, setShareForm] = useState({ accessLevel: "viewer" as ExternalPortalAccessLevel, allowedSections: [...CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), maxUses: "" });

  const load = useCallback(async () => {
    if (!actualProject) return;
    try { setState(await api<CloseoutState>(`/api/projects/${encodeURIComponent(actualProject.id)}/closeout`)); setStatus(""); }
    catch (error) { setStatus(formatApiError(error)); }
  }, [actualProject?.id]);
  useEffect(() => { if (!project && selectedProject?.id) setSelectedProjectId((value) => value || selectedProject.id); }, [project?.id, selectedProject?.id]);
  useEffect(() => { setState(null); void load(); }, [load]);

  async function securityPin(purpose: "submit_project_completion" | "archive_project") {
    return currentUser?.pinConfigured ? requestSecurityPin({ title: purpose === "archive_project" ? "Archive project" : "Submit project completion", description: "Enter your security PIN.", purpose, confirmLabel: purpose === "archive_project" ? "Archive" : "Submit" }) : requestSecurityPinSetup({ title: "Create security PIN", description: "Create a PIN before changing project completion state.", purpose: `setup_for_${purpose}` });
  }
  async function runAction(action: "submit" | "verify" | "reject" | "archive" | "reopen") {
    if (!actualProject || !state) return;
    if ((action === "submit" && !canContribute) || (action !== "submit" && !canManage)) { setStatus(permissionReason); return; }
    let pin = "";
    if (action === "submit" || action === "archive") { const value = await securityPin(action === "archive" ? "archive_project" : "submit_project_completion"); if (!value) return; pin = value; }
    setBusy(true); setStatus("");
    try {
      const next = await api<CloseoutState>(`/api/projects/${actualProject.id}/closeout/actions`, { method: "POST", body: JSON.stringify({ action, expectedRevision: state.record.revision, note: completionNote.trim() || null, pin }) });
      setState(next); setCompletionNote(""); setStatus(`Project closeout ${action} completed.`); if (action === "archive") onArchiveProject?.();
    } catch (error) { setStatus(formatApiError(error)); await load(); } finally { setBusy(false); }
  }
  async function toggleManualCheck(item: ServerEvaluation) {
    if (!actualProject || !state || !canContribute || !["manual", "mixed"].includes(item.source)) return;
    setBusy(true); setStatus("");
    try { setState(await api<CloseoutState>(`/api/projects/${actualProject.id}/closeout`, { method: "PUT", body: JSON.stringify({ checklist: { [item.key]: !item.done }, expectedRevision: state.record.revision }) })); }
    catch (error) { setStatus(formatApiError(error)); await load(); } finally { setBusy(false); }
  }
  async function createShareLink() {
    if (!actualProject || !canManage) { setStatus(permissionReason); return; }
    setBusy(true); setStatus("");
    try {
      const created = await api<ProjectShareLink>(`/api/projects/${actualProject.id}/share-links`, { method: "POST", body: JSON.stringify({ accessLevel: shareForm.accessLevel, allowedSections: shareForm.allowedSections, expiresAt: shareForm.expiresAt || null, maxUses: shareForm.maxUses ? Number(shareForm.maxUses) : null }) });
      setNewShareUrl(created.shareUrl || ""); setStatus("Restricted partner link created. Copy it now; the full token is shown once."); await load();
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }
  async function revokeShareLink(link: ProjectShareLink) {
    if (!actualProject || !canManage) { setStatus(permissionReason); return; }
    setBusy(true); setStatus("");
    try { await api(`/api/projects/${actualProject.id}/share-links/${link.id}`, { method: "DELETE" }); setStatus("Partner link revoked."); await load(); }
    catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  if (!actualProject) return <section className="project-subpage-v312"><ClusterEmptyState kind="first-use" title="No project available" description="Choose or create a project before opening the closeout workspace." /></section>;
  const evaluations = state?.evaluations || [];
  const blockers = evaluations.filter((item) => item.key !== "archiveApproved" && !item.done);
  const stageIndex = state?.record.status === "archived" ? 3 : state?.record.status === "verified" ? 2 : state?.record.status === "submitted" ? 1 : 0;
  const activeLinks = (state?.shareLinks || []).filter((link) => link.status === "active");
  const nextBlockers = blockers.slice(0, 4);
  const closeoutNextLabel = !state ? "Loading readiness" : blockers.length ? `${blockers.length} required action${blockers.length === 1 ? "" : "s"} remain` : state.record.status === "submitted" ? "Awaiting manager verification" : state.record.status === "verified" ? "Ready to archive" : state.record.status === "archived" ? "Closeout complete" : "Ready to submit completion";
  return <section className={`project-subpage-v312 closeout-portal-v134 closeout-page-v149 closeout-page-v150 project-closeout-v312 ${compact ? "compact" : ""}`}>
    {!project ? <div className="panel closeout-selector-v134"><div className="field"><label>Project</label><ClusterNativeSelect value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</ClusterNativeSelect></div></div> : null}
    {status ? <div className={`inline-status ${status.toLowerCase().includes("failed") ? "danger" : ""}`}>{status}</div> : null}
    <section className="closeout-shell-v149 closeout-shell-v150">
      <header className="closeout-header-v149 closeout-header-v150"><div className="closeout-title-v149"><p className="eyebrow">Completion gate</p><h2>{actualProject.name}</h2><span>{state ? helpers.closeoutStatusLabel(state.record.status) : "Loading closeout"} · server authoritative</span></div><div className="closeout-progress-v149 closeout-progress-v150"><div><span style={runtimeStyle({ width: `${state?.readiness || 0}%` })} /></div><strong>{state?.readiness || 0}%</strong><em>{blockers.length ? `${blockers.length} blockers` : "Ready"}</em></div><div className="closeout-header-actions-v149 closeout-header-actions-v150">{state?.record.status === "submitted" ? canManage ? <><ClusterButton type="button" className="" disabled={busy || !state.submissionReady} onClick={() => void runAction("verify")} variant="primary">Verify completion</ClusterButton><ClusterButton type="button" className="" disabled={busy} onClick={() => void runAction("reject")} variant="secondary">Request changes</ClusterButton></> : <span className="project-permission-badge-v316">Manager verification required</span> : state?.record.status === "verified" ? canManage ? <ClusterButton type="button" className="" disabled={busy || !state.submissionReady} onClick={() => void runAction("archive")} variant="danger">Archive and revoke access</ClusterButton> : <span className="project-permission-badge-v316">Manager archive required</span> : state?.record.status === "archived" ? canManage ? <ClusterButton type="button" className="" disabled={busy} onClick={() => void runAction("reopen")} variant="secondary">Reopen closeout</ClusterButton> : null : canContribute ? <ClusterButton type="button" className="" disabled={busy || !state?.submissionReady} onClick={() => void runAction("submit")} variant="primary">Submit completion</ClusterButton> : <span className="project-permission-badge-v316">Read only</span>}</div></header>
      <div className="closeout-steps-v149 closeout-steps-v150">{["Readiness", "Submitted", "Verified", "Archived"].map((step, index) => <span key={step} className={index <= stageIndex ? "active" : ""}>{step}</span>)}</div>
      <div className="closeout-submit-note-v150"><ClusterTextInput disabled={!canContribute} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Completion, verification, or requested-change note…" /><span>Archiving revokes active partner links and external access rules.</span></div>
      <section className={`closeout-next-actions-v14${blockers.length ? " has-blockers" : " ready"}`} aria-label="Next required closeout actions">
        <header><div><span>Next required actions</span><strong>{closeoutNextLabel}</strong></div><em>{state ? `${state.readiness}% ready` : "Loading"}</em></header>
        {nextBlockers.length ? <div className="closeout-next-actions-list-v14">{nextBlockers.map((item) => <article key={item.key}><span className="status-dot-v151"><ClusterIcon name="close" /></span><div><strong>{item.label}</strong><small>{item.evidence || item.detail}</small></div>{["manual", "mixed"].includes(item.source) && canContribute ? <ClusterButton type="button" disabled={busy} onClick={() => void toggleManualCheck(item)} variant="quiet" size="compact">Mark ready</ClusterButton> : <em>{item.source === "auto" ? "Server check" : item.source === "lead" ? "Manager" : item.source}</em>}</article>)}</div> : <div className="closeout-next-ready-v14"><ClusterIcon name="check" /><span>{state?.record.status === "submitted" ? "All readiness gates pass. A manager can verify completion." : state?.record.status === "verified" ? "Completion is verified. Archive when partner access and final delivery are ready to close." : state?.record.status === "archived" ? "The project is archived and closeout is complete." : "All readiness gates pass. The project can be submitted for completion."}</span></div>}
      </section>
      <div className="closeout-layout-v149 closeout-layout-v150"><article className="closeout-main-v149 closeout-main-v150 closeout-main-v151"><div className="closeout-panel-head-v149 closeout-panel-head-v151"><div><h3>Completion checklist</h3><span>Board, QA, Builds, Library, Roadmap, time, delivery, backup, and lead verification are evaluated from server data.</span></div><strong>{state?.submissionReady ? "Ready to submit" : `${blockers.length} blockers`}</strong></div><div className="closeout-check-groups-v151">{(["auto", "mixed", "manual", "lead"] as const).map((source) => { const items = evaluations.filter((item) => item.source === source); if (!items.length) return null; return <section key={source} className={`closeout-check-group-v151 ${source}`}><header><div><strong>{source === "auto" ? "Auto-verified" : source === "lead" ? "Lead verification" : "Manual confirmation"}</strong><span>{items.filter((item) => item.done).length}/{items.length} ready</span></div></header><div className="closeout-check-list-v151">{items.map((item) => <div key={item.key} className={`${item.done ? "done" : "open"} ${item.source}`}><span className="status-dot-v151">{item.done ? <ClusterIcon name="check" /> : <ClusterIcon name="close" />}</span><div className="check-copy-v151"><strong>{item.label}</strong><em>{item.evidence}</em></div><span className={`source-pill-v150 ${item.source}`}>{item.done ? "Ready" : source}</span>{["manual", "mixed"].includes(item.source) && canContribute ? <ClusterButton type="button" className="" disabled={busy} onClick={() => void toggleManualCheck(item)} variant="quiet" size="compact">{item.done ? "Clear" : "Mark ready"}</ClusterButton> : null}</div>)}</div></section>; })}</div></article>
        <aside className="closeout-side-v149 closeout-side-v150"><article className="closeout-gates-v149 closeout-gates-v150"><div><span>Submission</span><strong>{state?.submissionReady ? "Ready" : "Blocked"}</strong><em>{blockers.slice(0, 2).map((item) => item.label).join(" · ") || "All required gates pass"}</em></div><div className={state?.record.status === "verified" ? "good" : "warning"}><span>Lead verification</span><strong>{state?.record.status === "verified" || state?.record.status === "archived" ? "Verified" : state?.record.status === "submitted" ? "Pending" : "Waiting"}</strong><em>{state?.record.verifierName || "Project manager required"}</em></div><div className={activeLinks.length ? "warning" : "good"}><span>Partner access</span><strong>{activeLinks.length}</strong><em>{activeLinks.length ? "Will be revoked on archive" : "No active links"}</em></div></article>
          <article className="external-portal-v149 external-portal-v150"><div className="closeout-panel-head-v149"><div><h3>Restricted partner links</h3><span>Same server-enforced links used by Project Access.</span></div><strong>{activeLinks.length} active</strong></div>{canManage ? <div className="portal-form-v149"><ClusterNativeSelect value={shareForm.accessLevel} onChange={(event) => setShareForm((value) => ({ ...value, accessLevel: event.target.value as ExternalPortalAccessLevel }))}><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="reviewer">Reviewer</option></ClusterNativeSelect><ClusterTextInput type="date" value={shareForm.expiresAt} onChange={(event) => setShareForm((value) => ({ ...value, expiresAt: event.target.value }))} /><ClusterTextInput type="number" min="1" value={shareForm.maxUses} onChange={(event) => setShareForm((value) => ({ ...value, maxUses: event.target.value }))} placeholder="Use limit" /><div className="portal-section-grid-v149">{safeSections.map((section) => <label key={section}><ClusterInput type="checkbox" checked={shareForm.allowedSections.includes(section)} onChange={(event) => setShareForm((value) => ({ ...value, allowedSections: event.target.checked ? [...new Set([...value.allowedSections, section])] : value.allowedSections.filter((item) => item !== section) }))} /> {CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS[section]}</label>)}</div><ClusterButton type="button" className="" disabled={busy || !shareForm.allowedSections.length} onClick={() => void createShareLink()} variant="primary">Create restricted link</ClusterButton></div> : <div className="project-section-status-v312 neutral">{permissionReason}</div>}{newShareUrl ? <div className="share-link-once-v315"><ClusterTextInput readOnly value={newShareUrl} /><ClusterCopyButton text={newShareUrl} variant="quiet" size="compact" copiedLabel="Link copied">Copy</ClusterCopyButton></div> : null}<div className="portal-rule-list-v149 portal-rule-list-v151">{state?.shareLinks?.length ? state.shareLinks.map((link) => <article key={link.id} className={link.status}><div className="rule-main-v151"><strong>{link.tokenPreview}</strong><span>{helpers.portalAccessLabel(link.accessLevel)} · {link.status}</span><em>{link.allowedSections.join(" · ")} · {link.useCount}{link.maxUses ? `/${link.maxUses}` : ""} uses · {link.expiresAt ? `expires ${formatRelativeTime(link.expiresAt)}` : "no expiry"}</em></div>{link.status === "active" && canManage ? <ClusterButton type="button" className="" disabled={busy} onClick={() => void revokeShareLink(link)} variant="danger" size="compact">Revoke</ClusterButton> : null}</article>) : <ClusterEmptyState compact kind="empty" title="No partner links" description="Create a restricted link when an external reviewer needs temporary project access." />}</div></article>
        </aside></div>
    </section>
  </section>;
}
