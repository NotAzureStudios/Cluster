import type { FastifyReply } from "fastify";

export type CollaborationTool = "project" | "board" | "whiteboard" | "build" | "qa" | "timeline" | "calendar" | "scheduler" | "library" | "release" | "control";

/** Rooms directly tied to a Studio tool kill switch. Other room types are
 * shared by multiple domains and must not be disconnected by one switch. */
export const COLLABORATION_TOOL_OWNERS = {
  timeline: "timeline",
  calendar: "calendar",
  scheduler: "scheduler",
  library: "library",
} as const satisfies Partial<Record<CollaborationTool, string>>;

export function collaborationRoomOwner(tool: CollaborationTool): string | null {
  return (COLLABORATION_TOOL_OWNERS as Partial<Record<CollaborationTool, string>>)[tool] ?? null;
}

export type CollaborationEntityRef = {
  entityType: string;
  entityId: string;
  label?: string | null;
};

export type CollaborationPresence = {
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  clientId?: string | null;
  tool: CollaborationTool;
  resourceId: string;
  projectId?: string | null;
  cursor?: { x: number; y: number } | null;
  viewport?: { x: number; y: number; zoom?: number | null } | null;
  activity?: string | null;
  availability?: string | null;
  availabilityMessage?: string | null;
  declaredStatus?: string | null;
  connectionVisibility?: "visible" | "invisible";
  presenceDisclosure?: "connection" | "work_state" | "application" | "project" | "detailed";
  clockState?: "in" | "break" | "out" | null;
  workContext?: {
    applicationKey?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    repositoryId?: string | null;
    repositoryName?: string | null;
    branch?: string | null;
    resourceKind?: string | null;
    resourceId?: string | null;
    source?: string | null;
    sensitivity?: string | null;
    expiresAt?: Date | string | null;
  } | null;
  selection?: CollaborationEntityRef | null;
  editing?: CollaborationEntityRef | null;
  updatedAt: number;
};

export type CollaborationAction = {
  id: string;
  userId: string;
  userName: string;
  tool: CollaborationTool;
  resourceId: string;
  projectId?: string | null;
  entity?: CollaborationEntityRef | null;
  action: string;
  detail?: string | null;
  createdAt: number;
};

export type CollaborationStreamClient = {
  id: string;
  userId: string;
  sessionId: string;
  clientId: string;
  raw: FastifyReply["raw"];
  connectedAt: number;
  lastSentAt: number;
};

export type CollaborationRecipient = Pick<CollaborationStreamClient, "userId" | "sessionId" | "clientId">;

export type CollaborationAccessController = {
  authorize: (recipient: CollaborationRecipient, tool: CollaborationTool, resourceId: string) => Promise<boolean>;
  sanitizeState?: (recipient: CollaborationRecipient, tool: CollaborationTool, resourceId: string, state: any) => Promise<any>;
};

export type CollaborationRuntimeOptions = {
  publisher?: (topic: string, payload: unknown) => void;
  staleMs?: number;
  accessCacheMs?: number;
  broadcastDelayMs?: number;
  keepaliveMs?: number;
  retainedActions?: number;
  stateActionLimit?: number;
};

export class CollaborationRuntime {
  readonly staleMs: number;
  readonly accessCacheMs: number;
  private readonly broadcastDelayMs: number;
  private readonly keepaliveMs: number;
  private readonly retainedActionLimit: number;
  private readonly stateActionLimit: number;
  private readonly presence = new Map<string, CollaborationPresence>();
  private readonly presenceByRoom = new Map<string, Set<string>>();
  private readonly actions: CollaborationAction[] = [];
  private readonly actionsByRoom = new Map<string, CollaborationAction[]>();
  private readonly streams = new Map<string, Map<string, CollaborationStreamClient>>();
  private readonly roomSequence = new Map<string, number>();
  private readonly changeSequence = new Map<string, number>();
  private readonly broadcastTimers = new Map<string, NodeJS.Timeout>();
  private readonly accessCache = new Map<string, { allowed: boolean; expiresAt: number }>();
  private streamOpenCount = 0;
  private broadcastCount = 0;
  private failedWriteCount = 0;
  private heartbeatCount = 0;
  private reauthorizationDeniedCount = 0;
  private externalEventCount = 0;
  private backpressureSkips = 0;
  private slowClientDisconnects = 0;
  private maxObservedBufferedBytes = 0;
  private readonly publisher?: (topic: string, payload: unknown) => void;
  private accessController: CollaborationAccessController | null = null;

