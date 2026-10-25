export type CircuitBreakerState = "closed" | "open" | "half-open";

type CircuitRecord = {
  failures: number;
  openedAt: number | null;
  probeInFlight: boolean;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
};

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN";
  constructor(public readonly key: string, public readonly retryAfterMs: number) {
    super(`Dependency circuit ${key} is open. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();

  constructor(private readonly options: {
    failureThreshold?: number;
    baseCooldownMs?: number;
    maximumCooldownMs?: number;
    maxEntries?: number;
  } = {}) {}

  private record(key: string) {
    let value = this.records.get(key);
    if (!value) {
      value = { failures: 0, openedAt: null, probeInFlight: false, lastFailureAt: null, lastSuccessAt: null };
      this.records.set(key, value);
      this.prune();
    }
    return value;
  }

  private cooldown(record: CircuitRecord) {
    const base = Math.max(1_000, this.options.baseCooldownMs ?? 15_000);
    const max = Math.max(base, this.options.maximumCooldownMs ?? 10 * 60_000);
    const exponent = Math.max(0, record.failures - (this.options.failureThreshold ?? 5));
    return Math.min(max, base * 2 ** Math.min(exponent, 6));
  }

  state(key: string): { state: CircuitBreakerState; retryAfterMs: number; failures: number } {
    const record = this.records.get(key);
    if (!record || !record.openedAt) return { state: "closed", retryAfterMs: 0, failures: record?.failures || 0 };
    const remaining = this.cooldown(record) - (Date.now() - record.openedAt);
    if (remaining > 0) return { state: "open", retryAfterMs: remaining, failures: record.failures };
    return { state: "half-open", retryAfterMs: 0, failures: record.failures };
  }

  async execute<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const record = this.record(key);
    const state = this.state(key);
    if (state.state === "open") throw new CircuitOpenError(key, state.retryAfterMs);
    if (state.state === "half-open") {
      if (record.probeInFlight) throw new CircuitOpenError(key, Math.max(1_000, this.options.baseCooldownMs ?? 15_000));
      record.probeInFlight = true;
    }

    try {
      const result = await operation();
      record.failures = 0;
      record.openedAt = null;
      record.probeInFlight = false;
      record.lastSuccessAt = Date.now();
      return result;
    } catch (error) {
      record.failures += 1;
      record.lastFailureAt = Date.now();
      record.probeInFlight = false;
      if (record.failures >= (this.options.failureThreshold ?? 5)) record.openedAt = Date.now();
      throw error;
    }
  }

  snapshot() {
    return [...this.records.entries()].map(([key, record]) => ({
      key,
      ...this.state(key),
      lastFailureAt: record.lastFailureAt ? new Date(record.lastFailureAt).toISOString() : null,
      lastSuccessAt: record.lastSuccessAt ? new Date(record.lastSuccessAt).toISOString() : null,
    }));
  }

  private prune() {
    const maximum = Math.max(32, this.options.maxEntries ?? 2_000);
    if (this.records.size <= maximum) return;
    const candidates = [...this.records.entries()]
      .filter(([, record]) => !record.openedAt && !record.probeInFlight)
      .sort((a, b) => (a[1].lastSuccessAt || a[1].lastFailureAt || 0) - (b[1].lastSuccessAt || b[1].lastFailureAt || 0));
    for (const [key] of candidates.slice(0, this.records.size - maximum)) this.records.delete(key);
  }
}
