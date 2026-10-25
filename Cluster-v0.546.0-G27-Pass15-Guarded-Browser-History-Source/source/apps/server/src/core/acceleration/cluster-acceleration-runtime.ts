import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { BoundedCache } from "../bounded-cache.js";
import { runRedisProtocolCompatibility, type RedisCompatibilityResult } from "./redis-compatibility.js";
import { validatedRateLimitReply, classifyRedisFailure } from "./redis-protocol-safety.js";

export type ClusterAccelerationMode = "auto" | "memory" | "redis-required";

type AccelerationLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

type AccelerationListener = (payload: unknown) => void | Promise<void>;

type RedisClientLike = {
  isReady?: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect?(): void;
  duplicate(): RedisClientLike;
  on(event: string, listener: (...args: any[]) => void): RedisClientLike;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pExpire(key: string, ttlMs: number): Promise<number | boolean>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string, channel?: string) => void): Promise<unknown>;
  unsubscribe(channel?: string): Promise<unknown>;
  sendCommand(args: string[]): Promise<unknown>;
  ping(): Promise<string>;
};

type RedisModuleLike = {
  createClient(options?: Record<string, unknown>): RedisClientLike;
};

export type ClusterAccelerationSnapshot = {
  mode: ClusterAccelerationMode;
  activeBackend: "redis" | "memory";
  distributed: boolean;
  healthy: boolean;
  redisConfigured: boolean;
  redisConnected: boolean;
  redisUrl: string | null;
  keyPrefix: string;
  nodeId: string;
  cache: { hits: number; misses: number; writes: number; deletes: number; errors: number; localEntries: number; localBytes: number };
  bus: { published: number; received: number; subscribers: number; errors: number; lastPublishedAt: string | null; lastReceivedAt: string | null };
  primitives: { rateLimitOps: number; dedupeClaims: number; leaseClaims: number };
  lastRedisError: string | null;
  redisReconnectAttempts: number;
};

type MemoryValue = { encoded: string; expiresAt: number };

function cleanPrefix(value: unknown) {
  const text = String(value || "cluster").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (text || "cluster").slice(0, 80);
}

function redactRedisUrl(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.password) url.password = "***";
    if (url.username) url.username = "***";
    return url.toString();
  } catch {
    return "configured";
  }
}

function jsonEncode(value: unknown) {
  return JSON.stringify({ v: 1, value });
}

function jsonDecode<T>(encoded: string | null): T | undefined {
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(encoded);
    return parsed?.v === 1 ? parsed.value as T : undefined;
  } catch {
    return undefined;
  }
}

export class ClusterAccelerationRuntime {
  readonly nodeId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  readonly mode: ClusterAccelerationMode;
  readonly keyPrefix: string;
  private readonly redisUrl: string | null;
  private readonly logger: AccelerationLogger;
  private command: RedisClientLike | null = null;
  private subscriber: RedisClientLike | null = null;
  private redisConnected = false;
  private redisSubscribed = false;
  private started = false;
  private stopping = false;
  private redisRetryTimer: NodeJS.Timeout | null = null;
  private redisReconnectAttempts = 0;
  private readonly listeners = new Map<string, Set<AccelerationListener>>();
  private readonly memory = new BoundedCache<string, MemoryValue>({
    maxEntries: Math.max(256, Number(process.env.CLUSTER_ACCELERATION_MEMORY_ENTRIES || 8_192)),
    maxWeight: Math.max(4 * 1024 * 1024, Number(process.env.CLUSTER_ACCELERATION_MEMORY_BYTES || 64 * 1024 * 1024)),
    weightOf: (entry, key) => Buffer.byteLength(key, "utf8") + Buffer.byteLength(entry.encoded, "utf8") + 48,
  });
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheWrites = 0;
  private cacheDeletes = 0;
  private cacheErrors = 0;
  private busPublished = 0;
  private busReceived = 0;
  private busErrors = 0;
  private rateLimitOps = 0;
  private dedupeClaims = 0;
  private leaseClaims = 0;
  private lastPublishedAt: Date | null = null;
  private lastReceivedAt: Date | null = null;
  private lastRedisError: string | null = null;
  private compatibilityPromise: Promise<RedisCompatibilityResult> | null = null;
  private compatibilityCached: { at: number; result: RedisCompatibilityResult } | null = null;