  constructor(options: CollaborationRuntimeOptions = {}) {
    this.staleMs = options.staleMs ?? 20_000;
    this.accessCacheMs = options.accessCacheMs ?? 5_000;
    this.broadcastDelayMs = options.broadcastDelayMs ?? 80;
    this.keepaliveMs = options.keepaliveMs ?? 12_000;
    this.retainedActionLimit = options.retainedActions ?? 250;
    this.stateActionLimit = options.stateActionLimit ?? 30;
    this.publisher = options.publisher;
  }

  setAccessController(controller: CollaborationAccessController | null) {
    this.accessController = controller;
    this.accessCache.clear();
  }

  roomKey(tool: CollaborationTool, resourceId: string) {
    return `${tool}:${resourceId}`;
  }

  presenceKey(tool: CollaborationTool, resourceId: string, userId: string, clientId = "default") {
    return `${tool}:${resourceId}:${userId}:${clientId}`;
  }

  stateFor(tool: CollaborationTool, resourceId: string) {
    const room = this.roomKey(tool, resourceId);
    return {
      presence: [...(this.presenceByRoom.get(room) || [])]
        .map((key) => this.presence.get(key))
        .filter((item): item is CollaborationPresence => Boolean(item))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      actions: [...(this.actionsByRoom.get(room) || [])],
      sequence: this.roomSequence.get(room) || 0,
      changeSequence: this.changeSequence.get(room) || 0,
      transportVersion: 2,
      fullStateFrame: true,
      serverTime: Date.now()
    };
  }

