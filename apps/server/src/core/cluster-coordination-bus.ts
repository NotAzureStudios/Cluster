import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

export type ClusterCoordinationEnvelope = {
  v: 1;
  nodeId: string;
  eventId: string;
  topic: string;
  at: number;
  payload: unknown;
};

export type ClusterCoordinationBusSnapshot = {
  nodeId: string;
  channel: string;
  connected: boolean;
  reconnects: number;
  published: number;
  received: number;
  dropped: number;
  lastConnectedAt: string | null;
  lastReceivedAt: string | null;
  transport: "redis" | "postgresql";
  accelerationPublished: number;
  postgresqlPublished: number;
};

type CoordinationLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

type Listener = (payload: unknown, envelope: ClusterCoordinationEnvelope) => void | Promise<void>;

type AccelerationTransport = {
  isDistributed?: () => boolean;
  publish: (topic: string, payload: unknown) => Promise<boolean>;
  subscribe: (topic: string, listener: (payload: unknown) => void | Promise<void>) => () => void;
};

function postgresCoordinationUrl() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) throw new Error("DATABASE_URL is required for Cluster coordination.");
  const url = new URL(raw);
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("pool_timeout");
  url.searchParams.delete("connect_timeout");
  url.searchParams.set("application_name", `cluster-coordinator-${hostname()}-${process.pid}`);
  return url.toString();
}

function channelName(value: string) {
  const normalized = String(value || "cluster_coordination_v1").trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 63);
  if (!normalized) throw new Error("Cluster coordination channel is invalid.");
  return normalized;
}

export class ClusterCoordinationBus {
  readonly nodeId: string;
  readonly channel: string;
  private client: Client | null = null;
  private stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private readonly listeners = new Map<string, Set<Listener>>();
  private connected = false;
  private reconnects = 0;
  private published = 0;
  private received = 0;
  private dropped = 0;
  private lastConnectedAt: Date | null = null;
  private lastReceivedAt: Date | null = null;
  private accelerationPublished = 0;
  private postgresqlPublished = 0;
  private pendingPublish: Promise<void> = Promise.resolve();
  private unsubscribeAcceleration: (() => void) | null = null;
  private readonly acceleration?: AccelerationTransport;

