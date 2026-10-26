import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PRODUCT_CONNECTION_STATES, PRODUCT_OPERATION_STATES } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { api, formatApiError, queryApi } from "../../core/api";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { IntegrationProvidersPanel } from "./IntegrationProvidersPanel";
import "./admin.css";

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
  _count?: { projects: number; branches?: number; commits?: number; changes?: number; operations?: number };
};

type VersionPolicy = {
  id: string;
  name: string;
  presetKey: string;
  formatTemplate: string;
  projectOverrideAllowed: boolean;
  isDefault: boolean;
};

function AdminSurface({ title, description, status, children, embedded = false }: { title: string; description: string; status?: string; children: ReactNode; embedded?: boolean }) {
  if (embedded) return <section className="admin-embedded-surface-v535" aria-label={title}>{children}</section>;
  return (
    <section className="page admin-page-v243">
      <header className="page-header-v243">
        <div><span className="eyebrow">Administration</span><h1>{title}</h1><p>{description}</p></div>
        {status ? <span className="soft-pill">{status}</span> : null}
      </header>
      {children}
    </section>
  );
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="admin-summary-card-v243"><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export function SourceControlAdminPage({ embedded = false }: { embedded?: boolean } = {}) {
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
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [repositoryFormOpen, setRepositoryFormOpen] = useState(false);
  const [status, setStatus] = useState("Loading Source Control…");
  const [busy, setBusy] = useState(false);

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
      if (!editingConnectionId && !nextProviders.some((provider) => provider.id === providerId && provider.category === "source-control" && provider.implementation === "active")) {
        setProviderId(nextProviders.find((provider) => provider.category === "source-control" && provider.implementation === "active")?.id || "source.gitea");
      }
      setStatus(`${repositoryResult.repositories?.length || 0} repositories · ${nextConnections.length} connections`);
    } catch (error) {
      setStatus(formatApiError(error));
    }
  }

  useEffect(() => { void load(); }, []);
  useResourceChangeRefresh(() => load(true), { kinds: ["source_repository", "source_review", "source_commit", "integration_connection", "background_job"], debounceMs: 180 });
  useVisibleRefresh(() => load(true), { intervalMs: 30_000, requireOnline: true });

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
    setBusy(true);
    try {
      await api("/api/admin/source-control/repositories", {
        method: "POST",
        body: JSON.stringify({
          name: repositoryName.trim(),
          connectionId: repositoryConnectionId || null,
          hostingMode: repositoryConnectionId || remoteUrl.trim() ? "remote" : "cluster",
          remoteUrl: remoteUrl.trim() || null,
          cloneUrl: remoteUrl.trim() || null,
          defaultBranch: defaultBranch.trim() || "main",
        }),
      });
      setRepositoryName("");
      setRemoteUrl("");
      setDefaultBranch("main");
      setRepositoryFormOpen(false);
      await load(true);
      setStatus("Repository added.");
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

  const isEditingConnection = Boolean(editingConnectionId);
  const connectionColumns = useMemo<ClusterDataTableColumn<Connection>[]>(() => [
    { id: "connection", header: "Connection", hideable: false, pinnable: true, defaultWidth: 230, sortValue: (connection) => connection.displayName, cell: (connection) => <span><strong>{connection.displayName}</strong><small>{providerLabel(connection.providerId)}</small></span> },
    { id: "health", header: "Health", defaultWidth: 160, sortValue: (connection) => connection.healthState || connection.status, cell: (connection) => <span className={`soft-pill ${connection.healthState === "healthy" ? "good" : connection.healthState === "failed" ? "warning" : ""}`}>{connectionStateLabel(connection.healthState || connection.status)}</span> },
    { id: "endpoint", header: "Endpoint", defaultWidth: 280, sortValue: (connection) => connection.configuration?.baseUrl || connection.configuration?.apiBaseUrl || "", cell: (connection) => connection.configuration?.baseUrl || connection.configuration?.apiBaseUrl || "Provider default" },
    { id: "credentials", header: "Credentials", defaultWidth: 150, sortValue: (connection) => Boolean(connection.configuration?.tokenConfigured), cell: (connection) => connection.configuration?.tokenConfigured ? "Token configured" : "No token" },
    { id: "checked", header: "Last check", defaultWidth: 220, sortValue: (connection) => connection.lastCheckedAt || "", cell: (connection) => <span>{connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString() : "Not checked"}<small>{connection.healthMessage || "No health message"}</small></span> },
    { id: "actions", header: "Actions", hideable: false, pinnable: false, defaultWidth: 300, cell: (connection) => <div className="button-row"><ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => editConnection(connection)}>Edit</ClusterButton><ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void checkConnection(connection)}>Check</ClusterButton><ClusterButton size="compact" variant="danger" disabled={busy} onClick={() => void archiveConnection(connection)}>Remove</ClusterButton></div> },
  ], [busy, sourceProviders]);
  const repositoryColumns = useMemo<ClusterDataTableColumn<Repository>[]>(() => [
    { id: "repository", header: "Repository", hideable: false, pinnable: true, defaultWidth: 240, sortValue: (repository) => repository.name, cell: (repository) => <span><strong>{repository.name}</strong><small>{repository.connection ? `${repository.connection.displayName} · ${providerLabel(repository.connection.providerId)}` : "Cluster native"}</small></span> },
    { id: "state", header: "State", defaultWidth: 160, sortValue: (repository) => repository.syncState || repository.healthState, cell: (repository) => <span className={`soft-pill ${repository.syncState === "failed" || repository.healthState === "failed" ? "warning" : repository.healthState === "healthy" ? "good" : ""}`}>{repositoryStateLabel(repository)}</span> },
    { id: "branch", header: "Default branch", defaultWidth: 160, sortValue: (repository) => repository.defaultBranch, cell: (repository) => repository.defaultBranch },
    { id: "head", header: "Head revision", defaultWidth: 180, sortValue: (repository) => repository.headRevision || "", cell: (repository) => repository.headRevision ? repository.headRevision.slice(0, 12) : "—" },
    { id: "contents", header: "Repository data", defaultWidth: 220, sortValue: (repository) => (repository._count?.commits || 0), cell: (repository) => `${repository._count?.branches || 0} branches · ${repository._count?.commits || 0} commits` },
    { id: "projects", header: "Project links", defaultWidth: 130, sortValue: (repository) => repository._count?.projects || 0, cell: (repository) => repository._count?.projects || 0 },
    { id: "sync", header: "Last sync", defaultWidth: 240, sortValue: (repository) => repository.lastSyncedAt || "", cell: (repository) => repository.lastSyncedAt ? new Date(repository.lastSyncedAt).toLocaleString() : repository.remoteUrl || "Not synchronized" },
    { id: "actions", header: "Actions", hideable: false, pinnable: false, defaultWidth: 150, cell: (repository) => repository.connection ? <ClusterButton size="compact" variant="secondary" disabled={busy || repository.syncState === "syncing"} onClick={() => void syncRepository(repository)}>{repository.syncState === "syncing" ? PRODUCT_OPERATION_STATES.running : "Sync"}</ClusterButton> : <span className="muted">Local</span> },
  ], [busy, sourceProviders]);

  return (
    <AdminSurface title="Source Control" description="Cluster-managed repositories, Git runtime, LFS defaults, and optional remote hosting." status={status} embedded={embedded}>
      <div className="source-control-overview-v524">
        <SummaryCard title="Repositories" value={String(repositories.length)} detail={`${repositories.filter((repository) => repository.healthState === "healthy").length} healthy`} />
        <SummaryCard title="Connections" value={String(connections.length)} detail={connections.some((connection) => connection.healthState === "failed") ? "Needs attention" : "Ready"} />
        <div className="button-row source-control-overview-actions-v524">
          <ClusterButton variant="secondary" onClick={() => { resetConnectionForm(providerId); setConnectionFormOpen((open) => !open); }}>{connectionFormOpen && !isEditingConnection ? "Close" : "Add connection"}</ClusterButton>
          <ClusterButton variant="primary" onClick={() => setRepositoryFormOpen((open) => !open)}>{repositoryFormOpen ? "Close" : "Add repository"}</ClusterButton>
        </div>
      </div>

      {connectionFormOpen ? <section className="admin-panel-v243 source-control-editor-v524">
        <div className="admin-section-heading-v243"><div><h3>{isEditingConnection ? "Edit connection" : "New connection"}</h3><p>Provider, endpoint, and credentials.</p></div><ClusterButton variant="quiet" size="compact" disabled={busy} onClick={() => { resetConnectionForm(providerId); setConnectionFormOpen(false); }}>Close</ClusterButton></div>
        <div className="admin-tool-field-grid-v232 source-control-form-grid-v524">
          <label><span>Provider</span><ClusterSelect ariaLabel="Source Control provider" value={providerId} onChange={(value) => { if (!isEditingConnection) setProviderId(value); }} options={providerOptions} disabled={isEditingConnection} /></label>
          <label><span>Name</span><ClusterTextInput value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="Studio Source Control" /></label>
          <label><span>Server URL</span><ClusterTextInput value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={providerId === "source.github" ? "https://github.com" : providerId === "source.gitlab" ? "https://gitlab.com" : "https://git.example.com"} /></label>
          <label><span>API URL <small>optional</small></span><ClusterTextInput value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="Auto-detect when possible" /></label>
          <label><span>Access token</span><ClusterTextInput type="password" value={sourceToken} onChange={(event) => { setSourceToken(event.target.value); if (event.target.value) setClearSourceToken(false); }} placeholder={sourceTokenConfigured ? "Configured · type to replace" : "Access token"} /></label>
          <div className="source-control-boolean-v524"><span>Private-network server</span><ClusterSegmentedControl value={allowPrivateNetwork ? "allow" : "block"} onChange={(value) => setAllowPrivateNetwork(value === "allow")} label="Private network access" options={[{ value: "block", label: "Block" }, { value: "allow", label: "Allow" }]} /></div>
          {isEditingConnection && sourceTokenConfigured ? <div className="source-control-boolean-v524"><span>Stored token</span><ClusterSegmentedControl value={clearSourceToken ? "remove" : "keep"} onChange={(value) => { setClearSourceToken(value === "remove"); if (value === "remove") setSourceToken(""); }} label="Stored token action" options={[{ value: "keep", label: "Keep" }, { value: "remove", label: "Remove" }]} /></div> : null}
          <div className="button-row source-control-form-actions-v524"><ClusterButton variant="primary" disabled={busy || !connectionName.trim() || !providerId} onClick={() => void saveSourceConnection()}>{busy ? "Saving…" : isEditingConnection ? "Save changes" : "Add connection"}</ClusterButton></div>
        </div>
      </section> : null}

      <section className="admin-panel-v243 source-control-list-v524">
        <div className="admin-section-heading-v243"><div><h3>Connections</h3><p>Credentials and provider health.</p></div></div>
        <ClusterDataTable rows={connections} columns={connectionColumns} rowKey={(connection) => connection.id} rowLabel={(connection) => connection.displayName} label="Source Control connections" configurableColumns persistKey="admin-source-control-connections" empty={<p className="muted">No connections.</p>} />
      </section>

      {repositoryFormOpen ? <section className="admin-panel-v243 source-control-editor-v524">
        <div className="admin-section-heading-v243"><div><h3>New repository</h3><p>Create once, then attach it to projects.</p></div><ClusterButton variant="quiet" size="compact" onClick={() => setRepositoryFormOpen(false)}>Close</ClusterButton></div>
        <div className="admin-tool-field-grid-v232 source-control-form-grid-v524">
          <label><span>Name</span><ClusterTextInput value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="Game repository" /></label>
          <label><span>Connection</span><ClusterSelect ariaLabel="Repository Source Control connection" value={repositoryConnectionId} onChange={setRepositoryConnectionId} placeholder="Cluster native" options={[{ value: "", label: "Cluster native" }, ...connections.map((connection) => ({ value: connection.id, label: `${connection.displayName} · ${providerLabel(connection.providerId)}` }))]} /></label>
          <label><span>Remote URL <small>optional</small></span><ClusterTextInput value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://…" /></label>
          <label><span>Default branch</span><ClusterTextInput value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} placeholder="main" /></label>
          <div className="button-row source-control-form-actions-v524"><ClusterButton variant="primary" disabled={busy || !repositoryName.trim()} onClick={() => void addRepository()}>Add repository</ClusterButton></div>
        </div>
      </section> : null}

      <section className="admin-panel-v243 source-control-list-v524">
        <div className="admin-section-heading-v243"><div><h3>Repositories</h3><p>Reusable repositories available to projects.</p></div></div>
        <ClusterDataTable rows={repositories} columns={repositoryColumns} rowKey={(repository) => repository.id} rowLabel={(repository) => repository.name} label="Source Control repositories" configurableColumns persistKey="admin-source-control-repositories" empty={<p className="muted">No repositories.</p>} />
      </section>
    </AdminSurface>
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
  const [deliverySummary, setDeliverySummary] = useState<DiscordDeliverySummary | null>(null);
  const [botToken, setBotToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botTokenConfigured, setBotTokenConfigured] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [status, setStatus] = useState("Loading integrations…");
  const [busy, setBusy] = useState(false);
  const [integrationView, setIntegrationView] = useState<"connected" | "catalog" | "discord">("connected");

  async function load(force = false) {
    try {
      const [providerResult, connectionResult, configurationResult, deliveryResult] = await Promise.all([
        queryApi<{ providers: Provider[] }>("/api/admin/integrations/providers", { force, staleMs: 15_000, tags: ["integrations"] }),
        queryApi<{ connections: Connection[] }>("/api/admin/integrations/connections", { force, staleMs: 5_000, tags: ["integrations"] }),
        queryApi<{ connection: Connection | null; configuration: { guildId: string; forumChannelId: string; chatChannelId: string; adminRoleId: string; messagePrefix: string; applicationId: string; applicationPublicKeyConfigured: boolean; botTokenConfigured: boolean; webhookConfigured: boolean; interactionEndpoint?: string } }>("/api/admin/discord/configuration", { force, staleMs: 5_000, tags: ["integrations", "discord"] }),
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
      setApplicationPublicKey("");
      setDeliverySummary(deliveryResult);
      setBotTokenConfigured(Boolean(configurationResult.configuration?.botTokenConfigured));
      setWebhookConfigured(Boolean(configurationResult.configuration?.webhookConfigured));
      setBotToken("");
      setWebhookUrl("");
      setStatus(`${externalConnections.length} connected integration${externalConnections.length === 1 ? "" : "s"}`);
    } catch (error) { setStatus(formatApiError(error)); }
  }

  useEffect(() => { void load(); }, []);
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
      const result = await api<{ commands: Array<{ name: string }> }>("/api/admin/discord/commands/sync", { method: "POST", body: "{}" });
      setStatus(`${result.commands.length} Discord action${result.commands.length === 1 ? "" : "s"} synchronized.`);
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
    { id: "status", header: "Status", defaultWidth: 160, sortValue: (connection) => connection.status, cell: (connection) => <span className={`soft-pill ${connection.status === "configured" ? "good" : "warning"}`}>{connectionStateLabel(connection.status)}</span> },
    { id: "health", header: "Health", defaultWidth: 260, sortValue: (connection) => connection.healthState, cell: (connection) => <span><strong>{connectionStateLabel(connection.healthState)}</strong><small>{connection.healthMessage || "No connection health message"}</small></span> },
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
      <ClusterMetricStrip label="Integration summary" items={[{ label: "Connected", value: connections.length, detail: "external service connections" }, { label: "Providers", value: integrationProviders.filter((provider) => provider.implementation === "active").length, detail: "active providers" }, { label: "Discord", value: discordProvider?.implementation === "active" ? PRODUCT_CONNECTION_STATES.healthy : PRODUCT_CONNECTION_STATES.unavailable, detail: botTokenConfigured || webhookConfigured ? "credentials configured" : "setup available", tone: discordProvider?.implementation === "active" ? "good" : "warning" }, { label: "Project routes", value: deliverySummary?.routeCount || 0, detail: `${deliverySummary?.projectCount || 0} linked projects` }]} />
      {integrationView === "connected" ? <section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Connected integrations</h3><p>Connection health and setup state. Provider diagnostics stay in the integration detail.</p></div><ClusterButton variant="secondary" size="compact" onClick={() => setIntegrationView("catalog")}>Browse catalog</ClusterButton></div><ClusterDataTable rows={connections} columns={connectedIntegrationColumns} rowKey={(connection) => connection.id} rowLabel={(connection) => connection.displayName} label="Connected integrations" configurableColumns persistKey="admin-connected-integrations" onRowActivate={(connection) => { if (connection.providerId === "communication.discord") setIntegrationView("discord"); }} empty={<ClusterEmptyState title="No integrations connected" description="Open the catalog to see available external providers." actions={<ClusterButton variant="primary" onClick={() => setIntegrationView("catalog")}>Open catalog</ClusterButton>} />} /></section> : null}
      {integrationView === "catalog" ? <IntegrationProvidersPanel excludeCategories={["source-control"]} /> : null}
      {integrationView === "discord" ? <><section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Discord</h3><p>Studio connection and credentials. Project routing remains attached to each project.</p></div><span className={`soft-pill ${discordProvider?.implementation === "active" ? "good" : "warning"}`}>{discordProvider?.implementation === "active" ? "Available" : "Unavailable"}</span></div><div className="admin-tool-field-grid-v232"><label><span>Connection name</span><ClusterTextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Studio Discord" /></label><label><span>Server ID</span><ClusterTextInput value={guildId} onChange={(event) => setGuildId(event.target.value)} placeholder="Discord server ID" /></label><label><span>Bot token</span><ClusterTextInput type="password" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={botTokenConfigured ? "Configured · enter a value to replace" : "Bot token"} /></label><label><span>Webhook URL</span><ClusterTextInput type="password" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={webhookConfigured ? "Configured · enter a value to replace" : "Optional Discord webhook URL"} /></label><label><span>Forum channel ID</span><ClusterTextInput value={forumChannelId} onChange={(event) => setForumChannelId(event.target.value)} placeholder="Optional" /></label><label><span>Chat channel ID</span><ClusterTextInput value={chatChannelId} onChange={(event) => setChatChannelId(event.target.value)} placeholder="Optional" /></label><label><span>Admin role ID</span><ClusterTextInput value={adminRoleId} onChange={(event) => setAdminRoleId(event.target.value)} placeholder="Optional" /></label><label><span>Message prefix</span><ClusterTextInput value={messagePrefix} onChange={(event) => setMessagePrefix(event.target.value)} placeholder="Cluster" /></label><label><span>Application ID</span><ClusterTextInput value={applicationId} onChange={(event) => setApplicationId(event.target.value)} placeholder="Required for Discord actions" /></label><label><span>Application public key</span><ClusterTextInput type="password" value={applicationPublicKey} onChange={(event) => setApplicationPublicKey(event.target.value)} placeholder={applicationPublicKeyConfigured ? "Configured · enter a value to replace" : "Required for signed Discord actions"} /></label></div><div className="button-row admin-integration-detail-actions-v535"><ClusterButton variant="primary" disabled={busy || !displayName.trim() || discordProvider?.implementation !== "active"} onClick={() => void saveDiscordConfiguration()}>{busy ? "Saving…" : "Save connection"}</ClusterButton><ClusterButton variant="secondary" disabled={busy} onClick={() => void reconcileDiscord()}>Test connection</ClusterButton><ClusterButton variant="secondary" disabled={busy || !botTokenConfigured || !applicationId.trim() || !applicationPublicKeyConfigured} onClick={() => void syncDiscordActions()}>Sync actions</ClusterButton></div></section><section className="admin-panel-v243"><div className="admin-section-heading-v243"><div><h3>Delivery health</h3><p>Diagnostics stay inside this provider detail instead of taking over Integrations.</p></div></div><ClusterMetricStrip label="Discord delivery summary" items={[{ label: PRODUCT_OPERATION_STATES.completed, value: deliverySummary?.deliveries.completed || 0, detail: "deliveries completed", tone: "good" }, { label: PRODUCT_OPERATION_STATES.queued, value: deliverySummary?.deliveries.pending || 0, detail: "waiting for worker" }, { label: PRODUCT_OPERATION_STATES.running, value: deliverySummary?.deliveries.running || 0, detail: "attempts in progress" }, { label: PRODUCT_OPERATION_STATES.failed, value: deliverySummary?.deliveries.failed || 0, detail: deliverySummary?.healthMessage || "No connection health message", tone: deliverySummary?.deliveries.failed ? "warning" : "good" }]} /><ClusterDataTable rows={deliverySummary?.recentFailures || []} columns={discordFailureColumns} rowKey={(failure) => failure.id} rowLabel={(failure) => failure.error} label="Recent Discord delivery failures" configurableColumns persistKey="admin-discord-delivery-failures" empty={<p className="muted">No failed deliveries.</p>} /></section></> : null}
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
