import { randomUUID } from "node:crypto";
import { BoundedCache } from "./bounded-cache.js";

export type ProjectReadModelRuntimeSnapshot = {
  entries: number;
  pending: number;
  bytes: number;
  hits: number;
  sharedHits: number;
  misses: number;
  invalidations: number;
  loads: number;
  sharedBackend: boolean;
};

type SharedAcceleration = {
  getJson<T>(key: string): Promise<T | undefined>;
  setJson(key: string, value: unknown, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  snapshot?: () => { distributed?: boolean };
};

export class ProjectReadModelRuntime {
  private readonly cache = new BoundedCache<string, unknown>({
    maxEntries: Math.max(16, Number(process.env.CLUSTER_PROJECT_READ_MODEL_CACHE_ENTRIES || 256)),
    maxWeight: Math.max(8 * 1024 * 1024, Number(process.env.CLUSTER_PROJECT_READ_MODEL_CACHE_BYTES || 48 * 1024 * 1024)),
    weightOf: (value) => {
      try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
      catch { return 1024; }
    },
  });
  private readonly knownProjects = new Set<string>();
  private hits = 0;
  private sharedHits = 0;
  private misses = 0;
  private invalidations = 0;
  private loads = 0;

  constructor(private readonly acceleration?: SharedAcceleration) {}

  async getOrLoad<T>(projectId: string, loader: () => Promise<T>, ttlMs = 15_000, namespace = "default"): Promise<T> {
    const projectKey = String(projectId || "").trim();
    if (!projectKey) throw new Error("Project read-model cache requires a project ID.");
    const scope = String(namespace || "default").trim().replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 80) || "default";
    const key = `${scope}:${projectKey}`;
    this.knownProjects.add(projectKey);

    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      return cached as T;
    }

    const boundedTtl = Math.max(1_000, Math.min(60_000, ttlMs));
    let sharedKey: string | null = null;
    if (this.acceleration?.snapshot?.().distributed) {
      const epoch = await this.acceleration.getJson<string>(`project-read-model-epoch:${projectKey}`) || "0";
      sharedKey = `project-read-model:${projectKey}:${epoch}:${scope}`;
      const shared = await this.acceleration.getJson<T>(sharedKey);
      if (shared !== undefined) {
        this.sharedHits += 1;
        this.cache.set(key, shared, Math.min(boundedTtl, 5_000));
        return shared;
      }
    }

    this.misses += 1;
    return this.cache.getOrLoad(key, { ttlMs: boundedTtl }, async () => {
      this.loads += 1;
      const value = await loader();
      if (sharedKey && this.acceleration?.snapshot?.().distributed) void this.acceleration.setJson(sharedKey, value, boundedTtl);
      return value as unknown;
    }) as Promise<T>;
  }

  async invalidate(projectId: string | null | undefined) {
    const projectKey = String(projectId || "").trim();
    if (!projectKey) return false;
    const removed = this.cache.deleteWhere((key) => String(key).endsWith(`:${projectKey}`));
    this.knownProjects.add(projectKey);
    let sharedInvalidated = false;
    if (this.acceleration?.snapshot?.().distributed) {
      // Namespace rotation makes stale shared entries unreachable even if the
      // process that originally populated them is long gone. The epoch only
      // needs to outlive the maximum shared read-model TTL.
      await this.acceleration.setJson(`project-read-model-epoch:${projectKey}`, randomUUID(), 10 * 60_000);
      sharedInvalidated = true;
    }
    if (removed || sharedInvalidated) this.invalidations += Math.max(1, removed + (sharedInvalidated ? 1 : 0));
    return removed > 0 || sharedInvalidated;
  }

  clear() {
    const hadEntries = this.cache.size > 0;
    const projects = [...this.knownProjects];
    this.cache.clear();
    if (this.acceleration?.snapshot?.().distributed && projects.length) {
      void Promise.allSettled(projects.map((projectKey) => this.acceleration!.setJson(`project-read-model-epoch:${projectKey}`, randomUUID(), 10 * 60_000)));
    }
    if (hadEntries || projects.length) this.invalidations += 1;
  }

  snapshot(): ProjectReadModelRuntimeSnapshot {
    return {
      entries: this.cache.size,
      pending: this.cache.pending,
      bytes: this.cache.weight,
      hits: this.hits,
      sharedHits: this.sharedHits,
      misses: this.misses,
      invalidations: this.invalidations,
      loads: this.loads,
      sharedBackend: Boolean(this.acceleration?.snapshot?.().distributed),
    };
  }
}
