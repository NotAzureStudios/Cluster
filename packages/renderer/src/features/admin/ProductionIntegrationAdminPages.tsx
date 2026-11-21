import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PRODUCT_CONNECTION_STATES, PRODUCT_OPERATION_STATES } from "@cluster/shared";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip, type SettingsStateTone } from "../../components/SettingsStateChip";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterVisualComposition } from "../../components/ClusterVisualMetrics";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { api, formatApiError, queryApi } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { IntegrationProvidersPanel } from "./IntegrationProvidersPanel";
import "./admin.css";
import "./source-control-admin.css";

type Provider = {
  id: string;
  label: string;
  category: string;
  implementation: "active" | "adapter-contract";
  configured: boolean;
  setupSurface: string;
};

type Connection = {
  id: string;
  providerId: string;
  category: string;
  displayName: string;
  status: string;
  healthState: string;
  healthMessage?: string | null;
  lastCheckedAt?: string | null;
  configuration?: {
    baseUrl?: string;
    apiBaseUrl?: string;
    allowPrivateNetwork?: boolean;
    tokenConfigured?: boolean;
  };
};

type DiscordDeliveryFailure = {
  id: string;
  notificationId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  attempts: number;
  error: string;
  updatedAt: string;
};

type DiscordRoleMapping = { id: string; guildId: string; roleId: string; sourceKind: "accountType" | "team"; sourceId: string };
type DiscordRoleStatus = {
  enabled: boolean; mappings: DiscordRoleMapping[];
  roles: Array<{ id: string; name: string; color: number; position: number }>;
  teams: Array<{ id: string; name: string }>;
  accountTypes: string[]; managed: number; uncertain: number;
};
type DiscordRolePreview = { grants: number; revokes: number; uncertain: number; enabled: boolean; limitPerRun: number };

type DiscordDeliverySummary = {
  projectCount: number;
  routeCount: number;
  deliveries: { completed: number; failed: number; pending: number; running: number };
  recentFailures: DiscordDeliveryFailure[];
  healthState?: string | null;
  healthMessage?: string | null;
  lastCheckedAt?: string | null;
};

function connectionStateLabel(value: string | null | undefined) {
  const state = String(value || "").toLowerCase();
  if (["healthy", "connected", "configured"].includes(state)) return state === "configured" ? PRODUCT_CONNECTION_STATES.configured : state === "connected" ? PRODUCT_CONNECTION_STATES.connected : PRODUCT_CONNECTION_STATES.healthy;
  if (["failed", "degraded", "warning", "missing"].includes(state)) return PRODUCT_CONNECTION_STATES.needsAttention;
  if (["disabled"].includes(state)) return PRODUCT_CONNECTION_STATES.disabled;
  if (["unavailable"].includes(state)) return PRODUCT_CONNECTION_STATES.unavailable;
  return PRODUCT_CONNECTION_STATES.notConfigured;
}

function integrationStateTone(value: string | null | undefined): SettingsStateTone {
  const state = String(value || "").toLowerCase();
  if (state === "healthy") return "success";
  if (state === "failed") return "danger";
  if (["warning", "degraded", "missing"].includes(state)) return "warning";
  if (["connected", "configured", "checking", "running"].includes(state)) return "info";
  return "neutral";
}

function integrationStateIcon(value: string | null | undefined) {
  const state = String(value || "").toLowerCase();
  return state === "healthy" ? "check" as const :
    ["failed", "warning", "degraded", "missing"].includes(state) ? "warning" as const :
    ["connected", "configured", "running", "checking"].includes(state) ? "activity" as const :
    "minus" as const;
}

function repositoryStateLabel(repository: Repository) {
  const syncState = String(repository.syncState || "").toLowerCase();
  if (syncState === "syncing") return PRODUCT_OPERATION_STATES.running;
  if (syncState === "failed" || repository.healthState === "failed") return PRODUCT_CONNECTION_STATES.needsAttention;
  if (repository.healthState === "healthy") return PRODUCT_CONNECTION_STATES.healthy;
  return PRODUCT_CONNECTION_STATES.checking;
}

type Repository = {
  id: string;
  name: string;
  hostingMode: string;
  remoteUrl?: string | null;
  defaultBranch: string;
  headRevision?: string | null;
  syncState?: string | null;
  lastSyncedAt?: string | null;
  healthState: string;
  healthMessage?: string | null;
  connection?: Connection | null;
  metadata?: Record<string, unknown> | null;
  projects?: Array<{ projectId: string; isPrimary?: boolean; project?: { id: string; name: string } | null }>;
  _count?: { projects: number; branches?: number; commits?: number; changes?: number; operations?: number };
};

type RepositoryStateDetail = {
  repository: Repository;
  branches: Array<{ id: string; name: string; isDefault?: boolean; headRevision?: string | null }>;
  commits: Array<{ id: string; shortRevision: string; revision: string; message: string; authorName?: string | null; committedAt?: string | null }>;
  operations: Array<{ id: string; operationType: string; status: string; progressMessage?: string | null }>;
};

type VersionPolicy = {
  id: string;
  name: string;
  presetKey: string;
  formatTemplate: string;
  projectOverrideAllowed: boolean;
  isDefault: boolean;
};

function AdminSurface({ title, description, status, children, embedded = false }: { title: string; description?: string; status?: string; children: ReactNode; embedded?: boolean }) {
  if (embedded) return <section className="admin-embedded-surface-v535" aria-label={title}>{children}</section>;
  return (
    <section className="page admin-page-v243">
      <header className="page-header-v243">
        <div><span className="eyebrow">Administration</span><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
        {status ? <span className="soft-pill">{status}</span> : null}
      </header>
      {children}
    </section>
  );
}

/* Admin → Repositories. Repositories (list + detail) and provider
   connections, styled only by source-control-admin.css (scm-*). */
