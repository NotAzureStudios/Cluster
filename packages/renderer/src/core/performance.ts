export type ClusterPerformanceCategory =
  | "navigation"
  | "network"
  | "render"
  | "long-task"
  | "cache"
  | "search"
  | "sync"
  | "interaction"
  | "storage"
  | "worker"
  | "web-vital"
  | "asset";

export type ClusterPerformanceMetric = {
  name: string;
  category: ClusterPerformanceCategory;
  durationMs: number;
  startedAt: number;
  detail?: Record<string, string | number | boolean | null>;
};

type CategorySummary = { count: number; averageMs: number; p50Ms: number; p95Ms: number; maximumMs: number };
type PerformanceBudget = { category: ClusterPerformanceCategory; p95Ms: number; label: string };
type StartupClass = "cold" | "warm" | "reload";
type RenderHealth = { commits: number; mounts: number; updates: number; nestedUpdates: number; totalActualMs: number; averageActualMs: number; maximumActualMs: number };
type BudgetViolation = PerformanceBudget & { actualP95Ms: number; overByMs: number };
export type ClientPerformanceHealthStatus = "pass" | "warn" | "fail" | "unknown";
export type ClientPerformanceHealthCheck = {
  key: string;
  label: string;
  unit: "ms" | "ratio" | "MiB" | "requests/min" | "tasks/min";
  actual: number | null;
  target: number;
  warning: number;
  direction: "max" | "min";
  status: ClientPerformanceHealthStatus;
  detail: string;
};

export type PerformanceSummary = {
  generatedAt: string;
  count: number;
  sessionAgeMs: number;
  slowest: ClusterPerformanceMetric[];
  byCategory: Partial<Record<ClusterPerformanceCategory, CategorySummary>>;
  cache: { hits: number; misses: number; requests: number; hitRate: number };
  webVitals: { fcpMs: number | null; lcpMs: number | null; cls: number; inpMs: number | null };
  memory: { usedBytes: number | null; totalBytes: number | null; limitBytes: number | null };
  budgets: PerformanceBudget[];
  violations: BudgetViolation[];
  startup: { classification: StartupClass; previousSessionAgeMs: number | null; domContentLoadedMs: number | null; loadMs: number | null; firstFrameMs: number | null };
  renderHealth: RenderHealth;
  health: { status: ClientPerformanceHealthStatus; failures: number; warnings: number; requestRatePerMinute: number; longTasksPerMinute: number; checks: ClientPerformanceHealthCheck[] };
};

const MAX_METRICS = 1_200;
const SESSION_STARTED_AT = Date.now();
const metrics: ClusterPerformanceMetric[] = [];
const observers: PerformanceObserver[] = [];
const PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  { category: "navigation", p95Ms: 2_500, label: "Renderer navigation" },
  { category: "network", p95Ms: 900, label: "API requests" },
  { category: "render", p95Ms: 120, label: "React renders" },
  { category: "search", p95Ms: 150, label: "Search response" },
  { category: "interaction", p95Ms: 200, label: "Interactions" },
  { category: "worker", p95Ms: 180, label: "Worker tasks" },
  { category: "storage", p95Ms: 120, label: "Local storage" },
  { category: "sync", p95Ms: 15_000, label: "Synchronization" },
  { category: "long-task", p95Ms: 80, label: "Main-thread tasks" },
];
const CLIENT_RUNTIME_BUDGETS = Object.freeze({
  routeP95Ms: { target: 900, warning: 1_500 },
  networkP95Ms: { target: 750, warning: 1_200 },
  renderP95Ms: { target: 80, warning: 120 },
  searchP95Ms: { target: 120, warning: 200 },
  interactionP95Ms: { target: 150, warning: 250 },
  coldFirstFrameMs: { target: 2_200, warning: 3_500 },
  warmFirstFrameMs: { target: 1_200, warning: 2_000 },
  reloadFirstFrameMs: { target: 1_500, warning: 2_500 },
  fcpMs: { target: 1_800, warning: 2_500 },
  lcpMs: { target: 2_500, warning: 4_000 },
  inpMs: { target: 200, warning: 500 },
  cls: { target: 0.1, warning: 0.25 },
  heapUsedMiB: { target: 384, warning: 512 },
  heapUtilization: { target: 0.65, warning: 0.80 },
  cacheHitRate: { target: 0.55, warning: 0.35 },
  requestRatePerMinute: { target: 90, warning: 150 },
  longTasksPerMinute: { target: 5, warning: 10 },
});

