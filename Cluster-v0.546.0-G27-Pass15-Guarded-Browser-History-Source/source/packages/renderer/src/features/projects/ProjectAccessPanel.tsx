import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterResourcePicker } from "../../components/ClusterResourcePicker";
import { useAuthorizedProjectResources } from "../../components/useAuthorizedProjectResources";
import { useClusterMutationGate } from "../../components/useClusterMutationGate";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyClusterText } from "../../core/clipboard";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, queryApi, setApiQueryData } from "../../core/api";
import { levelLabel } from "../../core/format";
import { ProjectShareLinksSection } from "./ProjectShareLinksSection";
import { ProjectSectionHeader } from "./ProjectWorkspacePrimitives";
import { PROJECT_LEVEL_OPTIONS, type ProjectPermissionLevel } from "../../core/permissions";
import { displayUserName } from "../people/people-utils";
import type {
  AccessEffect, AccessRule, AccessSubjectKind, AccessTargetKind, ExternalPortalAccessLevel,
  Project, ProjectMediaPayload, ProjectShareLink, User,
} from "../application/application-models";
import "./project-operations.css";

type AccessExplainAction = "view" | "contribute" | "manage";
type AccessExplainDecision = {
  allowed: boolean;
  code: string;
  reason: string;
  action: string;
  resource: { kind: string; id: string | null; projectId: string | null; tool: string | null };
  contributors: Array<{ source: string; id?: string | null; effect: "allow" | "deny" | "limit"; detail: string }>;
  requiredElevationScope?: string | null;
  evaluatedAt: string;
};
type AccessRuleImpactPayload = {
  ok: true;
  sampled: boolean;
  evaluatedCount: number;
  elevated: number;
  reduced: number;
  unchanged: number;
  scope: string;
  limitations: string;
  before: Record<string, number>;
  after: Record<string, number>;
};
type AccessExplainPayload = {
  ok: true;
  actorUserId: string;
  subjectUserId: string;
  action: AccessExplainAction;
  project?: AccessExplainDecision;
  toolKey?: string;
  tool?: AccessExplainDecision;
  target?: AccessExplainDecision;
};

export interface ProjectAccessPanelHelpers {
  canUseProject: (user: User | null | undefined, project: Project, min?: ProjectPermissionLevel) => boolean;
  getProjectPermission: (user: User | null | undefined, project: Project) => ProjectPermissionLevel;
  projectPermissionReason: (user: User | null | undefined, project: Project) => string;
  libraryTypeLabel: (type?: string | null) => string;
  accessTargetLabel: (kind: AccessTargetKind) => string;
  portalAccessLabel: (level: ExternalPortalAccessLevel) => string;
}

