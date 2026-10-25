import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { api, queryApi } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { IntegrationProvidersPanel } from "./IntegrationProvidersPanel";

type SyncClient = {
  id: string;
  name: string;
  platform: string;
  clientVersion: string;
  mutationSchemaVersion: number;
  lastSeenAt: string;
  createdAt: string;
};

type SyncClientsResponse = {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  pages: number;
  clients: SyncClient[];
};

type ApiToolPosture = "no-observations" | "insufficient-data" | "observed-healthy" | "warning" | "degraded";
type DependencyPosture = "not-sampled" | "dependency-passing" | "dependency-warning" | "dependency-failed" | "dependency-unknown";
type DependencySignal = { key: string; status: "pass" | "warn" | "fail" | "unknown"; detail: string };
const DEPENDENCY_POSTURE_LABELS: Record<DependencyPosture, string> = {
  "not-sampled": "Not checked yet",
  "dependency-passing": "Dependencies responding",
  "dependency-warning": "Dependency warning",
  "dependency-failed": "Dependency failure",
  "dependency-unknown": "Readiness evidence unavailable",
};
type ApiToolRow = {
  key: string;
  label: string;
  dependencyReadiness?: { posture: DependencyPosture; sampledAt: string | null; dependencies: DependencySignal[] };
  ownerModules: string[];
  routeRoots: string[];
  posture: ApiToolPosture;
  requests: number;
  serverErrors: number;
  serverErrorRate: number;
  observedRoutes: number;
  highestRouteP95Ms: number | null;
  routes: Array<{ route: string; count: number; errors: number; p95Ms: number }>;
};
type ApiToolsResponse = {
  ok: boolean;
  diagnosticOnly: boolean;
  livenessChecked: boolean;
  sampleScope: string;
  dependencyReadiness?: { sampledAt: string | null; stale: boolean; successfulSamples: number; failedSamples: number; perToolEndpointProbed: boolean; inFlight: boolean };
  uptimeSeconds: number;
  tools: ApiToolRow[];
  counts: Record<ApiToolPosture, number>;
  unclassified: { routes: number; requests: number };
};

const API_TOOL_POSTURE_LABELS: Record<ApiToolPosture, string> = {
  "no-observations": "No traffic observed",
  "insufficient-data": "Limited traffic",
  "observed-healthy": "Normal traffic metrics",
  warning: "Elevated errors / latency",
  degraded: "Degraded traffic metrics",
};

type AccelerationCompatibility = {
  checkedAt: string;
  backend: "configured-redis" | "redis" | "memory";
  status: "passed" | "failed" | "unavailable";
  cached?: boolean;
  steps: Array<{ command: string; ok: boolean; code: string }>;
  note: string;
};

type ControlPlaneSnapshot = {
  ok?: boolean;
  generatedAt?: string;
  clients?: { total?: number; active?: number; stale?: number; conflicts?: number; failedReceipts24h?: number };
  media?: { workers?: { total?: number; online?: number }; queue?: { queued?: number; running?: number; failed?: number; deadLetter?: number } };
  queues?: { stalledLeases?: number; rows?: Array<{ queue: string; queued: number; running: number; failed: number; deadLetter: number }> };
  backup?: { enabled?: boolean; generationCount?: number; latestVerificationOk?: boolean | null; latestRestoreDrillOk?: boolean | null };
};

