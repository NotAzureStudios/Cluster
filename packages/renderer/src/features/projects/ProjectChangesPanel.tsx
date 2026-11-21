import { useEffect, useMemo, useRef, useState } from "react";
import { serializeClusterDeepLink, type ClusterOperation } from "@cluster/shared";
import { copyClusterText } from "../../core/clipboard";
import { clusterWorkPermalink } from "../workflow/work-actions";
import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { ClusterButton, ClusterIconButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterToggle } from "../../components/ClusterToggle";
import { api, formatApiError, queryApi } from "../../core/api";
import type { Project, User } from "../application/application-models";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { ClusterMultiSelect } from "../../components/ClusterMultiSelect";
import { PeopleMultiPicker } from "../people/PeoplePicker";
import { ProjectCollaborationStrip } from "../collaboration";
import { readFocusedSourceReview, readFocusedSourceCommit } from "./source-review-navigation";
import "./project-source.css";

/* Project → Source Control. One bar (repository, branch, head, sync) and
   five views: Work, Reviews, History, Branches, Policy. Rows, not cards;
   styled only by project-source.css (sx-*). */

type SourceBranch = {
  id: string;
  name: string;
  headRevision?: string | null;
  isDefault: boolean;
  protected: boolean;
  aheadCount: number;
  behindCount: number;
  lastCommitAt?: string | null;
};

type SourceChange = {
  id: string;
  path: string;
  previousPath?: string | null;
  changeType: string;
  additions?: number | null;
  deletions?: number | null;
  binary?: boolean;
};

type SourceCommit = {
  id: string;
  revision: string;
  shortRevision: string;
  message: string;
  authorName?: string | null;
  committedAt?: string | null;
  webUrl?: string | null;
  additions?: number | null;
  deletions?: number | null;
  filesChanged?: number | null;
  changes?: SourceChange[];
};

type SourceOperationMetadata = {
  repositoryId: string;
  workingCopyId?: string | null;
  operationType: string;
  branchName?: string | null;
  targetBranch?: string | null;
  backgroundJobId?: string | null;
  input?: Record<string, unknown>;
};

type SourceOperation = ClusterOperation & {
  payload?: { sourceControl?: SourceOperationMetadata };
};

function sourceOperationMetadata(operation: SourceOperation | null | undefined): SourceOperationMetadata | null {
  const value = operation?.payload?.sourceControl;
  return value && typeof value.operationType === "string" ? value : null;
}

function sourceOperationLabel(operation: SourceOperation | null | undefined) {
  const operationType = sourceOperationMetadata(operation)?.operationType || operation?.type?.replace(/^source\./, "") || "operation";
  return operationType.replaceAll("_", " ");
}

type SourceRepository = {
  id: string;
  name: string;
  slug?: string | null;
  remoteUrl?: string | null;
  defaultBranch: string;
  headRevision?: string | null;
  syncState?: string | null;
  lastSyncedAt?: string | null;
  healthState?: string | null;
  healthMessage?: string | null;
  connection?: { id: string; displayName: string; providerId: string; status: string } | null;
};

type SourceWorkingCopy = {
  id: string;
  branchName: string;
  baseBranch?: string | null;
  headRevision?: string | null;
  upstreamName?: string | null;
  status: string;
  dirtyFiles: number;
  stagedFiles: number;
  conflictCount: number;
  aheadCount: number;
  behindCount: number;
  mergeBaseRevision?: string | null;
  lastScannedAt?: string | null;
  updatedAt: string;
};

type SourcePolicy = {
  id?: string | null;
  bindingId?: string | null;
  protectedPatterns: string[];
  branchPrefixes: string[];
  allowDirectPush: boolean;
  allowForcePush: boolean;
  requireLinkedWorkItem: boolean;
  requiredApprovals: number;
  requireQa: boolean;
  requireBuild: boolean;
};

type SourceReview = {
  id: string;
  workingCopyId?: string | null;
  title: string;
  description?: string | null;
  sourceBranch: string;
  targetBranch: string;
  sourceRevision: string;
  targetRevision: string;
  status: string;
  eligibilityState: string;
  eligibilityMessage?: string | null;
  changeSummary?: { commits?: number; files?: number; additions?: number; deletions?: number; linkedWork?: number; approvals?: number; requiredApprovals?: number; qaLinked?: boolean; buildLinked?: boolean };
  decisions?: Array<{ id: string; userId: string; decision: string; comment?: string | null; updatedAt: string }>;
  reviewerIds?: string[];
  reviewerTeamIds?: string[];
  mergedRevision?: string | null;
  mergedAt?: string | null;
  updatedAt: string;
};

type WorkCandidate = { kind: string; id: string; label: string; context?: string | null };

type VersionSuggestion = {
  configured: boolean;
  policy?: { id: string; name: string; presetKey: string; formatTemplate: string } | null;
  latest?: { id: string; label: string; status: string; sourceRevision?: string | null; createdAt: string } | null;
  suggestion?: { label: string; bump: string; hasChanges: boolean; sourceRevision?: string | null; commitCount: number; rationale: string[]; commits: Array<{ revision: string; shortRevision: string; message: string; committedAt?: string | null }> } | null;
};

type SourceControlPayload = {
  projectId: string;
  binding: { id: string; repositoryId: string; defaultBranch?: string | null; isPrimary: boolean } | null;
  repository: SourceRepository | null;
  runtime?: {
    runtime: { available: boolean; version?: string | null; executable?: string; message?: string };
    mirrorState: "ready" | "missing" | "unavailable";
  } | null;
  branches: SourceBranch[];
  commits: SourceCommit[];
  operations: SourceOperation[];
  policy?: SourcePolicy | null;
  workingCopies?: SourceWorkingCopy[];
  links?: Array<{ id: string; targetType: string; targetId: string; linkRole: string; commitId?: string | null }>;
  versionSuggestion?: VersionSuggestion | null;
  reviews?: SourceReview[];
};