export function SourceControlAdminPage(_props: { embedded?: boolean } = {}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [editingConnectionId, setEditingConnectionId] = useState("");
  const [providerId, setProviderId] = useState("source.gitea");
  const [connectionName, setConnectionName] = useState("Studio Source Control");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [sourceToken, setSourceToken] = useState("");
  const [sourceTokenConfigured, setSourceTokenConfigured] = useState(false);
  const [clearSourceToken, setClearSourceToken] = useState(false);
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [repositoryName, setRepositoryName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [repositoryConnectionId, setRepositoryConnectionId] = useState("");
  const [repositoryTemplate, setRepositoryTemplate] = useState<"unreal" | "software" | "generic">("unreal");
  const [sourceView, setSourceView] = useState<"repositories" | "connections">("repositories");
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [repositoryFormOpen, setRepositoryFormOpen] = useState(false);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryScope, setRepositoryScope] = useState<"all" | "attention" | "linked">("all");
  const [repositorySort, setRepositorySort] = useState<"name" | "recent">("name");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [status, setStatus] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [repositoryDetail, setRepositoryDetail] = useState<{ repositoryId: string; data: RepositoryStateDetail } | null>(null);
  const [repositoryDetailLoading, setRepositoryDetailLoading] = useState(false);
  const [repositoryDetailError, setRepositoryDetailError] = useState("");
  const [repositoryDetailRefresh, setRepositoryDetailRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  const visibleRepositories = useMemo(() => repositories.filter((repository) => {
    const needle = repositoryQuery.trim().toLowerCase();
    const matches = !needle || [repository.name, repository.defaultBranch, repository.remoteUrl || "", repository.connection?.displayName || ""]
      .some((value) => value.toLowerCase().includes(needle));
    const inScope = repositoryScope === "all"
      || (repositoryScope === "attention" && (repository.healthState === "failed" || repository.syncState === "failed"))
      || (repositoryScope === "linked" && (repository._count?.projects || 0) > 0);
    return matches && inScope;
  }).sort((a, b) => repositorySort === "recent"
    ? (b.lastSyncedAt || "").localeCompare(a.lastSyncedAt || "") || a.name.localeCompare(b.name)
    : a.name.localeCompare(b.name)), [repositories, repositoryQuery, repositoryScope, repositorySort]);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId) || null;
  const sourceProviders = useMemo(() => providers.filter((provider) => provider.category === "source-control"), [providers]);
  const activeProviders = useMemo(() => sourceProviders.filter((provider) => provider.implementation === "active"), [sourceProviders]);
  const providerOptions = useMemo(() => activeProviders.map((provider) => ({ value: provider.id, label: provider.label })), [activeProviders]);
  const providerLabel = (id: string) => sourceProviders.find((provider) => provider.id === id)?.label || id.replace(/^source\./, "");

  function resetConnectionForm(nextProviderId = providerOptions[0]?.value || "source.gitea") {
    setEditingConnectionId("");
    setProviderId(nextProviderId);
    setConnectionName("Studio Source Control");
    setBaseUrl("");
    setApiBaseUrl("");
    setSourceToken("");
    setSourceTokenConfigured(false);
    setClearSourceToken(false);
    setAllowPrivateNetwork(false);
  }

  function editConnection(connection: Connection) {
    setConnectionFormOpen(true);
    setEditingConnectionId(connection.id);
    setProviderId(connection.providerId);
    setConnectionName(connection.displayName);
    setBaseUrl(connection.configuration?.baseUrl || "");
    setApiBaseUrl(connection.configuration?.apiBaseUrl || "");
    setSourceToken("");
    setSourceTokenConfigured(Boolean(connection.configuration?.tokenConfigured));
    setClearSourceToken(false);
    setAllowPrivateNetwork(Boolean(connection.configuration?.allowPrivateNetwork));
  }

  async function load(force = false) {
    try {
      const [providerResult, connectionResult, repositoryResult] = await Promise.all([
        queryApi<{ providers: Provider[] }>("/api/admin/integrations/providers", { force, staleMs: 15_000, tags: ["integrations"] }),
        queryApi<{ connections: Connection[] }>("/api/admin/source-control/connections", { force, staleMs: 5_000, tags: ["integrations", "source-control"] }),
        queryApi<{ repositories: Repository[] }>("/api/admin/source-control/repositories", { force, staleMs: 5_000, tags: ["source-control"] }),
      ]);
      const nextProviders = providerResult.providers || [];
      const nextConnections = connectionResult.connections || [];
      setProviders(nextProviders);
      setConnections(nextConnections);
      setRepositories(repositoryResult.repositories || []);
      setSelectedRepositoryId((current) => current || repositoryResult.repositories?.[0]?.id || "");
      if (!editingConnectionId && !nextProviders.some((provider) => provider.id === providerId && provider.category === "source-control" && provider.implementation === "active")) {
        setProviderId(nextProviders.find((provider) => provider.category === "source-control" && provider.implementation === "active")?.id || "source.gitea");
      }
      
    } catch (error) {
      setStatus(formatApiError(error));
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedRepositoryId || sourceView !== "repositories") {
      setRepositoryDetail(null);
      setRepositoryDetailError("");
      setRepositoryDetailLoading(false);
      return;
    }
    let active = true;
    setRepositoryDetail(null);
    setRepositoryDetailLoading(true);
    setRepositoryDetailError("");
    void queryApi<RepositoryStateDetail>(`/api/admin/source-control/repositories/${encodeURIComponent(selectedRepositoryId)}/state`, {
      force: repositoryDetailRefresh > 0,
      staleMs: 20_000,
      maxAgeMs: 60_000,
      tags: ["source-control", selectedRepositoryId],
    }).then((data) => {
      if (active) setRepositoryDetail({ repositoryId: selectedRepositoryId, data });
    }).catch((error) => {
      if (active) setRepositoryDetailError(formatApiError(error));
    }).finally(() => {
      if (active) setRepositoryDetailLoading(false);
    });
    return () => { active = false; };
  }, [selectedRepositoryId, sourceView, repositoryDetailRefresh]);
  useResourceChangeRefresh(() => load(true), { kinds: ["source_repository", "source_review", "source_commit", "integration_connection"], debounceMs: 750 });
  useVisibleRefresh(() => load(true), { intervalMs: 90_000, requireOnline: true });

  async function saveSourceConnection() {
    if (!connectionName.trim() || !providerId) return;
    setBusy(true);
    try {
      const payload = {
        ...(!editingConnectionId ? { providerId } : {}),
        displayName: connectionName.trim(),
        baseUrl: baseUrl.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        allowPrivateNetwork,
        ...(sourceToken.trim() ? { token: sourceToken.trim() } : {}),
        ...(editingConnectionId && clearSourceToken ? { clearToken: true } : {}),
      };
      const result = await api<{ connection: Connection }>(editingConnectionId ? `/api/admin/source-control/connections/${editingConnectionId}` : "/api/admin/source-control/connections", {
        method: editingConnectionId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const savedName = result.connection?.displayName || connectionName.trim();
      resetConnectionForm(providerId);
      setConnectionFormOpen(false);
      await load(true);
      setStatus(editingConnectionId ? `${savedName} updated.` : `${savedName} added.`);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function checkConnection(connection: Connection) {
    setBusy(true);
    try {
      await api(`/api/admin/source-control/connections/${connection.id}/check`, { method: "POST" });
      await load(true);
      setStatus(`${connection.displayName} is healthy.`);
    } catch (error) {
      await load(true);
      setStatus(formatApiError(error));
    } finally { setBusy(false); }
  }

  async function archiveConnection(connection: Connection) {
    setBusy(true);
    try {
      await api(`/api/admin/integrations/connections/${connection.id}`, { method: "DELETE" });
      if (editingConnectionId === connection.id) resetConnectionForm(providerId);
      await load(true);
      setStatus(`${connection.displayName} removed.`);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function addRepository() {
    if (!repositoryName.trim()) return;
    // Never create an orphaned remote repository that lacks a provider adapter.
    if ((remoteUrl.trim() && !repositoryConnectionId) || (repositoryConnectionId && !remoteUrl.trim())) {
      setStatus(repositoryConnectionId ? "Enter the remote repository URL." : "Select a provider connection or remove the remote URL.");
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ repository: Repository }>("/api/admin/source-control/repositories", {
        method: "POST",
        body: JSON.stringify({
          name: repositoryName.trim(),
          connectionId: repositoryConnectionId || null,
          hostingMode: repositoryConnectionId ? "remote" : "cluster",
          remoteUrl: repositoryConnectionId ? remoteUrl.trim() || null : null,
          cloneUrl: repositoryConnectionId ? remoteUrl.trim() || null : null,
          defaultBranch: defaultBranch.trim() || "main",
          ...(repositoryConnectionId ? {} : { template: repositoryTemplate }),
        }),
      });
      setRepositoryName("");
      setRemoteUrl("");
      setDefaultBranch("main");
      setRepositoryFormOpen(false);
      await load(true);
      if (created.repository?.id) setSelectedRepositoryId(created.repository.id);
      setStatus(`${created.repository?.name || "Repository"} created.`);
      // Index the new repository's first commit right away.
      if (created.repository?.id) void api(`/api/admin/source-control/repositories/${created.repository.id}/sync`, { method: "POST" }).then(() => load(true)).catch(() => undefined);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function syncRepository(repository: Repository) {
    setBusy(true);
    try {
      await api(`/api/admin/source-control/repositories/${repository.id}/sync`, { method: "POST" });
      setStatus(`${repository.name} synchronization queued.`);
      await load(true);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function removeRepository(repository: Repository) {
    const linked = repository._count?.projects || 0;
    if (!await confirmCluster({ title: `Remove ${repository.name}?`, message: linked ? `It is linked to ${linked} project${linked === 1 ? "" : "s"}; they will lose their repository link. Stored Git history is kept on the server.` : "Stored Git history is kept on the server.", confirmLabel: "Remove", tone: "danger" })) return;
    setBusy(true);
    try {
      await api(`/api/admin/source-control/repositories/${repository.id}`, { method: "DELETE", body: "{}" });
      if (selectedRepositoryId === repository.id) setSelectedRepositoryId("");
      await load(true);
      setStatus(`${repository.name} removed.`);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  const isEditingConnection = Boolean(editingConnectionId);
  const repoTone = (repository: Repository) => repository.syncState === "syncing" ? "running" : repository.syncState === "failed" || repository.healthState === "failed" ? "failed" : repository.healthState === "healthy" ? "ready" : "pending";
  const connectionTone = (connection: Connection) => connection.healthState === "healthy" ? "ready" : connection.healthState === "failed" ? "failed" : "pending";
  const attentionCount = repositories.filter((repository) => repoTone(repository) === "failed").length;
  const detail = selectedRepository && repositoryDetail?.repositoryId === selectedRepository.id ? repositoryDetail.data : null;

  return (
    <section className="scm" aria-label="Repositories">
      <header className="scm-bar">
        <ClusterSegmentedControl value={sourceView} onChange={(value) => setSourceView(value)} label="Source control view" options={[{ value: "repositories", label: `Repositories ${repositories.length}` }, { value: "connections", label: `Connections ${connections.length}` }]} />
        {sourceView === "repositories" && repositories.length ? <>
          <label className="scm-search"><ClusterIcon name="search" aria-hidden="true" /><input type="search" value={repositoryQuery} onChange={(event) => setRepositoryQuery(event.target.value)} placeholder="Find a repository" aria-label="Search repositories" /></label>
          <ClusterSegmentedControl value={repositoryScope} onChange={(value) => setRepositoryScope(value)} label="Filter repositories" options={[{ value: "all", label: "All" }, { value: "attention", label: attentionCount ? `Attention ${attentionCount}` : "Attention" }, { value: "linked", label: "Linked" }]} />
        </> : null}
        {status && !initialLoading ? <span className="scm-msg" role="status">{status}</span> : null}
        <span className="scm-bar__end">
          {sourceView === "repositories"
            ? <ClusterButton size="compact" variant={repositoryFormOpen ? "quiet" : "primary"} onClick={() => setRepositoryFormOpen((open) => !open)}><ClusterIcon name={repositoryFormOpen ? "close" : "plus"} />{repositoryFormOpen ? "Cancel" : "New repository"}</ClusterButton>
            : <ClusterButton size="compact" variant={connectionFormOpen ? "quiet" : "primary"} onClick={() => { if (connectionFormOpen) { resetConnectionForm(providerId); setConnectionFormOpen(false); } else { resetConnectionForm(providerId); setConnectionFormOpen(true); } }}><ClusterIcon name={connectionFormOpen ? "close" : "plus"} />{connectionFormOpen ? "Cancel" : "Add connection"}</ClusterButton>}
        </span>
      </header>

      {sourceView === "repositories" && repositoryFormOpen ? <div className="scm-form" aria-label="New repository">
        <label className="scm-field scm-field--grow"><span>Name</span><ClusterTextInput value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="Game" autoFocus /></label>
        <label className="scm-field"><span>Hosted by</span><ClusterSelect ariaLabel="Repository host" value={repositoryConnectionId} onChange={(id) => { setRepositoryConnectionId(id); if (!id) setRemoteUrl(""); }} options={[{ value: "", label: "Cluster" }, ...connections.map((connection) => ({ value: connection.id, label: connection.displayName }))]} /></label>
        {repositoryConnectionId
          ? <label className="scm-field scm-field--grow"><span>Remote URL</span><ClusterTextInput value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://…/studio/game.git" /></label>
          : <div className="scm-field"><span>Template</span><ClusterSegmentedControl value={repositoryTemplate} onChange={setRepositoryTemplate} label="Repository template" options={[{ value: "unreal", label: "Unreal", title: "LFS, lockable .uasset/.umap, Unreal .gitignore" }, { value: "software", label: "Software" }, { value: "generic", label: "Generic" }]} /></div>}
        <label className="scm-field scm-field--narrow"><span>Branch</span><ClusterTextInput value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} placeholder="main" /></label>
        <ClusterButton size="compact" variant="primary" busy={busy} busyLabel="Creating…" disabled={busy || !repositoryName.trim() || Boolean(repositoryConnectionId && !remoteUrl.trim())} onClick={() => void addRepository()}>Create</ClusterButton>
      </div> : null}

      {sourceView === "repositories" ? (initialLoading ? <p className="scm-empty">Loading…</p> : !repositories.length && !repositoryFormOpen ? <div className="scm-none">
        <ClusterIcon name="code" aria-hidden="true" />
        <b>No repositories</b>
        <span>Create one here, then link it from a project's settings.</span>
        <ClusterButton size="compact" variant="primary" onClick={() => setRepositoryFormOpen(true)}><ClusterIcon name="plus" />New repository</ClusterButton>
      </div> : repositories.length ? <div className="scm-split">
        <ul className="scm-list" aria-label="Repositories">
          {visibleRepositories.map((repository) => <li key={repository.id}>
            <button type="button" className="scm-repo" aria-current={selectedRepositoryId === repository.id || undefined} onClick={() => setSelectedRepositoryId(repository.id)}>
              <i data-state={repoTone(repository)} aria-hidden="true" />
              <span className="scm-repo__name"><b>{repository.name}</b><small>{repository.connection ? repository.connection.displayName : "Cluster"} · {repository.defaultBranch}</small></span>
              <span className="scm-repo__nums"><span title="Commits indexed">{repository._count?.commits || 0}<small>commits</small></span><span title="Linked projects">{repository._count?.projects || 0}<small>projects</small></span></span>
            </button>
          </li>)}
          {!visibleRepositories.length ? <li className="scm-empty">No matches.</li> : null}
        </ul>
        <section className="scm-detail" aria-label="Repository details">
          {selectedRepository ? <>
            <header className="scm-detail__head">
              <i data-state={repoTone(selectedRepository)} aria-hidden="true" />
              <h3>{selectedRepository.name}</h3>
              <span className="scm-pill" data-state={repoTone(selectedRepository)}>{repositoryStateLabel(selectedRepository)}</span>
              <span className="scm-detail__actions">
                <ClusterButton size="compact" variant="secondary" disabled={busy || selectedRepository.syncState === "syncing"} onClick={() => void syncRepository(selectedRepository)}><ClusterIcon name="sync" />{selectedRepository.syncState === "syncing" ? "Syncing…" : "Sync"}</ClusterButton>
                <ClusterIconButton size="compact" label="Remove repository" disabled={busy} onClick={() => void removeRepository(selectedRepository)}><ClusterIcon name="trash" /></ClusterIconButton>
              </span>
            </header>
            {selectedRepository.healthMessage && repoTone(selectedRepository) !== "ready" ? <p className="scm-notice" data-state={repoTone(selectedRepository)}>{selectedRepository.healthMessage}</p> : null}
            <dl className="scm-facts">
              <div><dt>Hosted by</dt><dd>{selectedRepository.connection ? `${selectedRepository.connection.displayName} · ${providerLabel(selectedRepository.connection.providerId)}` : "Cluster"}</dd></div>
              {!selectedRepository.connection && selectedRepository.metadata?.template ? <div><dt>Template</dt><dd>{String(selectedRepository.metadata.template).replace(/^./, (c) => c.toUpperCase())}</dd></div> : null}
              <div><dt>Default branch</dt><dd>{selectedRepository.defaultBranch}</dd></div>
              <div><dt>Head</dt><dd><code title={selectedRepository.headRevision || undefined}>{selectedRepository.headRevision?.slice(0, 10) || "—"}</code></dd></div>
              <div><dt>Last sync</dt><dd>{selectedRepository.lastSyncedAt ? new Date(selectedRepository.lastSyncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never"}</dd></div>
              <div><dt>Projects</dt><dd>{selectedRepository.projects?.length ? selectedRepository.projects.map((link) => link.project?.name || link.projectId).join(", ") : "None"}</dd></div>
              {selectedRepository.remoteUrl ? <div className="scm-facts__wide"><dt>Remote</dt><dd><code>{selectedRepository.remoteUrl}</code><ClusterIconButton size="compact" label="Copy remote URL" onClick={() => void copyClusterText(selectedRepository.remoteUrl!).then((copied) => setStatus(copied ? "Remote URL copied." : "Clipboard unavailable."))}><ClusterIcon name="link" /></ClusterIconButton></dd></div> : null}
            </dl>
            {repositoryDetailError ? <p className="scm-notice" data-state="failed">{repositoryDetailError}</p> : null}
            {detail ? <>
              <h4 className="scm-sub">Branches <small>{detail.branches.length}</small></h4>
              {detail.branches.length ? <div className="scm-chips">{detail.branches.slice(0, 24).map((branch) => <span key={branch.id || branch.name} data-default={branch.isDefault || undefined} title={branch.headRevision || undefined}>{branch.name}</span>)}</div> : <p className="scm-empty">Sync to load branches.</p>}
              <h4 className="scm-sub">Recent commits</h4>
              {detail.commits.length ? <ul className="scm-commits">{detail.commits.slice(0, 10).map((commit) => <li key={commit.id || commit.revision}>
                <code title={commit.revision}>{commit.revision.slice(0, 8)}</code>
                <b title={commit.message}>{commit.message.split("\n")[0]}</b>
                <small>{[commit.authorName, commit.committedAt ? new Date(commit.committedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · ")}</small>
              </li>)}</ul> : <p className="scm-empty">No commits indexed yet.</p>}
            </> : repositoryDetailLoading ? <p className="scm-empty">Loading…</p> : null}
          </> : <div className="scm-detail__empty"><ClusterIcon name="code" aria-hidden="true" /><span>Select a repository</span></div>}
        </section>
      </div> : null) : null}

      {sourceView === "connections" && connectionFormOpen ? <div className="scm-form" aria-label={isEditingConnection ? "Edit connection" : "New connection"}>
        <label className="scm-field"><span>Provider</span><ClusterSelect ariaLabel="Source Control provider" value={providerId} onChange={(value) => { if (!isEditingConnection) setProviderId(value); }} options={providerOptions} disabled={isEditingConnection} /></label>
        <label className="scm-field scm-field--grow"><span>Name</span><ClusterTextInput value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="Studio Git" /></label>
        <label className="scm-field scm-field--grow"><span>Server URL</span><ClusterTextInput value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={providerId === "source.github" ? "https://github.com" : providerId === "source.gitlab" ? "https://gitlab.com" : "https://git.example.com"} /></label>
        <label className="scm-field scm-field--grow"><span>API URL</span><ClusterTextInput value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="Auto" /></label>
        <label className="scm-field scm-field--grow"><span>Access token</span><ClusterTextInput type="password" value={sourceToken} onChange={(event) => { setSourceToken(event.target.value); if (event.target.value) setClearSourceToken(false); }} placeholder={sourceTokenConfigured ? "Saved · type to replace" : "Token"} /></label>
        <div className="scm-field"><span>Private network</span><ClusterSegmentedControl value={allowPrivateNetwork ? "allow" : "block"} onChange={(value) => setAllowPrivateNetwork(value === "allow")} label="Private network access" options={[{ value: "block", label: "Block" }, { value: "allow", label: "Allow" }]} /></div>
        {isEditingConnection && sourceTokenConfigured ? <div className="scm-field"><span>Saved token</span><ClusterSegmentedControl value={clearSourceToken ? "remove" : "keep"} onChange={(value) => { setClearSourceToken(value === "remove"); if (value === "remove") setSourceToken(""); }} label="Stored token action" options={[{ value: "keep", label: "Keep" }, { value: "remove", label: "Remove" }]} /></div> : null}
        <ClusterButton size="compact" variant="primary" busy={busy} busyLabel="Saving…" disabled={busy || !connectionName.trim() || !providerId} onClick={() => void saveSourceConnection()}>{isEditingConnection ? "Save" : "Add"}</ClusterButton>
      </div> : null}

      {sourceView === "connections" ? (connections.length ? <ul className="scm-conns" aria-label="Connections">
        {connections.map((connection) => <li key={connection.id}>
          <i data-state={connectionTone(connection)} aria-hidden="true" />
          <span className="scm-repo__name"><b>{connection.displayName}</b><small>{providerLabel(connection.providerId)}</small></span>
          <span className="scm-conns__url">{connection.configuration?.baseUrl || connection.configuration?.apiBaseUrl || "Provider default"}</span>
          <span className="scm-conns__token" data-on={connection.configuration?.tokenConfigured || undefined}><ClusterIcon name="lock" aria-hidden="true" />{connection.configuration?.tokenConfigured ? "Token" : "No token"}</span>
          <span className="scm-conns__check" title={connection.healthMessage || undefined}>{connection.lastCheckedAt ? `Checked ${new Date(connection.lastCheckedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Not checked"}</span>
          <span className="scm-detail__actions">
            <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void checkConnection(connection)}>Check</ClusterButton>
            <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => editConnection(connection)}>Edit</ClusterButton>
            <ClusterIconButton size="compact" label="Remove connection" disabled={busy} onClick={() => void archiveConnection(connection)}><ClusterIcon name="trash" /></ClusterIconButton>
          </span>
        </li>)}
      </ul> : !connectionFormOpen ? <div className="scm-none">
        <ClusterIcon name="link" aria-hidden="true" />
        <b>No connections</b>
        <span>Only needed for repositories hosted on GitHub, GitLab or Gitea.</span>
      </div> : null) : null}
    </section>
  );
}

export function IntegrationsAdminPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [displayName, setDisplayName] = useState("Studio Discord");
  const [guildId, setGuildId] = useState("");
  const [forumChannelId, setForumChannelId] = useState("");
  const [chatChannelId, setChatChannelId] = useState("");
  const [adminRoleId, setAdminRoleId] = useState("");
  const [messagePrefix, setMessagePrefix] = useState("Cluster");
  const [applicationId, setApplicationId] = useState("");
  const [applicationPublicKey, setApplicationPublicKey] = useState("");
  const [applicationPublicKeyConfigured, setApplicationPublicKeyConfigured] = useState(false);
  const [discordOAuthReady, setDiscordOAuthReady] = useState(false);
  const [discordOAuthAppMatches, setDiscordOAuthAppMatches] = useState(true);
  const [discordOAuthRedirectUri, setDiscordOAuthRedirectUri] = useState("");
  const [discordWorkspaceView, setDiscordWorkspaceView] = useState<"dashboard" | "configuration" | "bot" | "delivery">("dashboard");
  const [deliverySummary, setDeliverySummary] = useState<DiscordDeliverySummary | null>(null);
  const [botToken, setBotToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botTokenConfigured, setBotTokenConfigured] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [status, setStatus] = useState("Loading integrations…");
  const [busy, setBusy] = useState(false);
  const [integrationView, setIntegrationView] = useState<"connected" | "catalog" | "discord">("connected");
  const [discordBotState, setDiscordBotState] = useState<{ state: string; managed: boolean; message: string | null } | null>(null);
  const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; primary: boolean; name?: string | null; iconUrl?: string | null; reachable?: boolean }>>([]);
  const [discordLinkCoverage, setDiscordLinkCoverage] = useState<{ active: number; linked: number; unlinked: number } | null>(null);
  const [newDiscordGuild, setNewDiscordGuild] = useState("");
  const [selectedRoleGuild, setSelectedRoleGuild] = useState("");
  const [discordRoleStatus, setDiscordRoleStatus] = useState<DiscordRoleStatus | null>(null);
  const [discordRolePreview, setDiscordRolePreview] = useState<DiscordRolePreview | null>(null);
  const [roleSourceKind, setRoleSourceKind] = useState<"accountType" | "team">("accountType");
  const [roleSourceId, setRoleSourceId] = useState("employee");
  const [roleIdToMap, setRoleIdToMap] = useState("");

  async function load(force = false) {
    try {
      const [providerResult, connectionResult, configurationResult, deliveryResult] = await Promise.all([
        queryApi<{ providers: Provider[] }>("/api/admin/integrations/providers", { force, staleMs: 15_000, tags: ["integrations"] }),
        queryApi<{ connections: Connection[] }>("/api/admin/integrations/connections", { force, staleMs: 5_000, tags: ["integrations"] }),
        queryApi<{ connection: Connection | null; configuration: { guildId: string; forumChannelId: string; chatChannelId: string; adminRoleId: string; messagePrefix: string; applicationId: string; applicationPublicKeyConfigured: boolean; botTokenConfigured: boolean; webhookConfigured: boolean; oauthConfigured?: boolean; oauthApplicationMatches?: boolean; oauthRedirectUri?: string; interactionEndpoint?: string } }>("/api/admin/discord/configuration", { force, staleMs: 5_000, tags: ["integrations", "discord"] }),
        queryApi<DiscordDeliverySummary>("/api/admin/discord/status", { force, staleMs: 5_000, tags: ["integrations", "discord"] }).catch(() => null),

      ]);
      const nextProviders = providerResult.providers || [];
      setProviders(nextProviders);
      const integrationProviderIds = new Set(nextProviders.filter((provider) => provider.category !== "source-control").map((provider) => provider.id));
      const externalConnections = (connectionResult.connections || []).filter((connection) => integrationProviderIds.has(connection.providerId));
      const discord = externalConnections.filter((connection) => connection.providerId === "communication.discord");
      setConnections(externalConnections);
      setDisplayName(configurationResult.connection?.displayName || "Studio Discord");
      setGuildId(configurationResult.configuration?.guildId || "");
      setForumChannelId(configurationResult.configuration?.forumChannelId || "");
      setChatChannelId(configurationResult.configuration?.chatChannelId || "");
      setAdminRoleId(configurationResult.configuration?.adminRoleId || "");
      setMessagePrefix(configurationResult.configuration?.messagePrefix || "Cluster");
      setApplicationId(configurationResult.configuration?.applicationId || "");
      setApplicationPublicKeyConfigured(Boolean(configurationResult.configuration?.applicationPublicKeyConfigured));
      setDiscordOAuthReady(Boolean(configurationResult.configuration?.oauthConfigured));
      setDiscordOAuthAppMatches(configurationResult.configuration?.oauthApplicationMatches !== false);
      setDiscordOAuthRedirectUri(configurationResult.configuration?.oauthRedirectUri || "");
      setApplicationPublicKey("");
      setDeliverySummary(deliveryResult);
      // Only fetch Discord runtime/guild details when the Discord dashboard is open.
      if (integrationView === "discord") void loadDiscordRuntime();
      setBotTokenConfigured(Boolean(configurationResult.configuration?.botTokenConfigured));
      setWebhookConfigured(Boolean(configurationResult.configuration?.webhookConfigured));
      setBotToken("");
      setWebhookUrl("");
      setStatus(`${externalConnections.length} connected integration${externalConnections.length === 1 ? "" : "s"}`);
    } catch (error) { setStatus(formatApiError(error)); }
  }

  useEffect(() => { void load(); }, []);
  function loadDiscordRuntime() {
    void queryApi<{ bot: { state: string; managed: boolean; message: string | null } }>("/api/admin/integrations/discord/bot", { force: true, tags: ["discord-bot"] })
      .then((value) => setDiscordBotState(value.bot)).catch(() => setDiscordBotState(null));
    void queryApi<{ guilds: Array<{ id: string; primary: boolean; name?: string | null; iconUrl?: string | null; reachable?: boolean }> }>("/api/admin/integrations/discord/guilds", { force: true })
      .then((value) => { setDiscordGuilds(value.guilds || []); setSelectedRoleGuild((old) => old || value.guilds?.[0]?.id || ""); })
      .catch(() => setDiscordGuilds([]));
    void queryApi<{ coverage: { active: number; linked: number; unlinked: number } }>("/api/admin/integrations/discord/link-coverage", { force: true, tags: ["discord-link-coverage"] })
      .then((data) => setDiscordLinkCoverage(data.coverage)).catch(() => setDiscordLinkCoverage(null));
  }
  // One-shot reads on opening the dashboard, not background polling on every admin page.
  useEffect(() => { if (integrationView === "discord") loadDiscordRuntime(); }, [integrationView]);

  const discordProvider = providers.find((provider) => provider.id === "communication.discord");
  const integrationProviders = providers.filter((provider) => provider.category !== "source-control");
  const providerLabel = (providerId: string) => providers.find((provider) => provider.id === providerId)?.label || providerId;

  async function saveDiscordConfiguration() {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ configuration: { botTokenConfigured: boolean; webhookConfigured: boolean; applicationPublicKeyConfigured: boolean } }>("/api/admin/discord/configuration", {
        method: "PUT",
        body: JSON.stringify({
          displayName: displayName.trim(),
          guildId: guildId.trim(),
          forumChannelId: forumChannelId.trim(),
          chatChannelId: chatChannelId.trim(),
          adminRoleId: adminRoleId.trim(),
          messagePrefix: messagePrefix.trim() || "Cluster",
          applicationId: applicationId.trim(),
          ...(applicationPublicKey.trim() ? { applicationPublicKey: applicationPublicKey.trim() } : {}),
          ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
          ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
        }),
      });
      setBotTokenConfigured(Boolean(result.configuration?.botTokenConfigured));
      setWebhookConfigured(Boolean(result.configuration?.webhookConfigured));
      setApplicationPublicKeyConfigured(Boolean(result.configuration?.applicationPublicKeyConfigured));
      setApplicationPublicKey("");
      setBotToken("");
      setWebhookUrl("");
      await load(true);
      setStatus("Discord configuration saved.");
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function approveDiscordGuild() {
    if (!/^\d{8,24}$/.test(newDiscordGuild.trim())) return;
    setBusy(true);
    try {
      const result = await api<{ guilds: Array<{ id: string; primary: boolean; name?: string | null; iconUrl?: string | null; reachable?: boolean }> }>("/api/admin/integrations/discord/guilds", { method: "POST", body: JSON.stringify({ guildId: newDiscordGuild.trim() }) });
      setDiscordGuilds(result.guilds);
      setNewDiscordGuild("");
      setStatus("Discord server approved. Configure its Project routes to enable actions.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }
  async function revokeDiscordGuild(guildId: string) {
    setBusy(true);
    try {
      const result = await api<{ guilds: Array<{ id: string; primary: boolean; name?: string | null; iconUrl?: string | null; reachable?: boolean }> }>(`/api/admin/integrations/discord/guilds/${encodeURIComponent(guildId)}`, { method: "DELETE" });
      setDiscordGuilds(result.guilds);
      setStatus("Discord server access revoked.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }
  async function changeDiscordBot(enabled: boolean) {
    setBusy(true);
    try {
      const result = await api<{ bot: { state: string; managed: boolean; message: string | null } }>("/api/admin/integrations/discord/bot", { method: "PUT", body: JSON.stringify({ enabled }) });
      setDiscordBotState(result.bot);
      setStatus(result.bot.message || (enabled ? "Discord bot starting." : "Discord bot stopped."));
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function sendDiscordTestMessage() {
    if (!/^\d{8,24}$/.test(chatChannelId.trim())) return;
    setBusy(true);
    try {
      const result = await api<{ sent: boolean; channelId: string }>("/api/admin/integrations/discord/test-message", {
        method: "POST", body: JSON.stringify({ channelId: chatChannelId.trim() }),
      });
      setStatus(result.sent ? "Discord test message sent. Check the configured chat channel." : "Discord test message was not sent.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function loadDiscordRoles(guild = selectedRoleGuild) {
    if (!guild) return;
    try {
      const result = await queryApi<DiscordRoleStatus>(`/api/admin/integrations/discord/roles?guildId=${encodeURIComponent(guild)}`, { force: true, tags: ["discord-role-sync"] });
      setDiscordRoleStatus(result);
      setRoleIdToMap((old) => result.roles.some((r) => r.id === old) ? old : result.roles[0]?.id || "");
    } catch (error) { setStatus(formatApiError(error)); }
  }

  async function previewDiscordRoles() {
    try {
      const result = await queryApi<DiscordRolePreview>("/api/admin/integrations/discord/roles/preview", { force: true, tags: ["discord-role-sync"] });
      setDiscordRolePreview(result);
    } catch (error) { setStatus(formatApiError(error)); }
  }

  async function addDiscordRoleMapping() {
    setBusy(true);
    try {
      await api("/api/admin/integrations/discord/roles/mappings", { method: "POST", body: JSON.stringify({ guildId: selectedRoleGuild, roleId: roleIdToMap, sourceKind: roleSourceKind, sourceId: roleSourceId }) });
      setDiscordRolePreview(null);
      await loadDiscordRoles();
      setStatus("Discord role mapping saved. Preview changes before synchronization.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function removeDiscordRoleMapping(id: string) {
    setBusy(true);
    try {
      await api(`/api/admin/integrations/discord/roles/mappings/${encodeURIComponent(id)}`, { method: "DELETE" });
      setDiscordRolePreview(null);
      await loadDiscordRoles();
      setStatus("Mapping removed. Reconcile to revoke only Cluster-managed roles.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function setDiscordRoleSync(enabled: boolean) {
    setBusy(true);
    try {
      await api("/api/admin/integrations/discord/roles/sync", { method: "PUT", body: JSON.stringify({ enabled }) });
      await loadDiscordRoles();
      setDiscordRolePreview(null);
      setStatus(enabled ? "One-way Discord role sync enabled." : "Role sync paused. Existing Discord roles are unchanged until sync is re-enabled.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function reconcileDiscordRoles() {
    setBusy(true);
    try {
      const result = await api<{ applied: number; skipped: number; failed: number; remaining: number; errors: string[] }>("/api/admin/integrations/discord/roles/reconcile", { method: "POST", body: "{}" });
      await Promise.all([loadDiscordRoles(), previewDiscordRoles()]);
      setStatus(`Discord roles: ${result.applied || 0} updated · ${result.skipped || 0} skipped · ${result.failed || 0} failed${result.remaining ? ` · ${result.remaining} more pending` : ""}. ${result.errors?.[0] || ""}`.trim());
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function reconcileDiscord() {
    setBusy(true);
    try {
      const result = await api<{ checked: number; healthy: number; missing: number }>("/api/admin/discord/reconcile", { method: "POST", body: "{}" });
      await load(true);
      setStatus(`${result.healthy}/${result.checked} Discord routes verified${result.missing ? ` · ${result.missing} missing` : ""}.`);
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function syncDiscordActions() {
    setBusy(true);
    try {
      const result = await api<{ commands: Array<{ name: string }>; guilds?: Array<{ guildId: string; ok: boolean }> }>("/api/admin/discord/commands/sync", { method: "POST", body: "{}" });
      const failed = (result.guilds || []).filter((guild) => !guild.ok).length;
      setStatus(failed ? `${failed} Discord server${failed === 1 ? "" : "s"} failed command sync. Check bot access.` : `${result.commands.length} Discord actions synchronized across ${result.guilds?.length || 0} approved servers.`);
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function retryDiscordDelivery(receiptId: string) {
    setBusy(true);
    try {
      await api(`/api/admin/discord/deliveries/${encodeURIComponent(receiptId)}/retry`, { method: "POST", body: "{}" });
      await load(true);
      setStatus("Discord delivery queued for retry.");
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  const connectedIntegrationColumns = useMemo<ClusterDataTableColumn<Connection>[]>(() => [
    { id: "connection", header: "Connection", hideable: false, pinnable: true, defaultWidth: 240, sortValue: (connection) => connection.displayName, cell: (connection) => <strong>{connection.displayName}</strong> },
    { id: "provider", header: "Provider", defaultWidth: 190, sortValue: (connection) => providerLabel(connection.providerId), cell: (connection) => providerLabel(connection.providerId) },
    { id: "status", header: "Status", defaultWidth: 160, sortValue: (connection) => connection.status, cell: (connection) => <SettingsStateChip tone={integrationStateTone(connection.status)} icon={integrationStateIcon(connection.status)}>{connectionStateLabel(connection.status)}</SettingsStateChip> },
    { id: "health", header: "Health", defaultWidth: 260, sortValue: (connection) => connection.healthState, cell: (connection) => <span className="admin-integration-health-cell-v103"><SettingsStateChip tone={integrationStateTone(connection.healthState)} icon={integrationStateIcon(connection.healthState)}>{connection.healthState === "healthy" ? "Last check healthy" : connectionStateLabel(connection.healthState)}</SettingsStateChip><small>{connection.healthMessage || "No connection health message"}</small>{connection.lastCheckedAt && <small>Checked {new Date(connection.lastCheckedAt).toLocaleString()}</small>}</span> },
  ], [providers]);
  const discordFailureColumns = useMemo<ClusterDataTableColumn<DiscordDeliveryFailure>[]>(() => [
    { id: "failure", header: "Failure", hideable: false, pinnable: true, defaultWidth: 360, sortValue: (failure) => failure.error, cell: (failure) => <span><strong>{failure.error}</strong><small>{failure.channelId ? `Destination ${failure.channelId}` : "No destination recorded"}</small></span> },
    { id: "attempts", header: "Attempts", defaultWidth: 120, sortValue: (failure) => failure.attempts, cell: (failure) => failure.attempts },
    { id: "updated", header: "Updated", defaultWidth: 210, sortValue: (failure) => failure.updatedAt, cell: (failure) => new Date(failure.updatedAt).toLocaleString() },
    { id: "project", header: "Project", defaultWidth: 180, hiddenByDefault: true, sortValue: (failure) => failure.projectId || "", cell: (failure) => failure.projectId || "—" },
    { id: "actions", header: "Actions", hideable: false, pinnable: false, defaultWidth: 150, cell: (failure) => <ClusterButton variant="secondary" size="compact" disabled={busy} onClick={() => void retryDiscordDelivery(failure.id)}>Retry delivery</ClusterButton> },
  ], [busy]);

  return (
    <AdminSurface title="Integrations" description="Connect external services around Cluster. Native Source Control stays inside Projects and Tool Infrastructure." status={status}>
      <div className="admin-integration-nav-v535"><ClusterSegmentedControl value={integrationView} onChange={setIntegrationView} label="Integration workspace" options={[{ value: "connected", label: "Connected" }, { value: "catalog", label: "Catalog" }, { value: "discord", label: "Discord" }]} /></div>
      {integrationView !== "discord" ? <ClusterMetricStrip label="Integration summary" items={[{ label: "Connected", value: connections.length, detail: "external service connections" }, { label: "Providers", value: integrationProviders.filter((provider) => provider.implementation === "active").length, detail: "active providers" }, { label: "Discord provider", value: discordProvider?.implementation === "active" ? "Available" : "Unavailable", detail: botTokenConfigured || webhookConfigured ? "Credentials configured · health unverified" : "Setup available", tone: discordProvider?.implementation === "active" ? "neutral" : "warning" }, { label: "Project routes", value: deliverySummary?.routeCount || 0, detail: `${deliverySummary?.projectCount || 0} linked projects` }]} /> : null}
      {integrationView === "connected" ? <section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3><ClusterIcon name="link" aria-hidden="true" /> Connected integrations</h3><p>Saved connections and the latest observed health. A configured integration isn't necessarily reachable.</p></div><ClusterButton variant="secondary" size="compact" onClick={() => setIntegrationView("catalog")}><ClusterIcon name="plus" aria-hidden="true" /> Browse catalog</ClusterButton></div><ClusterDataTable rows={connections} columns={connectedIntegrationColumns} rowKey={(connection) => connection.id} rowLabel={(connection) => connection.displayName} label="Connected integrations" configurableColumns persistKey="admin-connected-integrations" onRowActivate={(connection) => { if (connection.providerId === "communication.discord") setIntegrationView("discord"); }} empty={<ClusterEmptyState title="No integrations connected" description="Open the catalog to see available external providers." actions={<ClusterButton variant="primary" onClick={() => setIntegrationView("catalog")}>Open catalog</ClusterButton>} />} /></section> : null}
      {integrationView === "catalog" ? <IntegrationProvidersPanel excludeCategories={["source-control"]} /> : null}
      {integrationView === "discord" ? <>
      <section className="admin-panel-v243 cluster-discord-dashboard-v548" aria-label="Discord bot management dashboard">
        <div className="admin-section-heading-v243"><div><h3><ResourceIdentityMark iconId="brand:discord" label="Discord" /> Discord management</h3><p>Bot runtime, account linking, approved servers and delivery health.</p></div>
          <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void load(true)}><ClusterIcon name="refresh" /> Refresh</ClusterButton></div>
        <ClusterSegmentedControl value={discordWorkspaceView} onChange={(next) => setDiscordWorkspaceView(next as typeof discordWorkspaceView)} label="Discord management views" options={[
          { value: "dashboard", label: "Dashboard" }, { value: "configuration", label: "Setup" }, { value: "bot", label: "Bot & servers" }, { value: "delivery", label: "Deliveries" },
        ]} />
        {discordWorkspaceView === "dashboard" ? <>
          <div className="cluster-discord-health-grid-v548">
            <div><span><ClusterIcon name="cloud" aria-hidden="true" /> Gateway</span><SettingsStateChip tone={discordBotState?.state === "connected" ? "success" : discordBotState?.state === "failed" ? "danger" : "neutral"} icon={discordBotState?.state === "connected" ? "check" : "activity"}>{discordBotState?.state === "connected" ? "Last check connected" : discordBotState?.state || "Not checked"}</SettingsStateChip><small>{discordBotState?.managed ? "Managed by Cluster" : "Not running under Cluster"}</small></div>
            <div><span><ClusterIcon name="lock" aria-hidden="true" /> OAuth linking</span><SettingsStateChip tone={discordOAuthReady && discordOAuthAppMatches ? "info" : "warning"} icon="lock">{discordOAuthReady && discordOAuthAppMatches ? "Configured" : "Needs setup"}</SettingsStateChip><small>{discordOAuthReady && !discordOAuthAppMatches ? "Application ID mismatch" : discordOAuthReady ? "Configuration present · test account linking" : "Identity linking unavailable"}</small></div>
            <div><span><ClusterIcon name="users" aria-hidden="true" /> Approved servers</span><strong>{discordGuilds.length}</strong><SettingsStateChip tone={discordGuilds.some((g) => g.reachable === false) ? "warning" : "neutral"}>{discordGuilds.filter((g) => g.reachable === false).length} reported unreachable</SettingsStateChip></div>
            <div><span><ClusterIcon name="link" aria-hidden="true" /> Project routes</span><strong>{deliverySummary?.routeCount ?? "—"}</strong><small>{deliverySummary?.projectCount ?? 0} linked projects</small></div>
          </div>
          {discordLinkCoverage ? <ClusterVisualComposition label="Active accounts linked to Discord" total={discordLinkCoverage.active} parts={[
            { label: "Linked", value: discordLinkCoverage.linked, tone: "good" },
            { label: "Not linked", value: discordLinkCoverage.unlinked, tone: "neutral" },
          ]} /> : <p className="muted">Account linking coverage not yet available.</p>}
          {deliverySummary ? <ClusterVisualComposition label="Notification delivery" total={deliverySummary.deliveries.completed + deliverySummary.deliveries.pending + deliverySummary.deliveries.running + deliverySummary.deliveries.failed} parts={[
            { label: "Delivered", value: deliverySummary.deliveries.completed, tone: "good" },
            { label: "Queued", value: deliverySummary.deliveries.pending, tone: "neutral" },
            { label: "Running", value: deliverySummary.deliveries.running, tone: "accent" },
            { label: "Failed", value: deliverySummary.deliveries.failed, tone: "danger" },
          ]} /> : null}
          <div className="button-row">
            <ClusterButton type="button" variant="primary" disabled={busy || !botTokenConfigured || !applicationId.trim() || !guildId.trim()} onClick={() => void changeDiscordBot(true)}><ClusterIcon name="play" /> Start / restart</ClusterButton>
            <ClusterButton type="button" variant="secondary" disabled={busy || !discordBotState?.managed} onClick={() => void changeDiscordBot(false)}>Stop bot</ClusterButton>
            <ClusterButton type="button" variant="secondary" onClick={() => setDiscordWorkspaceView("configuration")}>Configure OAuth</ClusterButton>
            <ClusterButton type="button" variant="secondary" onClick={() => setDiscordWorkspaceView("bot")}>Manage servers</ClusterButton>
            <ClusterButton type="button" variant="secondary" onClick={() => setDiscordWorkspaceView("delivery")}>Delivery details</ClusterButton>
          </div>
          {!discordOAuthReady || !discordOAuthAppMatches ? <p className="warning" role="status">Discord bot credentials and user OAuth are separate. Complete OAuth setup before anyone can link an account.</p> : null}
          {deliverySummary?.deliveries.failed ? <p role="alert" className="warning">{deliverySummary.deliveries.failed} Discord deliveries need attention. Open Deliveries to inspect and retry.</p> : null}
        </> : null}
      </section>
      {discordWorkspaceView === "configuration" ? <section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Discord</h3><p>Studio connection and credentials. Project routing remains attached to each project.</p></div><span className={`soft-pill ${discordProvider?.implementation === "active" ? "good" : "warning"}`}>{discordProvider?.implementation === "active" ? "Available" : "Unavailable"}</span></div><div className="admin-tool-field-grid-v232"><label><span>Connection name</span><ClusterTextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Studio Discord" /></label><label><span>Server ID</span><ClusterTextInput value={guildId} onChange={(event) => setGuildId(event.target.value)} placeholder="Discord server ID" /></label><label><span>Bot token</span><ClusterTextInput type="password" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={botTokenConfigured ? "Configured · enter a value to replace" : "Bot token"} /></label><label><span>Webhook URL</span><ClusterTextInput type="password" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={webhookConfigured ? "Configured · enter a value to replace" : "Optional Discord webhook URL"} /></label><label><span>Forum channel ID</span><ClusterTextInput value={forumChannelId} onChange={(event) => setForumChannelId(event.target.value)} placeholder="Optional" /></label><label><span>Chat channel ID</span><ClusterTextInput value={chatChannelId} onChange={(event) => setChatChannelId(event.target.value)} placeholder="Optional" /></label><label><span>Admin role ID</span><ClusterTextInput value={adminRoleId} onChange={(event) => setAdminRoleId(event.target.value)} placeholder="Optional" /></label><label><span>Message prefix</span><ClusterTextInput value={messagePrefix} onChange={(event) => setMessagePrefix(event.target.value)} placeholder="Cluster" /></label><label><span>Application ID</span><ClusterTextInput value={applicationId} onChange={(event) => setApplicationId(event.target.value)} placeholder="Required for Discord actions" /></label><label><span>Application public key</span><ClusterTextInput type="password" value={applicationPublicKey} onChange={(event) => setApplicationPublicKey(event.target.value)} placeholder={applicationPublicKeyConfigured ? "Configured · enter a value to replace" : "Required for signed Discord actions"} /></label></div>{!discordOAuthReady ? <p className="warning" role="status">Discord account linking is not configured. Add DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI to the server environment, then restart Cluster. Bot installation alone does not enable user linking.</p> : !discordOAuthAppMatches ? <p className="warning" role="status">Discord OAuth uses a different Application ID than the configured bot. Verify that both settings refer to the intended Discord application.</p> : <p className="muted">Discord account linking is available.</p>}
        <details className="cluster-visual-advanced"><summary>Set up account linking (OAuth)</summary><div className="cluster-visual-advanced__body">
          <p>1. In the Discord Developer Portal, open your application's OAuth2 settings. Add the public callback URL below as a redirect.</p>
          <code>{discordOAuthRedirectUri || `${typeof window !== "undefined" ? window.location.origin : "https://your-cluster-domain"}/api/auth/discord/callback`}</code>
          <p>2. Configure <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code>, and <code>DISCORD_REDIRECT_URI</code> in the Cluster server environment. Restart the server. The Application ID must match your configured bot.</p>
          <p>3. Members can open Account Settings → Profile → Discord account and link themselves. Discord roles never grant Cluster access.</p>
          <p className="muted">Use your externally reachable HTTPS hostname, not localhost, when people will link from other devices. Tokens and client secrets must never be entered into a public URL.</p>
        </div></details>
        <div className="button-row admin-integration-detail-actions-v535"><ClusterButton variant="primary" disabled={busy || !displayName.trim() || discordProvider?.implementation !== "active"} onClick={() => void saveDiscordConfiguration()}>{busy ? "Saving…" : "Save connection"}</ClusterButton><ClusterButton variant="secondary" disabled={busy} onClick={() => void reconcileDiscord()}>Test connection</ClusterButton><ClusterButton variant="secondary" disabled={busy || !botTokenConfigured || !applicationId.trim() || !applicationPublicKeyConfigured} onClick={() => void syncDiscordActions()}>Sync actions</ClusterButton><ClusterButton variant="secondary" disabled={busy || !botTokenConfigured || !/^\d{8,24}$/.test(chatChannelId.trim())} onClick={() => void sendDiscordTestMessage()}>Send test message</ClusterButton></div></section> : null}
      {discordWorkspaceView === "bot" ? <section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Discord bot</h3><p>Hosted by Cluster. Discord server installation does not grant Cluster access.</p></div><span className="soft-pill">{discordBotState?.state || "Not started"}</span></div>
        <div className="button-row admin-integration-detail-actions-v535">
          <ClusterButton variant="primary" disabled={busy || !botTokenConfigured || !applicationId.trim() || !guildId.trim()} onClick={() => void changeDiscordBot(true)}>Start / restart bot</ClusterButton>
          <ClusterButton variant="secondary" disabled={busy || !discordBotState?.managed} onClick={() => void changeDiscordBot(false)}>Stop bot</ClusterButton>
          <ClusterButton variant="secondary" disabled={busy} onClick={() => void queryApi<{ bot: { state: string; managed: boolean; message: string | null } }>("/api/admin/integrations/discord/bot", { force: true }).then((value) => setDiscordBotState(value.bot)).catch((error) => setStatus(formatApiError(error)))}>Refresh bot status</ClusterButton>
          {/^\d{8,24}$/.test(applicationId) ? <a href={`https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot%20applications.commands&permissions=3072&integration_type=0`} target="_blank" rel="noopener noreferrer" className="cluster-button">Install on Discord server ↗</a> : null}
          {/^\d{8,24}$/.test(applicationId) ? <a href={`https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot%20applications.commands&permissions=268438528&integration_type=0`} target="_blank" rel="noopener noreferrer" className="cluster-button" title="Requires Manage Roles, View Channel, and Send Messages. The bot's role must be above every mapped role.">Install with Manage Roles</a> : null}
          {/\d{8,24}$/.test(applicationId) ? <a href={`https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot%20applications.commands&permissions=8&integration_type=0`} target="_blank" rel="noopener noreferrer" className="cluster-button" title="Optional: gives the Discord bot server Administrator permissions. It never grants users Cluster permissions.">Install with Discord Administrator</a> : null}
        </div>
        {discordBotState?.message ? <p className="muted" role="status">{discordBotState.message}</p> : null}
        <details><summary>Approved Discord servers ({discordGuilds.length})</summary>
          <div className="button-row"><ClusterTextInput value={newDiscordGuild} onChange={(event) => setNewDiscordGuild(event.target.value)} placeholder="Server ID" />
            <ClusterButton variant="secondary" disabled={busy || !/^\d{8,24}$/.test(newDiscordGuild.trim())} onClick={() => void approveDiscordGuild()}>Approve server</ClusterButton></div>
          {discordGuilds.map((guild) => <div className="button-row" key={guild.id}>
            {guild.iconUrl ? <img src={guild.iconUrl} alt="" loading="lazy" width={28} height={28} style={{ borderRadius: 8 }} /> : <ClusterIcon name="users" width={20} height={20} />}
            <span><strong>{guild.name || `Discord server ${guild.id}`}</strong>{guild.primary ? " · Primary" : ""}{guild.reachable === false ? " · Unreachable" : ""}<small style={{ display: "block" }}>{guild.id}</small></span>
            {!guild.primary ? <ClusterButton variant="danger" size="compact" disabled={busy} onClick={() => void revokeDiscordGuild(guild.id)}>Revoke</ClusterButton> : null}
          </div>)}
        </details>

        <details className="cluster-visual-advanced" onToggle={(event) => { if (event.currentTarget.open) { void loadDiscordRoles(); void previewDiscordRoles(); } }}>
          <summary><ClusterIcon name="users" /> One-way role synchronization</summary>
          <div className="cluster-visual-advanced__body">
            <p className="muted">Cluster → Discord only. Only ordinary roles with no server-wide permissions can be mapped. Disabled by default. Never grants Cluster permissions.</p>
            <div className="button-row">
              <ClusterSelect ariaLabel="Discord role server" value={selectedRoleGuild} options={discordGuilds.map((guild) => ({ value: guild.id, label: guild.name || guild.id }))} onChange={(value) => { setSelectedRoleGuild(value); void loadDiscordRoles(value); }} placeholder="Select approved server" />
              <ClusterButton variant="secondary" disabled={busy || !selectedRoleGuild} onClick={() => void loadDiscordRoles()}>Refresh roles</ClusterButton>
            </div>
            {discordRoleStatus ? <>
              <ClusterVisualComposition label="Cluster-managed Discord role assignments" total={discordRoleStatus.managed + discordRoleStatus.uncertain} parts={[
                { label: "Confirmed", value: discordRoleStatus.managed, tone: "good" },
                { label: "Needs review", value: discordRoleStatus.uncertain, tone: "danger" },
              ]} />
              <div className="button-row">
                <ClusterSelect ariaLabel="Role mapping source" value={roleSourceKind} options={[{ value: "accountType", label: "Account type" }, { value: "team", label: "Team" }]} onChange={(value) => { setRoleSourceKind(value as "accountType" | "team"); setRoleSourceId(value === "team" ? discordRoleStatus.teams[0]?.id || "" : "employee"); }} />
                <ClusterSelect ariaLabel="Source to map" value={roleSourceId} options={(roleSourceKind === "team" ? discordRoleStatus.teams.map((team) => ({ value: team.id, label: team.name })) : discordRoleStatus.accountTypes.map((type) => ({ value: type, label: type })))} onChange={setRoleSourceId} placeholder="Select source" />
                <ClusterSelect ariaLabel="Discord role" value={roleIdToMap} options={discordRoleStatus.roles.map((role) => ({ value: role.id, label: role.name }))} onChange={setRoleIdToMap} placeholder="Select role" />
                <ClusterButton variant="secondary" disabled={busy || !roleSourceId || !roleIdToMap || !selectedRoleGuild} onClick={() => void addDiscordRoleMapping()}><ClusterIcon name="plus" /> Add mapping</ClusterButton>
              </div>
              {discordRoleStatus.mappings.map((mapping) => <div className="button-row" key={mapping.id}>
                <ClusterIcon name="lock" /><span>{mapping.sourceKind === "team" ? discordRoleStatus.teams.find((t) => t.id === mapping.sourceId)?.name || "Team" : mapping.sourceId} → {mapping.guildId === selectedRoleGuild ? discordRoleStatus.roles.find((r) => r.id === mapping.roleId)?.name || mapping.roleId : `${discordGuilds.find((g) => g.id === mapping.guildId)?.name || mapping.guildId} / ${mapping.roleId}`}</span>
                <ClusterButton variant="danger" size="compact" disabled={busy} onClick={() => void removeDiscordRoleMapping(mapping.id)}>Remove</ClusterButton>
              </div>)}
              <div className="button-row">
                <ClusterButton variant={discordRoleStatus.enabled ? "secondary" : "primary"} disabled={busy} onClick={() => void setDiscordRoleSync(!discordRoleStatus.enabled)}>{discordRoleStatus.enabled ? "Pause role sync" : "Enable role sync"}</ClusterButton>
                <ClusterButton variant="secondary" disabled={busy} onClick={() => void previewDiscordRoles()}><ClusterIcon name="search" /> Preview changes</ClusterButton>
                <ClusterButton variant="secondary" disabled={busy || !discordRoleStatus.enabled || !discordRolePreview} onClick={() => void reconcileDiscordRoles()}><ClusterIcon name="refresh" /> Apply previewed changes</ClusterButton>
              </div>
              {discordRolePreview ? <p role="status" className="muted">Preview: {discordRolePreview.grants} possible grants · {discordRolePreview.revokes} Cluster-owned revocations · {discordRolePreview.uncertain} uncertain. Maximum {discordRolePreview.limitPerRun} changes per run; actual actions are revalidated.</p> : null}
              {discordRoleStatus.uncertain > 0 ? <p role="alert" className="warning">Some role assignments have uncertain delivery. Cluster will not automatically remove or claim those roles. Review them in Discord before continuing.</p> : null}
            </> : <p className="muted">Select an approved server and refresh its role list.</p>}
          </div>
        </details>
        <p className="muted">Only approved servers and linked, authorized Cluster users can run actions. Ordinary notifications use Cluster Inbox and its durable delivery queue.</p>
      </section> : null}
      {discordWorkspaceView === "delivery" ? <section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Delivery health</h3></div></div>{deliverySummary && <ClusterVisualComposition label="Discord delivery outcomes" total={deliverySummary.deliveries.completed + deliverySummary.deliveries.pending + deliverySummary.deliveries.running + deliverySummary.deliveries.failed} parts={[
  { label: "Completed", value: deliverySummary.deliveries.completed, tone: "good" },
  { label: "Queued", value: deliverySummary.deliveries.pending, tone: "neutral" },
  { label: "Running", value: deliverySummary.deliveries.running, tone: "accent" },
  { label: "Failed", value: deliverySummary.deliveries.failed, tone: "danger" },
]} />}
{deliverySummary?.deliveries.failed ? <p role="alert" className="warning">{deliverySummary.deliveries.failed} failed deliveries. {deliverySummary.healthMessage || "Review the failures below."}</p> : null}
<details className="cluster-visual-advanced"><summary>Exact delivery counts</summary><div className="cluster-visual-advanced__body"><ClusterMetricStrip label="Discord delivery summary" items={[{ label: PRODUCT_OPERATION_STATES.completed, value: deliverySummary?.deliveries.completed || 0, detail: "deliveries completed", tone: "good" }, { label: PRODUCT_OPERATION_STATES.queued, value: deliverySummary?.deliveries.pending || 0, detail: "waiting for worker" }, { label: PRODUCT_OPERATION_STATES.running, value: deliverySummary?.deliveries.running || 0, detail: "attempts in progress" }, { label: PRODUCT_OPERATION_STATES.failed, value: deliverySummary?.deliveries.failed || 0, detail: deliverySummary?.healthMessage || "No connection health message", tone: deliverySummary?.deliveries.failed ? "warning" : "good" }]} /></div></details><ClusterDataTable rows={deliverySummary?.recentFailures || []} columns={discordFailureColumns} rowKey={(failure) => failure.id} rowLabel={(failure) => failure.error} label="Recent Discord delivery failures" configurableColumns persistKey="admin-discord-delivery-failures" empty={<p className="muted">No failed deliveries.</p>} /></section> : null}</> : null}
    </AdminSurface>
  );
}

const DEFAULT_VERSION_FORMATS: Record<string, string> = {
  semantic: "{major}.{minor}.{patch}",
  "game-development": "{stage}.{major}.{minor}.{patch}",
  calendar: "{year}.{month}.{revision}",
  "film-vfx": "v{major}.{minor}.{revision}",
  "simple-revision": "r{revision}",
  custom: "{major}.{minor}.{patch}",
};

export function VersioningAdminPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [policies, setPolicies] = useState<VersionPolicy[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [name, setName] = useState("Studio game version");
  const [presetKey, setPresetKey] = useState("game-development");
  const [formatTemplate, setFormatTemplate] = useState(DEFAULT_VERSION_FORMATS["game-development"]);
  const [status, setStatus] = useState("Loading version policies…");
  const [busy, setBusy] = useState(false);

  async function load(force = false) {
    try {
      const result = await queryApi<{ policies: VersionPolicy[]; presets: string[] }>("/api/admin/versioning/policies", { force, staleMs: 5_000, tags: ["versioning"] });
      setPolicies(result.policies || []);
      setPresets(result.presets || []);
      setStatus(`${result.policies?.length || 0} version polic${result.policies?.length === 1 ? "y" : "ies"}`);
    } catch (error) { setStatus(formatApiError(error)); }
  }

  useEffect(() => { void load(); }, []);

  async function createPolicy() {
    if (!name.trim() || !formatTemplate.trim()) return;
    setBusy(true);
    try {
      await api("/api/admin/versioning/policies", { method: "POST", body: JSON.stringify({ name: name.trim(), presetKey, formatTemplate: formatTemplate.trim(), isDefault: policies.length === 0, projectOverrideAllowed: true }) });
      await load(true);
      setStatus("Version policy created.");
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  const previewVersion = useMemo(() => formatTemplate
    .replaceAll("{stage}", "A")
    .replaceAll("{major}", "1")
    .replaceAll("{minor}", "4")
    .replaceAll("{patch}", "2")
    .replaceAll("{revision}", "7")
    .replaceAll("{year}", "2026")
    .replaceAll("{month}", "10"), [formatTemplate]);

  const policyColumns = useMemo<ClusterDataTableColumn<VersionPolicy>[]>(() => [
    { id: "name", header: "Policy", minWidth: 180, cell: (policy) => <div><strong>{policy.name}</strong>{policy.isDefault ? <span className="soft-pill good">Default</span> : null}</div> },
    { id: "preset", header: "Preset", minWidth: 130, cell: (policy) => <span>{policy.presetKey.replace(/-/g, " ")}</span> },
    { id: "format", header: "Format", minWidth: 200, cell: (policy) => <code>{policy.formatTemplate}</code> },
    { id: "overrides", header: "Project overrides", minWidth: 130, cell: (policy) => <span>{policy.projectOverrideAllowed ? "Allowed" : "Locked"}</span> },
  ], []);

  return (
    <AdminSurface title="Versioning" description="Studio version rules." status={busy ? "Saving…" : status} embedded={embedded}>
      <ClusterMetricStrip
        label="Versioning summary"
        items={[
          { label: "Policies", value: policies.length, detail: "configured" },
          { label: "Default", value: policies.find((policy) => policy.isDefault)?.name || "None", detail: "studio fallback" },
          { label: "Overrides", value: policies.filter((policy) => policy.projectOverrideAllowed).length, detail: "policies allow project override" },
        ]}
      />
      <div className="versioning-workspace-v532">
        <section className="admin-panel-v243 versioning-policies-v532">
          <div className="admin-section-heading-v243">
            <div><h3>Policies</h3></div>
            <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void load(true)}>Refresh</ClusterButton>
          </div>
          <ClusterDataTable
            rows={policies}
            columns={policyColumns}
            rowKey={(policy) => policy.id}
            rowLabel={(policy) => policy.name}
            label="Version policies"
            configurableColumns
            persistKey="admin-version-policies"
            empty={<div className="versioning-empty-v532"><strong>No version policy yet</strong><span>Create the studio default on the right.</span></div>}
          />
        </section>

        <section className="admin-panel-v243 versioning-create-v532">
          <div className="admin-section-heading-v243"><div><h3>New policy</h3></div></div>
          <div className="versioning-preview-v532"><span>Preview</span><strong>{previewVersion || "—"}</strong><code>{formatTemplate || "No format"}</code></div>
          <div className="versioning-form-v532">
            <label><span>Name</span><ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Preset</span><ClusterSelect ariaLabel="Version policy preset" value={presetKey} onChange={(value) => { setPresetKey(value); setFormatTemplate(DEFAULT_VERSION_FORMATS[value] || DEFAULT_VERSION_FORMATS.custom); }} options={presets.map((preset) => ({ value: preset, label: preset.replace(/-/g, " ") }))} /></label>
            <label className="versioning-format-field-v532"><span>Format</span><ClusterTextInput value={formatTemplate} onChange={(event) => setFormatTemplate(event.target.value)} placeholder="{stage}.{major}.{minor}.{patch}" /></label>
          </div>
          <div className="button-row"><ClusterButton variant="primary" disabled={busy || !name.trim() || !formatTemplate.trim()} onClick={() => void createPolicy()}>Create policy</ClusterButton></div>
        </section>
      </div>
    </AdminSurface>
  );
}
