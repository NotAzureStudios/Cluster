import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterOperationFeedback } from "../../components/ClusterOperationFeedback";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import {
  attachNativeRepository,
  cancelNativeLocalGitOperation,
  cloneNativeLocalRepository,
  createNativeLocalWorkspace,
  discoverNativeRepositories,
  getNativeLocalGitDiff,
  getNativeLocalGitDetails,
  getNativeLocalGitLfsHealth,
  getNativeLocalGitLfsPolicy,
  getNativeLocalGitStatus,
  scanNativeLocalGitSecrets,
  getNativeWorkstationStatus,
  getNativeLocalHardwareCapabilities,
  listNativeLocalTaskDefinitions,
  listNativeLocalTaskOperations,
  runNativeLocalTask,
  cancelNativeLocalTaskOperation,
  initializeNativeLocalGit,
  listNativeLocalGitOperations,
  subscribeNativeLocalGitOperations,
  listNativeLocalWorkspaces,
  mutateNativeLocalGit,
  pickNativeDirectory,
  removeNativeLocalWorkspace,
  startNativeLocalGitOperation,
  setNativeLocalRepositoryTrust,
  type ClusterLocalGitDetails,
  type ClusterLocalGitDiff,
  type ClusterLocalGitLfsHealth,
  type ClusterLocalGitLfsPolicy,
  type ClusterLocalSecretScanResult,
  type ClusterLocalGitMutationAction,
  type ClusterLocalGitOperation,
  type ClusterLocalTaskDefinition,
  type ClusterLocalTaskOperation,
  type ClusterLocalHardwareCapabilities,
  type ClusterLocalGitStatus,
  type ClusterLocalRepositoryCandidate,
  type ClusterLocalWorkspace,
  type ClusterWorkstationServiceStatus,
} from "../../core/desktop";
import { useVisibleRefresh } from "../../core/visible-refresh";
import "./desktop-workstation.css";

type RepoInspection = {
  loading?: boolean;
  git?: ClusterLocalGitStatus;
  details?: ClusterLocalGitDetails;
  lfs?: ClusterLocalGitLfsHealth;
  lfsPolicy?: ClusterLocalGitLfsPolicy;
  error?: string;
};

type CandidateState = {
  repositories: ClusterLocalRepositoryCandidate[];
  expiresInSeconds: number;
};

type GitDraft = {
  commitMessage: string;
  branchName: string;
  tagName: string;
  upstream: string;
  lfsPattern: string;
  lfsLockPath: string;
  ignorePattern: string;
  attributePattern: string;
  target: string;
  stashMessage: string;
  remoteName: string;
  remoteUrl: string;
  remoteNextName: string;
};

const emptyGitDraft = (): GitDraft => ({ commitMessage: "", branchName: "", tagName: "", upstream: "", lfsPattern: "", lfsLockPath: "", ignorePattern: "", attributePattern: "", target: "", stashMessage: "", remoteName: "", remoteUrl: "", remoteNextName: "" });

function repoKey(workspaceId: string, repositoryId: string) {
  return `${workspaceId}:${repositoryId}`;
}

function localOperationFeedbackState(operation: { status: string }): "idle" | "working" | "success" | "error" {
  if (operation.status === "queued" || operation.status === "running") return "working";
  if (operation.status === "succeeded") return "success";
  if (operation.status === "failed" || operation.status === "dead-letter") return "error";
  return "idle";
}