function timeLabel(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

export function OperationsSystemsPanel() {
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
  const [clients, setClients] = useState<SyncClientsResponse | null>(null);
  const [apiTools, setApiTools] = useState<ApiToolsResponse | null>(null);
  const [apiToolError, setApiToolError] = useState("");
  const [dependencyCheckBusy, setDependencyCheckBusy] = useState(false);
  const [dependencyCheckStatus, setDependencyCheckStatus] = useState("");
  const [accelerationCheckBusy, setAccelerationCheckBusy] = useState(false);
  const [accelerationCheck, setAccelerationCheck] = useState<AccelerationCompatibility | null>(null);
  const [accelerationCheckError, setAccelerationCheckError] = useState("");
  const [apiToolQuery, setApiToolQuery] = useState("");
  const [apiToolPosture, setApiToolPosture] = useState<ApiToolPosture | "all">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [state, setState] = useState<"all" | "active" | "stale">("all");
  const [status, setStatus] = useState("Loading system posture...");
  const loadingRef = useRef(false);

  async function load(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setStatus("Loading system posture...");
    try {
      const params = new URLSearchParams({ q: debouncedQuery, state, page: "1", limit: "50" });
      const [nextSnapshot, nextClients, nextApiTools] = await Promise.all([
        queryApi<ControlPlaneSnapshot>("/api/admin/operations/control-plane", { staleMs: 10_000, maxAgeMs: 60_000, persist: false, tags: ["operations"] }),
        queryApi<SyncClientsResponse>(`/api/admin/operations/sync-clients?${params.toString()}`, { staleMs: 10_000, maxAgeMs: 60_000, persist: false, tags: ["operations", "sync-clients"] }),
        queryApi<ApiToolsResponse>("/api/admin/operations/api-tools", { staleMs: 10_000, maxAgeMs: 60_000, persist: false, tags: ["operations", "api-tools"] }).catch((error: unknown) => {
          setApiToolError(error instanceof Error ? error.message : "API Tool Manager diagnostics unavailable.");
          return null;
        }),
      ]);
      setSnapshot(nextSnapshot);
      setClients(nextClients);
      setApiTools(nextApiTools);
      if (nextApiTools) setApiToolError("");
      setStatus(`Systems refreshed ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "System posture could not be loaded.");
    } finally { loadingRef.current = false; }
  }

  async function checkDependencies() {
    if (dependencyCheckBusy) return;
    setDependencyCheckBusy(true);
    setDependencyCheckStatus("Checking known service dependencies…");
    try {
      const response = await api<{ ok: true; outcome: "sampled" | "cached" }>("/api/admin/operations/api-tools/check", { method: "POST" });
      setDependencyCheckStatus(response.outcome === "sampled" ? "Dependency check completed." : "Recent dependency evidence reused; check cooldown active.");
      // Bypass dashboard query cache after an explicit operator check.
      const latest = await api<ApiToolsResponse>("/api/admin/operations/api-tools");
      setApiTools(latest);
      setApiToolError("");
    } catch (error) {
      setDependencyCheckStatus(error instanceof Error ? error.message : "Dependency check failed; previous evidence remains visible.");
    } finally { setDependencyCheckBusy(false); }
  }

  async function checkAccelerationCompatibility() {
    if (accelerationCheckBusy) return;
    setAccelerationCheckBusy(true);
    setAccelerationCheckError("");
    try {
      const result = await api<AccelerationCompatibility>("/api/admin/operations/acceleration/compatibility-check", { method: "POST", body: "{}" });
      setAccelerationCheck(result);
    } catch (error) {
      setAccelerationCheckError(error instanceof Error ? error.message : "Configured acceleration compatibility check failed.");
    } finally { setAccelerationCheckBusy(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => { void load(); }, [debouncedQuery, state]);
  useVisibleRefresh(() => load(true), { intervalMs: 30_000 });

  const clientColumns = useMemo<ClusterDataTableColumn<SyncClient>[]>(() => [
    { id: "name", header: "Client", hideable: false, pinnable: true, defaultWidth: 240, sortValue: (client) => client.name, cell: (client) => <span><strong>{client.name}</strong><small>{client.id}</small></span> },
    { id: "platform", header: "Platform", defaultWidth: 160, sortValue: (client) => client.platform, cell: (client) => client.platform },
    { id: "version", header: "Client version", defaultWidth: 150, sortValue: (client) => client.clientVersion, cell: (client) => client.clientVersion },
    { id: "schema", header: "Mutation schema", defaultWidth: 145, sortValue: (client) => client.mutationSchemaVersion, cell: (client) => client.mutationSchemaVersion || 1 },
    { id: "lastSeen", header: "Last seen", defaultWidth: 190, sortValue: (client) => new Date(client.lastSeenAt), cell: (client) => timeLabel(client.lastSeenAt) },
  ], []);

  const apiToolRows = useMemo(() => (apiTools?.tools || []).filter((tool) => {
    if (apiToolPosture !== "all" && tool.posture !== apiToolPosture) return false;
    const search = apiToolQuery.trim().toLowerCase();
    return !search || [tool.key, tool.label, ...tool.routeRoots, ...tool.ownerModules].some((text) => text.toLowerCase().includes(search));
  }), [apiTools, apiToolQuery, apiToolPosture]);
  const apiToolColumns = useMemo<ClusterDataTableColumn<ApiToolRow>[]>(() => [
    { id: "tool", header: "Tool", hideable: false, defaultWidth: 220, sortValue: (tool) => tool.label, cell: (tool) => <span><strong>{tool.label}</strong><small>{tool.key}</small></span> },
    { id: "dependencies", header: "Dependency readiness", defaultWidth: 230, sortValue: (tool) => tool.dependencyReadiness?.posture || "not-sampled", cell: (tool) => <span title={(tool.dependencyReadiness?.dependencies || []).map((item) => `${item.key}: ${item.status} · ${item.detail}`).join("\n")}>{DEPENDENCY_POSTURE_LABELS[tool.dependencyReadiness?.posture || "not-sampled"]}</span> },
    { id: "posture", header: "Observed API posture", defaultWidth: 215, sortValue: (tool) => tool.posture, cell: (tool) => API_TOOL_POSTURE_LABELS[tool.posture] },
    { id: "routes", header: "Routes seen", defaultWidth: 110, sortValue: (tool) => tool.observedRoutes, cell: (tool) => tool.observedRoutes },
    { id: "requests", header: "Requests", defaultWidth: 120, sortValue: (tool) => tool.requests, cell: (tool) => tool.requests.toLocaleString() },
    { id: "errors", header: "5xx errors", defaultWidth: 110, sortValue: (tool) => tool.serverErrors, cell: (tool) => tool.serverErrors.toLocaleString() },
    { id: "rate", header: "Error rate", defaultWidth: 130, sortValue: (tool) => tool.serverErrorRate, cell: (tool) => tool.requests ? `${(tool.serverErrorRate * 100).toFixed(1)}%` : "—" },
    { id: "p95", header: "Worst route p95", defaultWidth: 160, sortValue: (tool) => tool.highestRouteP95Ms, cell: (tool) => tool.highestRouteP95Ms == null ? "—" : `${Math.round(tool.highestRouteP95Ms)} ms` },
    { id: "evidence", header: "Observed route evidence", defaultWidth: 270, cell: (tool) => <span title={tool.routes.map((route) => `${route.route}: ${route.count} requests, ${route.errors} 5xx, p95 ${Math.round(route.p95Ms)}ms`).join("\n")}>{tool.routes[0]?.route || "No observed route"}</span> },
  ], []);

  const reviewQueue = (snapshot?.media?.queue?.failed || 0) + (snapshot?.media?.queue?.deadLetter || 0);
  const clientPosture = snapshot?.clients;

  return (
    <div className="operations-systems-v510">
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Operations 2.0</p><h2>Systems & Integrations</h2><p className="muted tight">Server-connected clients, worker/queue posture, recovery readiness, and integration provider health. Configuration stays with the domain that owns it.</p></div>
          <ClusterButton type="button" variant="secondary" onClick={() => void load()} disabled={loadingRef.current}>Refresh</ClusterButton>
        </div>
        <ClusterMetricStrip label="Systems summary" items={[
          { label: "Sync clients", value: clientPosture?.total ?? clients?.total ?? "—", detail: `${clientPosture?.active || 0} active · ${clientPosture?.stale || 0} stale`, tone: clientPosture?.stale ? "warning" : "good" },
          { label: "Sync conflicts", value: clientPosture?.conflicts ?? "—", detail: `${clientPosture?.failedReceipts24h || 0} failed receipts / 24h`, tone: clientPosture?.conflicts || clientPosture?.failedReceipts24h ? "warning" : "good" },
          { label: "Media workers", value: snapshot?.media?.workers ? `${snapshot.media.workers.online || 0}/${snapshot.media.workers.total || 0}` : "—", detail: `${snapshot?.media?.queue?.running || 0} running`, tone: snapshot?.media?.workers?.total && !snapshot?.media?.workers?.online ? "warning" : "good" },
          { label: "Media review", value: reviewQueue, detail: `${snapshot?.media?.queue?.queued || 0} queued`, tone: reviewQueue ? "danger" : "good" },
          { label: "Queue leases", value: snapshot?.queues?.stalledLeases ?? "—", detail: `${snapshot?.queues?.rows?.length || 0} active queues`, tone: snapshot?.queues?.stalledLeases ? "danger" : "good" },
          { label: "Recovery", value: snapshot?.backup?.enabled ? `${snapshot.backup.generationCount || 0} backups` : "Disabled", detail: snapshot?.backup?.latestVerificationOk === false ? "latest verification failed" : snapshot?.backup?.latestVerificationOk ? "latest verified" : "verification pending", tone: !snapshot?.backup?.enabled || snapshot?.backup?.latestVerificationOk === false ? "warning" : "good" },
        ]} />
        <div className="button-row">
          <label>Client search<ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, platform, or version" /></label>
          <label>Client state<ClusterNativeSelect value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="all">All clients</option><option value="active">Active</option><option value="stale">Stale</option></ClusterNativeSelect></label>
        </div>
        <ClusterDataTable rows={clients?.clients || []} columns={clientColumns} rowKey={(client) => client.id} rowLabel={(client) => client.name} label="Registered sync clients" configurableColumns persistKey="admin-operations-sync-clients" empty={<ClusterEmptyState compact kind="empty" title="No registered clients match" description="Adjust the filter or wait for a registered client to report in." />} />
        <p className="muted">{status}</p>
      </section>
        <section className="panel" aria-label="API Tool Manager">
          <div className="section-heading">
            <div><p className="eyebrow">API Tool Manager · read-only</p><h3>Tool request and dependency health</h3><p className="muted tight">Passive HTTP measurements plus bounded server-side checks of known dependencies. No endpoint sweep or external HTTP probe. Passing dependencies do not certify individual tools.</p></div>
          </div>
          <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={dependencyCheckBusy} aria-busy={dependencyCheckBusy} onClick={() => void checkDependencies()}>{dependencyCheckBusy ? "Checking…" : "Check dependencies now"}</ClusterButton><span className="muted" role="status">{dependencyCheckStatus}</span></div>
          {apiToolError ? <p role="alert" className="muted">API diagnostics unavailable: {apiToolError}</p> : null}
          <ClusterMetricStrip label="API tool traffic" items={[
            { label: "Registered tools", value: apiTools?.tools.length ?? "—", detail: "Canonical server domains", tone: "good" },
            { label: "Normal metrics", value: apiTools?.counts["observed-healthy"] ?? "—", detail: "Measured traffic only", tone: "good" },
            { label: "Warning", value: apiTools?.counts.warning ?? "—", detail: "Observed elevated latency/errors", tone: apiTools?.counts.warning ? "warning" : "good" },
            { label: "Degraded", value: apiTools?.counts.degraded ?? "—", detail: "Observed elevated 5xx / p95", tone: apiTools?.counts.degraded ? "danger" : "good" },
            { label: "No evidence", value: apiTools ? apiTools.counts["no-observations"] + apiTools.counts["insufficient-data"] : "—", detail: "Not a readiness verdict" },
          ]} />
          <div className="button-row">
            <label>Find a tool<ClusterTextInput value={apiToolQuery} onChange={(event) => setApiToolQuery(event.target.value)} placeholder="Tool, route, or owner module" /></label>
            <label>Observed posture<ClusterNativeSelect value={apiToolPosture} onChange={(event) => setApiToolPosture(event.target.value as ApiToolPosture | "all")}>
              <option value="all">All tools</option>
              {Object.entries(API_TOOL_POSTURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </ClusterNativeSelect></label>
          </div>
          <ClusterDataTable rows={apiToolRows} columns={apiToolColumns} rowKey={(tool) => tool.key} rowLabel={(tool) => tool.label} label="Observed API tool metrics" configurableColumns persistKey="admin-operations-api-tools" empty={<ClusterEmptyState compact kind="empty" title="No tools match these filters" description="Adjust the tool search or observed posture filter." />} />
          <p className="muted">Dependencies checked: {timeLabel(apiTools?.dependencyReadiness?.sampledAt)}{apiTools?.dependencyReadiness?.stale ? " (stale or unavailable)" : ""}. The server samples known lifecycle, database, storage and scheduler signals on its own cadence; this page does not trigger active checks. Counts are since process start; latency percentiles reflect bounded recent samples. No per-tool authorization, route correctness or external connectivity is certified. Unclassified traffic: {apiTools?.unclassified.requests ?? "—"} requests.</p>
        </section>
      <section className="panel" aria-label="Redis-compatible acceleration protocol">
        <div className="section-heading">
          <div><p className="eyebrow">Acceleration · optional</p><h3>Redis-compatible backend verification</h3><p className="muted tight">Manually test Cluster's required Redis commands against the configured connection. This can help evaluate Garnet, but does not identify the server product or certify its Windows runtime.</p></div>
        </div>
        <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={accelerationCheckBusy} aria-busy={accelerationCheckBusy} onClick={() => void checkAccelerationCompatibility()}>{accelerationCheckBusy ? "Testing…" : "Check configured backend"}</ClusterButton></div>
        {accelerationCheckError ? <p role="alert">{accelerationCheckError}</p> : null}
        {accelerationCheck && <div aria-live="polite">
          <p><strong>{accelerationCheck.status === "passed" ? "Required commands responded" : accelerationCheck.status === "failed" ? "One or more protocol checks failed" : "Redis backend is unavailable or not configured"}</strong> · {timeLabel(accelerationCheck.checkedAt)}{accelerationCheck.cached ? " · cached" : ""}</p>
          {accelerationCheck.steps.map(step => <p key={step.command} className={step.ok ? "muted tight" : "tight"}><strong>{step.command}:</strong> {step.ok ? "Supported" : "Failed or timed out"}</p>)}
          <p className="muted tight">{accelerationCheck.note}</p>
        </div>}
        <p className="muted tight">Checks use temporary, expiring namespaced keys and a temporary Pub/Sub subscriber. The server limits repeated attempts; this view never contacts arbitrary hosts and does not enable or install Garnet automatically. PostgreSQL remains authoritative.</p>
      </section>
      <IntegrationProvidersPanel />
    </div>
  );
}