  sendEvent(client: CollaborationStreamClient, event: string, payload: unknown) {
    if (client.raw.destroyed || client.raw.writableEnded) return false;
    const raw = client.raw as typeof client.raw & { writableLength?: number; writableNeedDrain?: boolean };
    const maxBufferedBytes = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number(process.env.CLUSTER_SSE_MAX_BUFFER_BYTES || 512 * 1024)));
    const buffered = Number(raw.writableLength || 0);
    this.maxObservedBufferedBytes = Math.max(this.maxObservedBufferedBytes, buffered);
    if (buffered > maxBufferedBytes) {
      this.slowClientDisconnects += 1;
      if (!raw.writableEnded) raw.end();
      return false;
    }
    if (raw.writableNeedDrain && (event === "state" || event === "ping")) {
      // State frames are complete snapshots, so skipping an intermediate frame is safe.
      // The next room broadcast/heartbeat will carry current state once the socket drains.
      this.backpressureSkips += 1;
      return true;
    }
    try {
      const writable = raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      this.maxObservedBufferedBytes = Math.max(this.maxObservedBufferedBytes, Number(raw.writableLength || 0));
      client.lastSentAt = Date.now();
      if (!writable && Number(raw.writableLength || 0) > maxBufferedBytes) {
        this.slowClientDisconnects += 1;
        if (!raw.writableEnded) raw.end();
        return false;
      }
      return true;
    } catch {
      this.failedWriteCount += 1;
      return false;
    }
  }

  async stateForRecipient(recipient: CollaborationRecipient, tool: CollaborationTool, resourceId: string) {
    const state = this.stateFor(tool, resourceId);
    if (!this.accessController?.sanitizeState) return state;
    return this.accessController.sanitizeState(recipient, tool, resourceId, state);
  }

  private async recipientAuthorized(recipient: CollaborationRecipient, tool: CollaborationTool, resourceId: string) {
    if (!this.accessController) return true;
    try {
      return await this.accessController.authorize(recipient, tool, resourceId);
    } catch {
      return false;
    }
  }

  private revokeClient(room: string, id: string, client: CollaborationStreamClient, reason = "access_revoked") {
    const split = room.indexOf(":");
    const tool = room.slice(0, split) as CollaborationTool;
    const resourceId = room.slice(split + 1);
    this.sendEvent(client, "access", { state: "revoked", reason });
    if (!client.raw.destroyed && !client.raw.writableEnded) client.raw.end();
    this.streams.get(room)?.delete(id);
    this.removePresence(tool, resourceId, client.userId, client.clientId);
    this.reauthorizationDeniedCount += 1;
    return { tool, resourceId };
  }

  private async broadcastRoom(tool: CollaborationTool, resourceId: string) {
    const room = this.roomKey(tool, resourceId);
    this.roomSequence.set(room, (this.roomSequence.get(room) || 0) + 1);
    this.broadcastCount += 1;
    const clients = this.streams.get(room);
    if (!clients?.size) return;
    let revoked = false;
    for (const [id, client] of [...clients.entries()]) {
      if (!(await this.recipientAuthorized(client, tool, resourceId))) {
        this.revokeClient(room, id, client);
        revoked = true;
        continue;
      }
      let payload: any;
      try {
        payload = await this.stateForRecipient(client, tool, resourceId);
      } catch {
        this.revokeClient(room, id, client, "authorization_failed");
        revoked = true;
        continue;
      }
      if (!this.sendEvent(client, "state", payload)) clients.delete(id);
    }
    if (!clients.size) this.streams.delete(room);
    if (revoked && clients.size) this.scheduleBroadcast(tool, resourceId);
  }

  scheduleBroadcast(tool: CollaborationTool, resourceId: string, changed = false, publish = true) {
    const room = this.roomKey(tool, resourceId);
    if (changed) {
      this.changeSequence.set(room, (this.changeSequence.get(room) || 0) + 1);
      if (publish) this.publisher?.("collaboration.room.changed", { tool, resourceId });
    }
    if (this.broadcastTimers.has(room)) return;
    const timer = setTimeout(() => {
      this.broadcastTimers.delete(room);
      void this.broadcastRoom(tool, resourceId);
    }, this.broadcastDelayMs);
    timer.unref?.();
    this.broadcastTimers.set(room, timer);
  }

  upsertPresence(presence: CollaborationPresence, publish = true) {
    this.heartbeatCount += 1;
    const key = this.presenceKey(presence.tool, presence.resourceId, presence.userId, presence.clientId || "default");
    this.presence.set(key, presence);
    const room = this.roomKey(presence.tool, presence.resourceId);
    const roomPresence = this.presenceByRoom.get(room) || new Set<string>();
    roomPresence.add(key);
    this.presenceByRoom.set(room, roomPresence);
    if (publish) this.publisher?.("collaboration.presence.upsert", presence);
  }

  removePresence(tool: CollaborationTool, resourceId: string, userId: string, clientId = "default", publish = true) {
    const key = this.presenceKey(tool, resourceId, userId, clientId);
    const removed = this.presence.delete(key);
    if (removed) {
      const room = this.roomKey(tool, resourceId);
      const roomPresence = this.presenceByRoom.get(room);
      roomPresence?.delete(key);
      if (roomPresence && !roomPresence.size) this.presenceByRoom.delete(room);
    }
    if (removed && publish) this.publisher?.("collaboration.presence.remove", { tool, resourceId, userId, clientId });
    return removed;
  }

  addStream(tool: CollaborationTool, resourceId: string, client: CollaborationStreamClient) {
    this.streamOpenCount += 1;
    const room = this.roomKey(tool, resourceId);
    const clients = this.streams.get(room) || new Map<string, CollaborationStreamClient>();
    clients.set(client.id, client);
    this.streams.set(room, clients);
  }

  removeStream(tool: CollaborationTool, resourceId: string, streamId: string) {
    const room = this.roomKey(tool, resourceId);
    const clients = this.streams.get(room);
    clients?.delete(streamId);
    if (clients && !clients.size) this.streams.delete(room);
  }

  /** Close only the streams owned by a disabled Studio tool. Project, Board,
   * Release and other shared rooms are deliberately unaffected. Closing an
   * SSE connection is not a substitute for request-time authorization. */
  disconnectTool(tool: CollaborationTool, reason = "tool_disabled") {
    let disconnected = 0;
    for (const [room, clients] of [...this.streams.entries()]) {
      if (!room.startsWith(`${tool}:`)) continue;
      const resourceId = room.slice(tool.length + 1);
      for (const [id, client] of [...clients.entries()]) {
        this.sendEvent(client, "access", { state: "revoked", reason });
        if (!client.raw.destroyed && !client.raw.writableEnded) client.raw.end();
        clients.delete(id);
        this.removePresence(tool, resourceId, client.userId, client.clientId);
        disconnected += 1;
      }
      this.streams.delete(room);
      const timer = this.broadcastTimers.get(room);
      if (timer) clearTimeout(timer);
      this.broadcastTimers.delete(room);
    }
    // Presence can also originate from heartbeat-only clients, not an SSE
    // connection. Clear it so disabled tools do not remain visibly occupied.
    for (const [room, keys] of [...this.presenceByRoom.entries()]) {
      if (!room.startsWith(`${tool}:`)) continue;
      for (const key of [...keys]) {
        const presence = this.presence.get(key);
        if (presence) this.removePresence(tool, presence.resourceId, presence.userId, presence.clientId || "default");
      }
    }
    // Discard stale authorization decisions for this tool on re-enable.
    this.accessCache.clear();
    return disconnected;
  }

  disconnectSession(sessionId: string, reason = "session_revoked", publish = true) {
    const changedRooms = new Set<string>();
    let disconnected = 0;
    for (const [room, clients] of this.streams.entries()) {
      for (const [id, client] of clients.entries()) {
        if (client.sessionId !== sessionId) continue;
        const state = ["reauthenticated", "discord_identity_changed"].includes(reason) ? "rotated" : "revoked";
        this.sendEvent(client, "session", { state, reason });
        if (!client.raw.destroyed && !client.raw.writableEnded) client.raw.end();
        clients.delete(id);
        const split = room.indexOf(":");
        const tool = room.slice(0, split) as CollaborationTool;
        const resourceId = room.slice(split + 1);
        this.removePresence(tool, resourceId, client.userId, client.clientId);
        changedRooms.add(room);
        disconnected += 1;
      }
      if (!clients.size) this.streams.delete(room);
    }
    for (const room of changedRooms) {
      const split = room.indexOf(":");
      this.scheduleBroadcast(room.slice(0, split) as CollaborationTool, room.slice(split + 1));
    }
    if (publish) this.publisher?.("collaboration.session.disconnect", { sessionId, reason });
    return disconnected;
  }

  disconnectUser(userId: string, reason = "sessions_revoked", exceptSessionId?: string | null, publish = true) {
    const sessionIds = new Set<string>();
    for (const clients of this.streams.values()) {
      for (const client of clients.values()) {
        if (client.userId === userId && (!exceptSessionId || client.sessionId !== exceptSessionId)) sessionIds.add(client.sessionId);
      }
    }
    let disconnected = 0;
    for (const sessionId of sessionIds) disconnected += this.disconnectSession(sessionId, reason, false);
    if (publish) this.publisher?.("collaboration.user.disconnect", { userId, reason, exceptSessionId: exceptSessionId || null });
    return disconnected;
  }

  recordAction(action: CollaborationAction, publish = true) {
    this.actions.unshift(action);
    const room = this.roomKey(action.tool, action.resourceId);
    const roomActions = this.actionsByRoom.get(room) || [];
    roomActions.unshift(action);
    if (roomActions.length > this.stateActionLimit) roomActions.length = this.stateActionLimit;
    this.actionsByRoom.set(room, roomActions);
    this.trimActions();
    if (publish) this.publisher?.("collaboration.action.record", action);
  }

  applyExternalEvent(topic: string, payload: any) {
    this.externalEventCount += 1;
    if (topic === "collaboration.presence.upsert" && payload) { this.upsertPresence(payload as CollaborationPresence, false); this.scheduleBroadcast(payload.tool, payload.resourceId); return; }
    if (topic === "collaboration.presence.remove" && payload) { this.removePresence(payload.tool, payload.resourceId, payload.userId, payload.clientId || "default", false); this.scheduleBroadcast(payload.tool, payload.resourceId); return; }
    if (topic === "collaboration.action.record" && payload) { this.recordAction(payload as CollaborationAction, false); this.scheduleBroadcast(payload.tool, payload.resourceId, true, false); return; }
    if (topic === "collaboration.session.disconnect" && payload?.sessionId) { this.disconnectSession(String(payload.sessionId), String(payload.reason || "session_revoked"), false); return; }
    if (topic === "collaboration.user.disconnect" && payload?.userId) { this.disconnectUser(String(payload.userId), String(payload.reason || "sessions_revoked"), payload.exceptSessionId ? String(payload.exceptSessionId) : null, false); return; }
    if (topic === "collaboration.room.changed" && payload?.tool && payload?.resourceId) this.scheduleBroadcast(payload.tool, payload.resourceId, true, false);
  }

  private trimActions() {
    while (this.actions.length > this.retainedActionLimit) {
      const removed = this.actions.pop();
      if (!removed) break;
      const room = this.roomKey(removed.tool, removed.resourceId);
      const roomActions = this.actionsByRoom.get(room);
      if (!roomActions) continue;
      const retained = roomActions.filter((action) => action.id !== removed.id);
      if (retained.length) this.actionsByRoom.set(room, retained);
      else this.actionsByRoom.delete(room);
    }
  }

  getCachedAccess(key: string) {
    const cached = this.accessCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (cached) this.accessCache.delete(key);
      return null;
    }
    return cached.allowed;
  }

  setCachedAccess(key: string, allowed: boolean) {
    this.accessCache.set(key, { allowed, expiresAt: Date.now() + this.accessCacheMs });
  }

  trim(now = Date.now()) {
    const changedRooms = new Set<string>();
    for (const [key, presence] of this.presence.entries()) {
      if (now - presence.updatedAt > this.staleMs) {
        this.presence.delete(key);
        const room = this.roomKey(presence.tool, presence.resourceId);
        const roomPresence = this.presenceByRoom.get(room);
        roomPresence?.delete(key);
        if (roomPresence && !roomPresence.size) this.presenceByRoom.delete(room);
        changedRooms.add(room);
      }
    }
    this.trimActions();
    for (const [key, cached] of this.accessCache.entries()) {
      if (cached.expiresAt <= now) this.accessCache.delete(key);
    }
    for (const room of changedRooms) {
      const split = room.indexOf(":");
      this.scheduleBroadcast(room.slice(0, split) as CollaborationTool, room.slice(split + 1));
    }
  }

  async runMaintenance(now = Date.now()) {
    this.trim(now);
    const changedRooms = new Set<string>();
    for (const [room, clients] of [...this.streams.entries()]) {
      const split = room.indexOf(":");
      const tool = room.slice(0, split) as CollaborationTool;
      const resourceId = room.slice(split + 1);
      for (const [id, client] of [...clients.entries()]) {
        if (client.raw.destroyed || client.raw.writableEnded) { clients.delete(id); continue; }
        if (!(await this.recipientAuthorized(client, tool, resourceId))) {
          this.revokeClient(room, id, client);
          changedRooms.add(room);
          continue;
        }
        if (now - client.lastSentAt > this.keepaliveMs) this.sendEvent(client, "ping", { serverTime: now });
      }
      if (!clients.size) this.streams.delete(room);
    }
    for (const room of changedRooms) {
      const split = room.indexOf(":");
      this.scheduleBroadcast(room.slice(0, split) as CollaborationTool, room.slice(split + 1));
    }
  }

  diagnostics() {
    return {
      transport: "sse",
      transportVersion: 2,
      fullStateFrames: true,
      activeRooms: this.streams.size,
      streamConnections: [...this.streams.values()].reduce((total, room) => total + room.size, 0),
      presenceSessions: this.presence.size,
      indexedPresenceRooms: this.presenceByRoom.size,
      retainedActions: this.actions.length,
      indexedActionRooms: this.actionsByRoom.size,
      staleAfterMs: this.staleMs,
      accessCacheEntries: this.accessCache.size,
      pendingBroadcasts: this.broadcastTimers.size,
      streamOpenCount: this.streamOpenCount,
      broadcastCount: this.broadcastCount,
      failedWriteCount: this.failedWriteCount,
      heartbeatCount: this.heartbeatCount,
      reauthorizationDeniedCount: this.reauthorizationDeniedCount,
      externalEventCount: this.externalEventCount,
      backpressureSkips: this.backpressureSkips,
      slowClientDisconnects: this.slowClientDisconnects,
      maxObservedBufferedBytes: this.maxObservedBufferedBytes,
      recipientAuthorization: Boolean(this.accessController),
      revisionProtectedEntities: ["board", "column", "card", "whiteboard"],
      presenceRooms: ["project", "board", "whiteboard", "build", "qa", "timeline", "calendar", "scheduler", "library", "release", "control"],
      deploymentMode: this.publisher ? "multi-node-coordinated" : "single-process-fallback"
    };
  }

  close() {
    for (const timer of this.broadcastTimers.values()) clearTimeout(timer);
    this.broadcastTimers.clear();
    for (const clients of this.streams.values()) {
      for (const client of clients.values()) {
        if (!client.raw.destroyed && !client.raw.writableEnded) client.raw.end();
      }
    }
    this.streams.clear();
    this.presence.clear();
    this.presenceByRoom.clear();
    this.actions.length = 0;
    this.actionsByRoom.clear();
    this.accessCache.clear();
    this.roomSequence.clear();
    this.changeSequence.clear();
  }
}
