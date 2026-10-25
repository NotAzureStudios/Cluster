import { useEffect, useMemo, useRef, useState } from "react";
import { serializeClusterDeepLink, type ClusterOperation } from "@cluster/shared";
import { copyClusterText } from "../../core/clipboard";
import { clusterWorkPermalink } from "../workflow/work-actions";
import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { api, formatApiError, queryApi } from "../../core/api";
import type { Project, User } from "../application/application-models";
import { ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { ActivityHeatmap, HealthStrip, PipelineRail } from "../../components/ClusterVisualIntelligence";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { ClusterMultiSelect } from "../../components/ClusterMultiSelect";
import { PeopleMultiPicker } from "../people/PeoplePicker";
import type { VisualDatum } from "../../components/visual-intelligence";
import { ProjectCollaborationStrip } from "../collaboration";
import { readFocusedSourceReview, readFocusedSourceCommit } from "./source-review-navigation";

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

function operationTone(status?: string) {
  if (status === "succeeded") return "neutral";
  if (status === "failed") return "danger";
  if (status === "queued" || status === "running") return "accent";
  return "neutral";
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
  const [status, setStatus] = useState("Loading source control…");
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
  const recentChanges = useMemo(() => payload?.commits.reduce((count, commit) => count + Number(commit.filesChanged ?? commit.changes?.length ?? 0), 0) || 0, [payload]);
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
      if (!result.repository) setStatus("No repository is linked to this project.");
      else if (result.repository.syncState === "failed") setStatus(result.repository.healthMessage || "Repository synchronization failed.");
      else setStatus(result.repository.lastSyncedAt ? `Repository synchronized ${relativeTime(result.repository.lastSyncedAt)}.` : "Repository is linked but has not been synchronized yet.");
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
    setDiscussionReviewId(focusedReviewId);
    const node = document.getElementById(`cluster-source-review-${focusedReviewId}`);
    node?.scrollIntoView({ block: "center", behavior: "auto" });
    node?.focus({ preventScroll: true });
  }, [focusedReviewId, payload?.reviews, linkedReview]);

  useEffect(() => {
    if (!focusedCommitId) { setLinkedCommit(null); return; }
    const known = payload?.commits?.some((commit) => commit.id === focusedCommitId);
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
  }, [focusedCommitId, expandedCommitId, payload?.commits, linkedCommit]);

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
  const defaultBranch = payload?.branches.find((branch) => branch.isDefault) || null;
  const policy = payload?.policy || null;
  const branchOptions = payload?.branches.length ? payload.branches : defaultBranch ? [defaultBranch] : [];
  const sourceHealth: VisualDatum[] = repository ? [
    { id: "sync", label: "Repository", value: repository.syncState === "failed" ? "Needs attention" : "Synchronized", tone: repository.syncState === "failed" ? "danger" : "good", detail: repository.lastSyncedAt ? relativeTime(repository.lastSyncedAt) : "Not synced yet" },
    { id: "working", label: "Working copies", value: payload?.workingCopies?.length || 0, tone: (payload?.workingCopies || []).some((copy) => copy.conflictCount > 0) ? "danger" : (payload?.workingCopies || []).some((copy) => copy.dirtyFiles > 0) ? "warning" : "good", detail: `${(payload?.workingCopies || []).reduce((sum, copy) => sum + copy.dirtyFiles, 0)} changed files` },
    { id: "reviews", label: "Open reviews", value: (payload?.reviews || []).filter((review) => review.status === "open").length, tone: (payload?.reviews || []).some((review) => review.status === "open" && review.eligibilityState === "ready") ? "accent" : "neutral", detail: `${(payload?.reviews || []).filter((review) => review.status === "open" && review.eligibilityState === "ready").length} merge ready` },
    { id: "runtime", label: "Managed mirror", value: payload?.runtime?.mirrorState === "ready" ? "Ready" : "Unavailable", tone: payload?.runtime?.mirrorState === "ready" ? "good" : "warning", detail: payload?.runtime?.runtime.available ? `Git ${payload.runtime.runtime.version || "available"}` : "Git runtime unavailable" },
  ] : [];
  const commitActivity: VisualDatum[] = (payload?.commits || []).slice(0, 28).reverse().map((commit) => ({ id: commit.id, label: `${commit.shortRevision} ${commit.message.split("\n")[0]}`, value: Math.min(100, Math.max(8, (commit.filesChanged ?? commit.changes?.length ?? 0) * 12)), tone: "accent", detail: `${commit.filesChanged ?? commit.changes?.length ?? 0} files · ${relativeTime(commit.committedAt)}` }));
  const activeReview = (payload?.reviews || []).find((review) => review.id === discussionReviewId) || null;
  const activeSourceBranch = (payload?.workingCopies || []).find((copy) => copy.dirtyFiles > 0 || copy.conflictCount > 0)?.branchName || payload?.workingCopies?.[0]?.branchName || repository?.defaultBranch || "source";
  const sourcePresenceActivity = activeReview ? `Source review · ${activeReview.title}` : `Source · ${activeSourceBranch}`;
  const reviewPipeline: VisualDatum[] = [
    { id: "source", label: "Source", value: payload?.commits.length || 0, tone: repository ? "good" : "neutral", detail: `${payload?.branches.length || 0} branches` },
    { id: "review", label: "Review", value: (payload?.reviews || []).filter((review) => review.status === "open").length, tone: (payload?.reviews || []).some((review) => review.status === "open" && review.eligibilityState === "ready") ? "accent" : "warning", detail: `${(payload?.reviews || []).filter((review) => review.status === "open" && review.eligibilityState === "ready").length} ready` },
    { id: "build", label: "Build", value: policy?.requireBuild ? "Required" : "Optional", tone: policy?.requireBuild ? "accent" : "neutral", detail: "Merge policy" },
    { id: "qa", label: "QA", value: policy?.requireQa ? "Required" : "Optional", tone: policy?.requireQa ? "accent" : "neutral", detail: "Merge policy" },
    { id: "merge", label: "Merge", value: (payload?.reviews || []).filter((review) => review.status === "merged").length, tone: "good", detail: `into ${repository?.defaultBranch || "default"}` },
  ];

  return (
    <section className="project-subpage-v312">
      <ProjectSectionHeader
        eyebrow="Source Control"
        title="Changes"
        description="Prepare branches, commit project work, review changes, merge protected targets, and track source-backed versions without leaving Cluster."
        metrics={[
          { label: "Repository", value: repository?.name || "No repository", tone: repository ? "accent" : "warning" },
          { label: "Branches", value: String(payload?.branches.length || 0) },
          { label: "Working copies", value: String(payload?.workingCopies?.length || 0) },
          { label: "Recent files", value: String(recentChanges) },
          { label: "Mirror", value: payload?.runtime?.mirrorState === "ready" ? "Ready" : payload?.runtime?.runtime.available ? "Not created" : "Git unavailable", tone: payload?.runtime?.mirrorState === "ready" ? "good" : "warning" },
        ]}
        actions={repository ? (
          <>
            {repository.remoteUrl ? <ClusterLinkButton href={repository.remoteUrl} target="_blank" rel="noreferrer" variant="secondary" size="compact">Open remote</ClusterLinkButton> : null}
            <ClusterButton variant="primary" size="compact" disabled={busy || Boolean(activeOperation) || !canContribute} onClick={() => void sync()}>{sourceOperationMetadata(activeOperation)?.operationType === "fetch" ? `${activeOperation?.progress || 0}%` : busy ? "Working…" : "Sync"}</ClusterButton>
          </>
        ) : <ClusterButton variant="primary" size="compact" onClick={onOpenConnections}>Link repository</ClusterButton>}
      />
      <ProjectCollaborationStrip tool="project" projectId={project.id} activity={sourcePresenceActivity} />
      <ProjectSectionStatus tone={repository?.syncState === "failed" ? "danger" : activeOperation ? "warning" : repository ? "good" : "warning"}>{status}{!canContribute && repository ? ` ${permissionReason}` : ""}</ProjectSectionStatus>

      {repository ? (
        <>
          <ProjectSurface title="Source overview" description="Repository health, recent change density, and the production path from source through review, build, QA, and merge. These views derive from the same source-control payload as the controls below." tone={repository.syncState === "failed" ? "danger" : "accent"}>
            <HealthStrip items={sourceHealth} label="Source control health" />
            <div className="cluster-visual-consumer-grid">
              <div><p className="eyebrow">Recent change activity</p><ActivityHeatmap items={commitActivity} label="Recent source activity" onSelect={(selection) => setExpandedCommitId(selection.datumId)} /></div>
              <div><p className="eyebrow">Delivery lineage</p><PipelineRail items={reviewPipeline} label="Source to merge pipeline" /></div>
            </div>
          </ProjectSurface>
          <div className="project-connection-grid-v312">
            <ProjectSurface title="Repository" description="Cluster owns repository identity and synchronized state. Provider credentials stay in Administration." tone={repository.healthState === "failed" ? "danger" : "accent"}>
              <dl className="project-form-grid-v312">
                <div><dt>Repository</dt><dd>{repository.slug || repository.name}</dd></div>
                <div><dt>Connection</dt><dd>{repository.connection?.displayName || "Cluster native"}</dd></div>
                <div><dt>Default branch</dt><dd>{repository.defaultBranch || "main"}</dd></div>
                <div><dt>Head</dt><dd>{repository.headRevision?.slice(0, 12) || "Unknown"}</dd></div>
                <div><dt>Managed mirror</dt><dd>{payload?.runtime?.mirrorState === "ready" ? "Ready" : payload?.runtime?.mirrorState === "missing" ? "Not created" : "Unavailable"}</dd></div>
                <div><dt>Git runtime</dt><dd>{payload?.runtime?.runtime.available ? `Git ${payload.runtime.runtime.version || "available"}` : "Unavailable"}</dd></div>
              </dl>
            </ProjectSurface>
            <ProjectSurface title="Current operation" description="Source-control writes use Cluster's durable background job system." tone={activeOperation ? operationTone(activeOperation.status) : "neutral"}>
              {activeOperation ? <div className="project-member-v312"><strong>{sourceOperationLabel(activeOperation)}</strong><span>{activeOperation.progress}%</span><p>{activeOperation.progressMessage || activeOperation.status}</p></div> : <p className="muted">No source-control operation is running.</p>}
            </ProjectSurface>
          </div>

          <ProjectSurface title="Version suggestion" description="Cluster derives the next project version from the active version policy and synchronized default-branch changes." tone={payload?.versionSuggestion?.suggestion?.hasChanges ? "accent" : "neutral"}>
            {!payload?.versionSuggestion?.configured ? <p className="muted">No version policy is configured. Configure one in Administration &gt; Versioning to enable source-backed suggestions.</p> : payload.versionSuggestion.suggestion ? <div className="project-form-grid-v312">
              <div><span>Suggested version</span><strong>{payload.versionSuggestion.suggestion.label}</strong></div>
              <div><span>Change level</span><strong>{payload.versionSuggestion.suggestion.bump === "none" ? "Initial" : payload.versionSuggestion.suggestion.bump}</strong></div>
              <div><span>Source changes</span><strong>{payload.versionSuggestion.suggestion.commitCount}</strong></div>
              <div><span>Latest version</span><strong>{payload.versionSuggestion.latest?.label || "None"}</strong></div>
              <p className="muted">{payload.versionSuggestion.suggestion.rationale.join(" ")}</p>
              {payload.versionSuggestion.suggestion.hasChanges ? <ClusterButton variant="primary" disabled={!canManage || busy} onClick={() => void createSuggestedVersion()}>Create draft {payload.versionSuggestion.suggestion.label}</ClusterButton> : <p className="muted">The current project version already matches the synchronized default branch.</p>}
            </div> : <p className="muted">Synchronize the repository to calculate a version suggestion.</p>}
          </ProjectSurface>

          <ProjectSurface title="Start work" description="Open an existing branch or create a project branch from a synchronized base. Cluster keeps the server path private." tone="accent">
            <div className="project-form-grid-v312">
              <label><span>Existing branch</span><ClusterNativeSelect value={existingBranch} onChange={(event) => setExistingBranch(event.target.value)} disabled={!canContribute || busy}>{(payload?.branches || []).map((branch) => <option key={branch.id} value={branch.name}>{branch.name}{branch.isDefault ? " · default" : ""}</option>)}</ClusterNativeSelect></label>
              <label><span>Base branch</span><ClusterNativeSelect value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} disabled={!canContribute || busy}>{(payload?.branches || []).map((branch) => <option key={branch.id} value={branch.name}>{branch.name}</option>)}</ClusterNativeSelect></label>
              <label><span>New branch</span><ClusterTextInput value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature/inventory-pass" disabled={!canContribute || busy} /></label>
              <div className="project-control-inline-actions-v313"><ClusterButton variant="secondary" disabled={!canContribute || busy || !existingBranch || payload?.runtime?.mirrorState !== "ready"} onClick={() => void prepareBranch(false)}>Open branch</ClusterButton><ClusterButton variant="primary" disabled={!canContribute || busy || !newBranch.trim() || payload?.runtime?.mirrorState !== "ready"} onClick={() => void prepareBranch(true)}>Create branch</ClusterButton></div>
            </div>
            {policy?.branchPrefixes?.length ? <p className="muted">Suggested branch prefixes: {policy.branchPrefixes.join(", ")}</p> : null}
          </ProjectSurface>

          <ProjectSurface title="My working copies" description="Working copies report dirty files, conflicts, and remote divergence. Desktop/source workspace integration can edit these managed copies without exposing server paths here." tone="neutral">
            <div className="project-team-grid-v312">
              {(payload?.workingCopies || []).map((workingCopy) => {
                const operation = operationsByWorkingCopy.get(workingCopy.id);
                const protectedBranch = Boolean(policy?.protectedPatterns.some((pattern) => wildcardMatches(workingCopy.branchName, pattern)) || payload?.branches.find((branch) => branch.name === workingCopy.branchName)?.protected);
                const canPush = canContribute && !operation && !protectedBranch && policy?.allowDirectPush !== false && workingCopy.status !== "conflicted" && workingCopy.status !== "failed" && workingCopy.behindCount === 0;
                return <article key={workingCopy.id} className="project-member-v312">
                  <div><strong>{workingCopy.branchName}</strong><span className={`soft-pill ${workingCopyTone(workingCopy.status)}`}>{workingCopy.status}</span>{protectedBranch ? <span className="soft-pill">Protected</span> : null}</div>
                  <code>{workingCopy.headRevision?.slice(0, 12) || "not prepared"}</code>
                  <small>{workingCopy.upstreamName || "No upstream"} · {workingCopy.aheadCount} ahead / {workingCopy.behindCount} behind · {workingCopy.dirtyFiles} changed · {workingCopy.conflictCount} conflicts</small>
                  {operation ? <small>{sourceOperationLabel(operation)} · {operation.progress}% · {operation.progressMessage || operation.status}</small> : null}
                  <div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant="quiet" disabled={Boolean(operation) || busy} onClick={() => void refreshWorkingCopy(workingCopy.id)}>Refresh</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={!canPush || busy} onClick={() => void pushWorkingCopy(workingCopy.id)}>Push branch</ClusterButton></div>
                  {workingCopy.dirtyFiles > 0 ? <div className="project-form-grid-v312"><label><span>Commit message</span><ClusterTextInput value={commitMessages[workingCopy.id] || ""} onChange={(event) => setCommitMessages((current) => ({ ...current, [workingCopy.id]: event.target.value }))} placeholder="Describe the production change" disabled={!canContribute || Boolean(operation)} /></label><label><span>Linked work</span><ClusterNativeSelect value={commitLinks[workingCopy.id] || ""} onChange={(event) => setCommitLinks((current) => ({ ...current, [workingCopy.id]: event.target.value }))} disabled={!canContribute || Boolean(operation)}><option value="">No linked item</option>{candidates.map((candidate) => <option key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.label} · {candidate.context || candidate.kind.replaceAll("_", " ")}</option>)}</ClusterNativeSelect></label><ClusterButton variant="primary" disabled={!canContribute || Boolean(operation) || !(commitMessages[workingCopy.id] || "").trim()} onClick={() => void commitWorkingCopy(workingCopy)}>Commit changes</ClusterButton></div> : <p className="muted">Working copy is clean. Commit controls appear when managed files change.</p>}
                  {workingCopy.dirtyFiles === 0 && workingCopy.headRevision && workingCopy.upstreamName ? <div className="project-form-grid-v312"><label><span>Review title</span><ClusterTextInput value={reviewTitles[workingCopy.id] || ""} onChange={(event) => setReviewTitles((current) => ({ ...current, [workingCopy.id]: event.target.value }))} placeholder={`Review ${workingCopy.branchName}`} disabled={!canContribute || Boolean(operation)} /></label><label><span>Merge into</span><ClusterNativeSelect value={reviewTargets[workingCopy.id] || repository.defaultBranch || "main"} onChange={(event) => setReviewTargets((current) => ({ ...current, [workingCopy.id]: event.target.value }))} disabled={!canContribute || Boolean(operation)}>{(payload?.branches || []).filter((branch) => branch.name !== workingCopy.branchName).map((branch) => <option key={branch.id} value={branch.name}>{branch.name}{branch.isDefault ? " · default" : ""}</option>)}</ClusterNativeSelect></label><PeopleMultiPicker label="Requested reviewers" values={reviewerIds[workingCopy.id] || []} onChange={(values) => setReviewerIds((current) => ({ ...current, [workingCopy.id]: values }))} people={users} disabled={!canContribute || Boolean(operation)} /><div className="field"><label>Reviewer teams</label><ClusterMultiSelect values={reviewerTeamIds[workingCopy.id] || []} onChange={(values) => setReviewerTeamIds((current) => ({ ...current, [workingCopy.id]: values }))} options={teams.map((team) => ({ value: team.id, label: team.name }))} ariaLabel="Requested reviewer teams" placeholder="Add reviewer team" disabled={!canContribute || Boolean(operation) || !teams.length} /></div><ClusterButton variant="secondary" disabled={!canContribute || Boolean(operation) || busy || workingCopy.behindCount > 0} onClick={() => void openReview(workingCopy)}>Open review</ClusterButton></div> : null}
                </article>;
              })}
              {!payload?.workingCopies?.length ? <p className="muted">Open or create a branch to prepare your first managed working copy.</p> : null}
            </div>
          </ProjectSurface>

          <ProjectSurface title="Reviews" description="Review production changes before they reach protected branches. Eligibility is calculated from revisions, approvals, conflicts, linked work, QA, and build policy." tone={(payload?.reviews || []).some((review) => review.status === "open" && review.eligibilityState === "ready") ? "accent" : "neutral"}>
            {focusedReviewId && payload?.reviews && !payload.reviews.some((review) => review.id === focusedReviewId) && linkedReview?.id !== focusedReviewId ? <ProjectSectionStatus tone="warning">The requested source review is no longer available in this Project. It may have been removed or you may no longer have access. <ClusterButton size="compact" variant="quiet" onClick={() => setFocusedReviewId(null)}>Show all reviews</ClusterButton></ProjectSectionStatus> : null}
            <div className="project-team-grid-v312">
              {([...(linkedReview && !payload?.reviews?.some((review) => review.id === linkedReview.id) ? [linkedReview] : []), ...(payload?.reviews || [])]).map((review) => <article key={review.id} id={`cluster-source-review-${review.id}`} data-focused={focusedReviewId === review.id ? "true" : undefined} tabIndex={-1} aria-label={`Source review: ${review.title}`} className="project-member-v312 cluster-source-review-v536">
                <div><strong>{review.title}</strong><span className={`soft-pill ${review.status === "merged" ? "good" : review.eligibilityState === "ready" ? "accent" : review.eligibilityState === "conflicted" ? "danger" : "warning"}`}>{review.status === "open" ? review.eligibilityState : review.status}</span></div>
                <small>{review.sourceBranch} → {review.targetBranch} · {review.sourceRevision.slice(0, 12)} → {review.targetRevision.slice(0, 12)}</small><div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant="quiet" onClick={() => void copySourceLink("source_review", review.id)}>Copy link</ClusterButton></div>
                <small>{review.changeSummary?.commits || 0} commits · {review.changeSummary?.files || 0} files · {review.changeSummary?.approvals || 0}/{review.changeSummary?.requiredApprovals ?? policy?.requiredApprovals ?? 1} approvals · {review.changeSummary?.linkedWork || 0} links</small>
                {review.status === "open" ? <p className="muted">{review.eligibilityMessage || "Checking merge eligibility."}</p> : review.mergedRevision ? <p className="muted">Merged as {review.mergedRevision.slice(0, 12)} {review.mergedAt ? `· ${relativeTime(review.mergedAt)}` : ""}</p> : null}
                {review.status === "open" ? <><div className="project-form-grid-v312"><PeopleMultiPicker label="Requested reviewers" values={review.reviewerIds || []} onChange={(values) => void updateReviewAssignments(review, values, review.reviewerTeamIds || [])} people={users} disabled={!canContribute || busy} /><div className="field"><label>Reviewer teams</label><ClusterMultiSelect values={review.reviewerTeamIds || []} onChange={(values) => void updateReviewAssignments(review, review.reviewerIds || [], values)} options={teams.map((team) => ({ value: team.id, label: team.name }))} ariaLabel={`${review.title} reviewer teams`} placeholder="Add reviewer team" disabled={!canContribute || busy || !teams.length} /></div></div><label><span>Review note</span><ClusterTextInput value={reviewComments[review.id] || ""} onChange={(event) => setReviewComments((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="Review note (required to request changes)" disabled={!canContribute || busy} /></label><div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant={discussionReviewId === review.id ? "secondary" : "quiet"} disabled={busy} onClick={() => setDiscussionReviewId((current) => current === review.id ? null : review.id)}>{discussionReviewId === review.id ? "Hide discussion" : "Discussion"}</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void refreshReview(review.id)}>Refresh</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={!canContribute || busy || !(reviewComments[review.id] || "").trim()} onClick={() => void reviewDecision(review, "changes_requested")}>Request changes</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={!canContribute || busy} onClick={() => void reviewDecision(review, "approved")}>Approve</ClusterButton><ClusterButton size="compact" variant="primary" disabled={!canManage || busy || review.eligibilityState !== "ready"} onClick={() => void mergeReview(review.id)}>Merge</ClusterButton></div></> : null}
                {review.status === "open" && discussionReviewId === review.id ? <CollaborationPanel title="Review discussion" entityType="source_review" entityId={review.id} users={users} currentUser={currentUser} compact /> : null}
              </article>)}
              {!payload?.reviews?.length && !linkedReview ? <p className="muted">Push a project branch and open a review when changes are ready for approval.</p> : null}
            </div>
          </ProjectSurface>

          <ProjectSurface title="Branch policy" description="The default branch is always protected. Additional protection and work-link rules are project-owned." tone="neutral">
            {canManage ? <div className="project-form-grid-v312">
              <label><span>Additional protected patterns</span><ClusterTextInput value={policyDraft.protectedPatterns} onChange={(event) => setPolicyDraft((current) => ({ ...current, protectedPatterns: event.target.value }))} placeholder="release/*, hotfix/locked-*" /></label>
              <label><span>Suggested branch prefixes</span><ClusterTextInput value={policyDraft.branchPrefixes} onChange={(event) => setPolicyDraft((current) => ({ ...current, branchPrefixes: event.target.value }))} placeholder="feature/, fix/, hotfix/" /></label>
              <label className="tool-check compact"><ClusterInput type="checkbox" checked={policyDraft.allowDirectPush} onChange={(event) => setPolicyDraft((current) => ({ ...current, allowDirectPush: event.target.checked }))} /> Allow direct push to unprotected branches</label>
              <label className="tool-check compact"><ClusterInput type="checkbox" checked={policyDraft.requireLinkedWorkItem} onChange={(event) => setPolicyDraft((current) => ({ ...current, requireLinkedWorkItem: event.target.checked }))} /> Require linked project work before push or merge</label>
              <label><span>Required review approvals</span><ClusterNativeSelect value={String(policyDraft.requiredApprovals)} onChange={(event) => setPolicyDraft((current) => ({ ...current, requiredApprovals: Number(event.target.value) }))}>{[0,1,2,3,4,5].map((count) => <option key={count} value={count}>{count}</option>)}</ClusterNativeSelect></label>
              <label className="tool-check compact"><ClusterInput type="checkbox" checked={policyDraft.requireQa} onChange={(event) => setPolicyDraft((current) => ({ ...current, requireQa: event.target.checked }))} /> Require linked QA evidence before merge</label>
              <label className="tool-check compact"><ClusterInput type="checkbox" checked={policyDraft.requireBuild} onChange={(event) => setPolicyDraft((current) => ({ ...current, requireBuild: event.target.checked }))} /> Require a linked build before merge</label>
              <ClusterButton variant="primary" disabled={busy} onClick={() => void savePolicy()}>Save branch policy</ClusterButton>
            </div> : <dl className="project-form-grid-v312"><div><dt>Protected</dt><dd>{policy?.protectedPatterns.join(", ") || repository.defaultBranch}</dd></div><div><dt>Direct push</dt><dd>{policy?.allowDirectPush === false ? "Disabled" : "Unprotected branches only"}</dd></div><div><dt>Linked work</dt><dd>{policy?.requireLinkedWorkItem ? "Required" : "Optional"}</dd></div><div><dt>Review approvals</dt><dd>{policy?.requiredApprovals ?? 1}</dd></div><div><dt>QA evidence</dt><dd>{policy?.requireQa ? "Required" : "Optional"}</dd></div><div><dt>Build</dt><dd>{policy?.requireBuild ? "Required" : "Optional"}</dd></div><div><dt>Force push</dt><dd>Disabled</dd></div></dl>}
          </ProjectSurface>

          <ProjectSurface title="Branches" description="Remote branch heads are synchronized from the linked source-control adapter." tone="neutral">
            <div className="project-team-grid-v312">
              {(payload?.branches || []).map((branch) => <article key={branch.id} className="project-member-v312"><div><strong>{branch.name}</strong>{branch.isDefault ? <span className="soft-pill good">Default</span> : null}{branch.protected ? <span className="soft-pill">Provider protected</span> : null}</div><code>{branch.headRevision?.slice(0, 12) || "unknown"}</code><small>{branch.lastCommitAt ? relativeTime(branch.lastCommitAt) : branch === defaultBranch ? "Current default branch" : "No commit time cached"}</small></article>)}
              {!payload?.branches.length ? <p className="muted">Synchronize the repository to load branch state.</p> : null}
            </div>
          </ProjectSurface>

          <ProjectSurface title="Recent commits" description="Recent history from the default branch, with file changes and project links cached by Cluster." tone="neutral">
            <div className="project-team-grid-v312">
              {([...(linkedCommit && !payload?.commits?.some((commit) => commit.id === linkedCommit.id) ? [linkedCommit] : []), ...(payload?.commits || [])]).map((commit) => {
                const expanded = expandedCommitId === commit.id;
                const changes = commit.changes || commitChangesById[commit.id];
                const linkCount = payload?.links?.filter((link) => link.commitId === commit.id).length || 0;
                return <article key={commit.id} id={`cluster-source-commit-${commit.id}`} tabIndex={-1} data-focused={focusedCommitId === commit.id ? "true" : undefined} className="project-member-v312"><ClusterButton unstyled type="button" className="project-resource-card-v312" aria-expanded={expanded} onClick={() => void toggleCommit(commit)}><code>{commit.shortRevision}</code><span><strong>{commit.message.split("\n")[0]}</strong><small>{commit.authorName || "Unknown author"} · {relativeTime(commit.committedAt)} · {commit.filesChanged ?? changes?.length ?? 0} files · {linkCount} links</small></span><span className="soft-pill">+{commit.additions || 0} / -{commit.deletions || 0}</span></ClusterButton><div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant="quiet" onClick={() => void copySourceLink("source_commit", commit.id)}>Copy link</ClusterButton></div>{expanded ? <div className="project-member-skills-v312">{loadingCommitId === commit.id && !changes ? <p className="muted">Loading file changes…</p> : changes?.length ? changes.map((change) => <div key={change.id}><span className={`soft-pill ${change.changeType === "added" ? "good" : change.changeType === "deleted" ? "warning" : ""}`}>{change.changeType}</span><code>{change.path}</code><small>{change.binary ? "binary" : change.additions == null && change.deletions == null ? "Locally committed change" : `+${change.additions || 0} / -${change.deletions || 0}`}</small></div>) : <p className="muted">No file-level diff is cached for this commit.</p>}</div> : null}</article>;
              })}
              {!payload?.commits.length && !linkedCommit ? <p className="muted">Synchronize the repository to load recent commit history.</p> : null}
            </div>
          </ProjectSurface>

          <ProjectSurface title="Operations" description="Synchronization and write actions keep durable receipts, progress, and failures." tone="neutral">
            <div className="project-team-grid-v312">{(payload?.operations || []).slice(0, 12).map((operation) => <article key={operation.id} className="project-member-v312"><span className={`soft-pill ${operationTone(operation.status)}`}>{operation.status}</span><strong>{sourceOperationLabel(operation)}</strong><span>{operation.progress}%</span><small>{operation.lastError || operation.progressMessage || relativeTime(operation.createdAt)}</small></article>)}</div>
          </ProjectSurface>
        </>
      ) : (
        <ProjectSurface title="No repository linked" description="Choose a studio-managed repository in Connections. Credentials and provider settings remain in Tool Infrastructure > Source Control." tone="warning">
          <ClusterButton variant="primary" onClick={onOpenConnections}>Open Connections</ClusterButton>
        </ProjectSurface>
      )}
    </section>
  );
}
