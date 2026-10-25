export type ReadinessProbeResult = {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  cached: boolean;
  timedOut: boolean;
  error: string | null;
  inFlight?: boolean;
};

type ProbeValue = Omit<ReadinessProbeResult, "cached">;

export class CachedReadinessProbe {
  private cached: ProbeValue | null = null;
  private inFlight: Promise<ProbeValue> | null = null;

  constructor(
    private readonly probe: () => Promise<unknown>,
    private readonly options: { ttlMs?: number; timeoutMs?: number } = {},
  ) {}

  async check(force = false): Promise<ReadinessProbeResult> {
    const ttlMs = Math.max(0, this.options.ttlMs ?? 1_000);
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < ttlMs) {
      return { ...this.cached, cached: true };
    }

    if (!this.inFlight) {
      const startedAt = performance.now();
      this.inFlight = this.probe()
        .then(() => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          latencyMs: Number((performance.now() - startedAt).toFixed(1)),
          timedOut: false,
          error: null,
        }))
        .catch((error) => ({
          ok: false,
          checkedAt: new Date().toISOString(),
          latencyMs: Number((performance.now() - startedAt).toFixed(1)),
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        .then((result) => {
          this.cached = result;
          return result;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }

    const timeoutMs = Math.max(100, this.options.timeoutMs ?? 2_500);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<ProbeValue>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: timeoutMs,
        timedOut: true,
        error: `Readiness probe timed out after ${timeoutMs}ms.`,
      }), timeoutMs);
      timeoutHandle.unref?.();
    });
    const activeProbe = this.inFlight;
    if (!activeProbe) throw new Error("Readiness probe did not start.");
    try {
      const result = await Promise.race([activeProbe, timeout]);
      return { ...result, cached: false };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  snapshot(): ReadinessProbeResult | null {
    return this.cached ? { ...this.cached, cached: true, inFlight: Boolean(this.inFlight) } : null;
  }
}