  constructor(input: {
    mode?: ClusterAccelerationMode;
    redisUrl?: string | null;
    keyPrefix?: string | null;
    logger?: AccelerationLogger;
  } = {}) {
    this.mode = input.mode || "auto";
    this.redisUrl = String(input.redisUrl || "").trim() || null;
    this.keyPrefix = cleanPrefix(input.keyPrefix || "cluster");
    this.logger = input.logger || {};
  }

  private redisKey(key: string) {
    return `${this.keyPrefix}:${String(key || "").replace(/^:+/, "")}`;
  }

  private busChannel() {
    return this.redisKey("bus:v1");
  }

  async start() {
    if (this.started) return this.snapshot();
    this.started = true;
    this.stopping = false;
    if (this.mode === "memory" || !this.redisUrl) {
      if (this.mode === "redis-required" && !this.redisUrl) throw new Error("Redis-required acceleration mode needs CLUSTER_REDIS_URL or redisUrlOverride.");
      this.logger.info?.({ mode: this.mode, backend: "memory" }, "Cluster acceleration layer started without Redis");
      return this.snapshot();
    }
    try {
      await this.connectRedis();
    } catch (error) {
      this.noteRedisError(error);
      await this.closeRedis();
      if (this.mode === "redis-required") throw new Error(`Cluster acceleration Redis backend is required but unavailable (${classifyRedisFailure(error)}).`);
      this.logger.warn?.({ errorCode: classifyRedisFailure(error), backend: "memory" }, "Redis acceleration unavailable; Cluster is continuing with bounded in-memory acceleration");
      this.scheduleRedisReconnect();
    }
    return this.snapshot();
  }

  async close() {
    this.stopping = true;
    this.started = false;
    if (this.redisRetryTimer) clearTimeout(this.redisRetryTimer);
    this.redisRetryTimer = null;
    await this.closeRedis();
    this.listeners.clear();
    this.memory.clear();
  }

  /** Explicit operator probe of the configured acceleration connection.
   * Nothing is sent to user-supplied URLs and no periodic task is installed.
   * Concurrent requests share a run; repeat checks are cooled down for 2 min.
   */
  async checkConfiguredCompatibility() {
    const snapshot = this.snapshot();
    if (!snapshot.distributed || !this.command) return {
      checkedAt: new Date().toISOString(),
      backend: snapshot.activeBackend,
      status: "unavailable" as const,
      steps: [],
      note: snapshot.redisConfigured
        ? "Configured Redis endpoint is not connected; no compatibility commands were sent. Cluster may be using memory fallback."
        : "No Redis endpoint configured; Garnet/Redis compatibility is not tested and memory fallback remains active.",
    };
    if (this.compatibilityPromise) return this.compatibilityPromise;
    if (this.compatibilityCached && Date.now()-this.compatibilityCached.at < 120_000) {
      return { ...this.compatibilityCached.result, cached: true };
    }
    const command = this.command;
    const probe = runRedisProtocolCompatibility({command, prefix:this.keyPrefix});
    this.compatibilityPromise = probe;
    try {
      const result = await probe;
      this.compatibilityCached = {at:Date.now(), result};
      return result;
    } finally { if (this.compatibilityPromise === probe) this.compatibilityPromise = null; }
  }

