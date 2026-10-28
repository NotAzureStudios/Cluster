import { PRODUCT_CONNECTION_STATES } from "@cluster/shared";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterActionButton } from "../../components/ClusterActionButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../../core/api";
import type { IntegrationConnectionSummary, Project, ProjectIntegrationBinding, ProjectSourceBinding, SourceRepositorySummary } from "../application/application-models";
import { ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";

export type ProjectConnectionsDraft = {
  repositoryId: string;
  discordConnectionId: string;
};

type ConnectionCheck = {
  status: "connected" | "warning" | "failed" | "not_configured";
  message: string;
};

type ConnectionHealth = {
  checkedAt: string;
  git: ConnectionCheck;
  discord: ConnectionCheck;
};


type DiscordRoute = {
  id: string;
  connectionId: string;
  channelId: string;
  guildId?: string | null;
  displayName?: string | null;
  eventClasses: string[];
  minPriority: string;
  mentionMode: "off" | "linked";
  routeKind: "channel" | "thread";
  health: string;
  healthMessage?: string | null;
};

type DiscordChannel = { id: string; name: string; parentId?: string | null; type: number; routeKind: "channel" | "thread"; url?: string | null };

const DISCORD_ROUTE_EVENTS = [
  ["review", "Reviews"], ["source", "Source control"], ["build", "Builds"], ["qa", "QA"], ["ticket", "Tickets"], ["milestone", "Milestones"], ["release", "Releases"], ["system", "System"],
] as const;

type DiscordRoutePreset = "production" | "project-work" | "everything" | "custom";

const DISCORD_ROUTE_PRESETS: Record<Exclude<DiscordRoutePreset, "custom">, { label: string; description: string; events: string[]; priority: string }> = {
  production: { label: "Production essentials", description: "Reviews, builds, QA, and releases that need studio attention.", events: ["review", "build", "qa", "release"], priority: "medium" },
  "project-work": { label: "Project work", description: "Production essentials plus tickets and milestones.", events: ["review", "build", "qa", "ticket", "milestone", "release"], priority: "normal" },
  everything: { label: "All project updates", description: "Every routed project update, including Source Control and system events.", events: ["all"], priority: "normal" },
};

function connectionState(status: string | undefined, linked: boolean, checking = false) {
  if (checking) return PRODUCT_CONNECTION_STATES.checking;
  if (status === "connected") return PRODUCT_CONNECTION_STATES.connected;
  if (status === "warning" || status === "failed") return PRODUCT_CONNECTION_STATES.needsAttention;
  if (linked) return PRODUCT_CONNECTION_STATES.needsAttention;
  return PRODUCT_CONNECTION_STATES.notConnected;
}

function routeHealthLabel(health: string | null | undefined) {
  const value = String(health || "").toLowerCase();
  if (value === "healthy") return PRODUCT_CONNECTION_STATES.healthy;
  if (["missing", "degraded", "failed", "warning"].includes(value)) return PRODUCT_CONNECTION_STATES.needsAttention;
  if (value === "disabled") return PRODUCT_CONNECTION_STATES.disabled;
  return PRODUCT_CONNECTION_STATES.checking;
}

function routeEventLabel(value: string) {
  if (value === "all") return "All project updates";
  return DISCORD_ROUTE_EVENTS.find(([event]) => event === value)?.[1] || value;
}

type ConnectionsCatalog = {
  revision: number;
  sourceBinding: ProjectSourceBinding | null;
  discordBinding: ProjectIntegrationBinding | null;
  repositories: SourceRepositorySummary[];
  discordConnections: IntegrationConnectionSummary[];
};

function activeSourceBinding(project: Project) {
  return (project.sourceBindings || []).find((binding) => binding.isPrimary) || project.sourceBindings?.[0] || null;
}

function activeDiscordBinding(project: Project) {
  return (project.integrationBindings || []).find((binding) => binding.connection?.providerId === "communication.discord" && binding.resourceType === "project")
    || (project.integrationBindings || []).find((binding) => binding.connection?.providerId === "communication.discord")
    || null;
}

const createDraft = (project: Project): ProjectConnectionsDraft => ({
  repositoryId: activeSourceBinding(project)?.repositoryId || "",
  discordConnectionId: activeDiscordBinding(project)?.connectionId || "",
});

export function ProjectConnectionsPanel({ project, canManage, permissionReason, busy, status, onSave }: {
  project: Project;
  canManage: boolean;
  permissionReason: string;
  busy: boolean;
  status: string;
  onSave: (draft: ProjectConnectionsDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectConnectionsDraft>(() => createDraft(project));
  const [catalog, setCatalog] = useState<ConnectionsCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [health, setHealth] = useState<ConnectionHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [discordRoutes, setDiscordRoutes] = useState<DiscordRoute[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; primary: boolean }>>([]);
  const [routeGuildId, setRouteGuildId] = useState("");
  const [routeChannelId, setRouteChannelId] = useState("");
  const [routePreset, setRoutePreset] = useState<DiscordRoutePreset>("production");
  const [routePriority, setRoutePriority] = useState("medium");
  const [routeMentionMode, setRouteMentionMode] = useState<"off" | "linked">("linked");
  const [routeEvents, setRouteEvents] = useState<string[]>(DISCORD_ROUTE_PRESETS.production.events);
  const [discordRouteStatus, setDiscordRouteStatus] = useState("");
  const [discordRouteBusy, setDiscordRouteBusy] = useState(false);

  useEffect(() => setDraft(createDraft(project)), [project.id, project.revision]);
  useEffect(() => { void loadCatalog(); void checkHealth(); void loadDiscordRouting(); }, [project.id, project.revision]);

  const baseline = useMemo(() => createDraft(project), [project]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const connected = Number(Boolean(draft.repositoryId)) + Number(Boolean(draft.discordConnectionId));
  const selectedRepository = catalog?.repositories.find((repository) => repository.id === draft.repositoryId)
    || activeSourceBinding(project)?.repository
    || null;
  const selectedDiscord = catalog?.discordConnections.find((connection) => connection.id === draft.discordConnectionId)
    || activeDiscordBinding(project)?.connection
    || null;

  async function loadCatalog() {
    setCatalogError("");
    try {
      setCatalog(await api<ConnectionsCatalog>(`/api/projects/${project.id}/connections/catalog`));
    } catch (error) {
      setCatalogError(formatApiError(error));
    }
  }

  async function checkHealth() {
    setChecking(true);
    setHealthError("");
    try {
      setHealth(await api<ConnectionHealth>(`/api/projects/${project.id}/connections/health`));
    } catch (error) {
      setHealthError(formatApiError(error));
      throw error;
    } finally {
      setChecking(false);
    }
  }

  async function loadDiscordRouting() {
    try {
      const [routeResult, guildResult] = await Promise.all([
        api<{ routes: DiscordRoute[] }>(`/api/projects/${project.id}/discord/routes`),
        api<{ guilds: Array<{ id: string; primary: boolean }>; primaryGuildId: string }>(`/api/projects/${project.id}/discord/guilds`),
      ]);
      setDiscordGuilds(guildResult.guilds || []);
      const targetGuild = (guildResult.guilds || []).some((guild) => guild.id === routeGuildId) ? routeGuildId : guildResult.primaryGuildId;
      if (targetGuild) setRouteGuildId(targetGuild);
      const channelResult = targetGuild ? await api<{ channels: DiscordChannel[] }>(`/api/projects/${project.id}/discord/channels?guildId=${encodeURIComponent(targetGuild)}`) : { channels: [] };
      setDiscordRoutes(routeResult.routes || []);
      setDiscordChannels(channelResult.channels || []);
      setDiscordRouteStatus("");
    } catch (error) {
      setDiscordRouteStatus(formatApiError(error));
    }
  }

  async function chooseRouteGuild(value: string) {
    setRouteGuildId(value);
    setRouteChannelId("");
    try {
      const result = await api<{ channels: DiscordChannel[] }>(`/api/projects/${project.id}/discord/channels?guildId=${encodeURIComponent(value)}`);
      setDiscordChannels(result.channels || []);
    } catch (error) { setDiscordChannels([]); setDiscordRouteStatus(formatApiError(error)); }
  }

  function applyRoutePreset(value: string) {
    const preset = value as DiscordRoutePreset;
    setRoutePreset(preset);
    if (preset === "custom") return;
    const configuration = DISCORD_ROUTE_PRESETS[preset];
    setRouteEvents(configuration.events);
    setRoutePriority(configuration.priority);
  }

  async function addDiscordRoute() {
    const connectionId = activeDiscordBinding(project)?.connectionId || "";
    if (!connectionId || !routeChannelId || !routeEvents.length) return;
    const channel = discordChannels.find((row) => row.id === routeChannelId);
    setDiscordRouteBusy(true);
    try {
      await api(`/api/projects/${project.id}/discord/routes`, { method: "POST", body: JSON.stringify({ connectionId, guildId: routeGuildId, channelId: routeChannelId, displayName: channel?.name || null, eventClasses: routeEvents, minPriority: routePriority, mentionMode: routeMentionMode, routeKind: channel?.routeKind || "channel" }) });
      setRouteChannelId("");
      await loadDiscordRouting();
      setDiscordRouteStatus("Discord delivery route added.");
    } catch (error) { setDiscordRouteStatus(formatApiError(error)); } finally { setDiscordRouteBusy(false); }
  }

  async function removeDiscordRoute(routeId: string) {
    setDiscordRouteBusy(true);
    try {
      await api(`/api/projects/${project.id}/discord/routes/${routeId}`, { method: "DELETE" });
      await loadDiscordRouting();
      setDiscordRouteStatus("Discord delivery route removed.");
    } catch (error) { setDiscordRouteStatus(formatApiError(error)); } finally { setDiscordRouteBusy(false); }
  }

  async function reconcileDiscordRoutes() {
    setDiscordRouteBusy(true);
    try {
      const result = await api<{ checked: number; healthy: number; missing: number }>(`/api/projects/${project.id}/discord/reconcile`, { method: "POST", body: "{}" });
      await loadDiscordRouting();
      setDiscordRouteStatus(`${result.healthy}/${result.checked} routes verified${result.missing ? ` · ${result.missing} missing` : ""}.`);
    } catch (error) { setDiscordRouteStatus(formatApiError(error)); } finally { setDiscordRouteBusy(false); }
  }

  const healthTone = (value?: ConnectionCheck) => value?.status === "connected" ? "accent" : value?.status === "failed" ? "danger" : value?.status === "warning" ? "warning" : "neutral";
  const statusText = catalogError || healthError || status || (!canManage ? permissionReason : "");

  return (
    <section className="project-subpage-v312 project-connections-v312">
      <ProjectSectionHeader
        eyebrow="Integrations"
        title="Project integrations"
        description="Attach studio-managed source control and communication resources to this project."
        metrics={[
          { label: "Connected", value: `${connected}/2`, tone: connected === 2 ? "good" : connected ? "accent" : "warning" },
          { label: "Repository", value: connectionState(health?.git.status, Boolean(draft.repositoryId), checking), tone: health?.git.status === "failed" ? "danger" : undefined },
          { label: "Discord", value: connectionState(health?.discord.status, Boolean(draft.discordConnectionId), checking), tone: health?.discord.status === "failed" ? "danger" : undefined },
        ]}
        actions={(
          <>
            <ClusterActionButton disabled={checking} action={checkHealth} workingLabel="Checking…" successLabel="Checked" errorLabel="Check failed" variant="secondary">Check health</ClusterActionButton>
            {canManage ? (
              <>
                <span className={`project-unsaved-v312 ${dirty ? "dirty" : ""}`}>{dirty ? "Unsaved changes" : "Up to date"}</span>
                <ClusterActionButton disabled={busy || !dirty} action={() => onSave(draft)} workingLabel="Saving…" successLabel="Saved" errorLabel="Save failed" variant="primary">Save integrations</ClusterActionButton>
              </>
            ) : <span className="project-permission-badge-v316">Read only</span>}
          </>
        )}
      />
      <ProjectSectionStatus tone={statusText.toLowerCase().includes("failed") || catalogError || healthError ? "danger" : canManage ? "good" : "neutral"}>{statusText}</ProjectSectionStatus>
      <div className="project-connection-health-v315">
        <article className={healthTone(health?.git)}><span>Source Control</span><strong>{connectionState(health?.git.status, Boolean(draft.repositoryId), checking)}</strong><p>{health?.git.message || "Check the repository and its Source Control connection."}</p></article>
        <article className={healthTone(health?.discord)}><span>Discord</span><strong>{connectionState(health?.discord.status, Boolean(draft.discordConnectionId), checking)}</strong><p>{health?.discord.message || "Check the project's Discord connection and destination access."}</p></article>
      </div>
      <fieldset className="project-connection-grid-v312 project-permission-fieldset-v316" disabled={!canManage}>
        <ProjectSurface
          title="Source repository"
          description="Repository identity and provider configuration are managed in Tool Infrastructure > Source Control."
          tone={draft.repositoryId ? "accent" : "neutral"}
          action={selectedRepository?.remoteUrl ? <ClusterLinkButton className="" href={selectedRepository.remoteUrl} target="_blank" rel="noreferrer" variant="secondary" size="compact">Open repository</ClusterLinkButton> : null}
        >
          <div className="project-form-grid-v312">
            <label className="field span-2"><span>Repository</span><ClusterSelect ariaLabel="Project source repository" value={draft.repositoryId} onChange={(value) => setDraft((current) => ({ ...current, repositoryId: value }))} placeholder="No repository" options={[{ value: "", label: "No repository" }, ...(catalog?.repositories || []).map((repository) => ({ value: repository.id, label: `${repository.name} · ${repository.defaultBranch}` }))]} /></label>
            <div className="field span-2"><span>Connection</span><strong>{selectedRepository?.connection?.displayName || (selectedRepository?.hostingMode === "cluster" ? "Cluster native" : "Not configured")}</strong></div>
          </div>
        </ProjectSurface>
        <ProjectSurface
          title="Discord"
          description="Select an installed Discord connection. Channel and thread routing stay owned by the Discord integration."
          tone={draft.discordConnectionId ? "accent" : "neutral"}
        >
          <div className="project-form-grid-v312">
            <label className="field span-2"><span>Connection</span><ClusterSelect ariaLabel="Project Discord connection" value={draft.discordConnectionId} onChange={(value) => setDraft((current) => ({ ...current, discordConnectionId: value }))} placeholder="No Discord connection" options={[{ value: "", label: "No Discord connection" }, ...(catalog?.discordConnections || []).map((connection) => ({ value: connection.id, label: connection.displayName }))]} /></label>
            <div className="field span-2"><span>Status</span><strong>{selectedDiscord ? (selectedDiscord.status === "configured" ? PRODUCT_CONNECTION_STATES.configured : PRODUCT_CONNECTION_STATES.needsAttention) : PRODUCT_CONNECTION_STATES.notConnected}</strong></div>
          </div>
          {activeDiscordBinding(project) ? (
            <>
              <div className="project-form-grid-v312">
                {discordGuilds.length > 1 ? <label className="field span-2"><span>Discord server</span><ClusterSelect ariaLabel="Discord server" value={routeGuildId} onChange={(value) => void chooseRouteGuild(value)} options={discordGuilds.map((guild) => ({ value: guild.id, label: guild.primary ? `${guild.id} · Primary` : guild.id }))} /></label> : null}
                <label className="field span-2"><span>Delivery destination</span><ClusterSelect ariaLabel="Discord delivery destination" value={routeChannelId} onChange={setRouteChannelId} placeholder="Choose a channel or thread" options={discordChannels.map((channel) => ({ value: channel.id, label: `${channel.name}${channel.routeKind === "thread" ? " · thread" : ""}` }))} /></label>
                <label className="field span-2"><span>Update preset</span><ClusterSelect ariaLabel="Discord update preset" value={routePreset} onChange={applyRoutePreset} options={[...Object.entries(DISCORD_ROUTE_PRESETS).map(([value, preset]) => ({ value, label: preset.label })), { value: "custom", label: "Custom" }]} /></label>
                <label className="field"><span>Minimum priority</span><ClusterSelect ariaLabel="Discord minimum priority" value={routePriority} onChange={(value) => { setRoutePriority(value); setRoutePreset("custom"); }} options={[{ value: "normal", label: "Normal and above" }, { value: "medium", label: "Medium and above" }, { value: "high", label: "High and critical" }, { value: "critical", label: "Critical only" }]} /></label>
                <label className="field"><span>Mentions</span><ClusterSelect ariaLabel="Discord mention policy" value={routeMentionMode} onChange={(value) => setRouteMentionMode(value as "off" | "linked")} options={[{ value: "linked", label: "Use each person's Discord preference" }, { value: "off", label: "Do not mention people" }]} /></label>
              </div>
              {routePreset !== "custom" ? <p className="muted tight">{DISCORD_ROUTE_PRESETS[routePreset].description}</p> : null}
              {routePreset === "custom" ? <div className="project-form-grid-v312">
                {DISCORD_ROUTE_EVENTS.map(([value, label]) => <label className="tool-check" key={value}><ClusterInput type="checkbox" checked={routeEvents.includes(value)} onChange={(event) => setRouteEvents((current) => event.target.checked ? [...new Set([...current.filter((item) => item !== "all"), value])] : current.filter((item) => item !== value))} /> {label}</label>)}
              </div> : null}
              <div className="button-row"><ClusterButton type="button" variant="primary" disabled={!canManage || discordRouteBusy || !routeChannelId || !routeEvents.length} onClick={() => void addDiscordRoute()}>{discordRouteBusy ? "Working…" : "Add delivery route"}</ClusterButton><ClusterButton type="button" variant="secondary" disabled={!canManage || discordRouteBusy} onClick={() => void reconcileDiscordRoutes()}>Verify routes</ClusterButton></div>
              {discordRouteStatus ? <ProjectSectionStatus tone={discordRouteStatus.toLowerCase().includes("missing") || discordRouteStatus.toLowerCase().includes("failed") ? "warning" : "neutral"}>{discordRouteStatus}</ProjectSectionStatus> : null}
              <div className="admin-summary-grid-v243">
                {discordRoutes.map((route) => <article className="admin-summary-card-v243" key={route.id}><div className="button-row"><strong>{route.displayName || route.channelId}</strong>{route.guildId && discordGuilds.length > 1 ? <small>{route.guildId}</small> : null}<span className={`soft-pill ${route.health === "healthy" ? "good" : route.health === "missing" ? "warning" : ""}`}>{routeHealthLabel(route.health)}</span></div><p>{route.eventClasses.map(routeEventLabel).join(", ")} · {route.minPriority === "normal" ? "Normal and above" : `${route.minPriority.charAt(0).toUpperCase()}${route.minPriority.slice(1)} and above`}</p><small>{route.mentionMode === "linked" ? "Uses each person's Discord mention preference" : "People are not mentioned"}{route.healthMessage ? ` · ${route.healthMessage}` : ""}</small>{canManage ? <div className="button-row"><ClusterButton type="button" variant="danger" size="compact" disabled={discordRouteBusy} onClick={() => void removeDiscordRoute(route.id)}>Remove</ClusterButton></div> : null}</article>)}
                {!discordRoutes.length ? <article className="admin-summary-card-v243"><strong>No delivery routes</strong><p>Add at least one route to send project Inbox updates to Discord.</p></article> : null}
              </div>
            </>
          ) : <p className="muted tight">Save the Discord project connection before adding channel or thread delivery routes.</p>}
        </ProjectSurface>
      </fieldset>
    </section>
  );
}