export function ProjectAccessPanelFeature({ project, media, currentUser, helpers }: { project: Project; media: ProjectMediaPayload; currentUser: User; helpers: ProjectAccessPanelHelpers }) {
  const { canUseProject, accessTargetLabel, portalAccessLabel } = helpers;
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [shareLinks, setShareLinks] = useState<ProjectShareLink[]>([]);
  const [newShareUrl, setNewShareUrl] = useState("");
  const [explainUserId, setExplainUserId] = useState(currentUser.id);
  const [explainAction, setExplainAction] = useState<AccessExplainAction>("view");
  const [explanation, setExplanation] = useState<AccessExplainPayload | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState("");
  const [impactPreview, setImpactPreview] = useState<AccessRuleImpactPayload | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactError, setImpactError] = useState("");
  const defaultTeamId = currentUser.studioTeams?.find((team) => team.primaryMembership)?.id || currentUser.studioTeams?.[0]?.id || "";
  const [shareForm, setShareForm] = useState({
    accessLevel: "viewer" as ExternalPortalAccessLevel,
    allowedSections: [...CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS] as string[],
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    maxUses: "",
  });
  const ruleRequestSequence = useRef(0);
  const userRequestSequence = useRef(0);
  const shareRequestSequence = useRef(0);
  const explainRequestSequence = useRef(0);
  const impactRequestSequence = useRef(0);
  const {
    resources: pickerTargets, setQuery: setPickerQuery, loading: pickerLoading,
    error: pickerError, nextCursor: pickerNextCursor, loadingMore: pickerPaging,
    loadMore: loadMorePickerTargets,
  } = useAuthorizedProjectResources({ projectId: project.id, minimum: currentUser.isAdmin || canUseProject(currentUser, project, "manage") ? "manage" : "view" });
  const mutationGate = useClusterMutationGate();
  const [form, setForm] = useState({
    targetKey: `project:${project.id}`,
    subjectKind: "team" as AccessSubjectKind,
    subjectId: defaultTeamId,
    effect: "allow" as AccessEffect,
    level: "view" as ProjectPermissionLevel,
    expiresAt: "",
    notes: "",
  });
  const isManager = currentUser.isAdmin || canUseProject(currentUser, project, "manage");
  // Project data is NOT a permission boundary. Only server-authorized
  // candidates may be used for both the rule builder and Access Explorer.
  const resourceCandidates = useMemo(() => pickerTargets.filter((target) => target.projectId === project.id), [pickerTargets, project.id]);
  const authorizedTarget = (key: string) => resourceCandidates.find((target) => `${target.kind}:${target.id}` === key) || null;
  const teams = useMemo(() => {
    const byId = new Map<string, string>();
    for (const member of [currentUser, ...users]) {
      for (const team of member.studioTeams || []) {
        if (team.id) byId.set(team.id, team.name || team.id);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUser, users]);
  const explainUsers = useMemo(() => {
    const byId = new Map<string, User>();
    byId.set(currentUser.id, currentUser);
    for (const user of users) byId.set(user.id, user);
    return [...byId.values()].sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)));
  }, [currentUser, users]);
  const activeRules = rules.filter((rule) => rule.status !== "archived");
  const liveRules = activeRules.filter((rule) => rule.status === "active" && (!rule.expiresAt || new Date(rule.expiresAt).getTime() > Date.now()));
  const expiredRules = activeRules.filter((rule) => rule.status === "expired" || Boolean(rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now()));
  const projectRules = liveRules.filter((rule) => rule.targetKind === "project");
  const restrictedTargets = new Set(liveRules.filter((rule) => rule.effect === "allow").map((rule) => `${rule.targetKind}:${rule.targetId}`));
  const accessRulePath = `/api/access-rules?projectId=${encodeURIComponent(project.id)}`;
  const shareLinksPath = `/api/projects/${encodeURIComponent(project.id)}/share-links`;
  async function loadRules(force = false) {
    const sequence = ++ruleRequestSequence.current;
    try {
      const result = await queryApi<AccessRule[]>(accessRulePath, { force, staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["access-rules", `project:${project.id}`] });
      if (sequence !== ruleRequestSequence.current) return;
      setRules(result);
      setError("");
    } catch (err) {
      if (sequence !== ruleRequestSequence.current) return;
      setRules([]);
      setError(err instanceof Error ? err.message : "Access rules could not be loaded from the server.");
    }
  }
  async function loadUsers(force = false) {
    const sequence = ++userRequestSequence.current;
    try {
      const result = await queryApi<User[]>("/api/users", { force, staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "people"] });
      if (sequence === userRequestSequence.current) setUsers(result);
    } catch {
      if (sequence === userRequestSequence.current) setUsers([]);
    }
  }
  async function loadShareLinks(force = false) {
    const sequence = ++shareRequestSequence.current;
    if (!isManager) { setShareLinks([]); return; }
    try {
      const result = await queryApi<ProjectShareLink[]>(shareLinksPath, { force, staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-share-links", `project:${project.id}`] });
      if (sequence === shareRequestSequence.current) setShareLinks(result);
    } catch (err) {
      if (sequence === shareRequestSequence.current) setError(err instanceof Error ? err.message : "Could not load share links.");
    }
  }
  useEffect(() => {
    void loadUsers();
    return () => { userRequestSequence.current += 1; };
  }, []);
  useEffect(() => {
    ruleRequestSequence.current += 1;
    shareRequestSequence.current += 1;
    void loadRules();
    void loadShareLinks();
    return () => { ruleRequestSequence.current += 1; shareRequestSequence.current += 1; };
  }, [project.id, isManager]);
  useEffect(() => {
    setForm((current) => ({ ...current, targetKey: `project:${project.id}` }));
    setExplanation(null);
  }, [project.id]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAccessExplanation(), 120);
    return () => { window.clearTimeout(timeout); explainRequestSequence.current += 1; };
  }, [project.id, form.targetKey, explainUserId, explainAction, resourceCandidates]);
  useEffect(() => {
    impactRequestSequence.current += 1;
    setImpactPreview(null);
    setImpactError("");
    setImpactBusy(false);
  }, [project.id, form.targetKey, form.subjectKind, form.subjectId, form.effect, form.level, form.expiresAt]);
  async function previewImpact() {
    const target = currentTarget();
    if (!isManager || !target) return;
    const sequence = ++impactRequestSequence.current;
    setImpactBusy(true);
    setImpactError("");
    setImpactPreview(null);
    try {
      const result = await api<AccessRuleImpactPayload>("/api/access/rule-impact-preview", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id, targetKind: target.kind, targetId: target.id,
          subjectKind: form.subjectKind, subjectId: form.subjectId || null,
          effect: form.effect, level: form.effect === "deny" ? "none" : form.level,
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
        }),
      });
      if (sequence === impactRequestSequence.current) setImpactPreview(result);
    } catch (err) {
      if (sequence === impactRequestSequence.current) setImpactError(err instanceof Error ? err.message : "Cannot preview this access change.");
    } finally {
      if (sequence === impactRequestSequence.current) setImpactBusy(false);
    }
  }
  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function currentTarget() {
    const target = authorizedTarget(form.targetKey);
    return target ? { key: `${target.kind}:${target.id}`, kind: target.kind as AccessTargetKind, id: target.id, label: target.label } : null;
  }
  async function loadAccessExplanation() {
    const sequence = ++explainRequestSequence.current;
    const target = currentTarget();
    if (!target) {
      setExplanation(null);
      setExplainLoading(false);
      setExplainError("Select a server-authorized target to inspect access.");
      return;
    }
    const params = new URLSearchParams({ userId: explainUserId || currentUser.id, action: explainAction, projectId: project.id });
    if (target.kind !== "project") {
      params.set("targetKind", target.kind);
      params.set("targetId", target.id);
    }
    setExplainLoading(true);
    setExplainError("");
    try {
      const result = await api<AccessExplainPayload>(`/api/access/explain?${params}`);
      if (sequence === explainRequestSequence.current) setExplanation(result);
    } catch (err) {
      if (sequence !== explainRequestSequence.current) return;
      setExplanation(null);
      setExplainError(err instanceof Error ? err.message : "Access explanation could not be loaded.");
    } finally {
      if (sequence === explainRequestSequence.current) setExplainLoading(false);
    }
  }
  function createRule() {
    return mutationGate.run(`access:${project.id}:create`, async () => {
    if (!isManager) return;
    const target = currentTarget();
    if (!target) { setError("Select an authorized access target before creating a rule."); return; }
    const payload = {
      targetKind: target.kind,
      targetId: target.id,
      projectId: project.id,
      subjectKind: form.subjectKind,
      subjectId: form.subjectId || null,
      effect: form.effect,
      level: form.effect === "deny" ? "none" : form.level,
      status: "active",
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      notes: form.notes.trim() || null,
    };
    setError("");
    try {
      const created = await api<AccessRule>("/api/access-rules", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const next = [created, ...rules.filter((rule) => rule.id !== created.id)];
      setRules(next);
      setApiQueryData(accessRulePath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["access-rules", `project:${project.id}`] });
      window.dispatchEvent(new CustomEvent("cluster-access-rules-changed", { detail: { projectId: project.id } }));
      setStatus("Access rule saved.");
      setForm((prev) => ({ ...prev, expiresAt: "", notes: "" }));
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "Access API unavailable. The rule was not saved.");
    }
    });
  }
  function patchRule(id: string, patch: Partial<AccessRule>) {
    return mutationGate.run(`access:${project.id}:rule:${id}`, async () => {
    if (!isManager) return;
    setError("");
    try {
      const updated = await api<AccessRule>(`/api/access-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const next = rules.map((rule) => (rule.id === id ? updated : rule));
      setRules(next);
      setApiQueryData(accessRulePath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["access-rules", `project:${project.id}`] });
      window.dispatchEvent(new CustomEvent("cluster-access-rules-changed", { detail: { projectId: project.id } }));
      setStatus("Access rule updated.");
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "Could not update access rule. No local permission change was applied.");
    }
    });
  }
  function deleteRule(id: string) {
    return mutationGate.run(`access:${project.id}:rule:${id}`, async () => {
    if (!isManager || !await confirmCluster({ title: "Delete access rule?", message: "Delete this project access rule?", confirmLabel: "Delete rule", tone: "danger" })) return;
    setError("");
    try {
      await api(`/api/access-rules/${id}`, { method: "DELETE" });
      const next = rules.filter((rule) => rule.id !== id);
      setRules(next);
      setApiQueryData(accessRulePath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["access-rules", `project:${project.id}`] });
      window.dispatchEvent(new CustomEvent("cluster-access-rules-changed", { detail: { projectId: project.id } }));
      setStatus("Access rule deleted.");
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "Could not delete access rule. The server rule remains active.");
    }
    });
  }
  function toggleShareSection(sectionName: string) {
    setShareForm((prev) => ({
      ...prev,
      allowedSections: prev.allowedSections.includes(sectionName) ? prev.allowedSections.filter((item) => item !== sectionName) : [...prev.allowedSections, sectionName],
    }));
  }
  function createShareLink() {
    return mutationGate.run(`access:${project.id}:share:create`, async () => {
    if (!isManager) { setError("Project manage access required."); return; }
    setError("");
    try {
      const created = await api<ProjectShareLink>(`/api/projects/${encodeURIComponent(project.id)}/share-links`, {
        method: "POST",
        body: JSON.stringify({
          accessLevel: shareForm.accessLevel,
          allowedSections: shareForm.allowedSections,
          expiresAt: shareForm.expiresAt ? new Date(`${shareForm.expiresAt}T23:59:59`).toISOString() : null,
          maxUses: shareForm.maxUses ? Number(shareForm.maxUses) : null,
        }),
      });
      setShareLinks((current) => {
        const next = [created, ...current];
        setApiQueryData(shareLinksPath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-share-links", `project:${project.id}`] });
        return next;
      });
      setNewShareUrl(created.shareUrl || "");
      setStatus("Restricted share link created. The full URL is shown once, so copy it before navigating away.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Share-link creation may have completed. Check the link list before retrying.");
    }
    });
  }
  function patchShareLink(id: string, patch: Partial<ProjectShareLink>) {
    return mutationGate.run(`access:${project.id}:share:${id}`, async () => {
    if (!isManager) return;
    try {
      const updated = await api<ProjectShareLink>(`/api/projects/${encodeURIComponent(project.id)}/share-links/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
      setShareLinks((current) => {
        const next = current.map((item) => (item.id === id ? updated : item));
        setApiQueryData(shareLinksPath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-share-links", `project:${project.id}`] });
        return next;
      });
      setStatus(updated.status === "revoked" ? "Share link revoked." : "Share link updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update share link.");
    }
    });
  }
  async function copyShareUrl() {
    if (!newShareUrl) return;
    try {
      const copied = await copyClusterText(newShareUrl);
      setStatus(copied ? "Share URL copied." : "Share URL could not be copied. Select the URL manually.");
    } catch {
      setStatus("Copy failed. Select the URL manually.");
    }
  }
  return (
    <section className="project-subpage-v312 project-access-page-v152 project-access-v312">
      <ProjectSectionHeader
        eyebrow="Access control"
        title="Project visibility"
        description="Project rules are enforced across project discovery, boards, whiteboards, files, video, and shared links. Temporary access expires automatically instead of relying on an admin remembering three months later."
        compact
        metrics={[
          { label: "Active", value: liveRules.length, tone: liveRules.length ? "accent" : "neutral" },
          { label: "Expired", value: expiredRules.length, tone: expiredRules.length ? "warning" : "neutral" },
          { label: "Share links", value: shareLinks.filter((link) => link.status === "active").length },
        ]}
      />

      <div className="access-layout-v152">
        <section className="access-rule-builder-v152">
          <div className="project-panel-head-v147">
            <h3>Add rule</h3>
            <span>{isManager ? "manager" : "read-only"}</span>
          </div>
          <div className="access-form-grid-v152">
            <div className="field">
              <label>Target</label>
              <ClusterResourcePicker ariaLabel="Rule target" value={form.targetKey}
                onChange={(value) => patch("targetKey", value)} projectId={project.id}
                resources={resourceCandidates} allowedKinds={['project', 'board', 'whiteboard', 'library', 'review_asset']}
                onSearchChange={setPickerQuery} emptyMessage={pickerLoading ? "Loading authorized targets…" : "No authorized targets found"}
                disabled={!isManager || mutationGate.anyPending || (pickerLoading && resourceCandidates.length === 0)} />
              {pickerNextCursor && <ClusterButton type="button" size="compact" variant="quiet" disabled={pickerLoading || pickerPaging} onClick={() => void loadMorePickerTargets()}>{pickerPaging ? "Loading more…" : "Load more authorized resources"}</ClusterButton>}
            </div>
            <div className="field">
              <label>Who</label>
              <ClusterNativeSelect value={form.subjectKind} onChange={(event) => {
                const subjectKind = event.target.value as AccessSubjectKind;
                setForm((prev) => ({ ...prev, subjectKind, subjectId: subjectKind === "team" ? defaultTeamId : "" }));
              }}>
                <option value="team">Team</option>
                <option value="member">Member</option>
                <option value="external">External</option>
                <option value="all">Everyone</option>
              </ClusterNativeSelect>
            </div>
            {form.subjectKind === "member" && (
              <div className="field">
                <label>Member</label>
                <ClusterNativeSelect value={form.subjectId} onChange={(event) => patch("subjectId", event.target.value)}>
                  <option value="">Choose member</option>
                  {users.map((member) => (
                    <option key={member.id} value={member.id}>
                      {displayUserName(member)}
                    </option>
                  ))}
                </ClusterNativeSelect>
              </div>
            )}
            {form.subjectKind === "team" && (
              <div className="field">
                <label>Team</label>
                <ClusterNativeSelect value={form.subjectId} onChange={(event) => patch("subjectId", event.target.value)}>
                  <option value="">Choose team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </ClusterNativeSelect>
              </div>
            )}
            {form.subjectKind === "external" && (
              <div className="field">
                <label>External collaborators</label>
                <span className="muted">Applies to all external collaborator accounts. Use Member for a specific person.</span>
              </div>
            )}
            <div className="field">
              <label>Effect</label>
              <ClusterNativeSelect value={form.effect} onChange={(event) => patch("effect", event.target.value as AccessEffect)}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Level</label>
              <ClusterNativeSelect value={form.level} onChange={(event) => patch("level", event.target.value as ProjectPermissionLevel)} disabled={form.effect === "deny"}>
                {PROJECT_LEVEL_OPTIONS.filter((level) => level !== "none").map((level) => (
                  <option key={level} value={level}>
                    {levelLabel(level)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Expires</label>
              <ClusterTextInput type="date" value={form.expiresAt} onChange={(event) => patch("expiresAt", event.target.value)} />
            </div>
            <div className="field span-2">
              <label>Notes</label>
              <ClusterTextInput value={form.notes} onChange={(event) => patch("notes", event.target.value)} placeholder="Why this rule exists" />
            </div>
          </div>
          <ClusterButton type="button" className="" onClick={() => void previewImpact()} busy={impactBusy} busyLabel="Evaluating…" disabled={!isManager || impactBusy || mutationGate.anyPending || !authorizedTarget(form.targetKey) || ((form.subjectKind === "member" || form.subjectKind === "team") && !form.subjectId)} variant="secondary">Preview impact</ClusterButton>
          <ClusterButton type="button" className="" onClick={createRule} busy={mutationGate.isPending(`access:${project.id}:create`)} busyLabel="Saving…" disabled={!isManager || mutationGate.anyPending || !authorizedTarget(form.targetKey) || ((form.subjectKind === "member" || form.subjectKind === "team") && !form.subjectId)} variant="primary">
            Add access rule
          </ClusterButton>
          {impactError ? <p role="alert" className="field-error-v199">{impactError}</p> : null}
          {impactPreview ? <div className="project-rule-impact-v507" aria-live="polite">
            <strong>Proposed access impact (no changes applied)</strong>
            <span>{impactPreview.scope} · {impactPreview.evaluatedCount} evaluated{impactPreview.sampled ? " (sampled, more members exist)" : ""}</span>
            <div><span>Gaining access: <b>{impactPreview.elevated}</b></span><span>Losing access: <b>{impactPreview.reduced}</b></span><span>Unchanged: <b>{impactPreview.unchanged}</b></span></div>
            <table className="project-rule-impact-table-v507"><thead><tr><th scope="col">Effective access</th><th scope="col">Currently</th><th scope="col">Proposed</th></tr></thead><tbody>{(["none", "view", "contribute", "manage"] as const).map((level) => <tr key={level}><th scope="row">{levelLabel(level)}</th><td>{impactPreview.before[level] || 0}</td><td>{impactPreview.after[level] || 0}</td></tr>)}</tbody></table>
            <small>{impactPreview.limitations}</small>
          </div> : null}
        </section>

        <section className="access-rules-list-v152">
          <div className="project-panel-head-v147">
            <h3>Rules</h3>
            <span>{activeRules.length}</span>
          </div>
          {activeRules.length ? (
            activeRules.map((rule) => {
              const target = resourceCandidates.find((item) => item.kind === rule.targetKind && item.id === rule.targetId);
              const expired = rule.status === "expired" || Boolean(rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now());
              return (
                <article key={rule.id} className={`${rule.effect} ${expired ? "expired" : rule.status}`}>
                  <div>
                    <strong>
                      {rule.effect === "deny" ? "Block" : "Allow"} {rule.subjectName}
                    </strong>
                    <span>
                      {accessTargetLabel(rule.targetKind)} · {target?.label || "Restricted or unavailable target"} · {levelLabel(rule.level)}
                      {rule.expiresAt ? ` · ${expired ? "expired" : "until"} ${new Date(rule.expiresAt).toLocaleDateString()}` : " · no expiry"}
                    </span>
                    {rule.notes && <em>{rule.notes}</em>}
                  </div>
                  <div className="button-row compact">
                    {expired ? (
                      <ClusterButton type="button"
                        className=""
                        onClick={() =>
                          patchRule(rule.id, {
                            status: "active",
                            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                          })
                        }
                       disabled={mutationGate.anyPending} busy={mutationGate.isPending(`access:${project.id}:rule:${rule.id}`)} variant="quiet" size="compact">
                        Renew 30d
                      </ClusterButton>
                    ) : (
                      <ClusterButton type="button"
                        className=""
                        onClick={() =>
                          patchRule(rule.id, {
                            status: rule.status === "active" ? "paused" : "active",
                          })
                        }
                       disabled={mutationGate.anyPending} busy={mutationGate.isPending(`access:${project.id}:rule:${rule.id}`)} variant="quiet" size="compact">
                        {rule.status === "active" ? "Pause" : "Activate"}
                      </ClusterButton>
                    )}
                    <ClusterButton type="button" className="" onClick={() => deleteRule(rule.id)} busy={mutationGate.isPending(`access:${project.id}:rule:${rule.id}`)} disabled={mutationGate.anyPending} variant="danger" size="compact">
                      Delete
                    </ClusterButton>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state compact-empty">No access rules yet. Default project permissions apply until you restrict a target.</div>
          )}
        </section>
      </div>

      <ProjectShareLinksSection
        isManager={isManager}
        busyCreate={mutationGate.isPending(`access:${project.id}:share:create`)}
        busyForLink={(id) => mutationGate.isPending(`access:${project.id}:share:${id}`)}
        actionsBusy={mutationGate.anyPending}
        shareLinks={shareLinks}
        shareForm={shareForm}
        setShareForm={setShareForm}
        newShareUrl={newShareUrl}
        portalAccessLabel={portalAccessLabel}
        toggleShareSection={toggleShareSection}
        createShareLink={createShareLink}
        patchShareLink={patchShareLink}
        copyShareUrl={copyShareUrl}
      />

      <section className="access-preview-v152 access-explorer-v516">
        <div className="project-panel-head-v147">
          <div><h3>Access Explorer</h3><p className="muted tight">Uses the server authorization engine to explain the actual allow/deny result for a person and the selected target.</p></div>
          <span>{explainLoading ? "evaluating…" : explanation ? "authoritative" : "unavailable"}</span>
        </div>
        <div className="access-explorer-controls-v516">
          <label className="field"><span>Person</span><ClusterNativeSelect value={explainUserId} onChange={(event) => setExplainUserId(event.target.value)}>{explainUsers.map((member) => <option key={member.id} value={member.id}>{displayUserName(member)}</option>)}</ClusterNativeSelect></label>
          <label className="field"><span>Action</span><ClusterNativeSelect value={explainAction} onChange={(event) => setExplainAction(event.target.value as AccessExplainAction)}><option value="view">View</option><option value="contribute">Contribute</option><option value="manage">Manage</option></ClusterNativeSelect></label>
          <label className="field span-2"><span>Target</span><ClusterResourcePicker ariaLabel="Access target" value={form.targetKey} onChange={(value) => patch("targetKey", value)} projectId={project.id} resources={resourceCandidates} onSearchChange={setPickerQuery} emptyMessage={pickerLoading ? "Loading authorized targets…" : "No authorized targets found"} />{pickerNextCursor && <ClusterButton type="button" size="compact" variant="quiet" disabled={pickerLoading || pickerPaging} onClick={() => void loadMorePickerTargets()}>{pickerPaging ? "Loading more…" : "Load more authorized resources"}</ClusterButton>}</label>
        </div>
        {(() => {
          const decision = explanation?.target || explanation?.project || null;
          if (!decision) return explainError ? <div className="error-box slim">{explainError}</div> : <div className="empty-state compact-empty">{explainLoading ? "Evaluating effective access…" : "Choose a person and target to inspect effective access."}</div>;
          return <div className={`access-explorer-result-v516 ${decision.allowed ? "allow" : "deny"}`}>
            <header><div><span>{decision.allowed ? "Allowed" : "Denied"}</span><strong>{decision.reason}</strong></div><code>{decision.code}</code></header>
            <div className="access-explorer-boundaries-v0507" aria-label="Independent authorization boundaries">
              {([['Tool', explanation?.tool], ['Project', explanation?.project], ['Target', explanation?.target]] as const)
                .map(([label, check]) => check ? <div key={label}><strong>{label}: {check.allowed ? "allowed" : "denied"}</strong><small>{check.reason}</small></div> : null)}
              <p className="muted tight">Each boundary is evaluated independently. An allowed Tool or Project is not permission to bypass a target rule or Library source access.</p>
            </div>
            {explanation?.tool?.contributors?.length ? <ClusterDisclosureGroup title={`${explanation.toolKey || 'Tool'} inheritance and permission sources`} headerTrailing={<span>{explanation.tool.contributors.length}</span>} className="project-access-explain-disclosure-v546" contentClassName="access-explorer-contributors-v516">{explanation.tool.contributors.map((source, index) => <article key={`${source.source}-${index}`} className={source.effect}><strong>{source.source.replace(/[-_]/g, " ")}</strong><p>{source.detail}</p></article>)}
            </ClusterDisclosureGroup> : null}
            <div className="access-explorer-contributors-v516">{decision.contributors.length ? decision.contributors.map((contributor, index) => <article key={`${contributor.source}-${contributor.id || index}`} className={contributor.effect}><div><strong>{contributor.source.replace(/[-_]/g, " ")}</strong><span>{contributor.effect}</span></div><p>{contributor.detail}</p>{contributor.id ? <small>{contributor.id}</small> : null}</article>) : <p className="muted">The authorization engine returned no contributing rules.</p>}</div>
            <small>Evaluated {new Date(decision.evaluatedAt).toLocaleString()} against {decision.resource.kind}{decision.resource.id ? ` · ${decision.resource.id}` : ""}.</small>
          </div>;
        })()}
      </section>

      {pickerError && <div className="error-box slim">Resource discovery failed: {pickerError}. No cached project resources are substituted.</div>}
      {status && <div className="status-box system-status-box-v053">{status}</div>}
      {error && <div className="error-box">{error}</div>}
    </section>
  );
}