let initialized = false;
let frameHandle = 0;
let visibilityHandler: (() => void) | null = null;
let lastFrameAt = 0;
let frameSamples = 0;
let droppedFrames = 0;
let clsValue = 0;
let fcpMs: number | null = null;
let lcpMs: number | null = null;
let inpMs: number | null = null;
let startupDomContentLoadedMs: number | null = null;
let startupLoadMs: number | null = null;
let firstFrameMs: number | null = null;
let renderCommits = 0;
let renderMounts = 0;
let renderUpdates = 0;
let renderNestedUpdates = 0;
let renderTotalActualMs = 0;
let renderMaximumActualMs = 0;
const STARTUP_SESSION_KEY = "cluster.performance.last-session-at";
const WARM_START_WINDOW_MS = 30 * 60 * 1000;

function startupClassification(): { classification: StartupClass; previousSessionAgeMs: number | null } {
  if (typeof window === "undefined") return { classification: "cold", previousSessionAgeMs: null };
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type === "reload") return { classification: "reload", previousSessionAgeMs: 0 };
  let previous: number | null = null;
  try { previous = Number(window.localStorage.getItem(STARTUP_SESSION_KEY) || 0) || null; } catch {}
  const age = previous ? Math.max(0, Date.now() - previous) : null;
  return { classification: age !== null && age <= WARM_START_WINDOW_MS ? "warm" : "cold", previousSessionAgeMs: age };
}

const STARTUP_CLASS = startupClassification();

function round(value: number, precision = 1) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];
}

export function recordPerformanceMetric(metric: ClusterPerformanceMetric) {
  const normalized: ClusterPerformanceMetric = {
    ...metric,
    durationMs: Math.max(0, Number(metric.durationMs) || 0),
    startedAt: Number(metric.startedAt) || Date.now(),
  };
  metrics.push(normalized);
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
  if (normalized.durationMs >= 500 && typeof console !== "undefined") {
    console.debug(`[Cluster performance] ${normalized.name}: ${Math.round(normalized.durationMs)}ms`, normalized.detail || {});
  }
}

export function recordReactRender(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) {
  renderCommits += 1;
  if (phase === "mount") renderMounts += 1;
  else if (phase === "nested-update") renderNestedUpdates += 1;
  else renderUpdates += 1;
  renderTotalActualMs += Math.max(0, actualDuration);
  renderMaximumActualMs = Math.max(renderMaximumActualMs, actualDuration);
  recordPerformanceMetric({
    name: `React ${id}`,
    category: "render",
    durationMs: actualDuration,
    startedAt: performance.timeOrigin + startTime,
    detail: { phase, baseDuration: round(baseDuration), commitTime: round(commitTime) },
  });
}

function memorySnapshot() {
  const memory = (typeof performance !== "undefined" ? performance : null) as (Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  }) | null;
  return {
    usedBytes: Number(memory?.memory?.usedJSHeapSize || 0) || null,
    totalBytes: Number(memory?.memory?.totalJSHeapSize || 0) || null,
    limitBytes: Number(memory?.memory?.jsHeapSizeLimit || 0) || null,
  };
}

function summarizeMetrics(input: ClusterPerformanceMetric[]): CategorySummary {
  const values = input.map((metric) => metric.durationMs).sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { count: values.length, averageMs: values.length ? round(total / values.length) : 0, p50Ms: round(percentile(values, 0.5)), p95Ms: round(percentile(values, 0.95)), maximumMs: round(values.length ? values[values.length - 1] : 0) };
}

function classifyHealth(actual: number | null, target: number, warning: number, direction: "max" | "min"): ClientPerformanceHealthStatus {
  if (actual == null || !Number.isFinite(actual)) return "unknown";
  if (direction === "max") return actual <= target ? "pass" : actual <= warning ? "warn" : "fail";
  return actual >= target ? "pass" : actual >= warning ? "warn" : "fail";
}

function healthCheck(key: string, label: string, unit: ClientPerformanceHealthCheck["unit"], actual: number | null, budget: { target: number; warning: number }, direction: "max" | "min", detail: string): ClientPerformanceHealthCheck {
  return { key, label, unit, actual, target: budget.target, warning: budget.warning, direction, status: classifyHealth(actual, budget.target, budget.warning, direction), detail };
}