  constructor(private readonly logger: CoordinationLogger = {}, options: { nodeId?: string; channel?: string; acceleration?: AccelerationTransport } = {}) {
    this.nodeId = options.nodeId || `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.channel = channelName(options.channel || process.env.CLUSTER_COORDINATION_CHANNEL || "cluster_coordination_v1");
    this.acceleration = options.acceleration;
  }

  subscribe(topic: string, listener: Listener) {
    const key = String(topic || "").trim();
    if (!key) throw new Error("Coordination topic is required.");
    const set = this.listeners.get(key) || new Set<Listener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(key);
    };
  }

  async start() {
    this.stopping = false;
    if (!this.unsubscribeAcceleration && this.acceleration) {
      this.unsubscribeAcceleration = this.acceleration.subscribe("cluster.coordination", async (payload) => {
        await this.onAcceleratedEnvelope(payload);
      });
    }
    await this.connect();
  }

  async publish(topic: string, payload: unknown) {
    const envelope: ClusterCoordinationEnvelope = {
      v: 1,
      nodeId: this.nodeId,
      eventId: randomUUID(),
      topic: String(topic || "").trim(),
      at: Date.now(),
      payload,
    };
    if (this.acceleration?.isDistributed?.()) {
      try {
        if (await this.acceleration.publish("cluster.coordination", envelope)) {
          this.accelerationPublished += 1;
          this.published += 1;
          return true;
        }
      } catch (error) {
        this.logger.warn?.({ error, topic: envelope.topic }, "cluster acceleration coordination publish failed; falling back to PostgreSQL");
      }
    }
    const client = this.client;
    if (!client || !this.connected) {
      this.dropped += 1;
      return false;
    }
    const encoded = JSON.stringify(envelope);
    if (Buffer.byteLength(encoded, "utf8") > 7_500) {
      this.dropped += 1;
      this.logger.warn?.({ topic: envelope.topic, bytes: Buffer.byteLength(encoded, "utf8") }, "cluster coordination payload exceeded PostgreSQL NOTIFY budget");
      return false;
    }
    try {
      // Serialize publishes on the dedicated LISTEN connection. pg@9 rejects
      // concurrent client.query calls; bursts occur during initial job enqueue.
      const operation = this.pendingPublish.catch(() => undefined).then(async () => {
        if (!this.connected || this.client !== client) throw new Error("Cluster coordination connection changed");
        await client.query("SELECT pg_notify($1, $2)", [this.channel, encoded]);
      });
      this.pendingPublish = operation.catch(() => undefined);
      await operation;
      this.published += 1;
      this.postgresqlPublished += 1;
      return true;
    } catch (error) {
      this.dropped += 1;
      this.logger.warn?.({ error, topic: envelope.topic }, "cluster coordination publish failed");
      this.scheduleReconnect();
      return false;
    }
  }

  snapshot(): ClusterCoordinationBusSnapshot {
    return {
      nodeId: this.nodeId,
      channel: this.channel,
      connected: this.connected,
      reconnects: this.reconnects,
      published: this.published,
      received: this.received,
      dropped: this.dropped,
      lastConnectedAt: this.lastConnectedAt?.toISOString() || null,
      lastReceivedAt: this.lastReceivedAt?.toISOString() || null,
      transport: this.acceleration?.isDistributed?.() ? "redis" : "postgresql",
      accelerationPublished: this.accelerationPublished,
      postgresqlPublished: this.postgresqlPublished,
    };
  }

  async close() {
    this.stopping = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
    this.unsubscribeAcceleration?.();
    this.unsubscribeAcceleration = null;
    this.listeners.clear();
  }

  private async connect() {
    if (this.stopping) return;
    const previous = this.client;
    this.client = null;
    this.connected = false;
    if (previous) await previous.end().catch(() => undefined);

    const client = new Client({ connectionString: postgresCoordinationUrl(), keepAlive: true });
    this.client = client;
    client.on("notification", (message) => { void this.onNotification(message.payload || ""); });
    client.on("error", (error) => {
      this.connected = false;
      this.logger.warn?.({ error }, "cluster coordination connection failed");
      this.scheduleReconnect();
    });
    client.on("end", () => {
      this.connected = false;
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${this.channel}`);
      this.connected = true;
      this.reconnectAttempt = 0;
      this.lastConnectedAt = new Date();
      this.logger.info?.({ nodeId: this.nodeId, channel: this.channel }, "cluster coordination bus connected");
    } catch (error) {
      this.connected = false;
      this.logger.warn?.({ error }, "cluster coordination bus startup failed");
      this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnects += 1;
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6)) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async onAcceleratedEnvelope(payload: unknown) {
    const envelope = payload as ClusterCoordinationEnvelope | null;
    if (!envelope || envelope.v !== 1 || envelope.nodeId === this.nodeId || !envelope.topic) return;
    await this.dispatchEnvelope(envelope);
  }

  private async dispatchEnvelope(envelope: ClusterCoordinationEnvelope) {
    this.received += 1;
    this.lastReceivedAt = new Date();
    const listeners = [...(this.listeners.get(envelope.topic) || [])];
    if (!listeners.length) return;
    const outcomes = await Promise.allSettled(listeners.map((listener) => listener(envelope.payload, envelope)));
    for (const outcome of outcomes) if (outcome.status === "rejected") this.logger.warn?.({ error: outcome.reason, topic: envelope.topic }, "cluster coordination subscriber failed");
  }

  private async onNotification(raw: string) {
    let envelope: ClusterCoordinationEnvelope | null = null;
    try { envelope = JSON.parse(raw) as ClusterCoordinationEnvelope; } catch { this.dropped += 1; return; }
    if (!envelope || envelope.v !== 1 || envelope.nodeId === this.nodeId || !envelope.topic) return;
    await this.dispatchEnvelope(envelope);
  }
}
