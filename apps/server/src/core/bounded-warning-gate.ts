/**
 * Bound repetitive request diagnostics without hiding the first failure.
 * This controls log emission only. Accounting, rejection and audit decisions
 * must happen independently of the gate.
 */
export class BoundedWarningGate {
  private readonly entries = new Map<string, { nextAt: number; suppressed: number }>();
  private readonly intervalMs: number;
  private readonly maxKeys: number;

  constructor(intervalMs = 60_000, maxKeys = 256) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1 || !Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new Error("Invalid warning gate bounds.");
    }
    this.intervalMs = intervalMs;
    this.maxKeys = maxKeys;
  }

  check(key: string, now = Date.now()): { emit: boolean; suppressedRepeats: number } {
    const previous = this.entries.get(key);
    if (previous && now < previous.nextAt) {
      previous.suppressed += 1;
      return { emit: false, suppressedRepeats: previous.suppressed };
    }
    // Expired or newly admitted keys move to the tail; evict old keys before
    // cardinality can grow without bound in a noisy or hostile environment.
    if (previous) this.entries.delete(key);
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { nextAt: now + this.intervalMs, suppressed: 0 });
    return { emit: true, suppressedRepeats: previous?.suppressed || 0 };
  }

  get size() { return this.entries.size; }
}
