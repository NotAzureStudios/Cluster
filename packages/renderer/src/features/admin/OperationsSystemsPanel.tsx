import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { api, queryApi } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import "./admin-ops.css";

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

  const apiToolRows = useMemo(() => (apiTools?.tools || []).filter((tool) => {
    if (apiToolPosture !== "all" && tool.posture !== apiToolPosture) return false;
    const search = apiToolQuery.trim().toLowerCase();
    return !search || [tool.key, tool.label, ...tool.routeRoots, ...tool.ownerModules].some((text) => text.toLowerCase().includes(search));
  }), [apiTools, apiToolQuery, apiToolPosture]);

  const reviewQueue = (snapshot?.media?.queue?.failed || 0) + (snapshot?.media?.queue?.deadLetter || 0);
  const clientPosture = snapshot?.clients;
  const mediaWorkersOnline = snapshot?.media?.workers?.online;
  const mediaWorkersTotal = snapshot?.media?.workers?.total;

  const toolTone = (tool: ApiToolRow) => {
    const dependency = tool.dependencyReadiness?.posture;
    if (tool.posture === "degraded" || dependency === "dependency-failed") return "danger";
    if (tool.posture === "warning" || dependency === "dependency-warning") return "warning";
    if (tool.posture === "observed-healthy" || dependency === "dependency-passing") return "good";
    return "";
  };
  const short = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";

  return (
    <div className="ao operations-systems-v510">
      <div className="ao-bar">
        <div className="ao-chips">
          <span className="ao-chip" data-tone={clientPosture?.stale ? "warning" : "good"} title={`${clientPosture?.stale || 0} stale`}><span>Clients</span><b>{clientPosture ? `${clientPosture.active || 0}/${clientPosture.total || 0}` : "—"}</b></span>
          {clientPosture?.conflicts ? <span className="ao-chip" data-tone="warning"><span>Conflicts</span><b>{clientPosture.conflicts}</b></span> : null}
          <span className="ao-chip" data-tone={mediaWorkersTotal && !mediaWorkersOnline ? "warning" : "good"}><span>Media workers</span><b>{typeof mediaWorkersTotal === "number" ? `${mediaWorkersOnline || 0}/${mediaWorkersTotal}` : "—"}</b></span>
          {reviewQueue ? <span className="ao-chip" data-tone="danger"><span>Media failures</span><b>{reviewQueue}</b></span> : null}
          {snapshot?.queues?.stalledLeases ? <span className="ao-chip" data-tone="danger"><span>Stalled</span><b>{snapshot.queues.stalledLeases}</b></span> : null}
          <span className="ao-chip" data-tone={!snapshot?.backup?.enabled || snapshot?.backup?.latestVerificationOk === false ? "warning" : "good"} title={snapshot?.backup?.latestVerificationOk === false ? "Latest verification failed" : undefined}><span>Backups</span><b>{snapshot?.backup?.enabled ? snapshot.backup.generationCount || 0 : "Off"}</b></span>
        </div>
        <span className="ao-bar__end">
          {dependencyCheckStatus ? <span className="ao-msg" role="status">{dependencyCheckStatus}</span> : null}
          <ClusterButton type="button" size="compact" variant="quiet" disabled={accelerationCheckBusy} title="Checks the Redis commands Cluster needs. It does not identify the server product." onClick={() => void checkAccelerationCompatibility()}>{accelerationCheckBusy ? "Testing…" : "Test Redis"}</ClusterButton>
          <ClusterButton type="button" size="compact" variant="secondary" disabled={dependencyCheckBusy} aria-busy={dependencyCheckBusy} onClick={() => void checkDependencies()}>{dependencyCheckBusy ? "Checking…" : "Check dependencies"}</ClusterButton>
        </span>
      </div>

      {accelerationCheck || accelerationCheckError ? <section className="ao-card" aria-label="Redis-compatible acceleration">
        <h3 className="ao-card__title">Redis acceleration {accelerationCheck ? <span className="ao-pill" data-tone={accelerationCheck.status === "passed" ? "good" : "danger"}>{accelerationCheck.status === "passed" ? "Compatible" : accelerationCheck.status === "failed" ? "Failed" : "Unavailable"}</span> : null}</h3>
        {accelerationCheckError ? <p className="ao-sub" role="alert">{accelerationCheckError}</p> : null}
        {accelerationCheck ? <div className="ao-chips">{accelerationCheck.steps.map((step) => <span key={step.command} className="ao-chip" data-tone={step.ok ? "good" : "danger"}><span>{step.command}</span><b>{step.ok ? "✓" : "✕"}</b></span>)}</div> : null}
      </section> : null}

      <div className="ao-grid">
        <section className="ao-card" aria-label="Registered sync clients">
          <h3 className="ao-card__title">Clients <small>{clients?.total ?? ""}</small>
            <ClusterSegmentedControl value={state} onChange={setState} label="Client state" options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "stale", label: "Stale" }]} />
          </h3>
          <label className="ao-search"><ClusterIcon name="search" aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, platform or version" aria-label="Search clients" /></label>
          {clients?.clients.length ? <ul className="ao-rows">{clients.clients.map((client) => <li key={client.id} className="ao-row ao-row--plain">
            <span className="ao-row__main"><b title={client.id}>{client.name && !/^Unnamed client/i.test(client.name) ? client.name : client.platform && client.platform !== "unknown" ? client.platform : "Browser"}</b><small>{[client.platform, client.clientVersion].filter((value) => value && value !== "unknown").join(" · ") || client.id.slice(0, 8)}</small></span>
            <span className="ao-row__end"><small>{short(client.lastSeenAt)}</small></span>
          </li>)}</ul> : <p className="ao-empty">{status.startsWith("Loading") ? "Loading…" : "No clients match."}</p>}
        </section>

        <section className="ao-card" aria-label="API tools">
          <h3 className="ao-card__title">API tools <small>{apiTools?.tools.length ?? ""}</small>
            <ClusterNativeSelect aria-label="Observed posture" value={apiToolPosture} onChange={(event) => setApiToolPosture(event.target.value as ApiToolPosture | "all")}>
              <option value="all">All</option>
              {Object.entries(API_TOOL_POSTURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </ClusterNativeSelect>
          </h3>
          <label className="ao-search"><ClusterIcon name="search" aria-hidden="true" /><input type="search" value={apiToolQuery} onChange={(event) => setApiToolQuery(event.target.value)} placeholder="Tool, route or module" aria-label="Find a tool" /></label>
          {apiToolError ? <p className="ao-sub" role="alert">{apiToolError}</p> : null}
          {apiToolRows.length ? <ul className="ao-rows">{apiToolRows.map((tool) => <li key={tool.key} className="ao-row" data-tone={toolTone(tool) || undefined}>
            <i className="ao-dot" aria-hidden="true" />
            <span className="ao-row__main"><b>{tool.label}</b><small title={(tool.dependencyReadiness?.dependencies || []).map((item) => `${item.key}: ${item.status} · ${item.detail}`).join("\n")}>{DEPENDENCY_POSTURE_LABELS[tool.dependencyReadiness?.posture || "not-sampled"]} · {API_TOOL_POSTURE_LABELS[tool.posture]}</small></span>
            <span className="ao-row__end" title={tool.routes.map((route) => `${route.route}: ${route.count} requests, ${route.errors} 5xx, p95 ${Math.round(route.p95Ms)}ms`).join("\n")}>
              <small>{tool.requests.toLocaleString()} req</small>
              <small>{tool.requests ? `${(tool.serverErrorRate * 100).toFixed(1)}% 5xx` : "—"}</small>
              <small>{tool.highestRouteP95Ms == null ? "—" : `${Math.round(tool.highestRouteP95Ms)} ms`}</small>
            </span>
          </li>)}</ul> : <p className="ao-empty">No tools match.</p>}
          {apiTools ? <p className="ao-sub">Dependencies checked {short(apiTools.dependencyReadiness?.sampledAt).toLowerCase()}{apiTools.dependencyReadiness?.stale ? " (stale)" : ""}. Traffic counts since server start.</p> : null}
        </section>
      </div>
    </div>
  );
}