export function performanceSummary(): PerformanceSummary {
  const byCategory: PerformanceSummary["byCategory"] = {};
  for (const category of new Set(metrics.map((metric) => metric.category))) byCategory[category] = summarizeMetrics(metrics.filter((metric) => metric.category === category));

  const cacheMetrics = metrics.filter((metric) => metric.category === "cache" && metric.detail?.bypass !== true);
  const cacheHits = cacheMetrics.filter((metric) => metric.detail?.hit === true).length;
  const cacheMisses = cacheMetrics.filter((metric) => metric.detail?.hit === false).length;
  const cacheRequests = cacheHits + cacheMisses;
  const cacheHitRatio = cacheRequests ? cacheHits / cacheRequests : 0;
  const violations = PERFORMANCE_BUDGETS.flatMap((budget) => {
    const actual = byCategory[budget.category]?.p95Ms || 0;
    return actual > budget.p95Ms ? [{ ...budget, actualP95Ms: actual, overByMs: round(actual - budget.p95Ms) }] : [];
  });

  const sessionAgeMs = Date.now() - SESSION_STARTED_AT;
  // The metric buffer is bounded. Dividing its retained samples by the entire
  // session age increasingly understates load during long-running sessions.
  const rateWindowMs = Math.min(sessionAgeMs, 5 * 60_000);
  const rateWindowStartedAt = Date.now() - rateWindowMs;
  const recentMetrics = metrics.filter((metric) => metric.startedAt >= rateWindowStartedAt);
  const rateWindowMinutes = Math.max(rateWindowMs / 60_000, 1 / 60);
  const routeMetrics = metrics.filter((metric) => metric.category === "navigation" && metric.name.startsWith("route "));
  const routeSummary = summarizeMetrics(routeMetrics);
  const networkSummary = summarizeMetrics(metrics.filter((metric) => metric.category === "network"));
  const renderSummary = summarizeMetrics(metrics.filter((metric) => metric.category === "render" && metric.name.startsWith("React ")));
  const searchSummary = summarizeMetrics(metrics.filter((metric) => metric.category === "search"));
  const interactionSummary = summarizeMetrics(metrics.filter((metric) => metric.category === "interaction"));
  const requestRatePerMinute = round(recentMetrics.filter((metric) => metric.category === "network").length / rateWindowMinutes);
  const longTasksPerMinute = round(recentMetrics.filter((metric) => metric.category === "long-task").length / rateWindowMinutes);
  const memory = memorySnapshot();
  const heapUsedMiB = memory.usedBytes == null ? null : memory.usedBytes / 1024 / 1024;
  const heapUtilization = memory.usedBytes != null && memory.limitBytes ? memory.usedBytes / memory.limitBytes : null;
  const startupBudget = STARTUP_CLASS.classification === "warm" ? CLIENT_RUNTIME_BUDGETS.warmFirstFrameMs : STARTUP_CLASS.classification === "reload" ? CLIENT_RUNTIME_BUDGETS.reloadFirstFrameMs : CLIENT_RUNTIME_BUDGETS.coldFirstFrameMs;
  const checks: ClientPerformanceHealthCheck[] = [
    healthCheck("route-p95", "Route transition p95", "ms", routeSummary.count >= 3 ? routeSummary.p95Ms : null, CLIENT_RUNTIME_BUDGETS.routeP95Ms, "max", "Two-frame route stabilization time."),
    healthCheck("network-p95", "API request p95", "ms", networkSummary.count >= 5 ? networkSummary.p95Ms : null, CLIENT_RUNTIME_BUDGETS.networkP95Ms, "max", "Client-observed API request latency; each request is counted once."),
    healthCheck("render-p95", "React render p95", "ms", renderSummary.count >= 5 ? renderSummary.p95Ms : null, CLIENT_RUNTIME_BUDGETS.renderP95Ms, "max", "React Profiler commit cost."),
    healthCheck("search-p95", "Search p95", "ms", searchSummary.count >= 5 ? searchSummary.p95Ms : null, CLIENT_RUNTIME_BUDGETS.searchP95Ms, "max", "Local worker and server search response time."),
    healthCheck("interaction-p95", "Interaction p95", "ms", interactionSummary.count >= 5 ? interactionSummary.p95Ms : null, CLIENT_RUNTIME_BUDGETS.interactionP95Ms, "max", "Observed event timing for user interactions."),
    healthCheck("startup-first-frame", `${STARTUP_CLASS.classification} startup first frame`, "ms", firstFrameMs, startupBudget, "max", "Time to the first renderer frame for this startup class."),
    healthCheck("fcp", "First Contentful Paint", "ms", fcpMs, CLIENT_RUNTIME_BUDGETS.fcpMs, "max", "Browser paint timing."),
    healthCheck("lcp", "Largest Contentful Paint", "ms", lcpMs, CLIENT_RUNTIME_BUDGETS.lcpMs, "max", "Browser largest-content timing."),
    healthCheck("inp", "Interaction to Next Paint", "ms", inpMs, CLIENT_RUNTIME_BUDGETS.inpMs, "max", "Worst observed interaction duration."),
    healthCheck("cls", "Cumulative Layout Shift", "ratio", clsValue || null, CLIENT_RUNTIME_BUDGETS.cls, "max", "Unexpected layout movement without recent input."),
    healthCheck("heap-used", "Renderer heap", "MiB", heapUsedMiB, CLIENT_RUNTIME_BUDGETS.heapUsedMiB, "max", "Chromium JS heap when the runtime exposes memory telemetry."),
    healthCheck("heap-utilization", "Renderer heap utilization", "ratio", heapUtilization, CLIENT_RUNTIME_BUDGETS.heapUtilization, "max", "Used JS heap relative to the browser heap limit."),
    healthCheck("cache-hit", "Query cache hit rate", "ratio", cacheRequests >= 10 ? cacheHitRatio : null, CLIENT_RUNTIME_BUDGETS.cacheHitRate, "min", "Eligible query lookups served by memory, inflight dedupe, or durable cache."),
    healthCheck("request-rate", "API request chatter", "requests/min", sessionAgeMs >= 60_000 ? requestRatePerMinute : null, CLIENT_RUNTIME_BUDGETS.requestRatePerMinute, "max", "Client API requests per minute in the last five minutes (or available session time)."),
    healthCheck("long-task-rate", "Main-thread long tasks", "tasks/min", sessionAgeMs >= 60_000 ? longTasksPerMinute : null, CLIENT_RUNTIME_BUDGETS.longTasksPerMinute, "max", "Long tasks per minute in the last five minutes (or available session time)."),
  ];
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const knownChecks = checks.filter((check) => check.status !== "unknown");
  const healthStatus: ClientPerformanceHealthStatus = failures ? "fail" : warnings ? "warn" : knownChecks.length ? "pass" : "unknown";

  return {
    generatedAt: new Date().toISOString(),
    count: metrics.length,
    sessionAgeMs,
    slowest: [...metrics].sort((left, right) => right.durationMs - left.durationMs).slice(0, 40),
    byCategory,
    cache: { hits: cacheHits, misses: cacheMisses, requests: cacheRequests, hitRate: cacheRequests ? round(cacheHitRatio * 100) : 0 },
    webVitals: { fcpMs, lcpMs, cls: round(clsValue, 4), inpMs },
    memory,
    budgets: PERFORMANCE_BUDGETS,
    violations,
    startup: { classification: STARTUP_CLASS.classification, previousSessionAgeMs: STARTUP_CLASS.previousSessionAgeMs, domContentLoadedMs: startupDomContentLoadedMs, loadMs: startupLoadMs, firstFrameMs },
    renderHealth: { commits: renderCommits, mounts: renderMounts, updates: renderUpdates, nestedUpdates: renderNestedUpdates, totalActualMs: round(renderTotalActualMs), averageActualMs: renderCommits ? round(renderTotalActualMs / renderCommits) : 0, maximumActualMs: round(renderMaximumActualMs) },
    health: { status: healthStatus, failures, warnings, requestRatePerMinute, longTasksPerMinute, checks },
  };
}

