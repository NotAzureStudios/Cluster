import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, apiErrorPresentation } from "../core/api";
import { APP_VERSION, APP_VERSION_LABEL } from "../core/version";
import { useVisibleRefresh } from "../core/visible-refresh";
import { ClusterButton } from "./ClusterButton";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { deriveServerOperationalStatus } from "./operational-status";

type HealthSignal = { key: string; status: "pass" | "warn" | "fail" };
type HealthPayload = {
  ok?: boolean;
  app?: string;
  version?: string;
  ready?: boolean;
  draining?: boolean;
  state?: "starting" | "healthy" | "degraded" | "unavailable" | "draining";
  generatedAt?: string;
  uptimeSeconds?: number;
  signals?: HealthSignal[];
  runtime?: {
    profile?: string;
    requests?: { total?: number; errorRate?: number; inFlight?: number; p95Ms?: number; p99Ms?: number };
    eventLoop?: { p95Ms?: number; maxMs?: number };
    memory?: { heapUsedMiB?: number; heapTotalMiB?: number; heapLimitMiB?: number; rssMiB?: number };
  };
};

function formatUptime(seconds = 0) {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function signalLabel(key: string) {
  return ({ lifecycle: "Lifecycle", database: "Database", storage: "Storage", "event-loop": "Event loop", requests: "Requests", memory: "Memory", "background-tasks": "Background tasks" } as Record<string, string>)[key] || key;
}

export function AppVersionFooter({ onOpenChangelog, onOpenOperations }: { onOpenChangelog: () => void; onOpenOperations?: () => void }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<unknown>(null);
  const [lastHealthyAt, setLastHealthyAt] = useState<Date | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    const started = performance.now();
    setRefreshing(true);
    try {
      const next = await api<HealthPayload>("/health");
      const checkedAt = new Date();
      setHealth(next);
      setReachable(Boolean(next?.ok));
      setLatencyMs(Math.max(0, Math.round(performance.now() - started)));
      setLastError(null);
      setConsecutiveFailures(0);
      if (next?.ok) setLastHealthyAt(checkedAt);
    } catch (error) {
      setReachable(false);
      setLatencyMs(null);
      setLastError(error);
      setConsecutiveFailures((current) => current + 1);
    } finally {
      setLastCheckedAt(new Date());
      setRefreshing(false);
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const offline = () => {
      setReachable(false);
      setLatencyMs(null);
      setLastError(new ApiError("This device is offline.", 0, undefined, null, "NETWORK_UNAVAILABLE", { retryable: true, action: "Restore the network connection. Cluster will recheck the server automatically." }));
    };
    if (navigator.onLine) void check();
    else offline();
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, [check]);

  useVisibleRefresh(() => check(), { intervalMs: 60_000 });

  const serverVersion = health?.version || null;
  const mismatched = Boolean(serverVersion && serverVersion !== APP_VERSION);
  const healthState = reachable === false ? "offline" : mismatched ? "mismatch" : health?.state || (reachable ? "healthy" : "checking");
  const requests = health?.runtime?.requests;
  const eventLoop = health?.runtime?.eventLoop;
  const memory = health?.runtime?.memory;
  const heapPercent = memory?.heapLimitMiB ? Math.round(((memory.heapUsedMiB || 0) / memory.heapLimitMiB) * 100) : null;
  const errorDetail = lastError ? apiErrorPresentation(lastError) : null;
  const staleHealth = reachable === false && health != null;
  const operational = deriveServerOperationalStatus({ reachable, refreshing, mismatched, ready: health?.ready, state: health?.state || null, lastCheckedAt });
  const interactionState = operational.interactionState;
  const label = operational.label;

  return <div data-cluster-state={interactionState} className={`app-version-status-v390 ${open ? "open" : ""}`}>
    <ClusterButton ref={triggerRef} unstyled type="button" data-cluster-state={interactionState} aria-pressed={open} className={`app-version-footer-v201 ${healthState}`} onClick={() => setOpen((value) => !value)} title={`${label} · Open server status`} aria-expanded={open} aria-haspopup="dialog">
      <span className="app-version-dot-v201" aria-hidden="true" />
      <span className="app-version-name-v201">Cluster</span>
      <strong>{APP_VERSION_LABEL}</strong>
    </ClusterButton>
    <ClusterFloatingSurface open={open} anchorRef={triggerRef} label="Cluster server status" role="dialog" placement="top-start" mobileMode="sheet" className="server-status-popover-v390" data-cluster-state={interactionState} onDismiss={() => setOpen(false)}>
      <header>
        <div><span className={`server-status-dot-v390 ${healthState}`} aria-hidden="true" /><div><strong>{label}</strong><small>{serverVersion ? `Server v${serverVersion} · ${operational.detail}` : operational.detail}</small></div></div>
        <ClusterStatus state={interactionState} dot>{operational.label}</ClusterStatus>
      </header>
      <div className="server-status-grid-v390">
        <article><span>Round trip</span><strong>{latencyMs == null ? "—" : `${latencyMs} ms`}</strong></article>
        <article><span>Uptime</span><strong>{health?.uptimeSeconds == null ? "—" : formatUptime(health.uptimeSeconds)}</strong></article>
        <article><span>API p95</span><strong>{requests?.p95Ms == null ? "—" : `${Math.round(requests.p95Ms)} ms`}</strong></article>
        <article><span>Error rate</span><strong>{requests?.errorRate == null ? "—" : `${(requests.errorRate * 100).toFixed(1)}%`}</strong></article>
        <article><span>Event loop p95</span><strong>{eventLoop?.p95Ms == null ? "—" : `${Math.round(eventLoop.p95Ms)} ms`}</strong></article>
        <article><span>Heap</span><strong>{heapPercent == null ? "—" : `${heapPercent}%`}</strong></article>
      </div>
      {health?.signals?.length ? <div className="server-status-signals-v390" aria-label="Server health signals">{health.signals.map((signal) => <span key={signal.key} data-status={signal.status}><i aria-hidden="true" />{signalLabel(signal.key)}</span>)}</div> : null}
      {errorDetail && <div data-cluster-state="error" className="server-status-recovery-v394" role="status">
        <div><strong>{errorDetail.code}</strong><span>{errorDetail.message}</span></div>
        <small>{errorDetail.retryAfterSeconds ? `Retry after ${errorDetail.retryAfterSeconds}s. ` : ""}{errorDetail.action}</small>
        <div>{errorDetail.requestId && <code>request {errorDetail.requestId}</code>}{consecutiveFailures > 1 && <code>{consecutiveFailures} checks failed</code>}{staleHealth && lastHealthyAt && <code>last healthy {lastHealthyAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</code>}</div>
      </div>}
      <footer>
        <span>{health?.runtime?.profile || "runtime unknown"}{lastCheckedAt ? ` · checked ${lastCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}</span>
        <div>{onOpenOperations ? <ClusterButton variant="secondary" size="compact" onClick={() => { setOpen(false); onOpenOperations(); }}>Operations</ClusterButton> : null}<ClusterButton size="compact" busy={refreshing} busyLabel="Refreshing…" onClick={() => void check()}>Refresh</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => { setOpen(false); onOpenChangelog(); }}>Release history</ClusterButton></div>
      </footer>
    </ClusterFloatingSurface>
  </div>;
}