  isDistributed() {
    return Boolean(this.redisConnected && this.redisSubscribed && this.command?.isReady && this.subscriber?.isReady);
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    const clean = String(key || "").trim();
    if (!clean) return undefined;
    if (this.isDistributed()) {
      try {
        const encoded = await this.command!.get(this.redisKey(`cache:${clean}`));
        const value = jsonDecode<T>(encoded);
        if (value !== undefined) { this.cacheHits += 1; return value; }
        this.cacheMisses += 1;
        return undefined;
      } catch (error) {
        this.cacheErrors += 1;
        this.noteRedisError(error);
      }
    }
    const entry = this.memory.get(clean);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) this.memory.delete(clean);
      this.cacheMisses += 1;
      return undefined;
    }
    const value = jsonDecode<T>(entry.encoded);
    if (value === undefined) { this.cacheMisses += 1; return undefined; }
    this.cacheHits += 1;
    return value;
  }

  async setJson(key: string, value: unknown, ttlMs: number) {
    const clean = String(key || "").trim();
    if (!clean) throw new Error("Acceleration cache key is required.");
    const ttl = Math.max(100, Math.min(24 * 60 * 60_000, Math.round(ttlMs || 1_000)));
    const encoded = jsonEncode(value);
    if (this.isDistributed()) {
      try {
        await this.command!.set(this.redisKey(`cache:${clean}`), encoded, { PX: ttl });
        this.cacheWrites += 1;
        return true;
      } catch (error) {
        this.cacheErrors += 1;
        this.noteRedisError(error);
      }
    }
    this.memory.set(clean, { encoded, expiresAt: Date.now() + ttl }, ttl);
    this.cacheWrites += 1;
    return true;
  }

  async delete(key: string) {
    const clean = String(key || "").trim();
    if (!clean) return false;
    this.memory.delete(clean);
    if (this.isDistributed()) {
      try { await this.command!.del(this.redisKey(`cache:${clean}`)); }
      catch (error) { this.cacheErrors += 1; this.noteRedisError(error); }
    }
    this.cacheDeletes += 1;
    return true;
  }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    await this.setJson(key, value, ttlMs);
    return value;
  }

  subscribe(topicValue: string, listener: AccelerationListener) {
    const topic = String(topicValue || "").trim();
    if (!topic) throw new Error("Acceleration topic is required.");
    const set = this.listeners.get(topic) || new Set<AccelerationListener>();
    set.add(listener);
    this.listeners.set(topic, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(topic);
    };
  }

  async publish(topicValue: string, payload: unknown) {
    const topic = String(topicValue || "").trim();
    if (!topic) throw new Error("Acceleration topic is required.");
    if (!this.isDistributed()) return false;
    const envelope = JSON.stringify({ v: 1, nodeId: this.nodeId, eventId: randomUUID(), topic, at: Date.now(), payload });
    if (Buffer.byteLength(envelope, "utf8") > 256 * 1024) {
      this.busErrors += 1;
      return false;
    }
    try {
      await this.command!.publish(this.busChannel(), envelope);
      this.busPublished += 1;
      this.lastPublishedAt = new Date();
      return true;
    } catch (error) {
      this.busErrors += 1;
      this.noteRedisError(error);
      return false;
    }
  }

  async claimDedupe(key: string, ttlMs: number) {
    const clean = this.redisKey(`dedupe:${String(key || "").trim()}`);
    const ttl = Math.max(100, Math.min(24 * 60 * 60_000, Math.round(ttlMs || 1_000)));
    this.dedupeClaims += 1;
    if (!this.isDistributed()) return false;
    try {
      const result = await this.command!.set(clean, this.nodeId, { NX: true, PX: ttl });
      return String(result || "").toUpperCase() === "OK";
    } catch (error) {
      this.noteRedisError(error);
      return false;
    }
  }

  async acquireLease(key: string, ttlMs: number) {
    const clean = this.redisKey(`lease:${String(key || "").trim()}`);
    const ttl = Math.max(500, Math.min(24 * 60 * 60_000, Math.round(ttlMs || 5_000)));
    const token = randomUUID();
    this.leaseClaims += 1;
    if (!this.isDistributed()) return null;
    try {
      const result = await this.command!.set(clean, token, { NX: true, PX: ttl });
      return String(result || "").toUpperCase() === "OK" ? { key: clean, token, ttlMs: ttl } : null;
    } catch (error) {
      this.noteRedisError(error);
      return null;
    }
  }

  async releaseLease(lease: { key: string; token: string } | null | undefined) {
    if (!lease || !this.isDistributed()) return false;
    const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
    try {
      const result = await this.command!.sendCommand(["EVAL", script, "1", lease.key, lease.token]);
      return Number(result || 0) > 0;
    } catch (error) {
      this.noteRedisError(error);
      return false;
    }
  }

  async consumeFixedWindow(key: string, limit: number, windowMs: number, cost = 1, now = Date.now()) {
    if (!this.isDistributed()) return null;
    this.rateLimitOps += 1;
    const redisKey = this.redisKey(`rate:${String(key || "").trim()}`);
    const ttl = Math.max(1, Math.round(windowMs));
    const script = `local current = redis.call('INCRBY', KEYS[1], ARGV[1]); if current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]); end; local remain = redis.call('PTTL', KEYS[1]); return {current, remain}`;
    try {
      const result = await this.command!.sendCommand(["EVAL", script, "1", redisKey, String(cost), String(ttl)]) as any;
      const validated = validatedRateLimitReply(result, cost, ttl);
      if (!validated) {
        this.noteRedisError(new Error("Invalid rate-limit reply"));
        return null; // PostgreSQL fallback, never a guessed/allowed Redis decision.
      }
      const { count, remainingTtl } = validated;
      const resetAt = now + remainingTtl;
      const allowed = count <= limit;
      return { allowed, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(remainingTtl / 1000)) };
    } catch (error) {
      this.noteRedisError(error);
      return null;
    }
  }

  async deleteRateLimit(key: string) {
    if (!this.isDistributed()) return false;
    try { return (await this.command!.del(this.redisKey(`rate:${String(key || "").trim()}`))) > 0; }
    catch (error) { this.noteRedisError(error); return false; }
  }

  snapshot(): ClusterAccelerationSnapshot {
    return {
      mode: this.mode,
      activeBackend: this.isDistributed() ? "redis" : "memory",
      distributed: this.isDistributed(),
      healthy: this.mode !== "redis-required" || this.isDistributed(),
      redisConfigured: Boolean(this.redisUrl),
      redisConnected: this.redisConnected,
      redisUrl: redactRedisUrl(this.redisUrl),
      keyPrefix: this.keyPrefix,
      nodeId: this.nodeId,
      cache: { hits: this.cacheHits, misses: this.cacheMisses, writes: this.cacheWrites, deletes: this.cacheDeletes, errors: this.cacheErrors, localEntries: this.memory.size, localBytes: this.memory.weight },
      bus: { published: this.busPublished, received: this.busReceived, subscribers: [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0), errors: this.busErrors, lastPublishedAt: this.lastPublishedAt?.toISOString() || null, lastReceivedAt: this.lastReceivedAt?.toISOString() || null },
      primitives: { rateLimitOps: this.rateLimitOps, dedupeClaims: this.dedupeClaims, leaseClaims: this.leaseClaims },
      lastRedisError: this.lastRedisError,
      redisReconnectAttempts: this.redisReconnectAttempts,
    };
  }


  private refreshRedisConnected() {
    this.redisConnected = Boolean(this.redisSubscribed && this.command?.isReady && this.subscriber?.isReady);
  }

  private async connectRedis() {
    if (!this.redisUrl || this.stopping || !this.started) return;
    await this.closeRedis();
    const redisModule = await import("@redis/client") as unknown as RedisModuleLike;
    const maxSocketRetries = Math.max(0, Math.min(5, Number(process.env.CLUSTER_REDIS_SOCKET_RETRIES || 1)));
    const command = redisModule.createClient({
      url: this.redisUrl,
      socket: {
        connectTimeout: Math.max(500, Number(process.env.CLUSTER_REDIS_CONNECT_TIMEOUT_MS || 2_500)),
        reconnectStrategy: (retries: number) => retries > maxSocketRetries
          ? new Error("Cluster Redis socket retry budget exhausted")
          : Math.min(2_000, 250 * 2 ** Math.min(retries, 3)),
      },
    });
    command.on("error", (error: unknown) => { if (this.command === command) this.noteRedisError(error); });
    command.on("ready", () => { if (this.command === command) this.refreshRedisConnected(); });
    command.on("end", () => {
      if (this.command !== command) return;
      this.redisConnected = false;
      this.redisSubscribed = false;
      if (!this.stopping && this.mode !== "memory") this.scheduleRedisReconnect();
    });
    const subscriber = command.duplicate();
    subscriber.on("error", (error: unknown) => { if (this.subscriber === subscriber) this.noteRedisError(error); });
    subscriber.on("ready", () => { if (this.subscriber === subscriber) this.refreshRedisConnected(); });
    subscriber.on("end", () => {
      if (this.subscriber !== subscriber) return;
      this.redisConnected = false;
      this.redisSubscribed = false;
      if (!this.stopping && this.mode !== "memory") this.scheduleRedisReconnect();
    });
    this.command = command;
    this.subscriber = subscriber;
    this.redisSubscribed = false;
    await Promise.all([command.connect(), subscriber.connect()]);
    await command.ping();
    await subscriber.subscribe(this.busChannel(), (message) => { void this.onRedisMessage(message); });
    this.redisSubscribed = true;
    this.refreshRedisConnected();
    if (!this.redisConnected) throw new Error("Redis clients became unavailable before acceleration Pub/Sub was ready.");
    // Do not advertise a distributed backend until all primitives actually
    // required by Cluster have passed against THIS backend generation.
    // Garnet can speak RESP without Lua enabled, which breaks our lease and
    // rate limiter scripts. Probe only at connect/reconnect; never per request.
    this.redisConnected = false;
    const protocol = await runRedisProtocolCompatibility({ command, prefix: this.keyPrefix });
    if (protocol.status !== "passed") {
      const missing = protocol.steps.filter(step => !step.ok).map(step => step.command).join(",");
      throw new Error(`Configured Redis acceleration lacks required commands: ${missing || "unknown"}.`);
    }
    this.refreshRedisConnected();
    if (!this.redisConnected) throw new Error("Redis disconnected during protocol verification.");
    this.compatibilityCached = { at: Date.now(), result: protocol };
    if (this.redisRetryTimer) clearTimeout(this.redisRetryTimer);
    this.redisRetryTimer = null;
    this.redisReconnectAttempts = 0;
    this.lastRedisError = null;
    this.logger.info?.({ backend: "redis", url: redactRedisUrl(this.redisUrl), prefix: this.keyPrefix }, "Cluster acceleration layer connected");
  }

  private scheduleRedisReconnect() {
    if (this.stopping || !this.started || this.mode === "memory" || !this.redisUrl || this.redisRetryTimer) return;
    this.redisReconnectAttempts += 1;
    const base = Math.max(5_000, Number(process.env.CLUSTER_REDIS_RETRY_INTERVAL_MS || 15_000));
    const delay = Math.min(5 * 60_000, base * Math.max(1, Math.min(this.redisReconnectAttempts, 8)));
    this.redisRetryTimer = setTimeout(() => {
      this.redisRetryTimer = null;
      void this.connectRedis().catch(async (error) => {
        this.noteRedisError(error);
        await this.closeRedis();
        this.scheduleRedisReconnect();
      });
    }, delay);
    this.redisRetryTimer.unref?.();
  }

  private async onRedisMessage(message: string) {
    let envelope: any;
    try { envelope = JSON.parse(message); } catch { this.busErrors += 1; return; }
    if (!envelope || envelope.v !== 1 || envelope.nodeId === this.nodeId || !envelope.topic) return;
    this.busReceived += 1;
    this.lastReceivedAt = new Date();
    const listeners = [...(this.listeners.get(String(envelope.topic)) || [])];
    if (!listeners.length) return;
    const outcomes = await Promise.allSettled(listeners.map((listener) => listener(envelope.payload)));
    for (const outcome of outcomes) if (outcome.status === "rejected") this.logger.warn?.({ errorCode: classifyRedisFailure(outcome.reason), topic: envelope.topic }, "Cluster acceleration subscriber failed");
  }

  private noteRedisError(error: unknown) {
    this.redisConnected = false;
    // Raw transport messages can embed redis:// credentials or token query
    // parameters; only expose a bounded, non-secret classification.
    this.lastRedisError = classifyRedisFailure(error);
    this.compatibilityCached = null;
    if (!this.stopping && this.started && this.mode !== "memory" && this.redisUrl) this.scheduleRedisReconnect();
  }

  private async closeRedis() {
    this.compatibilityCached = null;
    const subscriber = this.subscriber;
    const command = this.command;
    this.subscriber = null;
    this.command = null;
    this.redisConnected = false;
    this.redisSubscribed = false;
    if (subscriber) {
      try { await subscriber.unsubscribe(this.busChannel()); } catch { /* best effort */ }
      try { await subscriber.quit(); } catch { try { subscriber.disconnect?.(); } catch { /* best effort */ } }
    }
    if (command) {
      try { await command.quit(); } catch { try { command.disconnect?.(); } catch { /* best effort */ } }
    }
  }
}