type SourceView = "work" | "reviews" | "history" | "branches" | "policy";

function relativeTime(value?: string | null) {
  if (!value) return "Never";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function workingCopyTone(status?: string) {
  if (status === "conflicted" || status === "failed") return "danger";
  if (status === "dirty") return "warning";
  if (status === "preparing") return "accent";
  return "good";
}

function wildcardMatches(value: string, pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export function ProjectChangesPanel({ project, users, currentUser, canContribute, canManage, permissionReason, onOpenConnections }: {
  project: Project;
  users: User[];
  currentUser: User;
  canContribute: boolean;
  canManage: boolean;
  permissionReason: string;
  onOpenConnections: () => void;
}) {
  const [payload, setPayload] = useState<SourceControlPayload | null>(null);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<SourceView>("work");
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [reviewDraftFor, setReviewDraftFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);
  const [commitChangesById, setCommitChangesById] = useState<Record<string, SourceChange[]>>({});
  const [loadingCommitId, setLoadingCommitId] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [existingBranch, setExistingBranch] = useState("main");
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});
  const [commitLinks, setCommitLinks] = useState<Record<string, string>>({});
  const [reviewTitles, setReviewTitles] = useState<Record<string, string>>({});
  const [reviewTargets, setReviewTargets] = useState<Record<string, string>>({});
  const [reviewerIds, setReviewerIds] = useState<Record<string, string[]>>({});
  const [reviewerTeamIds, setReviewerTeamIds] = useState<Record<string, string[]>>({});
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [focusedReviewId, setFocusedReviewId] = useState<string | null>(() => typeof window === "undefined" ? null : readFocusedSourceReview(window.location.search));
  const [focusedCommitId, setFocusedCommitId] = useState<string | null>(() => typeof window === "undefined" ? null : readFocusedSourceCommit(window.location.search));
  const [linkedCommit, setLinkedCommit] = useState<SourceCommit | null>(null);
  const [linkedReview, setLinkedReview] = useState<SourceReview | null>(null);
  const operationBusyRef = useRef(false);
  const sourceLoadGenerationRef = useRef(0);

  const [discussionReviewId, setDiscussionReviewId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; archived?: boolean }>>([]);
  const [candidates, setCandidates] = useState<WorkCandidate[]>([]);
  const [policyDraft, setPolicyDraft] = useState({ protectedPatterns: "", branchPrefixes: "", allowDirectPush: true, requireLinkedWorkItem: false, requiredApprovals: 1, requireQa: false, requireBuild: false });

  const activeOperation = useMemo(() => payload?.operations.find((operation) => operation.status === "queued" || operation.status === "running") || null, [payload]);
  const operationsByWorkingCopy = useMemo(() => new Map((payload?.operations || [])
    .map((operation) => [operation, sourceOperationMetadata(operation)] as const)
    .filter(([operation, metadata]) => metadata?.workingCopyId && (operation.status === "queued" || operation.status === "running"))
    .map(([operation, metadata]) => [metadata!.workingCopyId as string, operation])), [payload]);

  async function load(force = false) {
    const generation = ++sourceLoadGenerationRef.current;
    try {
      const result = await queryApi<SourceControlPayload>(`/api/projects/${project.id}/source-control`, { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["source-control", project.id] });
      if (generation !== sourceLoadGenerationRef.current) return;
      setPayload(result);
      const defaultName = result.binding?.defaultBranch || result.repository?.defaultBranch || "main";
      setBaseBranch((current) => current === "main" ? defaultName : current);
      setExistingBranch((current) => current === "main" ? defaultName : current);
      if (result.policy) setPolicyDraft({ protectedPatterns: result.policy.protectedPatterns.filter((name) => name !== defaultName).join(", "), branchPrefixes: result.policy.branchPrefixes.join(", "), allowDirectPush: result.policy.allowDirectPush, requireLinkedWorkItem: result.policy.requireLinkedWorkItem, requiredApprovals: result.policy.requiredApprovals ?? 1, requireQa: Boolean(result.policy.requireQa), requireBuild: Boolean(result.policy.requireBuild) });
    } catch (error) {
      if (generation === sourceLoadGenerationRef.current) setStatus(formatApiError(error));
    }
  }

  useEffect(() => {
    setPayload(null);
    setCommitChangesById({}); setExpandedCommitId(null); setLinkedCommit(null); setLinkedReview(null);
    void load();
    return () => { sourceLoadGenerationRef.current++; };
  }, [project.id]);
  useEffect(() => {
    const followInspector = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; id?: string | null }>).detail;
      if (detail?.scope === "source-review") setFocusedReviewId(detail.id || null);
      if (detail?.scope === "source-commit") setFocusedCommitId(detail.id || null);
    };
    window.addEventListener("cluster:inspector-state-changed", followInspector);
    setFocusedReviewId(readFocusedSourceReview(window.location.search));
    setFocusedCommitId(readFocusedSourceCommit(window.location.search));
    return () => window.removeEventListener("cluster:inspector-state-changed", followInspector);
  }, [project.id]);
  useEffect(() => {
    if (!focusedReviewId || payload?.reviews?.some((review) => review.id === focusedReviewId)) { setLinkedReview(null); return; }
    if (linkedReview?.id === focusedReviewId) return;
    let cancelled = false;
    void api<{ ok: true; review: SourceReview }>(`/api/projects/${project.id}/source-control/reviews/${encodeURIComponent(focusedReviewId)}`)
      .then((result) => { if (!cancelled) setLinkedReview(result.review); })
      .catch(() => { if (!cancelled) setLinkedReview(null); });
    return () => { cancelled = true; };
  }, [focusedReviewId, payload?.reviews, project.id, linkedReview?.id]);
  useEffect(() => {
    if (!focusedReviewId || !(linkedReview?.id === focusedReviewId || payload?.reviews?.some((review) => review.id === focusedReviewId))) return;
    setView("reviews");
    setOpenReviewId(focusedReviewId);
    setDiscussionReviewId(focusedReviewId);
    const node = document.getElementById(`cluster-source-review-${focusedReviewId}`);
    node?.scrollIntoView({ block: "center", behavior: "auto" });
    node?.focus({ preventScroll: true });
  }, [focusedReviewId, payload?.reviews, linkedReview, view]);

  useEffect(() => {
    if (!focusedCommitId) { setLinkedCommit(null); return; }
    const known = payload?.commits?.some((commit) => commit.id === focusedCommitId);
    setView("history");
    if (known) { setLinkedCommit(null); setExpandedCommitId(focusedCommitId); return; }
    let cancelled = false;
    // Older linked commits can fall outside the bounded recent-history window.
    // Fetch exactly the requested record through the Project's authorized API.
    void api<{ ok: true; commit: SourceCommit }>(`/api/projects/${project.id}/source-control/commits/${encodeURIComponent(focusedCommitId)}`)
      .then((result) => { if (!cancelled) { setLinkedCommit(result.commit); setExpandedCommitId(result.commit.id); } })
      .catch(() => { if (!cancelled) { setLinkedCommit(null); setStatus("Linked revision could not be found or you do not have access."); } });
    return () => { cancelled = true; };
  }, [focusedCommitId, payload?.commits, project.id]);
  useEffect(() => {
    if (!focusedCommitId || expandedCommitId !== focusedCommitId) return;
    const node = document.getElementById(`cluster-source-commit-${focusedCommitId}`);
    node?.scrollIntoView({ block: "center", behavior: "auto" });
    node?.focus({ preventScroll: true });
  }, [focusedCommitId, expandedCommitId, payload?.commits, linkedCommit, view]);

  useEffect(() => {
    void api<Array<{ id: string; name: string; archived?: boolean }>>("/api/team/teams").then((rows) => setTeams(rows.filter((row) => !row.archived))).catch(() => setTeams([]));
  }, [project.id]);
  useEffect(() => {
    if (!payload?.repository) return;
    void api<{ candidates?: WorkCandidate[] }>(`/api/projects/${project.id}/workflow-link-candidates?limit=80`)
      .then((result) => setCandidates((result.candidates || []).filter((candidate) => ["card", "ticket", "timeline", "control", "build", "qa_plan", "qa_session", "release"].includes(candidate.kind))))
      .catch(() => setCandidates([]));
  }, [project.id, payload?.repository?.id]);
  useEffect(() => {
    if (!activeOperation) return;
    const timer = window.setTimeout(() => void load(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [activeOperation?.id, activeOperation?.status, activeOperation?.progress]);

  async function copySourceLink(kind: "source_commit" | "source_review", id: string) {
    const navigation: ClusterWorkNavigationTarget = {
      screen: "project", projectId: project.id, projectTab: "source",
      inspectScope: kind === "source_commit" ? "source-commit" : "source-review", inspectId: id,
    };
    const native = new URL(window.location.href).searchParams.get("clusterDesktop") === "1";
    const link = native ? serializeClusterDeepLink({ type: "resource", resource: { kind, id, projectId: project.id } }) : null;
    const copied = await copyClusterText(link || clusterWorkPermalink(navigation));
    setStatus(copied ? "Source link copied." : "Could not copy the source link to the clipboard.");
  }

  async function toggleCommit(commit: SourceCommit) {
    if (expandedCommitId === commit.id) { setExpandedCommitId(null); return; }
    setExpandedCommitId(commit.id);
    if (commit.changes || commitChangesById[commit.id]) return;
    setLoadingCommitId(commit.id);
    try {
      const result = await queryApi<{ changes: SourceChange[] }>(`/api/projects/${project.id}/source-control/commits/${commit.id}/changes`, { staleMs: 60_000, maxAgeMs: 10 * 60_000, tags: ["source-control", "source-changes", project.id, commit.id] });
      setCommitChangesById((current) => ({ ...current, [commit.id]: result.changes || [] }));
    } catch (error) {
      setStatus(formatApiError(error));
      setCommitChangesById((current) => ({ ...current, [commit.id]: [] }));
    } finally {
      setLoadingCommitId((current) => current === commit.id ? null : current);
    }
  }

  async function perform(label: string, action: () => Promise<unknown>): Promise<boolean> {
    // React state alone doesn't guard double clicks in the same event turn.
    if (operationBusyRef.current) return false;
    operationBusyRef.current = true;
    setBusy(true);
    try {
      await action();
      setStatus(label);
      await load(true);
      return true;
    } catch (error) {
      setStatus(formatApiError(error));
      return false;
    } finally {
      operationBusyRef.current = false;
      setBusy(false);
    }
  }

  async function sync() {
    await perform("Repository synchronization queued.", () => api(`/api/projects/${project.id}/source-control/sync`, { method: "POST" }));
  }

  async function prepareBranch(createBranch: boolean) {
    const branchName = createBranch ? newBranch.trim() : existingBranch;
    if (!branchName) return;
    await perform(createBranch ? "Branch creation queued." : "Working-copy preparation queued.", () => api(`/api/projects/${project.id}/source-control/workspaces`, { method: "POST", body: JSON.stringify({ branchName, baseBranch, createBranch }) }));
    if (createBranch) setNewBranch("");
  }

  async function refreshWorkingCopy(workingCopyId: string) {
    await perform("Working-copy state refreshed.", () => api(`/api/projects/${project.id}/source-control/workspaces/${workingCopyId}/refresh`, { method: "POST" }));
  }

  async function commitWorkingCopy(workingCopy: SourceWorkingCopy) {
    const message = (commitMessages[workingCopy.id] || "").trim();
    if (!message) { setStatus("Enter a commit message first."); return; }
    const selected = commitLinks[workingCopy.id] || "";
    const candidate = candidates.find((item) => `${item.kind}:${item.id}` === selected);
    const saved = await perform("Commit queued.", () => api(`/api/projects/${project.id}/source-control/workspaces/${workingCopy.id}/commit`, { method: "POST", body: JSON.stringify({ message, links: candidate ? [{ targetType: candidate.kind, targetId: candidate.id, linkRole: "implements" }] : [] }) }));
    if (saved) setCommitMessages((current) => ({ ...current, [workingCopy.id]: "" }));
  }

  async function pushWorkingCopy(workingCopyId: string) {
    await perform("Push queued.", () => api(`/api/projects/${project.id}/source-control/workspaces/${workingCopyId}/push`, { method: "POST" }));
  }

  async function savePolicy() {
    await perform("Branch policy saved.", () => api(`/api/projects/${project.id}/source-control/policy`, { method: "PATCH", body: JSON.stringify({ protectedPatterns: policyDraft.protectedPatterns.split(",").map((item) => item.trim()).filter(Boolean), branchPrefixes: policyDraft.branchPrefixes.split(",").map((item) => item.trim()).filter(Boolean), allowDirectPush: policyDraft.allowDirectPush, requireLinkedWorkItem: policyDraft.requireLinkedWorkItem, requiredApprovals: policyDraft.requiredApprovals, requireQa: policyDraft.requireQa, requireBuild: policyDraft.requireBuild }) }));
  }

  async function openReview(workingCopy: SourceWorkingCopy) {
    const title = (reviewTitles[workingCopy.id] || "").trim() || `Review ${workingCopy.branchName}`;
    const targetBranch = reviewTargets[workingCopy.id] || payload?.repository?.defaultBranch || "main";
    const created = await perform("Source review opened.", () => api(`/api/projects/${project.id}/source-control/reviews`, { method: "POST", body: JSON.stringify({ workingCopyId: workingCopy.id, title, targetBranch, reviewerIds: reviewerIds[workingCopy.id] || [], reviewerTeamIds: reviewerTeamIds[workingCopy.id] || [] }) }));
    if (created) {
      setReviewDraftFor(null);
      setReviewerIds((current) => ({ ...current, [workingCopy.id]: [] }));
      setReviewerTeamIds((current) => ({ ...current, [workingCopy.id]: [] }));
    }
  }

  async function updateReviewAssignments(review: SourceReview, nextReviewerIds: string[], nextReviewerTeamIds: string[]) {
    await perform("Review assignments updated.", () => api(`/api/projects/${project.id}/source-control/reviews/${review.id}`, { method: "PATCH", body: JSON.stringify({ reviewerIds: nextReviewerIds, reviewerTeamIds: nextReviewerTeamIds }) }));
  }

  async function reviewDecision(review: SourceReview, decision: "approved" | "changes_requested" | "commented") {
    const comment = (reviewComments[review.id] || "").trim();
    if (decision === "changes_requested" && !comment) {
      setStatus("Explain the changes requested before submitting a review decision.");
      return;
    }
    const saved = await perform(decision === "approved" ? "Review approved." : decision === "changes_requested" ? "Changes requested." : "Review comment saved.", () => api(`/api/projects/${project.id}/source-control/reviews/${review.id}/decision`, { method: "POST", body: JSON.stringify({ decision, comment: comment || undefined }) }));
    if (saved) setReviewComments((current) => ({ ...current, [review.id]: "" }));
  }

  async function refreshReview(reviewId: string) {
    await perform("Review eligibility refreshed.", () => api(`/api/projects/${project.id}/source-control/reviews/${reviewId}/refresh`, { method: "POST" }));
  }

  async function mergeReview(reviewId: string) {
    await perform("Merge queued.", () => api(`/api/projects/${project.id}/source-control/reviews/${reviewId}/merge`, { method: "POST" }));
  }

  async function createSuggestedVersion() {
    await perform("Draft project version created.", () => api(`/api/projects/${project.id}/source-control/version`, { method: "POST", body: JSON.stringify({ bump: "auto" }) }));
  }

  const repository = payload?.repository || null;
  const policy = payload?.policy || null;
  const branches = payload?.branches || [];
  const workingCopies = payload?.workingCopies || [];
  const reviews = [...(linkedReview && !payload?.reviews?.some((review) => review.id === linkedReview.id) ? [linkedReview] : []), ...(payload?.reviews || [])];
  const commits = [...(linkedCommit && !payload?.commits?.some((commit) => commit.id === linkedCommit.id) ? [linkedCommit] : []), ...(payload?.commits || [])];
  const openReviews = reviews.filter((review) => review.status === "open");
  const mirrorReady = payload?.runtime?.mirrorState === "ready";
  const gitAvailable = payload?.runtime?.runtime.available !== false;
  const activeReview = reviews.find((review) => review.id === discussionReviewId) || null;
  const activeSourceBranch = workingCopies.find((copy) => copy.dirtyFiles > 0 || copy.conflictCount > 0)?.branchName || workingCopies[0]?.branchName || repository?.defaultBranch || "source";
  const sourcePresenceActivity = activeReview ? `Source review · ${activeReview.title}` : `Source · ${activeSourceBranch}`;
  const lastFailure = (payload?.operations || []).find((operation) => operation.status === "failed" && !activeOperation);
  const syncState = !repository ? "none" : repository.syncState === "failed" ? "failed" : activeOperation ? "running" : mirrorReady ? "ready" : "pending";
  const workDisabled = !canContribute || busy;
  const notice = !gitAvailable ? { tone: "danger", text: payload?.runtime?.runtime.message || "Git isn't available on the server." }
    : repository?.syncState === "failed" ? { tone: "danger", text: repository.healthMessage || "Sync failed." }
    : repository && !mirrorReady && !activeOperation ? { tone: "warning", text: "Not synced yet. Sync to load branches and history." }
    : null;

  if (!payload && !status) return <section className="sx"><p className="sx-empty">Loading…</p></section>;

  if (!repository) return <section className="sx">
    <div className="sx-none">
      <ClusterIcon name="code" aria-hidden="true" />
      <b>No repository</b>
      <span>Pick one of the studio's repositories for this project.</span>
      {canManage ? <ClusterButton variant="primary" size="compact" onClick={onOpenConnections}>Link repository</ClusterButton> : <small>{permissionReason}</small>}
    </div>
    {status ? <p className="sx-msg" role="status">{status}</p> : null}
  </section>;

  const tabs: Array<{ value: SourceView; label: string }> = [
    { value: "work", label: workingCopies.length ? `Work ${workingCopies.length}` : "Work" },
    { value: "reviews", label: openReviews.length ? `Reviews ${openReviews.length}` : "Reviews" },
    { value: "history", label: "History" },
    { value: "branches", label: branches.length ? `Branches ${branches.length}` : "Branches" },
    { value: "policy", label: "Policy" },
  ];

  return (
    <section className="sx">
      <header className="sx-bar">
        <span className="sx-repo" data-state={syncState} title={repository.healthMessage || undefined}>
          <i aria-hidden="true" />
          <b>{repository.name}</b>
          <small>{repository.connection?.displayName || "Cluster native"}</small>
        </span>
        <span className="sx-fact" title="Default branch"><ClusterIcon name="timeline" aria-hidden="true" />{repository.defaultBranch || "main"}</span>
        <code className="sx-fact" title={repository.headRevision || "No commits yet"}>{repository.headRevision?.slice(0, 8) || "no commits"}</code>
        <span className="sx-fact sx-fact--muted" title={repository.lastSyncedAt ? new Date(repository.lastSyncedAt).toLocaleString() : undefined}>{repository.lastSyncedAt ? `Synced ${relativeTime(repository.lastSyncedAt).toLowerCase()}` : "Never synced"}</span>
        {activeOperation ? <span className="sx-op" role="status" title={activeOperation.progressMessage || undefined}>
          <span className="sx-op__track"><span style={{ width: `${Math.max(4, activeOperation.progress || 0)}%` }} /></span>
          {sourceOperationLabel(activeOperation)} {activeOperation.progress || 0}%
        </span> : null}
        <span className="sx-bar__end">
          {repository.remoteUrl ? <ClusterLinkButton href={repository.remoteUrl} target="_blank" rel="noreferrer" variant="quiet" size="compact" title="Open remote"><ClusterIcon name="forward" aria-hidden="true" />Remote</ClusterLinkButton> : null}
          <ClusterButton variant="primary" size="compact" disabled={busy || Boolean(activeOperation) || !canContribute} onClick={() => void sync()}><ClusterIcon name="sync" aria-hidden="true" />{activeOperation ? "Syncing…" : "Sync"}</ClusterButton>
        </span>
      </header>
      <ProjectCollaborationStrip tool="project" projectId={project.id} activity={sourcePresenceActivity} />
      {notice ? <p className="sx-notice" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}><ClusterIcon name="warning" aria-hidden="true" />{notice.text}</p> : null}
      {lastFailure && !notice ? <p className="sx-notice" data-tone="danger" role="alert"><ClusterIcon name="warning" aria-hidden="true" />{sourceOperationLabel(lastFailure)} failed{lastFailure.lastError ? `: ${lastFailure.lastError}` : "."}</p> : null}

      <nav className="sx-tabs">
        <ClusterSegmentedControl value={view} onChange={setView} label="Source control views" options={tabs} />
        {!canContribute ? <span className="sx-readonly"><ClusterIcon name="lock" aria-hidden="true" />{permissionReason}</span> : null}
        {status ? <span className="sx-msg" role="status">{status}</span> : null}
      </nav>

      {view === "work" ? <>
        {canContribute ? <div className="sx-start" aria-label="Start work">
          <label className="sx-field sx-field--grow"><span>New branch</span><ClusterTextInput value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder={policy?.branchPrefixes?.[0] ? `${policy.branchPrefixes[0]}…` : "feature/…"} disabled={workDisabled} /></label>
          <label className="sx-field"><span>From</span><ClusterNativeSelect value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} disabled={workDisabled || !branches.length}>{branches.map((branch) => <option key={branch.id} value={branch.name}>{branch.name}</option>)}</ClusterNativeSelect></label>
          <ClusterButton variant="primary" size="compact" disabled={workDisabled || !newBranch.trim() || !mirrorReady} onClick={() => void prepareBranch(true)}>Create</ClusterButton>
          <span className="sx-start__or">or</span>
          <label className="sx-field"><span>Open</span><ClusterNativeSelect value={existingBranch} onChange={(event) => setExistingBranch(event.target.value)} disabled={workDisabled || !branches.length}>{branches.map((branch) => <option key={branch.id} value={branch.name}>{branch.name}{branch.isDefault ? " (default)" : ""}</option>)}</ClusterNativeSelect></label>
          <ClusterButton variant="secondary" size="compact" disabled={workDisabled || !existingBranch || !mirrorReady} onClick={() => void prepareBranch(false)}>Open</ClusterButton>
        </div> : null}
        <section className="sx-card" aria-label="Working copies">
          <h3 className="sx-card__title">Working copies</h3>
          {workingCopies.length ? <ul className="sx-rows">
            {workingCopies.map((workingCopy) => {
              const operation = operationsByWorkingCopy.get(workingCopy.id);
              const protectedBranch = Boolean(policy?.protectedPatterns.some((pattern) => wildcardMatches(workingCopy.branchName, pattern)) || branches.find((branch) => branch.name === workingCopy.branchName)?.protected);
              const canPush = canContribute && !operation && !protectedBranch && policy?.allowDirectPush !== false && workingCopy.status !== "conflicted" && workingCopy.status !== "failed" && workingCopy.behindCount === 0;
              const canOpenReview = workingCopy.dirtyFiles === 0 && Boolean(workingCopy.headRevision && workingCopy.upstreamName);
              const locked = !canContribute || Boolean(operation);
              return <li key={workingCopy.id} className="sx-wc" data-tone={workingCopyTone(workingCopy.status)}>
                <div className="sx-row">
                  <span className="sx-row__main"><i className="sx-dot" aria-hidden="true" /><b>{workingCopy.branchName}</b>{protectedBranch ? <ClusterIcon name="lock" aria-label="Protected" /> : null}<small>{workingCopy.status}</small></span>
                  <span className="sx-nums">
                    <span title="Ahead / behind upstream">↑{workingCopy.aheadCount} ↓{workingCopy.behindCount}</span>
                    <span data-on={workingCopy.dirtyFiles > 0 || undefined}>{workingCopy.dirtyFiles} changed</span>
                    {workingCopy.conflictCount ? <span data-tone="danger">{workingCopy.conflictCount} conflicts</span> : null}
                  </span>
                  <code title={workingCopy.headRevision || undefined}>{workingCopy.headRevision?.slice(0, 8) || "—"}</code>
                  <span className="sx-row__actions">
                    <ClusterIconButton size="compact" label="Refresh" disabled={Boolean(operation) || busy} onClick={() => void refreshWorkingCopy(workingCopy.id)}><ClusterIcon name="refresh" /></ClusterIconButton>
                    {canOpenReview ? <ClusterButton size="compact" variant={reviewDraftFor === workingCopy.id ? "secondary" : "quiet"} disabled={locked || busy} onClick={() => setReviewDraftFor((current) => current === workingCopy.id ? null : workingCopy.id)}>Review</ClusterButton> : null}
                    <ClusterButton size="compact" variant="secondary" disabled={!canPush || busy} title={protectedBranch ? "Protected branch — merge through a review" : workingCopy.behindCount ? "Behind upstream — sync first" : undefined} onClick={() => void pushWorkingCopy(workingCopy.id)}>Push</ClusterButton>
                  </span>
                </div>
                {operation ? <p className="sx-sub">{sourceOperationLabel(operation)} · {operation.progress}%{operation.progressMessage ? ` · ${operation.progressMessage}` : ""}</p> : null}
                {workingCopy.dirtyFiles > 0 ? <div className="sx-compose">
                  <ClusterTextInput aria-label={`Commit message for ${workingCopy.branchName}`} value={commitMessages[workingCopy.id] || ""} onChange={(event) => setCommitMessages((current) => ({ ...current, [workingCopy.id]: event.target.value }))} placeholder="Commit message" disabled={locked} />
                  <ClusterNativeSelect aria-label="Linked work" value={commitLinks[workingCopy.id] || ""} onChange={(event) => setCommitLinks((current) => ({ ...current, [workingCopy.id]: event.target.value }))} disabled={locked}><option value="">No linked work</option>{candidates.map((candidate) => <option key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.label} · {candidate.context || candidate.kind.replaceAll("_", " ")}</option>)}</ClusterNativeSelect>
                  <ClusterButton size="compact" variant="primary" disabled={locked || !(commitMessages[workingCopy.id] || "").trim()} onClick={() => void commitWorkingCopy(workingCopy)}>Commit {workingCopy.dirtyFiles}</ClusterButton>
                </div> : null}
                {canOpenReview && reviewDraftFor === workingCopy.id ? <div className="sx-compose sx-compose--review">
                  <ClusterTextInput aria-label="Review title" value={reviewTitles[workingCopy.id] || ""} onChange={(event) => setReviewTitles((current) => ({ ...current, [workingCopy.id]: event.target.value }))} placeholder={`Review ${workingCopy.branchName}`} disabled={locked} />
                  <label className="sx-field"><span>Into</span><ClusterNativeSelect value={reviewTargets[workingCopy.id] || repository.defaultBranch || "main"} onChange={(event) => setReviewTargets((current) => ({ ...current, [workingCopy.id]: event.target.value }))} disabled={locked}>{branches.filter((branch) => branch.name !== workingCopy.branchName).map((branch) => <option key={branch.id} value={branch.name}>{branch.name}</option>)}</ClusterNativeSelect></label>
                  <PeopleMultiPicker label="Reviewers" values={reviewerIds[workingCopy.id] || []} onChange={(values) => setReviewerIds((current) => ({ ...current, [workingCopy.id]: values }))} people={users} disabled={locked} />
                  {teams.length ? <ClusterMultiSelect values={reviewerTeamIds[workingCopy.id] || []} onChange={(values) => setReviewerTeamIds((current) => ({ ...current, [workingCopy.id]: values }))} options={teams.map((team) => ({ value: team.id, label: team.name }))} ariaLabel="Reviewer teams" placeholder="Teams" disabled={locked} /> : null}
                  <ClusterButton size="compact" variant="primary" disabled={locked || busy || workingCopy.behindCount > 0} onClick={() => void openReview(workingCopy)}>Open review</ClusterButton>
                </div> : null}
              </li>;
            })}
          </ul> : <p className="sx-empty">{mirrorReady ? "No working copies. Create or open a branch." : "Sync first, then create or open a branch."}</p>}
        </section>
      </> : null}

      {view === "reviews" ? <section className="sx-card" aria-label="Reviews">
        {focusedReviewId && payload?.reviews && !payload.reviews.some((review) => review.id === focusedReviewId) && linkedReview?.id !== focusedReviewId ? <p className="sx-notice" data-tone="warning">The requested source review is no longer available in this Project. <ClusterButton size="compact" variant="quiet" onClick={() => setFocusedReviewId(null)}>Show all</ClusterButton></p> : null}
        {reviews.length ? <ul className="sx-rows">
          {reviews.map((review) => {
            const open = openReviewId === review.id;
            const state = review.status === "open" ? review.eligibilityState : review.status;
            const approvals = review.changeSummary?.approvals || 0;
            const required = review.changeSummary?.requiredApprovals ?? policy?.requiredApprovals ?? 1;
            return <li key={review.id} id={`cluster-source-review-${review.id}`} data-focused={focusedReviewId === review.id ? "true" : undefined} tabIndex={-1} aria-label={`Source review: ${review.title}`} className="sx-review cluster-source-review-v536" data-state={state}>
              <div className="sx-row">
                <button type="button" className="sx-row__toggle" aria-expanded={open} onClick={() => setOpenReviewId(open ? null : review.id)}>
                  <span className="sx-pill" data-state={state}>{state.replaceAll("_", " ")}</span>
                  <span className="sx-row__main"><b>{review.title}</b><small>{review.sourceBranch} → {review.targetBranch}</small></span>
                </button>
                <span className="sx-nums">
                  <span data-on={approvals >= required || undefined} title="Approvals">✓ {approvals}/{required}</span>
                  <span>{review.changeSummary?.commits || 0} commits</span>
                  <span>{review.changeSummary?.files || 0} files</span>
                </span>
                <span className="sx-row__actions"><ClusterIconButton size="compact" label="Copy link" onClick={() => void copySourceLink("source_review", review.id)}><ClusterIcon name="link" /></ClusterIconButton></span>
              </div>
              {open ? <div className="sx-detail">
                {review.status === "open" ? <p className="sx-sub">{review.eligibilityMessage || "Checking merge eligibility."}</p> : review.mergedRevision ? <p className="sx-sub">Merged as <code>{review.mergedRevision.slice(0, 10)}</code>{review.mergedAt ? ` · ${relativeTime(review.mergedAt)}` : ""}</p> : null}
                {review.status === "open" ? <>
                  <div className="sx-compose">
                    <PeopleMultiPicker label="Reviewers" values={review.reviewerIds || []} onChange={(values) => void updateReviewAssignments(review, values, review.reviewerTeamIds || [])} people={users} disabled={!canContribute || busy} />
                    {teams.length ? <ClusterMultiSelect values={review.reviewerTeamIds || []} onChange={(values) => void updateReviewAssignments(review, review.reviewerIds || [], values)} options={teams.map((team) => ({ value: team.id, label: team.name }))} ariaLabel={`${review.title} reviewer teams`} placeholder="Teams" disabled={!canContribute || busy} /> : null}
                  </div>
                  <div className="sx-compose">
                    <ClusterTextInput aria-label="Review note" value={reviewComments[review.id] || ""} onChange={(event) => setReviewComments((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="Note (needed to request changes)" disabled={!canContribute || busy} />
                    <ClusterButton size="compact" variant="secondary" disabled={!canContribute || busy || !(reviewComments[review.id] || "").trim()} onClick={() => void reviewDecision(review, "changes_requested")}>Request changes</ClusterButton>
                    <ClusterButton size="compact" variant="secondary" disabled={!canContribute || busy} onClick={() => void reviewDecision(review, "approved")}>Approve</ClusterButton>
                    <ClusterButton size="compact" variant="primary" disabled={!canManage || busy || review.eligibilityState !== "ready"} onClick={() => void mergeReview(review.id)}>Merge</ClusterButton>
                  </div>
                  <div className="sx-detail__foot">
                    <ClusterButton size="compact" variant={discussionReviewId === review.id ? "secondary" : "quiet"} disabled={busy} onClick={() => setDiscussionReviewId((current) => current === review.id ? null : review.id)}><ClusterIcon name="comment" aria-hidden="true" />Discussion</ClusterButton>
                    <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void refreshReview(review.id)}><ClusterIcon name="refresh" aria-hidden="true" />Recheck</ClusterButton>
                    <code>{review.sourceRevision.slice(0, 8)} → {review.targetRevision.slice(0, 8)}</code>
                  </div>
                  {discussionReviewId === review.id ? <CollaborationPanel title="Review discussion" entityType="source_review" entityId={review.id} users={users} currentUser={currentUser} compact /> : null}
                </> : null}
              </div> : null}
            </li>;
          })}
        </ul> : <p className="sx-empty">No reviews. Push a branch, then open a review from Work.</p>}
      </section> : null}

      {view === "history" ? <>
        {payload?.versionSuggestion?.configured && payload.versionSuggestion.suggestion?.hasChanges ? <div className="sx-version" title={payload.versionSuggestion.suggestion.rationale.join(" ")}>
          <ClusterIcon name="spark" aria-hidden="true" />
          <span>Next version <b>{payload.versionSuggestion.suggestion.label}</b></span>
          <small>{payload.versionSuggestion.suggestion.bump === "none" ? "initial" : payload.versionSuggestion.suggestion.bump} · {payload.versionSuggestion.suggestion.commitCount} changes · latest {payload.versionSuggestion.latest?.label || "none"}</small>
          {canManage ? <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void createSuggestedVersion()}>Create draft</ClusterButton> : null}
        </div> : null}
        <section className="sx-card" aria-label="Recent commits">
          <h3 className="sx-card__title">Commits <small>{repository.defaultBranch}</small></h3>
          {commits.length ? <ul className="sx-rows">
            {commits.map((commit) => {
              const expanded = expandedCommitId === commit.id;
              const changes = commit.changes || commitChangesById[commit.id];
              const linkCount = payload?.links?.filter((link) => link.commitId === commit.id).length || 0;
              return <li key={commit.id} id={`cluster-source-commit-${commit.id}`} tabIndex={-1} data-focused={focusedCommitId === commit.id ? "true" : undefined} className="sx-commit">
                <div className="sx-row">
                  <button type="button" className="sx-row__toggle" aria-expanded={expanded} onClick={() => void toggleCommit(commit)}>
                    <code title={commit.revision}>{commit.revision.slice(0, 8)}</code>
                    <span className="sx-row__main"><b title={commit.message}>{commit.message.split("\n")[0]}</b><small>{commit.authorName || "Unknown"} · {relativeTime(commit.committedAt)}</small></span>
                  </button>
                  <span className="sx-nums">
                    <span>{commit.filesChanged ?? changes?.length ?? 0} files</span>
                    <span data-tone="good">+{commit.additions || 0}</span>
                    <span data-tone="danger">−{commit.deletions || 0}</span>
                    {linkCount ? <span title="Linked work"><ClusterIcon name="link" aria-hidden="true" />{linkCount}</span> : null}
                  </span>
                  <span className="sx-row__actions"><ClusterIconButton size="compact" label="Copy link" onClick={() => void copySourceLink("source_commit", commit.id)}><ClusterIcon name="link" /></ClusterIconButton></span>
                </div>
                {expanded ? <ul className="sx-files">
                  {loadingCommitId === commit.id && !changes ? <li className="sx-empty">Loading files…</li> : changes?.length ? changes.map((change) => <li key={change.id} data-change={change.changeType}>
                    <i>{change.changeType.slice(0, 1).toUpperCase()}</i>
                    <code title={change.previousPath ? `${change.previousPath} → ${change.path}` : change.path}>{change.path}</code>
                    <small>{change.binary ? "binary" : change.additions == null && change.deletions == null ? "" : `+${change.additions || 0} −${change.deletions || 0}`}</small>
                  </li>) : <li className="sx-empty">No file list cached for this commit.</li>}
                </ul> : null}
              </li>;
            })}
          </ul> : <p className="sx-empty">{mirrorReady ? "No commits yet." : "Sync to load history."}</p>}
        </section>
        {payload?.operations?.length ? <section className="sx-card" aria-label="Operations">
          <h3 className="sx-card__title">Operations</h3>
          <ul className="sx-rows">{payload.operations.slice(0, 10).map((operation) => <li key={operation.id} className="sx-row sx-oprow" data-state={operation.status}>
            <span className="sx-pill" data-state={operation.status}>{operation.status}</span>
            <span className="sx-row__main"><b>{sourceOperationLabel(operation)}</b><small title={operation.lastError || undefined}>{operation.lastError || operation.progressMessage || ""}</small></span>
            <small className="sx-when">{relativeTime(operation.createdAt)}</small>
          </li>)}</ul>
        </section> : null}
      </> : null}

      {view === "branches" ? <section className="sx-card" aria-label="Branches">
        {branches.length ? <ul className="sx-rows">
          {branches.map((branch) => <li key={branch.id} className="sx-row sx-branch">
            <span className="sx-row__main"><b>{branch.name}</b>{branch.isDefault ? <span className="sx-pill" data-state="ready">default</span> : null}{branch.protected || policy?.protectedPatterns.some((pattern) => wildcardMatches(branch.name, pattern)) ? <ClusterIcon name="lock" aria-label="Protected" /> : null}</span>
            <span className="sx-nums">{branch.aheadCount || branch.behindCount ? <span>↑{branch.aheadCount} ↓{branch.behindCount}</span> : null}</span>
            <code title={branch.headRevision || undefined}>{branch.headRevision?.slice(0, 8) || "—"}</code>
            <small className="sx-when">{branch.lastCommitAt ? relativeTime(branch.lastCommitAt) : ""}</small>
          </li>)}
        </ul> : <p className="sx-empty">Sync to load branches.</p>}
      </section> : null}

      {view === "policy" ? <section className="sx-card sx-policy" aria-label="Branch policy">
        <div className="sx-set"><span><b>Protected branches</b><small>{repository.defaultBranch} is always protected</small></span>
          {canManage ? <ClusterTextInput aria-label="Protected patterns" value={policyDraft.protectedPatterns} onChange={(event) => setPolicyDraft((current) => ({ ...current, protectedPatterns: event.target.value }))} placeholder="release/*, hotfix/*" /> : <span className="sx-val">{policy?.protectedPatterns.join(", ") || repository.defaultBranch}</span>}
        </div>
        <div className="sx-set"><span><b>Branch prefixes</b><small>Suggested when creating branches</small></span>
          {canManage ? <ClusterTextInput aria-label="Branch prefixes" value={policyDraft.branchPrefixes} onChange={(event) => setPolicyDraft((current) => ({ ...current, branchPrefixes: event.target.value }))} placeholder="feature/, fix/" /> : <span className="sx-val">{policy?.branchPrefixes.join(", ") || "None"}</span>}
        </div>
        <div className="sx-set"><span><b>Approvals to merge</b></span>
          {canManage ? <ClusterSegmentedControl value={String(policyDraft.requiredApprovals)} onChange={(value) => setPolicyDraft((current) => ({ ...current, requiredApprovals: Number(value) }))} label="Required approvals" options={[0, 1, 2, 3].map((count) => ({ value: String(count), label: String(count) }))} /> : <span className="sx-val">{policy?.requiredApprovals ?? 1}</span>}
        </div>
        {([
          ["allowDirectPush", "Direct push", "To unprotected branches"],
          ["requireLinkedWorkItem", "Linked work", "Required before push or merge"],
          ["requireBuild", "Build", "A linked build is required to merge"],
          ["requireQa", "QA", "Linked QA evidence is required to merge"],
        ] as const).map(([key, label, hint]) => <div key={key} className="sx-set"><span><b>{label}</b><small>{hint}</small></span>
          {canManage ? <ClusterToggle checked={policyDraft[key]} aria-label={label} onCheckedChange={(checked) => setPolicyDraft((current) => ({ ...current, [key]: checked }))} /> : <span className="sx-val">{(key === "allowDirectPush" ? policy?.allowDirectPush !== false : Boolean(policy?.[key])) ? "On" : "Off"}</span>}
        </div>)}
        <div className="sx-set"><span><b>Force push</b></span><span className="sx-val">Never</span></div>
        {canManage ? <div className="sx-policy__save"><ClusterButton variant="primary" size="compact" disabled={busy} onClick={() => void savePolicy()}>Save policy</ClusterButton></div> : null}
      </section> : null}
    </section>
  );
}