function formatStartedAt(value?: string) {
  if (!value) return "Starting…";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function DesktopWorkstationPanel() {
  const [status, setStatus] = useState<ClusterWorkstationServiceStatus | null>(null);
  const [hardware, setHardware] = useState<ClusterLocalHardwareCapabilities | null>(null);
  const [workspaces, setWorkspaces] = useState<ClusterLocalWorkspace[]>([]);
  const [candidates, setCandidates] = useState<Record<string, CandidateState>>({});
  const [inspections, setInspections] = useState<Record<string, RepoInspection>>({});
  const [operations, setOperations] = useState<ClusterLocalGitOperation[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<Record<string, ClusterLocalTaskDefinition[]>>({});
  const [taskOperations, setTaskOperations] = useState<ClusterLocalTaskOperation[]>([]);
  const [diffs, setDiffs] = useState<Record<string, ClusterLocalGitDiff>>({});
  const [secretScans, setSecretScans] = useState<Record<string, ClusterLocalSecretScanResult>>({});
  const [gitDrafts, setGitDrafts] = useState<Record<string, GitDraft>>({});
  const [cloneWorkspaceId, setCloneWorkspaceId] = useState("");
  const [cloneRemote, setCloneRemote] = useState("");
  const [cloneDestination, setCloneDestination] = useState("");
  const [cloneStrategy, setCloneStrategy] = useState<"full" | "current" | "lightweight">("current");
  const [busyAction, setBusyAction] = useState("");
  // State updates do not synchronously disable buttons during the initiating click.
  // Lock the native intent before sending it, including commits, clone, and task execution.
  const inFlightMutations = useRef(new Set<string>());
  function claimNativeIntent(key: string): boolean {
    if (inFlightMutations.current.has(key)) return false;
    inFlightMutations.current.add(key);
    return true;
  }
  function releaseNativeIntent(key: string): void { inFlightMutations.current.delete(key); }
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextWorkspaces, nextHardware] = await Promise.all([getNativeWorkstationStatus(), listNativeLocalWorkspaces(), getNativeLocalHardwareCapabilities()]);
      setStatus(nextStatus);
      setWorkspaces(nextWorkspaces);
      setHardware(nextHardware);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Workstation Service is unavailable.");
    }
  }, []);

  const refreshOperations = useCallback(async () => {
    try {
      const [gitOperations, localTasks] = await Promise.all([listNativeLocalGitOperations(), listNativeLocalTaskOperations()]);
      setOperations(gitOperations);
      setTaskOperations(localTasks);
    } catch { /* service status message owns availability */ }
  }, []);

  useEffect(() => { void refresh(); void refreshOperations(); }, [refresh, refreshOperations]);
  useEffect(() => subscribeNativeLocalGitOperations((event) => setOperations(event.operations || [])), []);
  const hasActiveOperations = useMemo(
    () => operations.some((item) => ["queued", "running"].includes(String(item.status)))
      || taskOperations.some((item) => ["queued", "running"].includes(String(item.status))),
    [operations, taskOperations],
  );
  useVisibleRefresh(() => refresh(), { enabled: true, intervalMs: 30_000 });
  // Native Desktop pushes operation snapshots while Git work is active. Keep a slow
  // safety reconciliation in case the helper restarts or an operation originated
  // from another local client such as Unreal. Idle sessions remain quiet.
  useVisibleRefresh(() => refreshOperations(), { enabled: hasActiveOperations, intervalMs: 15_000, minimumGapMs: 5_000 });
  useVisibleRefresh(() => refreshOperations(), { enabled: !hasActiveOperations, intervalMs: 60_000, minimumGapMs: 10_000 });

  const repositoryCount = useMemo(() => workspaces.reduce((sum, workspace) => sum + workspace.repositories.length, 0), [workspaces]);

  function updateGitDraft(workspaceId: string, repositoryId: string, patch: Partial<GitDraft>) {
    const key = repoKey(workspaceId, repositoryId);
    setGitDrafts((current) => ({ ...current, [key]: { ...(current[key] || emptyGitDraft()), ...patch } }));
  }

  async function addWorkspace() {
    setBusyAction("create");
    setMessage("");
    try {
      const selected = await pickNativeDirectory({ title: "Choose a local Cluster workspace" });
      if (!selected) return;
      await createNativeLocalWorkspace({ handle: selected.handle, name: selected.name });
      setMessage(`${selected.name} is registered as a device-local workspace. Cluster stores the path only in the Workstation Service.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The local workspace could not be registered.");
    } finally {
      setBusyAction("");
    }
  }

  async function discover(workspaceId: string) {
    setBusyAction(`discover:${workspaceId}`);
    setMessage("");
    try {
      const result = await discoverNativeRepositories(workspaceId, 4);
      setCandidates((current) => ({ ...current, [workspaceId]: result }));
      setMessage(result.repositories.length
        ? `Found ${result.repositories.length} Git ${result.repositories.length === 1 ? "repository" : "repositories"} inside the approved workspace root.`
        : "No unattached Git repositories were found inside the approved workspace root.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repository discovery failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function attach(workspaceId: string, candidateId: string) {
    setBusyAction(`attach:${candidateId}`);
    setMessage("");
    try {
      const updated = await attachNativeRepository(workspaceId, candidateId);
      setWorkspaces((current) => current.map((workspace) => workspace.id === updated.id ? updated : workspace));
      setCandidates((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] || { repositories: [], expiresInSeconds: 0 }),
          repositories: (current[workspaceId]?.repositories || []).filter((candidate) => candidate.candidateId !== candidateId),
        },
      }));
      setMessage("Repository attached to the local workspace registry.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The repository could not be attached.");
    } finally {
      setBusyAction("");
    }
  }

  async function inspectRepository(workspaceId: string, repositoryId: string) {
    const key = repoKey(workspaceId, repositoryId);
    setInspections((current) => ({ ...current, [key]: { ...current[key], loading: true, error: undefined } }));
    try {
      const [gitResult, detailsResult, lfsResult, lfsPolicyResult] = await Promise.allSettled([
        getNativeLocalGitStatus(workspaceId, repositoryId),
        getNativeLocalGitDetails(workspaceId, repositoryId),
        getNativeLocalGitLfsHealth(workspaceId, repositoryId),
        getNativeLocalGitLfsPolicy(workspaceId, repositoryId),
      ]);
      const error = [gitResult, detailsResult, lfsResult, lfsPolicyResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "")
        .filter(Boolean)
        .join(" · ");
      setInspections((current) => ({
        ...current,
        [key]: {
          loading: false,
          git: gitResult.status === "fulfilled" ? gitResult.value : undefined,
          details: detailsResult.status === "fulfilled" ? detailsResult.value : undefined,
          lfs: lfsResult.status === "fulfilled" ? lfsResult.value : undefined,
          lfsPolicy: lfsPolicyResult.status === "fulfilled" ? lfsPolicyResult.value : undefined,
          error: error || undefined,
        },
      }));
    } catch (error) {
      setInspections((current) => ({ ...current, [key]: { loading: false, error: error instanceof Error ? error.message : "Repository inspection failed." } }));
    }
  }

  async function initializeGit(workspaceId: string) {
    const intent = `init:${workspaceId}`;
    if (!claimNativeIntent(intent)) return;
    setBusyAction(intent);
    setMessage("");
    try {
      const result = await initializeNativeLocalGit(workspaceId);
      setWorkspaces((current) => current.map((workspace) => workspace.id === result.workspace.id ? result.workspace : workspace));
      setMessage("Git repository initialized in the approved workspace root and marked trusted because Cluster created the repository metadata.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Git could not be initialized in this workspace.");
    } finally {
      releaseNativeIntent(intent);
      setBusyAction("");
    }
  }

  async function setRepositoryTrust(workspaceId: string, repositoryId: string, trusted: boolean) {
    setBusyAction(`trust:${repositoryId}`);
    setMessage("");
    try {
      const updated = await setNativeLocalRepositoryTrust(workspaceId, repositoryId, trusted);
      setWorkspaces((current) => current.map((workspace) => workspace.id === updated.id ? updated : workspace));
      setMessage(trusted
        ? "Repository trusted for future local mutation/tool workflows on this device. Trust does not bypass Cluster server permissions."
        : "Repository returned to untrusted mode. Read-only inspection remains available.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repository trust could not be updated.");
    } finally {
      setBusyAction("");
    }
  }

  async function cloneRepository(workspaceId: string) {
    const remote = cloneRemote.trim();
    const destinationName = cloneDestination.trim();
    if (!remote || !destinationName) {
      setMessage("Remote and destination folder are required to clone a repository.");
      return;
    }
    const intent = `clone:${workspaceId}`;
    if (!claimNativeIntent(intent)) return;
    setBusyAction(intent);
    setMessage("");
    try {
      const operation = await cloneNativeLocalRepository(workspaceId, remote, destinationName, cloneStrategy);
      setOperations((current) => [operation, ...current.filter((item) => item.id !== operation.id)]);
      setCloneRemote("");
      setCloneDestination("");
      setCloneStrategy("current");
      setCloneWorkspaceId("");
      setMessage("Clone accepted by the background Workstation Service. The new repository will remain untrusted until you explicitly trust it after inspection.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Git clone could not be started.");
    } finally {
      releaseNativeIntent(intent);
      setBusyAction("");
    }
  }

  async function runGitOperation(workspaceId: string, repositoryId: string, action: "fetch" | "pull" | "push" | "lfs.fetch.current" | "lfs.fetch.recent" | "lfs.checkout" | "lfs.locks" | "lfs.lock" | "lfs.unlock", relativePath?: string) {
    const intent = `gitop:${repositoryId}:${action}:${relativePath || "repo"}`;
    if (!claimNativeIntent(intent)) return;
    setBusyAction(intent);
    setMessage("");
    try {
      const operation = await startNativeLocalGitOperation(workspaceId, repositoryId, action, relativePath);
      setOperations((current) => [operation, ...current.filter((item) => item.id !== operation.id)]);
      setMessage(`Git ${action.replace("lfs.", "LFS ")} accepted by the background Workstation Service. You can close the visible Desktop window without cancelling it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Git ${action} could not be started.`);
    } finally {
      releaseNativeIntent(intent);
      setBusyAction("");
    }
  }

  async function runSecretScan(workspaceId: string, repositoryId: string, scope: "staged" | "outgoing") {
    setBusyAction(`secretscan:${repositoryId}:${scope}`);
    setMessage("");
    try {
      const result = await scanNativeLocalGitSecrets(workspaceId, repositoryId, scope);
      setSecretScans((current) => ({ ...current, [`${repoKey(workspaceId, repositoryId)}:${scope}`]: result }));
      setMessage(result.blocked
        ? `${scope === "staged" ? "Staged" : "Outgoing"} secret scan blocked: ${result.blockCount} high-confidence finding${result.blockCount === 1 ? "" : "s"}.`
        : `${scope === "staged" ? "Staged" : "Outgoing"} secret scan passed with ${result.warningCount} review warning${result.warningCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Secret scan could not complete safely.");
    } finally {
      setBusyAction("");
    }
  }

  async function runGitMutation(
    workspaceId: string,
    repositoryId: string,
    action: ClusterLocalGitMutationAction,
    input: { relativePath?: string; message?: string; name?: string; upstream?: string; pattern?: string; target?: string; remote?: string; url?: string; nextName?: string; stashRef?: string; hunkId?: string; confirmed?: boolean } = {},
  ) {
    const actionKey = `gitmut:${repositoryId}:${action}:${input.relativePath || input.name || input.upstream || input.target || input.remote || input.stashRef || "repo"}`;
    if (!claimNativeIntent(actionKey)) return;
    setBusyAction(actionKey);
    setMessage("");
    try {
      const result = await mutateNativeLocalGit(workspaceId, repositoryId, action, input);
      const key = repoKey(workspaceId, repositoryId);
      setInspections((current) => ({
        ...current,
        [key]: { ...current[key], loading: false, git: result.status, details: result.details, error: undefined },
      }));
      if (action === "commit" || action === "amend") updateGitDraft(workspaceId, repositoryId, { commitMessage: "" });
      if (action === "branch.create") updateGitDraft(workspaceId, repositoryId, { branchName: "" });
      if (action === "tag.create") updateGitDraft(workspaceId, repositoryId, { tagName: "" });
      if (action === "stash.push") updateGitDraft(workspaceId, repositoryId, { stashMessage: "" });
      if (action === "remote.add") updateGitDraft(workspaceId, repositoryId, { remoteName: "", remoteUrl: "" });
      if (action === "remote.rename") updateGitDraft(workspaceId, repositoryId, { remoteNextName: "" });
      if (action === "lfs.track" || action === "lfs.untrack" || action === "lfs.track-lockable") updateGitDraft(workspaceId, repositoryId, { lfsPattern: "" });
      if (action === "ignore.add" || action === "ignore.remove") updateGitDraft(workspaceId, repositoryId, { ignorePattern: "" });
      if (action.startsWith("attributes.")) updateGitDraft(workspaceId, repositoryId, { attributePattern: "" });
      if (action.startsWith("lfs.")) {
        // The Git mutation already committed. A failed follow-up inspection must
        // not label the mutation as failed and encourage a dangerous retry.
        try {
          const [lfsPolicy, lfs] = await Promise.all([getNativeLocalGitLfsPolicy(workspaceId, repositoryId), getNativeLocalGitLfsHealth(workspaceId, repositoryId)]);
          setInspections((current) => ({ ...current, [key]: { ...current[key], lfsPolicy, lfs } }));
        } catch (refreshError) {
          setMessage(`Git ${action.replace(".", " ")} completed locally, but LFS status could not be refreshed: ${refreshError instanceof Error ? refreshError.message : "Refresh unavailable"}. Reopen repository inspection to reconcile; do not repeat the mutation.`);
          return;
        }
      }
      if (action.startsWith("hunk.") && input.relativePath) {
        const prefix = `${key}:`;
        const suffix = `:${input.relativePath}`;
        setDiffs((current) => Object.fromEntries(Object.entries(current).filter(([diffKey]) => !(diffKey.startsWith(prefix) && diffKey.endsWith(suffix)))));
      }
      setMessage(`Git ${action.replace(".", " ")} completed locally.${result.message ? ` ${result.message}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Git ${action} failed.`);
    } finally {
      releaseNativeIntent(actionKey);
      setBusyAction("");
    }
  }

  async function showGitDiff(workspaceId: string, repositoryId: string, relativePath: string, staged: boolean) {
    const key = `${repoKey(workspaceId, repositoryId)}:${staged ? "staged" : "worktree"}:${relativePath}`;
    setBusyAction(`diff:${key}`);
    try {
      const result = await getNativeLocalGitDiff(workspaceId, repositoryId, relativePath, staged);
      setDiffs((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Git diff could not be loaded.");
    } finally {
      setBusyAction("");
    }
  }

  async function loadRepositoryTasks(workspaceId: string, repositoryId: string) {
    const key = repoKey(workspaceId, repositoryId);
    setBusyAction(`tasks:${repositoryId}`);
    setMessage("");
    try {
      const definitions = await listNativeLocalTaskDefinitions(workspaceId, repositoryId);
      setTaskDefinitions((current) => ({ ...current, [key]: definitions }));
      setMessage(definitions.length ? `Loaded ${definitions.length} repository ${definitions.length === 1 ? "task" : "tasks"} from .cluster/tasks.json.` : "This trusted repository does not declare any Cluster local tasks.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repository tasks could not be loaded.");
    } finally {
      setBusyAction("");
    }
  }

  async function runRepositoryTask(workspaceId: string, repositoryId: string, taskId: string) {
    const intent = `taskrun:${repositoryId}:${taskId}`;
    if (!claimNativeIntent(intent)) return;
    setBusyAction(intent);
    setMessage("");
    try {
      const operation = await runNativeLocalTask(workspaceId, repositoryId, taskId);
      setTaskOperations((current) => [operation, ...current.filter((item) => item.id !== operation.id)]);
      setMessage("Repository task accepted by the background Workstation Service. The manifest is revalidated again at execution time.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The repository task could not be started.");
    } finally {
      releaseNativeIntent(intent);
      setBusyAction("");
    }
  }

  async function cancelRepositoryTask(operationId: string) {
    setBusyAction(`taskcancel:${operationId}`);
    try {
      await cancelNativeLocalTaskOperation(operationId);
      await refreshOperations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The repository task could not be cancelled.");
    } finally {
      setBusyAction("");
    }
  }

  async function discardGitChange(workspaceId: string, repositoryId: string, relativePath: string) {
    const confirmed = await confirmCluster({ title: "Discard local changes?", message: `Discard local changes to ${relativePath}? This cannot be undone by Cluster.`, confirmLabel: "Discard changes", tone: "danger" });
    if (!confirmed) return;
    await runGitMutation(workspaceId, repositoryId, "discard", { relativePath, confirmed: true });
  }

  async function cancelGitOperation(operationId: string) {
    setBusyAction(`cancel:${operationId}`);
    try {
      await cancelNativeLocalGitOperation(operationId);
      await refreshOperations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Git operation could not be cancelled.");
    } finally {
      setBusyAction("");
    }
  }

  async function forgetWorkspace(workspaceId: string) {
    setBusyAction(`remove:${workspaceId}`);
    setMessage("");
    try {
      await removeNativeLocalWorkspace(workspaceId);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setCandidates((current) => {
        const next = { ...current };
        delete next[workspaceId];
        return next;
      });
      setMessage("Local workspace registration removed. No files or repositories were deleted from disk.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The local workspace registration could not be removed.");
    } finally {
      setBusyAction("");
    }
  }

  return <section className="desktop-workstation-v9m" aria-label="Cluster Workstation Service">
    <header className="desktop-workstation-header-v9m">
      <div>
        <p className="eyebrow">Workstation runtime</p>
        <h2>Local workspaces & Git</h2>
        <p>Approved local roots, repository discovery, and Git/LFS health run through Cluster&apos;s background Workstation Service. Browser code never receives raw filesystem paths.</p>
      </div>
      <div className="desktop-workstation-actions-v9m">
        <span className={`desktop-mount-state-v481 ${status ? "ready" : "planned"}`}>{status ? "Service online" : "Starting service"}</span>
        <ClusterButton type="button" variant="primary" busy={busyAction === "create"} busyLabel="Choosing…" onClick={() => void addWorkspace()}>Add local workspace</ClusterButton>
      </div>
    </header>

    <div className="desktop-workstation-summary-v9m">
      <div><span>Process lifetime</span><strong>{status?.backgroundIndependent ? "Background independent" : "Checking…"}</strong><small>{status ? `PID ${status.pid} · started ${formatStartedAt(status.startedAt)}` : "Desktop will start the service on demand."}</small></div>
      <div><span>IPC boundary</span><strong>{status?.authenticatedLocalIpc ? "Authenticated local IPC" : "Checking…"}</strong><small>{status?.rawPathExposure === false ? "Raw paths stay native-side" : "Path policy unavailable"}</small></div>
      <div><span>Background auth</span><strong>{status ? (status.sessionLeaseCount ? "Memory-only lease active" : "No active lease") : "Checking…"}</strong><small>Session secrets are never exposed to the renderer or persisted by the Workstation Service.</small></div>
      <div><span>Local compute</span><strong>{hardware ? `${hardware.logicalCpuCount} logical CPUs` : "Checking…"}</strong><small>{hardware ? `${hardware.architecture} · ${hardware.kernelType} · no process or stable-ID enumeration` : "Hardware capability evidence stays non-identifying."}</small></div>
      <div><span>Local workspaces</span><strong>{workspaces.length}</strong><small>{repositoryCount} attached {repositoryCount === 1 ? "repository" : "repositories"}</small></div>
      <div><span>Service protocol</span><strong>{status ? `v${status.protocol}` : "…"}</strong><small>{status?.version || "Waiting for runtime status"}</small></div>
    </div>

    {!workspaces.length ? <div className="desktop-workstation-empty-v9m">
      <strong>No local workspaces registered</strong>
      <span>Choose a project folder or a parent folder that contains repositories. Discovery remains bounded to that approved root.</span>
      <ClusterButton type="button" variant="secondary" onClick={() => void addWorkspace()} disabled={busyAction === "create"}>Choose folder</ClusterButton>
    </div> : <div className="desktop-workstation-list-v9m">
      {workspaces.map((workspace) => {
        const workspaceCandidates = candidates[workspace.id];
        return <article key={workspace.id} className="desktop-workstation-card-v9m">
          <header>
            <div><h3>{workspace.name}</h3><p>{workspace.rootName} · {workspace.repositories.length} attached {workspace.repositories.length === 1 ? "repository" : "repositories"}</p></div>
            <div className="desktop-workstation-actions-v9m">
              {!workspace.repositories.some((repository) => repository.relativePath === ".") && <ClusterButton size="compact" variant="secondary" busy={busyAction === `init:${workspace.id}`} busyLabel="Initializing…" onClick={() => void initializeGit(workspace.id)}>Initialize Git here</ClusterButton>}
              <ClusterButton size="compact" variant="secondary" selected={cloneWorkspaceId === workspace.id} onClick={() => setCloneWorkspaceId((current) => current === workspace.id ? "" : workspace.id)}>Clone repository</ClusterButton>
              <ClusterButton size="compact" variant="secondary" busy={busyAction === `discover:${workspace.id}`} busyLabel="Scanning…" onClick={() => void discover(workspace.id)}>Discover repositories</ClusterButton>
              <ClusterButton size="compact" variant="quiet" busy={busyAction === `remove:${workspace.id}`} busyLabel="Removing…" onClick={() => void forgetWorkspace(workspace.id)}>Forget</ClusterButton>
            </div>
          </header>

          {cloneWorkspaceId === workspace.id && <div className="desktop-workstation-clone-v9m">
            <label><span>Remote</span><ClusterTextInput value={cloneRemote} placeholder="https://host/org/repository.git or git@host:org/repository.git" onChange={(event) => setCloneRemote(event.target.value)} /></label>
            <label><span>Destination folder</span><ClusterTextInput value={cloneDestination} placeholder="repository-name" onChange={(event) => setCloneDestination(event.target.value)} /></label>
            <label><span>Clone strategy</span><ClusterSelect ariaLabel="Git clone strategy" value={cloneStrategy} onChange={(value) => setCloneStrategy(value as "full" | "current" | "lightweight")} options={[{ value: "full", label: "Full repository" }, { value: "current", label: "Current/default branch" }, { value: "lightweight", label: "Lightweight · defer LFS" }]} /></label>
            <div><small>{cloneStrategy === "full" ? "Clone normal repository history and refs. Best when you need the complete local repo immediately." : cloneStrategy === "lightweight" ? "Use partial Git clone + one branch and defer Git LFS object hydration. Best for huge game/art repos when you want to inspect first." : "Clone only the remote default branch. This is the balanced default for most workstations."} HTTPS credentials in clone URLs are rejected; SSH uses your workstation&apos;s SSH agent/config.</small><ClusterButton size="compact" variant="primary" busy={busyAction === `clone:${workspace.id}`} busyLabel="Starting clone…" onClick={() => void cloneRepository(workspace.id)}>Start background clone</ClusterButton></div>
          </div>}

          {operations.filter((operation) => operation.workspaceId === workspace.id && operation.kind === "git.clone").slice(0, 2).map((operation) => <div key={operation.id} className={`desktop-workstation-operation-v9m ${operation.state}`}>
            <div className="desktop-workstation-operation-head-v9m"><div><strong>Git clone · {operation.targetLabel || "repository"}</strong><span>{operation.stage} · {operation.state}{operation.result?.cloneStrategy ? ` · ${operation.result.cloneStrategy}` : ""}{operation.result?.lfsHydrationDeferred ? " · LFS hydration deferred" : ""}</span></div>{["queued", "running", "cancelling"].includes(operation.state) && <ClusterButton size="compact" variant="quiet" disabled={operation.state === "cancelling"} busy={busyAction === `cancel:${operation.id}`} busyLabel="Cancelling…" onClick={() => void cancelGitOperation(operation.id)}>Cancel</ClusterButton>}</div>
            <ClusterOperationFeedback state={localOperationFeedbackState(operation)} message={operation.progressMessage || operation.stage} detail={operation.message || "Waiting for clone progress…"} progress={operation.status === "queued" || operation.status === "running" ? operation.progress : operation.status === "succeeded" ? 100 : null} />
          </div>)}

          {workspace.projectRefs.length > 0 && <div className="desktop-workstation-projects-v9m"><span>Linked Cluster projects</span><strong>{workspace.projectRefs.length}</strong></div>}

          {workspaceCandidates && <div className="desktop-workstation-candidates-v9m">
            <div className="desktop-workstation-section-title-v9m"><strong>Discovered repositories</strong><span>Candidates expire in {workspaceCandidates.expiresInSeconds}s</span></div>
            {!workspaceCandidates.repositories.length && <p>No unattached repositories found in the approved root.</p>}
            {workspaceCandidates.repositories.map((candidate) => <div key={candidate.candidateId} className="desktop-workstation-candidate-v9m">
              <div><strong>{candidate.name}</strong><span>{candidate.relativePath}</span></div>
              <ClusterButton size="compact" variant="secondary" busy={busyAction === `attach:${candidate.candidateId}`} busyLabel="Attaching…" onClick={() => void attach(workspace.id, candidate.candidateId)}>Attach</ClusterButton>
            </div>)}
          </div>}

          <div className="desktop-workstation-repositories-v9m">
            {!workspace.repositories.length && <p className="desktop-workstation-muted-v9m">No repositories attached yet. Discovery only searches inside this approved workspace root.</p>}
            {workspace.repositories.map((repository) => {
              const key = repoKey(workspace.id, repository.id);
              const inspection = inspections[key];
              const draft = gitDrafts[key] || emptyGitDraft();
              const definitions = taskDefinitions[key] || [];
              const repositoryTasks = taskOperations.filter((operation) => operation.workspaceId === workspace.id && operation.repositoryId === repository.id);
              const taskActive = repositoryTasks.some((operation) => ["queued", "running", "cancelling"].includes(operation.state));
              const gitActive = operations.some((operation) => operation.workspaceId === workspace.id && operation.repositoryId === repository.id && ["queued", "running", "cancelling"].includes(operation.state));
              return <section key={repository.id} className="desktop-workstation-repository-v9m">
                <header>
                  <div><strong>{repository.name}</strong><span>{repository.relativePath} · {repository.trust === "trusted" ? "trusted on this device" : "untrusted"}</span></div>
                  <div className="desktop-workstation-actions-v9m">
                    <ClusterButton size="compact" variant={repository.trust === "trusted" ? "quiet" : "secondary"} busy={busyAction === `trust:${repository.id}`} busyLabel="Updating…" onClick={() => void setRepositoryTrust(workspace.id, repository.id, repository.trust !== "trusted")}>{repository.trust === "trusted" ? "Revoke trust" : "Trust repository"}</ClusterButton>
                    <ClusterButton size="compact" variant="quiet" busy={Boolean(inspection?.loading)} busyLabel="Inspecting…" onClick={() => void inspectRepository(workspace.id, repository.id)}>Inspect Git + LFS</ClusterButton>
                  </div>
                </header>
                <div className="desktop-workstation-git-actions-v9m">
                  {(["fetch", "pull", "push"] as const).map((action) => <ClusterButton key={action} size="compact" variant={action === "pull" ? "secondary" : "quiet"} disabled={repository.trust !== "trusted" || taskActive || gitActive} busy={busyAction === `gitop:${repository.id}:${action}`} busyLabel={`${action}…`} onClick={() => void runGitOperation(workspace.id, repository.id, action)}>{action[0].toUpperCase() + action.slice(1)}</ClusterButton>)}
                  <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || taskActive || gitActive} busy={busyAction === `secretscan:${repository.id}:staged`} busyLabel="Scanning…" onClick={() => void runSecretScan(workspace.id, repository.id, "staged")}>Scan staged secrets</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || taskActive || gitActive} busy={busyAction === `secretscan:${repository.id}:outgoing`} busyLabel="Scanning…" onClick={() => void runSecretScan(workspace.id, repository.id, "outgoing")}>Scan outgoing secrets</ClusterButton>
                  {repository.trust !== "trusted" && <span>Trust this repository before network mutations.</span>}
                </div>
                <div className="desktop-workstation-tasks-v9m">
                  <div className="desktop-workstation-section-title-v9m"><div><strong>Repository tasks</strong><span>.cluster/tasks.json · trusted repositories only · argv execution without a shell</span></div><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `tasks:${repository.id}`} busyLabel="Loading…" onClick={() => void loadRepositoryTasks(workspace.id, repository.id)}>Load tasks</ClusterButton></div>
                  {repository.trust !== "trusted" && <small>Trust this repository before Cluster reads or executes its local task manifest.</small>}
                  {repository.trust === "trusted" && definitions.length === 0 && <small>No loaded task definitions. Cluster never accepts a renderer-supplied command or argument list.</small>}
                  {definitions.map((definition) => <div key={definition.id} className="desktop-workstation-task-definition-v9m"><div><strong>{definition.label}</strong><span>{definition.id} · {definition.workingDirectory} · timeout {definition.timeoutSeconds}s · {definition.argumentCount} args</span></div><ClusterButton size="compact" variant="secondary" disabled={gitActive || taskActive} busy={busyAction === `taskrun:${repository.id}:${definition.id}`} busyLabel="Starting…" onClick={() => void runRepositoryTask(workspace.id, repository.id, definition.id)}>Run</ClusterButton></div>)}
                  {repositoryTasks.slice(0, 3).map((operation) => <div key={operation.id} className={`desktop-workstation-operation-v9m ${operation.state}`}><div className="desktop-workstation-operation-head-v9m"><div><strong>Task · {operation.targetLabel || operation.taskId}</strong><span>{operation.stage} · {operation.state}</span></div>{["queued", "running", "cancelling"].includes(operation.state) && <ClusterButton size="compact" variant="quiet" disabled={operation.state === "cancelling"} busy={busyAction === `taskcancel:${operation.id}`} busyLabel="Cancelling…" onClick={() => void cancelRepositoryTask(operation.id)}>Cancel</ClusterButton>}</div><ClusterOperationFeedback state={localOperationFeedbackState(operation)} message={operation.progressMessage || operation.stage} detail={operation.message || "Waiting for local task output…"} progress={operation.status === "running" || operation.status === "queued" ? operation.progress : operation.status === "succeeded" ? 100 : null} />{operation.logs.length > 0 && <ClusterDisclosureGroup title="Sanitized task output"><pre>{operation.logs.slice(-8).join("\n")}</pre></ClusterDisclosureGroup>}</div>)}
                </div>
                {operations.filter((operation) => operation.repositoryId === repository.id && operation.workspaceId === workspace.id).slice(0, 3).map((operation) => <div key={operation.id} className={`desktop-workstation-operation-v9m ${operation.state}`}>
                  <div className="desktop-workstation-operation-head-v9m"><div><strong>{operation.kind.replace("git.", "Git ")}</strong><span>{operation.stage} · {operation.state}</span></div>{["queued", "running", "cancelling"].includes(operation.state) && <ClusterButton size="compact" variant="quiet" disabled={operation.state === "cancelling"} busy={busyAction === `cancel:${operation.id}`} busyLabel="Cancelling…" onClick={() => void cancelGitOperation(operation.id)}>Cancel</ClusterButton>}</div>
                  <ClusterOperationFeedback state={localOperationFeedbackState(operation)} message={operation.progressMessage || operation.stage} detail={operation.message || "Waiting for Git progress…"} progress={operation.status === "queued" || operation.status === "running" ? operation.progress : operation.status === "succeeded" ? 100 : null} />
                  {operation.result?.lfsLocks && <div className="desktop-workstation-lock-results-v9m"><strong>Server-reported locks · {operation.result.ownershipVerified ? "ownership verified" : "ownership not classified"}</strong>{!operation.result.lfsLocks.length && <span>No remote locks reported.</span>}{operation.result.lfsLocks.map((lock) => <button type="button" key={lock.id || lock.path} onClick={() => updateGitDraft(workspace.id, repository.id, { lfsLockPath: lock.path })}><code>{lock.path}</code><span>{lock.ownership === "ours" ? "Ours" : lock.ownership === "theirs" ? "Another user" : "Ownership unknown"}{lock.owner ? ` · ${lock.owner}` : ""}{lock.lockedAt ? ` · ${lock.lockedAt}` : ""}</span></button>)}</div>}
                  {operation.result?.lfsLock && <div className="desktop-workstation-lock-result-v9m"><code>{operation.result.lfsLock.path}</code><span>Lock acquired for current LFS credentials{operation.result.lfsLock.owner ? ` · server owner: ${operation.result.lfsLock.owner}` : ""}</span></div>}
                  {operation.result?.lfsUnlock && <div className="desktop-workstation-lock-result-v9m"><code>{operation.result.lfsUnlock.path || operation.targetLabel || "LFS path"}</code><span>{operation.result.lfsUnlock.unlocked ? "Lock released" : operation.result.lfsUnlock.reason || "Lock was not released"}</span></div>}
                  {operation.logs.length > 0 && <ClusterDisclosureGroup title="Sanitized Git output"><pre>{operation.logs.slice(-6).join("\n")}</pre></ClusterDisclosureGroup>}
                </div>)}
                {inspection?.error && <p className="desktop-workstation-error-v9m">{inspection.error}</p>}
                {(inspection?.git || inspection?.lfs) && <div className="desktop-workstation-repo-health-v9m">
                  <div><span>Branch</span><strong>{inspection.git?.detached ? "Detached HEAD" : inspection.git?.branch || "Unknown"}</strong><small>{inspection.git ? `${inspection.git.changedFiles} changed · ${inspection.git.ahead} ahead · ${inspection.git.behind} behind` : "Git status unavailable"}</small></div>
                  <div><span>Working tree</span><strong>{inspection.git?.clean ? "Clean" : inspection.git ? "Changes present" : "Unknown"}</strong><small>{inspection.git?.upstream || inspection.git?.remotes?.join(", ") || "No upstream reported"}</small></div>
                  <div><span>Git LFS</span><strong>{inspection.lfs?.installed ? inspection.lfs.healthy ? "Healthy" : "Needs attention" : "Not installed"}</strong><small>{inspection.lfs?.installed ? `${inspection.lfs.trackedObjects || 0} tracked · ${formatBytes(inspection.lfs.cacheBytes || 0)} local cache${inspection.lfs.cacheScanTruncated ? "+" : ""} · objects ${inspection.lfs.objectFsckHealthy === false ? "need repair" : "verified"} · pointers ${inspection.lfs.pointerFsckHealthy === false ? "need repair" : "verified"}${typeof inspection.lfs.diskAvailableBytes === "number" && inspection.lfs.diskAvailableBytes >= 0 ? ` · ${formatBytes(inspection.lfs.diskAvailableBytes)} free` : ""}` : inspection.lfs?.message || "Git LFS was not detected."}</small></div>
                </div>}
                {inspection?.lfsPolicy && <div className="desktop-workstation-lfs-policy-v9m">
                  <div className="desktop-workstation-lfs-header-v9m"><div><strong>Git LFS policy</strong><span>{inspection.lfsPolicy.installed ? `${inspection.lfsPolicy.patterns.length} root .gitattributes ${inspection.lfsPolicy.patterns.length === 1 ? "pattern" : "patterns"} · ${inspection.lfsPolicy.lockablePatterns.length} lockable` : "Git LFS is not installed"}</span></div><div className="desktop-workstation-lfs-editor-v9m"><ClusterTextInput value={draft.lfsPattern} placeholder="*.uasset or Content/**" onChange={(event) => updateGitDraft(workspace.id, repository.id, { lfsPattern: event.target.value })} /><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !inspection.lfsPolicy.installed || !draft.lfsPattern.trim()} busy={busyAction === `gitmut:${repository.id}:lfs.track:${draft.lfsPattern.trim()}`} busyLabel="Tracking…" onClick={() => void runGitMutation(workspace.id, repository.id, "lfs.track", { pattern: draft.lfsPattern })}>Track pattern</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !inspection.lfsPolicy.installed || !draft.lfsPattern.trim()} busy={busyAction === `gitmut:${repository.id}:lfs.track-lockable:${draft.lfsPattern.trim()}`} busyLabel="Tracking…" onClick={() => void runGitMutation(workspace.id, repository.id, "lfs.track-lockable", { pattern: draft.lfsPattern })}>Track + lockable</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !inspection.lfsPolicy.installed || !draft.lfsPattern.trim()} busy={busyAction === `gitmut:${repository.id}:lfs.untrack:${draft.lfsPattern.trim()}`} busyLabel="Untracking…" onClick={() => void runGitMutation(workspace.id, repository.id, "lfs.untrack", { pattern: draft.lfsPattern })}>Untrack pattern</ClusterButton></div></div>
                  {inspection.lfsPolicy.patterns.length > 0 && <div className="desktop-workstation-lfs-patterns-v9m">{inspection.lfsPolicy.patterns.map((pattern) => <code key={pattern}>{pattern}{inspection.lfsPolicy!.lockablePatterns.includes(pattern) ? " · lockable" : ""}</code>)}</div>}
                  {inspection.lfsPolicy.installed && <div className="desktop-workstation-actions-v9m"><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted"} busy={busyAction === `gitop:${repository.id}:lfs.fetch.current:repo`} busyLabel="Fetching…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.fetch.current")}>Fetch current LFS</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitop:${repository.id}:lfs.fetch.recent:repo`} busyLabel="Fetching…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.fetch.recent")}>Fetch recent LFS</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitop:${repository.id}:lfs.checkout:repo`} busyLabel="Hydrating…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.checkout")}>Hydrate working tree</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:lfs.prune.dry-run:repo`} busyLabel="Checking…" onClick={() => void runGitMutation(workspace.id, repository.id, "lfs.prune.dry-run")}>Preview LFS prune</ClusterButton><ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:lfs.prune:repo`} busyLabel="Pruning…" onClick={() => void (async () => { if (await confirmCluster({ title: "Prune local LFS cache?", message: "Prune old local Git LFS cache objects? This can remove locally cached historical objects that Git LFS considers safe to prune.", confirmLabel: "Prune cache", tone: "danger" })) await runGitMutation(workspace.id, repository.id, "lfs.prune", { confirmed: true }); })()}>Prune local LFS cache</ClusterButton></div>}
                  {inspection.lfsPolicy.installed && <div className="desktop-workstation-lfs-locks-v9m"><div><strong>Remote LFS locks</strong><span>Ownership is shown exactly as the LFS server reports it. Cluster does not guess that a matching Git username means a lock is yours.</span></div><div className="desktop-workstation-lfs-editor-v9m"><ClusterTextInput value={draft.lfsLockPath} placeholder="Content/Maps/Main.umap" onChange={(event) => updateGitDraft(workspace.id, repository.id, { lfsLockPath: event.target.value })} /><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.lfsLockPath.trim()} busy={busyAction === `gitop:${repository.id}:lfs.lock:${draft.lfsLockPath.trim()}`} busyLabel="Locking…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.lock", draft.lfsLockPath)}>Lock path</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.lfsLockPath.trim()} busy={busyAction === `gitop:${repository.id}:lfs.unlock:${draft.lfsLockPath.trim()}`} busyLabel="Unlocking…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.unlock", draft.lfsLockPath)}>Unlock path</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitop:${repository.id}:lfs.locks:repo`} busyLabel="Refreshing…" onClick={() => void runGitOperation(workspace.id, repository.id, "lfs.locks")}>Refresh remote locks</ClusterButton></div></div>}
                  {inspection.lfsPolicy.largeFiles.length > 0 && <div className="desktop-workstation-lfs-warnings-v9m"><strong>Large changed files</strong>{inspection.lfsPolicy.largeFiles.map((file) => <div key={file.relativePath}><code>{file.relativePath}</code><span>{formatBytes(file.sizeBytes)} · {file.lfsTracked ? "tracked by LFS" : "not tracked by LFS"}</span></div>)}{inspection.lfsPolicy.largeFiles.some((file) => !file.lfsTracked) && <p>Large files above {formatBytes(inspection.lfsPolicy.largeFileThresholdBytes)} should be reviewed before commit. Cluster does not auto-edit LFS policy behind your back.</p>}</div>}
                </div>}
                {(["staged", "outgoing"] as const).map((scope) => { const scan = secretScans[`${repoKey(workspace.id, repository.id)}:${scope}`]; return scan ? <div key={scope} className="desktop-workstation-secret-scan-v9m"><strong>{scope === "staged" ? "Staged" : "Outgoing"} secret scan · {scan.blocked ? "blocked" : "passed"}</strong><span>{scan.scannedAddedLines} added lines · {scan.blockCount} blocked · {scan.warningCount} warnings{scope === "outgoing" ? ` · ${scan.commitsScanned} commits` : ""}</span>{scan.findings.length > 0 && <div>{scan.findings.slice(0, 12).map((finding, index) => <p key={`${finding.rule}:${finding.path}:${finding.line}:${index}`}><b>{finding.severity === "block" ? "BLOCK" : "REVIEW"}</b> <code>{finding.path || "(unknown path)"}{finding.line > 0 ? `:${finding.line}` : ""}</code> · {finding.message}</p>)}</div>}</div> : null; })}
                {inspection?.details && <div className="desktop-workstation-mutation-v9m">
                  <div className="desktop-workstation-commit-v9m">
                    <label><span>Commit message</span><textarea value={draft.commitMessage} placeholder="Describe the staged change" rows={3} maxLength={4000} onChange={(event) => updateGitDraft(workspace.id, repository.id, { commitMessage: event.target.value })} /></label>
                    <div className="desktop-workstation-actions-v9m">
                      <ClusterButton size="compact" variant="primary" disabled={repository.trust !== "trusted" || !draft.commitMessage.trim()} busy={busyAction === `gitmut:${repository.id}:commit:repo`} busyLabel="Committing…" onClick={() => void runGitMutation(workspace.id, repository.id, "commit", { message: draft.commitMessage })}>Commit staged</ClusterButton>
                      <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.commitMessage.trim()} busy={busyAction === `gitmut:${repository.id}:amend:repo`} busyLabel="Amending…" onClick={() => void runGitMutation(workspace.id, repository.id, "amend", { message: draft.commitMessage })}>Amend HEAD</ClusterButton>
                    </div>
                  </div>
                  <div className="desktop-workstation-ref-tools-v9m">
                    <label><span>Branch</span><ClusterTextInput value={draft.branchName} placeholder="feature/name" onChange={(event) => updateGitDraft(workspace.id, repository.id, { branchName: event.target.value })} /></label>
                    <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.branchName.trim()} busy={busyAction === `gitmut:${repository.id}:branch.create:${draft.branchName.trim()}`} busyLabel="Creating…" onClick={() => void runGitMutation(workspace.id, repository.id, "branch.create", { name: draft.branchName })}>Create & switch</ClusterButton>
                    <label><span>Tag</span><ClusterTextInput value={draft.tagName} placeholder="v1.0.0" onChange={(event) => updateGitDraft(workspace.id, repository.id, { tagName: event.target.value })} /></label>
                    <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.tagName.trim()} busy={busyAction === `gitmut:${repository.id}:tag.create:${draft.tagName.trim()}`} busyLabel="Tagging…" onClick={() => void runGitMutation(workspace.id, repository.id, "tag.create", { name: draft.tagName })}>Create tag</ClusterButton>
                    <label><span>Upstream</span><ClusterTextInput value={draft.upstream} placeholder="origin/main" onChange={(event) => updateGitDraft(workspace.id, repository.id, { upstream: event.target.value })} /></label>
                    <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.upstream.trim()} busy={busyAction === `gitmut:${repository.id}:upstream.set:${draft.upstream.trim()}`} busyLabel="Setting…" onClick={() => void runGitMutation(workspace.id, repository.id, "upstream.set", { upstream: draft.upstream })}>Set upstream</ClusterButton>
                    <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !inspection.git?.upstream} busy={busyAction === `gitmut:${repository.id}:upstream.unset:repo`} busyLabel="Clearing…" onClick={() => void runGitMutation(workspace.id, repository.id, "upstream.unset")}>Clear upstream</ClusterButton>
                  </div>
                </div>}
                {inspection?.details && <div className="desktop-workstation-policy-v9m">
                  <div className="desktop-workstation-policy-card-v9m"><strong>Root .gitignore</strong><span>{inspection.details.policy.ignoreFileSafe ? `${inspection.details.policy.ignorePatterns.length} visible patterns` : "Symlinked policy file blocked from Cluster edits"}</span><div className="desktop-workstation-policy-editor-v9m"><ClusterTextInput value={draft.ignorePattern} placeholder="Saved/** or *.tmp" onChange={(event) => updateGitDraft(workspace.id, repository.id, { ignorePattern: event.target.value })} /><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !inspection.details.policy.ignoreFileSafe || !draft.ignorePattern.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "ignore.add", { pattern: draft.ignorePattern })}>Add ignore</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !inspection.details.policy.ignoreFileSafe || !draft.ignorePattern.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "ignore.remove", { pattern: draft.ignorePattern })}>Remove exact</ClusterButton></div>{inspection.details.policy.ignorePatterns.length > 0 && <div className="desktop-workstation-policy-list-v9m">{inspection.details.policy.ignorePatterns.slice(0, 24).map((pattern) => <code key={pattern}>{pattern}</code>)}</div>}</div>
                  <div className="desktop-workstation-policy-card-v9m"><strong>Root .gitattributes helpers</strong><span>{inspection.details.policy.attributesFileSafe ? `${inspection.details.policy.attributeRules.length} visible rules` : "Symlinked policy file blocked from Cluster edits"}</span><div className="desktop-workstation-policy-editor-v9m"><ClusterTextInput value={draft.attributePattern} placeholder="*.uasset" onChange={(event) => updateGitDraft(workspace.id, repository.id, { attributePattern: event.target.value })} /><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !inspection.details.policy.attributesFileSafe || !draft.attributePattern.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "attributes.text", { pattern: draft.attributePattern })}>Mark text</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !inspection.details.policy.attributesFileSafe || !draft.attributePattern.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "attributes.binary", { pattern: draft.attributePattern })}>Mark binary</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !inspection.details.policy.attributesFileSafe || !draft.attributePattern.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "attributes.remove", { pattern: draft.attributePattern })}>Remove helper rule</ClusterButton></div>{inspection.details.policy.attributeRules.length > 0 && <div className="desktop-workstation-policy-list-v9m">{inspection.details.policy.attributeRules.slice(0, 24).map((rule, ruleIndex) => <code key={`${rule.pattern}:${rule.attributes}:${ruleIndex}`}>{rule.pattern} {rule.attributes}</code>)}</div>}</div>
                </div>}
                {inspection?.details && <div className="desktop-workstation-advanced-v9m">
                  {inspection.details!.recovery.inProgress && <div className="desktop-workstation-recovery-v9m">
                    <div><strong>Recovery in progress</strong><span>{inspection.details.recovery.operation} · {inspection.details.recovery.conflictCount} unresolved conflicts</span></div>
                    <div className="desktop-workstation-actions-v9m">
                      <ClusterButton size="compact" variant="primary" disabled={repository.trust !== "trusted" || !inspection.details.recovery.canContinue} busy={busyAction === `gitmut:${repository.id}:${inspection.details.recovery.operation}.continue:repo`} busyLabel="Continuing…" onClick={() => void runGitMutation(workspace.id, repository.id, `${inspection.details!.recovery.operation}.continue` as ClusterLocalGitMutationAction)}>Continue</ClusterButton>
                      <ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted" || !inspection.details.recovery.canAbort} busy={busyAction === `gitmut:${repository.id}:${inspection.details.recovery.operation}.abort:repo`} busyLabel="Aborting…" onClick={() => void (async () => { if (await confirmCluster({ title: "Abort Git operation?", message: `Abort the current ${inspection.details!.recovery.operation} operation? Cluster will ask Git to restore the pre-operation state.`, confirmLabel: "Abort operation", tone: "danger" })) await runGitMutation(workspace.id, repository.id, `${inspection.details!.recovery.operation}.abort` as ClusterLocalGitMutationAction); })()}>Abort</ClusterButton>
                    </div>
                  </div>}
                  <div className="desktop-workstation-advanced-grid-v9m">
                    <div className="desktop-workstation-advanced-card-v9m">
                      <strong>Integrate / recover</strong>
                      <label><span>Branch or commit target</span><ClusterTextInput value={draft.target} placeholder="main, origin/main, or commit SHA" onChange={(event) => updateGitDraft(workspace.id, repository.id, { target: event.target.value })} /></label>
                      <div className="desktop-workstation-actions-v9m">
                        <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} busy={busyAction === `gitmut:${repository.id}:merge.start:${draft.target.trim()}`} busyLabel="Merging…" onClick={() => void runGitMutation(workspace.id, repository.id, "merge.start", { target: draft.target })}>Merge</ClusterButton>
                        <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} busy={busyAction === `gitmut:${repository.id}:rebase.start:${draft.target.trim()}`} busyLabel="Rebasing…" onClick={() => void runGitMutation(workspace.id, repository.id, "rebase.start", { target: draft.target })}>Rebase</ClusterButton>
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} busy={busyAction === `gitmut:${repository.id}:cherry-pick.start:${draft.target.trim()}`} busyLabel="Cherry-picking…" onClick={() => void runGitMutation(workspace.id, repository.id, "cherry-pick.start", { target: draft.target })}>Cherry-pick</ClusterButton>
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} busy={busyAction === `gitmut:${repository.id}:revert.start:${draft.target.trim()}`} busyLabel="Reverting…" onClick={() => void runGitMutation(workspace.id, repository.id, "revert.start", { target: draft.target })}>Revert commit</ClusterButton>
                      </div>
                      <div className="desktop-workstation-actions-v9m">
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} onClick={() => void runGitMutation(workspace.id, repository.id, "reset.soft", { target: draft.target })}>Soft reset</ClusterButton>
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} onClick={() => void runGitMutation(workspace.id, repository.id, "reset.mixed", { target: draft.target })}>Mixed reset</ClusterButton>
                        <ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted" || !draft.target.trim() || inspection.details!.recovery.inProgress} onClick={() => void (async () => { if (await confirmCluster({ title: "Hard reset repository?", message: `Hard reset this repository to ${draft.target.trim()}? Working tree and index changes may be destroyed.`, confirmLabel: "Hard reset", tone: "danger" })) await runGitMutation(workspace.id, repository.id, "reset.hard", { target: draft.target, confirmed: true }); })()}>Hard reset</ClusterButton>
                      </div>
                    </div>
                    <div className="desktop-workstation-advanced-card-v9m">
                      <strong>Stash</strong>
                      <label><span>Optional stash message</span><ClusterTextInput value={draft.stashMessage} placeholder="WIP before merge" onChange={(event) => updateGitDraft(workspace.id, repository.id, { stashMessage: event.target.value })} /></label>
                      <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || inspection.details!.recovery.inProgress} busy={busyAction === `gitmut:${repository.id}:stash.push:repo`} busyLabel="Stashing…" onClick={() => void runGitMutation(workspace.id, repository.id, "stash.push", { message: draft.stashMessage })}>Stash tracked + untracked</ClusterButton>
                      {!inspection.details.stashes.length && <span>No stash entries.</span>}
                      {inspection.details.stashes.slice(0, 8).map((stash) => <div key={stash.ref} className="desktop-workstation-ref-row-v9m"><span><code>{stash.ref}</code> {stash.subject}</span><div className="desktop-workstation-actions-v9m"><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || inspection.details!.recovery.inProgress} onClick={() => void runGitMutation(workspace.id, repository.id, "stash.apply", { stashRef: stash.ref })}>Apply</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || inspection.details!.recovery.inProgress} onClick={() => void runGitMutation(workspace.id, repository.id, "stash.pop", { stashRef: stash.ref })}>Pop</ClusterButton><ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted"} onClick={() => void (async () => { if (await confirmCluster({ title: "Drop stash?", message: `Drop ${stash.ref}? This permanently removes that stash entry.`, confirmLabel: "Drop stash", tone: "danger" })) await runGitMutation(workspace.id, repository.id, "stash.drop", { stashRef: stash.ref, confirmed: true }); })()}>Drop</ClusterButton></div></div>)}
                    </div>
                    <div className="desktop-workstation-advanced-card-v9m">
                      <strong>Remotes</strong>
                      <label><span>Remote name</span><ClusterTextInput value={draft.remoteName} placeholder="origin" onChange={(event) => updateGitDraft(workspace.id, repository.id, { remoteName: event.target.value })} /></label>
                      <label><span>HTTPS / SSH URL</span><ClusterTextInput value={draft.remoteUrl} placeholder="https://host/org/repo.git" onChange={(event) => updateGitDraft(workspace.id, repository.id, { remoteUrl: event.target.value })} /></label>
                      <label><span>Rename to</span><ClusterTextInput value={draft.remoteNextName} placeholder="upstream" onChange={(event) => updateGitDraft(workspace.id, repository.id, { remoteNextName: event.target.value })} /></label>
                      <div className="desktop-workstation-actions-v9m">
                        <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted" || !draft.remoteName.trim() || !draft.remoteUrl.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "remote.add", { remote: draft.remoteName, url: draft.remoteUrl })}>Add remote</ClusterButton>
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.remoteName.trim() || !draft.remoteNextName.trim()} onClick={() => void runGitMutation(workspace.id, repository.id, "remote.rename", { remote: draft.remoteName, nextName: draft.remoteNextName })}>Rename</ClusterButton>
                        <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted" || !draft.remoteName.trim() || !draft.remoteUrl.trim()} onClick={() => void (async () => { if (await confirmCluster({ title: "Change remote URL?", message: `Change the URL for remote ${draft.remoteName.trim()}?`, confirmLabel: "Change URL" })) await runGitMutation(workspace.id, repository.id, "remote.set-url", { remote: draft.remoteName, url: draft.remoteUrl, confirmed: true }); })()}>Set URL</ClusterButton>
                        <ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted" || !draft.remoteName.trim()} onClick={() => void (async () => { if (await confirmCluster({ title: "Remove Git remote?", message: `Remove remote ${draft.remoteName.trim()} from this local repository?`, confirmLabel: "Remove remote", tone: "danger" })) await runGitMutation(workspace.id, repository.id, "remote.remove", { remote: draft.remoteName, confirmed: true }); })()}>Remove</ClusterButton>
                      </div>
                      {inspection.details.remotes.map((remote) => <button type="button" key={remote.name} className="desktop-workstation-remote-row-v9m" onClick={() => updateGitDraft(workspace.id, repository.id, { remoteName: remote.name, remoteUrl: remote.url })}><strong>{remote.name}</strong><span>{remote.url}</span></button>)}
                    </div>
                    <div className="desktop-workstation-advanced-card-v9m">
                      <strong>Repository shape & signing</strong>
                      <span>HEAD signature: {inspection.details.signing.headStatus}{inspection.details.signing.headSigner ? ` · ${inspection.details.signing.headSigner}` : ""}</span>
                      <span>Commit signing: {inspection.details.signing.commitSigningEnabled ? "enabled" : "not forced"} · key {inspection.details.signing.signingKeyConfigured ? "configured" : "not configured"}</span>
                      <span>Worktrees: {inspection.details.layout.worktreeCount}{inspection.details.layout.worktreeBranches.length ? ` · ${inspection.details.layout.worktreeBranches.join(", ")}` : ""}</span>
                      <span>Submodules: {inspection.details.layout.submodules.length} · Sparse checkout: {inspection.details.layout.sparseCheckout ? "enabled" : "off"} · Partial clone: {inspection.details.layout.partialClone ? `yes (${inspection.details.layout.partialCloneRemote || "configured"})` : "no"}</span>
                      {inspection.details.layout.sparsePatterns.length > 0 && <small>Sparse paths: {inspection.details.layout.sparsePatterns.slice(0, 8).join(", ")}{inspection.details.layout.sparsePatterns.length > 8 ? ` +${inspection.details.layout.sparsePatterns.length - 8}` : ""}</small>}
                      {inspection.details.layout.submodules.slice(0, 8).map((submodule) => <code key={submodule.relativePath}>{submodule.state} {submodule.relativePath} · {submodule.sha.slice(0, 10)}</code>)}
                    </div>
                  </div>
                </div>}
                {inspection?.details && <div className="desktop-workstation-git-details-v9m">
                  <div className="desktop-workstation-changes-v9m">
                    <strong>Changes</strong>
                    {!inspection.details.changes.length && <span>Working tree has no reported changes.</span>}
                    {inspection.details.changes.slice(0, 12).map((change, index) => {
                      const staged = change.state[0] !== " " && change.state[0] !== "?";
                      const worktree = change.state[1] !== " " || change.state === "??";
                      const stagedKey = `${key}:staged:${change.relativePath}`;
                      const worktreeKey = `${key}:worktree:${change.relativePath}`;
                      const stagedDiff = diffs[stagedKey];
                      const worktreeDiff = diffs[worktreeKey];
                      const renderDiff = (diff: ClusterLocalGitDiff | undefined, stagedSide: boolean) => diff && <div className="desktop-workstation-diff-panel-v9m">
                        <div className="desktop-workstation-diff-heading-v9m"><strong>{stagedSide ? "Staged diff" : "Working-tree diff"}</strong><small>{diff.hunks.length ? `${diff.hunks.length} selectable hunk${diff.hunks.length === 1 ? "" : "s"}` : "No selectable text hunks"}</small></div>
                        {diff.hunks.length > 0 && <div className="desktop-workstation-hunks-v9m">{diff.hunks.map((hunk, hunkIndex) => <div key={hunk.id} className="desktop-workstation-hunk-v9m"><code>{hunk.header}</code><ClusterButton size="compact" variant={stagedSide ? "quiet" : "secondary"} disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:${stagedSide ? "hunk.unstage" : "hunk.stage"}:${change.relativePath}`} busyLabel={stagedSide ? "Unstaging…" : "Staging…"} onClick={() => void runGitMutation(workspace.id, repository.id, stagedSide ? "hunk.unstage" : "hunk.stage", { relativePath: change.relativePath, hunkId: hunk.id })}>{stagedSide ? `Unstage hunk ${hunkIndex + 1}` : `Stage hunk ${hunkIndex + 1}`}</ClusterButton></div>)}</div>}
                        <pre className="desktop-workstation-diff-v9m">{diff.patch || "No textual diff available for this path."}{diff.truncated ? "\n\n[Diff truncated by Cluster IPC safety limit]" : ""}</pre>
                      </div>;
                      return <div key={`${change.relativePath}:${index}`} className="desktop-workstation-change-v9m">
                        <div><code>{change.state} {change.relativePath}</code><span>{staged ? "staged" : ""}{staged && worktree ? " + " : ""}{worktree ? "working tree" : ""}</span></div>
                        <div className="desktop-workstation-actions-v9m">
                          {worktree && <ClusterButton size="compact" variant="secondary" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:stage:${change.relativePath}`} busyLabel="Staging…" onClick={() => void runGitMutation(workspace.id, repository.id, "stage", { relativePath: change.relativePath })}>Stage</ClusterButton>}
                          {staged && <ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:unstage:${change.relativePath}`} busyLabel="Unstaging…" onClick={() => void runGitMutation(workspace.id, repository.id, "unstage", { relativePath: change.relativePath })}>Unstage</ClusterButton>}
                          {worktree && <ClusterButton size="compact" variant="quiet" busy={busyAction === `diff:${worktreeKey}`} busyLabel="Loading diff…" onClick={() => void showGitDiff(workspace.id, repository.id, change.relativePath, false)}>Working diff</ClusterButton>}
                          {staged && <ClusterButton size="compact" variant="quiet" busy={busyAction === `diff:${stagedKey}`} busyLabel="Loading diff…" onClick={() => void showGitDiff(workspace.id, repository.id, change.relativePath, true)}>Staged diff</ClusterButton>}
                          {worktree && <ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted"} onClick={() => void discardGitChange(workspace.id, repository.id, change.relativePath)}>Discard</ClusterButton>}
                        </div>
                        {renderDiff(stagedDiff, true)}
                        {renderDiff(worktreeDiff, false)}
                      </div>;
                    })}
                    {inspection.details.changes.length > 12 && <span>+ {inspection.details.changes.length - 12} more changes</span>}
                    {inspection.details.conflicts.length > 0 && <div className="desktop-workstation-conflicts-v9m"><strong>Conflicts</strong>{inspection.details.conflicts.map((path) => <code key={path}>{path}</code>)}</div>}
                  </div>
                  <div>
                    <strong>Branches</strong>
                    {!inspection.details.branches.length && <span>No local branches reported yet.</span>}
                    {inspection.details.branches.slice(0, 10).map((branch) => <div key={branch.name} className="desktop-workstation-ref-row-v9m"><span>{branch.current ? "● " : ""}{branch.name}{branch.upstream ? ` → ${branch.upstream}` : ""}</span>{!branch.current && <div className="desktop-workstation-actions-v9m"><ClusterButton size="compact" variant="quiet" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:branch.checkout:${branch.name}`} busyLabel="Switching…" onClick={() => void runGitMutation(workspace.id, repository.id, "branch.checkout", { name: branch.name })}>Switch</ClusterButton><ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:branch.delete:${branch.name}`} busyLabel="Deleting…" onClick={() => void runGitMutation(workspace.id, repository.id, "branch.delete", { name: branch.name })}>Delete</ClusterButton></div>}</div>)}
                    {inspection.details.tags.length > 0 && <><strong>Tags</strong>{inspection.details.tags.slice(0, 12).map((tag) => <div key={tag} className="desktop-workstation-ref-row-v9m"><span>{tag}</span><ClusterButton size="compact" variant="danger" disabled={repository.trust !== "trusted"} busy={busyAction === `gitmut:${repository.id}:tag.delete:${tag}`} busyLabel="Deleting…" onClick={() => void runGitMutation(workspace.id, repository.id, "tag.delete", { name: tag })}>Delete</ClusterButton></div>)}</>}
                    {inspection.details.upstreams.length > 0 && <small>Remote branches: {inspection.details.upstreams.slice(0, 8).join(", ")}{inspection.details.upstreams.length > 8 ? ` +${inspection.details.upstreams.length - 8}` : ""}</small>}
                  </div>
                  <div className="desktop-workstation-history-v9m">
                    <strong>Branch graph</strong>
                    {!inspection.details.graph.length && <span>No commits yet.</span>}
                    {inspection.details.graph.slice(0, 20).map((commit) => <div key={commit.sha} className="desktop-workstation-graph-row-v9m"><span className="desktop-workstation-graph-node-v9m" aria-hidden="true">●</span><span className="desktop-workstation-graph-copy-v9m"><span><code>{commit.shortSha}</code> {commit.subject}</span>{commit.refs.length > 0 && <small>{commit.refs.join(" · ")}</small>}<small>{commit.author} · {commit.parents.length > 1 ? `${commit.parents.length}-parent merge` : commit.parents.length === 0 ? "root commit" : "commit"}</small></span></div>)}
                    <details className="desktop-workstation-history-details-v9m"><summary>Linear recent history</summary>{inspection.details.history.slice(0, 8).map((commit) => <span key={commit.sha}><code>{commit.shortSha}</code> {commit.subject} <small>{commit.author}</small></span>)}</details>
                  </div>
                </div>}
              </section>;
            })}
          </div>
        </article>;
      })}
    </div>}

    {message && <p className="desktop-native-message" role="status">{message}</p>}
  </section>;
}