export function clearPerformanceMetrics() {
  metrics.length = 0;
  clsValue = 0;
  fcpMs = null;
  lcpMs = null;
  inpMs = null;
  renderCommits = 0;
  renderMounts = 0;
  renderUpdates = 0;
  renderNestedUpdates = 0;
  renderTotalActualMs = 0;
  renderMaximumActualMs = 0;
}

export function exportPerformanceMetrics() {
  return { ...performanceSummary(), metrics: [...metrics] };
}

export function downloadPerformanceReport() {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(exportPerformanceMetrics(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cluster-performance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function observe(type: string, callback: (entry: PerformanceEntry) => void) {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
    observer.observe({ type, buffered: true } as PerformanceObserverInit);
    observers.push(observer);
  } catch {
    // Some browser runtimes do not expose every observer type.
  }
}

function monitorFrames(timestamp: number) {
  if (!initialized) return;
  if (lastFrameAt) {
    const delta = timestamp - lastFrameAt;
    frameSamples += 1;
    if (delta > 34) droppedFrames += Math.max(1, Math.round(delta / 16.67) - 1);
    if (frameSamples >= 120) {
      recordPerformanceMetric({
        name: "animation frame health",
        category: "render",
        durationMs: droppedFrames ? (droppedFrames / frameSamples) * 100 : 0,
        startedAt: Date.now(),
        detail: { samples: frameSamples, droppedFrames, droppedPercent: round((droppedFrames / Math.max(1, frameSamples)) * 100) },
      });
      frameSamples = 0;
      droppedFrames = 0;
    }
  }
  lastFrameAt = timestamp;
  if (document.visibilityState === "visible") frameHandle = window.requestAnimationFrame(monitorFrames);
  else { frameHandle = 0; lastFrameAt = 0; }
}

export function initializePerformanceMonitoring() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const globalWindow = window as typeof window & {
    clusterPerformance?: {
      summary: typeof performanceSummary;
      clear: typeof clearPerformanceMetrics;
      export: typeof exportPerformanceMetrics;
      download: typeof downloadPerformanceReport;
    };
  };
  globalWindow.clusterPerformance = {
    summary: performanceSummary,
    clear: clearPerformanceMetrics,
    export: exportPerformanceMetrics,
    download: downloadPerformanceReport,
  };

  observe("longtask", (entry) => {
    if (entry.duration < 50) return;
    recordPerformanceMetric({ name: entry.name || "main-thread task", category: "long-task", durationMs: entry.duration, startedAt: performance.timeOrigin + entry.startTime });
  });
  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") fcpMs = round(entry.startTime);
    recordPerformanceMetric({ name: entry.name, category: "web-vital", durationMs: entry.startTime, startedAt: performance.timeOrigin });
  });
  observe("largest-contentful-paint", (entry) => {
    lcpMs = round(entry.startTime);
  });
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (!shift.hadRecentInput) clsValue += Number(shift.value || 0);
  });
  observe("event", (entry) => {
    if (entry.duration < 16) return;
    inpMs = Math.max(inpMs || 0, round(entry.duration));
    recordPerformanceMetric({ name: `interaction ${entry.name}`, category: "interaction", durationMs: entry.duration, startedAt: performance.timeOrigin + entry.startTime });
  });
  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    const assetMatch = resource.name.match(/\.(js|css|png|jpe?g|webp|gif|svg|mp4|webm|pdf)(?:\?|$)/i);
    if (resource.duration < 100 || !assetMatch || resource.name.includes("/api/")) return;
    recordPerformanceMetric({
      name: assetMatch[1]?.match(/^(png|jpe?g|webp|gif|svg|mp4|webm|pdf)$/i) ? `asset ${resource.name.split("/").pop()}` : `resource ${resource.name.split("/").pop()}`,
      category: assetMatch[1]?.match(/^(png|jpe?g|webp|gif|svg|mp4|webm|pdf)$/i) ? "asset" : "navigation",
      durationMs: resource.duration,
      startedAt: performance.timeOrigin + resource.startTime,
      detail: { transferBytes: resource.transferSize || 0, decodedBytes: resource.decodedBodySize || 0, cacheLikely: resource.transferSize === 0 && resource.decodedBodySize > 0 },
    });
  });

  frameHandle = window.requestAnimationFrame((timestamp) => {
    firstFrameMs = round(timestamp);
    recordPerformanceMetric({ name: `${STARTUP_CLASS.classification}-startup-first-frame`, category: "navigation", durationMs: timestamp, startedAt: performance.timeOrigin, detail: { startupClass: STARTUP_CLASS.classification } });
    frameHandle = 0;
    monitorFrames(timestamp);
  });
  visibilityHandler = () => {
    if (!initialized || document.visibilityState !== "visible" || frameHandle) return;
    lastFrameAt = 0;
    frameHandle = window.requestAnimationFrame(monitorFrames);
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("load", () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigation) return;
    startupDomContentLoadedMs = round(navigation.domContentLoadedEventEnd);
    startupLoadMs = round(navigation.loadEventEnd);
    try { window.localStorage.setItem(STARTUP_SESSION_KEY, String(Date.now())); } catch {}
    recordPerformanceMetric({
      name: `${STARTUP_CLASS.classification}-renderer-startup`,
      category: "navigation",
      durationMs: navigation.domContentLoadedEventEnd,
      startedAt: performance.timeOrigin,
      detail: {
        startupClass: STARTUP_CLASS.classification,
        responseMs: Math.round(navigation.responseEnd - navigation.requestStart),
        domInteractiveMs: Math.round(navigation.domInteractive),
        loadMs: Math.round(navigation.loadEventEnd),
        transferBytes: navigation.transferSize || 0,
      },
    });
  }, { once: true });
}

export function disposePerformanceMonitoring() {
  initialized = false;
  observers.splice(0).forEach((observer) => observer.disconnect());
  if (typeof window !== "undefined") {
    window.cancelAnimationFrame(frameHandle);
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  }
  visibilityHandler = null;
  frameHandle = 0;
  lastFrameAt = 0;
}
