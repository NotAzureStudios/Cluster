import { CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterResourcePicker } from "../../components/ClusterResourcePicker";
import { useAuthorizedProjectResources } from "../../components/useAuthorizedProjectResources";
import { useClusterMutationGate } from "../../components/useClusterMutationGate";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyClusterText } from "../../core/clipboard";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, queryApi, setApiQueryData } from "../../core/api";
import { levelLabel } from "../../core/format";
import { ProjectShareLinksSection } from "./ProjectShareLinksSection";
import { PROJECT_LEVEL_OPTIONS, type ProjectPermissionLevel } from "../../core/permissions";
import { displayUserName } from "../people/people-utils";
import type {
  AccessEffect, AccessRule, AccessSubjectKind, AccessTargetKind, ExternalPortalAccessLevel,
  Project, ProjectMediaPayload, ProjectShareLink, User,
} from "../application/application-models";
import "./project-access.css";

type AccessExplainAction = "view" | "contribute" | "manage";
type AccessPerson = {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  role: string;
  level: "manage" | "contribute" | "view" | "none";
  reason: { kind: string; label: string; ruleId?: string };
};
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

const EXPLAIN_SOURCE_LABELS: Record<string, string> = {
  "workspace-role": "Studio role",
  "tool-permission": "Tool permission",
  "tool-cap": "Tool limit",
  "project-policy": "Project limit",
  "project-permission": "Project access",
  "resource-permission": "Item access",
  "access-rule": "Rule",
  "resource-state": "Item state",
  "account-lifecycle": "Account",
  "account-inactive": "Account",
  "user-access-expiry": "Access expired",
  authentication: "Sign-in",
  deployment: "Server",
};

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
  const [people, setPeople] = useState<AccessPerson[] | null>(null);
  const [peopleTruncated, setPeopleTruncated] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<"access" | "none" | "all">("access");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [addingRule, setAddingRule] = useState(false);
  const [explainOpen, setExplainOpen] = useState<string | null>(null);
  const peopleRequestSequence = useRef(0);
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
  const activeRules = rules.filter((rule) => rule.status !== "archived");
  const liveRules = activeRules.filter((rule) => rule.status === "active" && (!rule.expiresAt || new Date(rule.expiresAt).getTime() > Date.now()));
  const expiredRules = activeRules.filter((rule) => rule.status === "expired" || Boolean(rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now()));
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
  async function loadPeople() {
    const sequence = ++peopleRequestSequence.current;
    if (!isManager) { setPeople(null); return; }
    try {
      const result = await api<{ people: AccessPerson[]; truncated: boolean }>(`/api/projects/${encodeURIComponent(project.id)}/access/people`);
      if (sequence !== peopleRequestSequence.current) return;
      setPeople(result.people);
      setPeopleTruncated(result.truncated);
      setPeopleError("");
    } catch (err) {
      if (sequence === peopleRequestSequence.current) setPeopleError(err instanceof Error ? err.message : "Could not work out who has access.");
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
    void loadPeople();
    return () => { ruleRequestSequence.current += 1; shareRequestSequence.current += 1; peopleRequestSequence.current += 1; };
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
      void loadPeople();
      setStatus("Rule added.");
      setForm((prev) => ({ ...prev, expiresAt: "", notes: "" }));
      setAddingRule(false);
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
      void loadPeople();
      setStatus("Rule updated.");
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
      void loadPeople();
      setStatus("Rule deleted.");
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
      setStatus("Link created. Copy it now; it is shown once.");
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
  const subjectReady = !((form.subjectKind === "member" || form.subjectKind === "team") && !form.subjectId);
  // The server only accepts individual allows through a reviewed scoped grant.
  const needsGrantReview = form.subjectKind === "member" && form.effect === "allow";
  const counts = { manage: 0, contribute: 0, view: 0, none: 0 } as Record<AccessPerson["level"], number>;
  for (const person of people || []) counts[person.level] += 1;
  const term = peopleSearch.trim().toLocaleLowerCase();
  const visiblePeople = (people || []).filter((person) =>
    (peopleFilter === "all" || (peopleFilter === "none" ? person.level === "none" : person.level !== "none"))
    && (!term || `${person.name} ${person.username || ""} ${person.role}`.toLocaleLowerCase().includes(term)));
  const ruleTarget = (rule: AccessRule) => rule.targetKind === "project" ? null : (resourceCandidates.find((item) => item.kind === rule.targetKind && item.id === rule.targetId)?.label || "Unavailable item");
  const openExplain = (userId: string) => {
    if (explainOpen === userId) { setExplainOpen(null); return; }
    setExplainOpen(userId);
    setExplainUserId(userId);
    setExplainAction("view");
    patch("targetKey", `project:${project.id}`);
  };
  const decision = explanation?.target || explanation?.project || null;

  return (
    <section className="pa">
      {isManager ? <div className="pa-summary" aria-label="Access summary">
        {(["manage", "contribute", "view", "none"] as const).map((level) => <span key={level} data-level={level}><i />{people ? counts[level] : "–"}<small>{level === "none" ? "No access" : levelLabel(level)}</small></span>)}
        <span className="pa-summary__links"><ClusterIcon name="link" aria-hidden="true" />{shareLinks.filter((link) => link.status === "active").length}<small>Share links</small></span>
      </div> : <p className="pa-readonly"><ClusterIcon name="lock" aria-hidden="true" />Only project managers can change access.</p>}

      {isManager ? <section className="pa-card" aria-label="Who has access">
        <header className="pa-card__head">
          <h3>People</h3>
          <label className="pa-search"><ClusterIcon name="search" aria-hidden="true" /><input type="search" value={peopleSearch} placeholder="Find a person" aria-label="Find a person" onChange={(event) => setPeopleSearch(event.target.value)} /></label>
          <ClusterSegmentedControl value={peopleFilter} onChange={setPeopleFilter} label="Show people"
            options={[{ value: "access", label: "Has access" }, { value: "none", label: "No access" }, { value: "all", label: "All" }]} />
        </header>
        {peopleError ? <p className="pa-error" role="alert">{peopleError}</p> : null}
        {!people && !peopleError ? <p className="pa-empty">Checking access…</p> : null}
        {people && !visiblePeople.length ? <p className="pa-empty">Nobody here.</p> : null}
        <ul className="pa-people">
          {visiblePeople.map((person) => <li key={person.userId} data-open={explainOpen === person.userId || undefined}>
            <button type="button" className="pa-person" aria-expanded={explainOpen === person.userId} onClick={() => openExplain(person.userId)}>
              {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span className="pa-avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>}
              <span className="pa-person__name"><b>{person.name}</b><small>{levelLabel(person.role)}</small></span>
              <span className="pa-level" data-level={person.level}><i />{person.level === "none" ? "No access" : levelLabel(person.level)}</span>
              <span className="pa-reason" data-kind={person.reason.kind}>{person.reason.label}</span>
              <ClusterIcon name="chevron-down" aria-hidden="true" />
            </button>
            {explainOpen === person.userId ? <div className="pa-explain">
              {explainLoading ? <p className="pa-empty">Checking…</p> : explainError ? <p className="pa-error">{explainError}</p> : decision ? <>
                <p className="pa-explain__verdict" data-allowed={decision.allowed} title={decision.reason}>
                  <ClusterIcon name={decision.allowed ? "check" : "close"} aria-hidden="true" />
                  {decision.allowed ? "Can" : "Can't"} {explainAction}
                </p>
                {decision.contributors.length ? <ul className="pa-steps">{decision.contributors.map((contributor, index) => <li key={`${contributor.source}-${contributor.id || index}`} data-effect={contributor.effect} title={contributor.detail}>
                  <ClusterIcon name={contributor.effect === "deny" ? "close" : contributor.effect === "limit" ? "minus" : "check"} aria-hidden="true" />{EXPLAIN_SOURCE_LABELS[contributor.source] || contributor.source.replace(/[-_]/g, " ")}
                </li>)}</ul> : null}
                <div className="pa-explain__check">
                  <span>Check</span>
                  <ClusterNativeSelect value={explainAction} aria-label="Action" onChange={(event) => setExplainAction(event.target.value as AccessExplainAction)}><option value="view">View</option><option value="contribute">Contribute</option><option value="manage">Manage</option></ClusterNativeSelect>
                  <span>on</span>
                  <ClusterResourcePicker ariaLabel="Access target" value={form.targetKey} onChange={(value) => patch("targetKey", value)} projectId={project.id} resources={resourceCandidates} onSearchChange={setPickerQuery} emptyMessage={pickerLoading ? "Loading…" : "Nothing found"} />
                </div>
              </> : null}
            </div> : null}
          </li>)}
        </ul>
        {peopleTruncated ? <p className="pa-empty">Showing the first 300 people.</p> : null}
      </section> : null}

      <section className="pa-card" aria-label="Access rules">
        <header className="pa-card__head">
          <h3>Rules</h3>
          <span className="pa-count">{liveRules.length} active{expiredRules.length ? ` · ${expiredRules.length} expired` : ""}</span>
          {isManager ? <ClusterButton type="button" size="compact" variant={addingRule ? "quiet" : "secondary"} onClick={() => setAddingRule((open) => !open)}><ClusterIcon name={addingRule ? "close" : "plus"} />{addingRule ? "Cancel" : "Add rule"}</ClusterButton> : null}
        </header>
        {addingRule && isManager ? <div className="pa-add">
          <ClusterSegmentedControl value={form.effect} onChange={(value) => patch("effect", value as AccessEffect)} label="Effect" options={[{ value: "allow", label: "Allow" }, { value: "deny", label: "Block" }]} />
          <label className="pa-field"><span>Who</span><ClusterNativeSelect value={form.subjectKind} aria-label="Who" onChange={(event) => {
            const subjectKind = event.target.value as AccessSubjectKind;
            setForm((prev) => ({ ...prev, subjectKind, subjectId: subjectKind === "team" ? defaultTeamId : "" }));
          }}>
            <option value="team">Team</option>
            <option value="member">Person</option>
            <option value="external">External people</option>
            <option value="all">Everyone</option>
          </ClusterNativeSelect></label>
          <label className="pa-field"><span>{form.subjectKind === "member" ? "Person" : form.subjectKind === "team" ? "Team" : "\u00a0"}</span>{form.subjectKind === "member" ? <ClusterNativeSelect value={form.subjectId} aria-label="Person" onChange={(event) => patch("subjectId", event.target.value)}>
            <option value="">Choose…</option>
            {users.map((member) => <option key={member.id} value={member.id}>{displayUserName(member)}</option>)}
          </ClusterNativeSelect> : form.subjectKind === "team" ? <ClusterNativeSelect value={form.subjectId} aria-label="Team" onChange={(event) => patch("subjectId", event.target.value)}>
            <option value="">Choose…</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </ClusterNativeSelect> : <span className="pa-field__none">{form.subjectKind === "all" ? "Everyone in the studio" : "Anyone outside the studio"}</span>}</label>
          <label className="pa-field"><span>Level</span><ClusterNativeSelect value={form.level} aria-label="Level" onChange={(event) => patch("level", event.target.value as ProjectPermissionLevel)} disabled={form.effect === "deny"}>
            {PROJECT_LEVEL_OPTIONS.filter((level) => level !== "none").map((level) => <option key={level} value={level}>{levelLabel(level)}</option>)}
          </ClusterNativeSelect></label>
          <label className="pa-field"><span>Expires</span><ClusterTextInput type="date" aria-label="Expires" value={form.expiresAt} onChange={(event) => patch("expiresAt", event.target.value)} /></label>
          <div className="pa-field pa-add__target">
            <span>Applies to</span>
            <ClusterResourcePicker ariaLabel="Rule target" value={form.targetKey}
              onChange={(value) => patch("targetKey", value)} projectId={project.id}
              resources={resourceCandidates} allowedKinds={["project", "board", "whiteboard", "library", "review_asset"]}
              onSearchChange={setPickerQuery} emptyMessage={pickerLoading ? "Loading…" : "Nothing found"}
              disabled={mutationGate.anyPending || (pickerLoading && resourceCandidates.length === 0)} />
            {pickerNextCursor ? <ClusterButton type="button" size="compact" variant="quiet" disabled={pickerLoading || pickerPaging} onClick={() => void loadMorePickerTargets()}>{pickerPaging ? "Loading…" : "More"}</ClusterButton> : null}
          </div>
          <label className="pa-field pa-add__note"><span>Note</span><ClusterTextInput value={form.notes} aria-label="Note" onChange={(event) => patch("notes", event.target.value)} placeholder="Optional" /></label>
          <div className="pa-add__actions">
            {impactPreview ? <span className="pa-impact" aria-live="polite" title={impactPreview.limitations}>
              <b data-tone="good">+{impactPreview.elevated}</b> gain · <b data-tone="danger">−{impactPreview.reduced}</b> lose · {impactPreview.unchanged} same{impactPreview.sampled ? " (sample)" : ""}
            </span> : impactError ? <span className="pa-error" role="alert">{impactError}</span> : null}
            {needsGrantReview ? <span className="pa-hint"><ClusterIcon name="user" aria-hidden="true" />One person? Use Studio Systems → Scoped grants.</span> : null}
            <ClusterButton type="button" size="compact" variant="quiet" onClick={() => void previewImpact()} busy={impactBusy} busyLabel="Checking…" disabled={impactBusy || mutationGate.anyPending || !authorizedTarget(form.targetKey) || !subjectReady}>Preview</ClusterButton>
            <ClusterButton type="button" size="compact" variant="primary" onClick={createRule} busy={mutationGate.isPending(`access:${project.id}:create`)} busyLabel="Adding…" disabled={mutationGate.anyPending || !authorizedTarget(form.targetKey) || !subjectReady || needsGrantReview}>Add</ClusterButton>
          </div>
        </div> : null}
        {activeRules.length ? <ul className="pa-rules">
          {activeRules.map((rule) => {
            const expired = rule.status === "expired" || Boolean(rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now());
            const target = ruleTarget(rule);
            const busy = mutationGate.isPending(`access:${project.id}:rule:${rule.id}`);
            return <li key={rule.id} data-effect={rule.effect} data-state={expired ? "expired" : rule.status} title={rule.notes || undefined}>
              <span className="pa-rule__effect"><ClusterIcon name={rule.effect === "deny" ? "close" : "check"} aria-hidden="true" />{rule.effect === "deny" ? "Block" : "Allow"}</span>
              <span className="pa-rule__who"><b>{rule.subjectName}</b>{target ? <small>{accessTargetLabel(rule.targetKind)} · {target}</small> : null}</span>
              {rule.effect === "deny" ? <span /> : <span className="pa-level" data-level={rule.level}><i />{levelLabel(rule.level)}</span>}
              <span className="pa-rule__when">{expired ? "Expired" : rule.status === "paused" ? "Paused" : rule.expiresAt ? `Until ${new Date(rule.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No expiry"}</span>
              {isManager ? <span className="pa-rule__actions">
                {expired
                  ? <ClusterButton type="button" size="compact" variant="quiet" busy={busy} disabled={mutationGate.anyPending} onClick={() => patchRule(rule.id, { status: "active", expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() })}>Renew 30d</ClusterButton>
                  : <ClusterButton type="button" size="compact" variant="quiet" busy={busy} disabled={mutationGate.anyPending} onClick={() => patchRule(rule.id, { status: rule.status === "active" ? "paused" : "active" })}>{rule.status === "active" ? "Pause" : "Resume"}</ClusterButton>}
                <ClusterIconButton size="compact" label="Delete rule" disabled={mutationGate.anyPending} onClick={() => deleteRule(rule.id)}><ClusterIcon name="trash" /></ClusterIconButton>
              </span> : null}
            </li>;
          })}
        </ul> : addingRule ? null : <p className="pa-empty">No rules. Studio roles and the project crew decide access.</p>}
      </section>

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

      {pickerError ? <p className="pa-error">Couldn't load project items: {pickerError}</p> : null}
      {error ? <p className="pa-error" role="alert">{error}</p> : status ? <p className="pa-status" role="status">{status}</p> : null}
    </section>
  );
}
