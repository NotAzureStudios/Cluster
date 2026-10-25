import type { ServerDomainDescriptor } from "../app/server-domain-catalog.js";

/**
 * Advisory dependency readiness for the API Tool Manager. Probes are exclusively
 * authoritative in-process health signals, NOT URLs supplied by users or
 * workspace tools. This is not a per-route correctness or authorization test.
 */
export type ApiDependencySignal = {
  key: "lifecycle" | "database" | "storage" | "background-tasks";
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
};
export type ApiToolDependencyPosture = "not-sampled" | "dependency-passing" | "dependency-warning" | "dependency-failed" | "dependency-unknown";
export type ApiToolDependencyReadiness = {
  key: string;
  posture: ApiToolDependencyPosture;
  dependencies: ApiDependencySignal[];
  sampledAt: string | null;
};

const STORAGE_CONSUMERS = new Set(["library", "uploads", "data-imports", "data-exports", "source-control"]);
const BACKGROUND_CONSUMERS = new Set(["jobs", "automation", "notifications", "sync", "uploads", "data-exports", "data-imports"]);
const SIGNAL_KEYS = ["lifecycle", "database", "storage", "background-tasks"] as const;

function requiredSignalKeys(domain: ServerDomainDescriptor): ApiDependencySignal["key"][] {
  return SIGNAL_KEYS.filter((key) => key === "lifecycle" || key === "database" ||
    (key === "storage" && STORAGE_CONSUMERS.has(domain.key)) ||
    (key === "background-tasks" && BACKGROUND_CONSUMERS.has(domain.key)));
}
function describeSignal(value: ApiDependencySignal): ApiDependencySignal {
  const status = ["pass", "warn", "fail", "unknown"].includes(value?.status) ? value.status : "unknown";
  // Do not project arbitrary filesystem paths, exception details, or credentials.
  return { key: value.key, status, detail: String(value.detail || "No observation available.").slice(0, 180) };
}

export class ApiToolReadinessMonitor {
  private capturedAt: string | null = null;
  private signals: ApiDependencySignal[] = [];
  private inFlight: Promise<void> | null = null;
  private successfulSamples = 0;
  private failedSamples = 0;

  constructor(private readonly sampler: () => Promise<readonly ApiDependencySignal[]>, private readonly now: () => Date = () => new Date()) {}

  /** Single-flight. The sampler is fixed by the server and never accepts a URL. */
  async sample(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const task = (async () => {
      const values = await this.sampler();
      const byKey = new Map<ApiDependencySignal["key"], ApiDependencySignal>();
      for (const item of values) {
        if (!item || !SIGNAL_KEYS.includes(item.key) || byKey.has(item.key)) continue;
        byKey.set(item.key, describeSignal(item));
      }
      this.signals = SIGNAL_KEYS.map((key) => byKey.get(key) || { key, status: "unknown", detail: "No observation available." });
      this.capturedAt = this.now().toISOString();
      this.successfulSamples++;
    })().catch((error) => {
      this.failedSamples++;
      // A sampler exception must never be converted to a false healthy result.
      // Preserve previous evidence but let it become stale as it ages.
      throw error;
    });
    this.inFlight = task;
    try { await task; } finally { if (this.inFlight === task) this.inFlight = null; }
  }

  /** Admin-requested safe refresh. Coalesced and throttled across callers. */
  async sampleIfDue(minIntervalMs = 30_000): Promise<"sampled" | "cached"> {
    if (this.inFlight) { await this.inFlight; return "cached"; }
    const elapsed = this.capturedAt ? this.now().getTime() - Date.parse(this.capturedAt) : Infinity;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < minIntervalMs) return "cached";
    await this.sample();
    return "sampled";
  }

  snapshot(domains: readonly ServerDomainDescriptor[], maxAgeMs = 5 * 60_000) {
    const ageMs = this.capturedAt ? Math.max(0, this.now().getTime() - Date.parse(this.capturedAt)) : null;
    const stale = ageMs == null || !Number.isFinite(ageMs) || ageMs > maxAgeMs;
    const byKey = new Map(this.signals.map((signal) => [signal.key, signal]));
    const tools: ApiToolDependencyReadiness[] = domains.map((domain) => {
      const dependencies = requiredSignalKeys(domain).map((key) => byKey.get(key) || { key, status: "unknown" as const, detail: "Not sampled." });
      const posture: ApiToolDependencyPosture = this.capturedAt === null ? "not-sampled" : stale ? "dependency-unknown" :
        dependencies.some((signal) => signal.status === "fail") ? "dependency-failed" :
        dependencies.some((signal) => signal.status === "unknown") ? "dependency-unknown" :
        dependencies.some((signal) => signal.status === "warn") ? "dependency-warning" : "dependency-passing";
      return { key: domain.key, posture, dependencies, sampledAt: this.capturedAt };
    });
    return {
      schemaVersion: 1,
      provenance: "in-process-canonical-dependency-checks",
      perToolEndpointProbed: false,
      diagnosticOnly: true,
      sampledAt: this.capturedAt,
      ageMs,
      stale,
      inFlight: Boolean(this.inFlight),
      successfulSamples: this.successfulSamples,
      failedSamples: this.failedSamples,
      signals: this.signals.map((signal) => ({ ...signal })),
      tools,
    };
  }
}

export function joinApiToolDependencyReadiness<T extends { key: string }>(
  tools: T[],
  readiness: ReturnType<ApiToolReadinessMonitor["snapshot"]>,
): Array<T & { dependencyReadiness: ApiToolDependencyReadiness }> {
  const byKey = new Map(readiness.tools.map((tool) => [tool.key, tool]));
  return tools.map((tool) => ({ ...tool, dependencyReadiness: byKey.get(tool.key) || {
    key: tool.key, posture: "not-sampled", dependencies: [], sampledAt: null,
  } }));
}
