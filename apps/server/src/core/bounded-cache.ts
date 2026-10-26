export type CacheLoadOptions = {
  ttlMs: number;
};

export type BoundedCacheOptions<K, V> = {
  maxEntries: number;
  maxWeight?: number;
  weightOf?: (value: V, key: K) => number;
};

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
  weight: number;
};

export class BoundedCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly epochs = new Map<K, number>();
  private readonly maxEntries: number;
  private readonly maxWeight: number;
  private readonly weightOf: (value: V, key: K) => number;
  private totalWeight = 0;

  constructor(input: number | BoundedCacheOptions<K, V>) {
    const options = typeof input === "number" ? { maxEntries: input } : input;
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) throw new Error("BoundedCache maxEntries must be a positive integer.");
    if (options.maxWeight != null && (!Number.isFinite(options.maxWeight) || options.maxWeight < 1)) throw new Error("BoundedCache maxWeight must be a positive finite number.");
    this.maxEntries = options.maxEntries;
    this.maxWeight = Math.max(1, Math.floor(options.maxWeight ?? Number.MAX_SAFE_INTEGER));
    this.weightOf = options.weightOf || (() => 1);
  }

  get size() {
    return this.entries.size;
  }

  get pending() {
    return this.inFlight.size;
  }

  get weight() {
    return this.totalWeight;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.removeEntry(key);
      this.cleanupEpoch(key);
      return undefined;
    }
    // Map insertion order doubles as a tiny LRU without a second index.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number) {
    const ttl = Math.max(1, Math.floor(ttlMs));
    this.removeEntry(key);
    const measured = Number(this.weightOf(value, key));
    const weight = Number.isFinite(measured) && measured > 0 ? Math.max(1, Math.floor(measured)) : 1;
    this.entries.set(key, { value, expiresAt: Date.now() + ttl, weight });
    this.totalWeight += weight;
    this.trim();
    return value;
  }

  async getOrLoad(key: K, options: CacheLoadOptions, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const epoch = this.epochs.get(key) || 0;
    let pending!: Promise<V>;
    pending = loader()
      .then((value) => {
        if ((this.epochs.get(key) || 0) === epoch) this.set(key, value, options.ttlMs);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        this.cleanupEpoch(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  delete(key: K) {
    const existed = this.entries.has(key) || this.inFlight.has(key);
    this.invalidateKey(key);
    return existed;
  }

  clear() {
    const keys = new Set<K>([...this.entries.keys(), ...this.inFlight.keys()]);
    for (const key of keys) this.invalidateKey(key);
  }

  deleteWhere(predicate: (key: K, value?: V) => boolean) {
    let removed = 0;
    const keys = new Set<K>([...this.entries.keys(), ...this.inFlight.keys()]);
    for (const key of keys) {
      const value = this.entries.get(key)?.value;
      if (!predicate(key, value)) continue;
      if (this.entries.has(key) || this.inFlight.has(key)) removed += 1;
      this.invalidateKey(key);
    }
    return removed;
  }

  pruneExpired(now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.removeEntry(key);
      this.cleanupEpoch(key);
      removed += 1;
    }
    return removed;
  }

  private invalidateKey(key: K) {
    this.removeEntry(key);
    this.inFlight.delete(key);
    this.epochs.set(key, (this.epochs.get(key) || 0) + 1);
  }

  private removeEntry(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalWeight = Math.max(0, this.totalWeight - entry.weight);
    return true;
  }

  private cleanupEpoch(key: K) {
    if (this.entries.has(key) || this.inFlight.has(key)) return;
    this.epochs.delete(key);
  }

  private trim() {
    while (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.removeEntry(oldest);
      this.cleanupEpoch(oldest);
    }
  }
}
