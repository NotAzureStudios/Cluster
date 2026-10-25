import { useCallback, useEffect, useRef, useState } from "react";
import type { CollaborationTool } from "@cluster/shared";
import { API_URL, api, invalidateAuthenticatedClientState, queryApi } from "../../core/api";
import { sessionControlAction } from "../../core/session-lifecycle";
import { COLLABORATION_HEARTBEAT_MS, COLLABORATION_POLL_INTERVAL_MS, collaborationFallbackDelay, collaborationPresenceDelay, collaborationPresenceIsActive, collaborationReconnectDelay } from "./realtime";
import { collaborationMutationQueue, discardCollaborationMutation, flushCollaborationMutationQueue, retryCollaborationMutation, sendOrQueueCollaborationMutation, subscribeCollaborationMutationQueue, type CollaborationMutation } from "./offlineQueue";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton } from "../../components/ClusterButton";

export type CollaborationEntityRef = { entityType: string; entityId: string; label?: string | null };
export type CollaborationPresence = {
  userId: string; userName: string; avatarUrl?: string | null; clientId?: string | null; tool: CollaborationTool; resourceId: string; projectId?: string | null;
  cursor?: { x: number; y: number } | null; viewport?: { x: number; y: number; zoom?: number | null } | null; activity?: string | null;
  availability?: string | null; availabilityMessage?: string | null; declaredStatus?: string | null; connectionVisibility?: "visible" | "invisible"; presenceDisclosure?: "connection" | "work_state" | "application" | "project" | "detailed"; clockState?: "in" | "break" | "out" | null;
  workContext?: { applicationKey?: string | null; projectId?: string | null; projectName?: string | null; repositoryId?: string | null; repositoryName?: string | null; branch?: string | null; resourceKind?: string | null; resourceId?: string | null; sensitivity?: string | null } | null;
  selection?: CollaborationEntityRef | null; editing?: CollaborationEntityRef | null; updatedAt: number;
};
export type CollaborationAction = { id: string; userId: string; userName: string; tool: CollaborationTool; resourceId: string; projectId?: string | null; entity?: CollaborationEntityRef | null; action: string; detail?: string | null; createdAt: number };
type CollaborationState = { presence: CollaborationPresence[]; actions: CollaborationAction[]; sequence?: number; changeSequence?: number; serverTime?: number };
type LocalCollaborationPresence = Pick<CollaborationPresence, "cursor" | "viewport" | "activity" | "selection" | "editing">;
type CurrentUser = { id: string; displayName?: string | null; username?: string | null; avatarUrl?: string | null };
export type CollaborationConnection = {
  state: "connecting" | "live" | "reconnecting" | "polling" | "offline";
  transport: "stream" | "poll" | "none";
  lastSyncedAt: number | null;
  latencyMs: number | null;
  reconnectAttempts: number;
  pendingMutations: number;
  conflictMutations: number;
  sequenceGaps: number;
  quality: "good" | "degraded" | "offline";
};

export function collaborationColor(userId: string) {
  const palette = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#22c55e", "#eab308", "#ef4444"];
  let hash = 0;
  for (const char of userId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initialConnection(): CollaborationConnection {
  return {
    state: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "connecting",
    transport: "none",
    lastSyncedAt: null,
    latencyMs: null,
    reconnectAttempts: 0,
    pendingMutations: 0,
    conflictMutations: 0,
    sequenceGaps: 0,
    quality: "good"
  };
}

export function useToolCollaboration(tool: CollaborationTool, resourceId?: string | null, projectId?: string | null) {
  const canvasTool = tool === "board" || tool === "whiteboard" ? tool : null;
  const [state, setState] = useState<CollaborationState>({ presence: [], actions: [], sequence: 0, changeSequence: 0 });
  const [connection, setConnection] = useState<CollaborationConnection>(initialConnection);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [queuedMutations, setQueuedMutations] = useState<CollaborationMutation[]>([]);
  const clientIdRef = useRef(`client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const localPresenceRef = useRef<LocalCollaborationPresence>({ cursor: null, viewport: null, activity: "viewing", selection: null, editing: null });
  const lastHeartbeatRef = useRef(0);
  const presenceSendTimerRef = useRef(0);
  const sequenceRef = useRef(0);
  const streamRef = useRef<EventSource | null>(null);
  const pendingStateRef = useRef<{ state: CollaborationState; transport: "stream" | "poll" } | null>(null);
  const applyStateFrameRef = useRef(0);

  useEffect(() => { queryApi<{ user: CurrentUser | null }>("/api/me", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["me", "collaboration"] }).then((result) => setMe(result.user)).catch(() => setMe(null)); }, []);

  useEffect(() => {
    const sync = () => {
      const queue = canvasTool ? collaborationMutationQueue(canvasTool, resourceId) : [];
      setQueuedMutations(queue);
      setConnection((current) => ({
        ...current,
        pendingMutations: queue.filter((item) => ["pending", "replaying"].includes(item.status)).length,
        conflictMutations: queue.filter((item) => item.status === "conflict").length
      }));
    };
    sync();
    const unsubscribe = subscribeCollaborationMutationQueue(sync);
    return unsubscribe;
  }, [canvasTool, resourceId]);

  const applyState = useCallback((next: CollaborationState, transport: "stream" | "poll") => {
    pendingStateRef.current = { state: next, transport };
    if (applyStateFrameRef.current || typeof window === "undefined") return;
    applyStateFrameRef.current = window.requestAnimationFrame(() => {
      applyStateFrameRef.current = 0;
      const pending = pendingStateRef.current;
      pendingStateRef.current = null;
      if (!pending) return;
      const now = Date.now();
      const sequence = Number(pending.state.sequence || 0);
      const previousSequence = sequenceRef.current;
      const sequenceGap = pending.transport === "stream" && previousSequence > 0 && sequence > previousSequence + 1;
      sequenceRef.current = sequence;
      const latency = typeof pending.state.serverTime === "number" ? Math.max(0, now - pending.state.serverTime) : null;
      setState({
        presence: Array.isArray(pending.state.presence) ? pending.state.presence : [],
        actions: Array.isArray(pending.state.actions) ? pending.state.actions : [],
        sequence,
        changeSequence: Number(pending.state.changeSequence || 0),
        serverTime: pending.state.serverTime
      });
      setConnection((current) => ({
        ...current,
        state: pending.transport === "stream" ? "live" : "polling",
        transport: pending.transport,
        lastSyncedAt: now,
        latencyMs: latency ?? current.latencyMs,
        reconnectAttempts: pending.transport === "stream" ? 0 : current.reconnectAttempts,
        sequenceGaps: current.sequenceGaps + (sequenceGap ? 1 : 0),
        quality: sequenceGap || (latency != null && latency > 1500) || pending.transport === "poll" ? "degraded" : "good"
      }));
    });
  }, []);

  const transmitPresence = useCallback(async () => {
    if (!resourceId) return;
    lastHeartbeatRef.current = Date.now();
    try {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await api<{ serverTime?: number }>("/api/collaboration/heartbeat", { method: "POST", body: JSON.stringify({ tool, resourceId, projectId: projectId || null, clientId: clientIdRef.current, ...localPresenceRef.current }) });
      const latencyMs = Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt));
      setConnection((current) => ({ ...current, latencyMs, quality: latencyMs > 1500 ? "degraded" : current.state === "offline" ? "offline" : "good" }));
    } catch {
      if (!navigator.onLine) setConnection((current) => ({ ...current, state: "offline", transport: "none", quality: "offline" }));
    }
  }, [tool, resourceId, projectId]);

  const sendHeartbeat = useCallback(async (force = false) => {
    if (!resourceId) return;
    if (force) {
      if (presenceSendTimerRef.current) window.clearTimeout(presenceSendTimerRef.current);
      presenceSendTimerRef.current = 0;
      await transmitPresence();
      return;
    }
    const delay = collaborationPresenceDelay(lastHeartbeatRef.current);
    if (delay <= 0) {
      await transmitPresence();
      return;
    }
    if (!presenceSendTimerRef.current && typeof window !== "undefined") {
      presenceSendTimerRef.current = window.setTimeout(() => {
        presenceSendTimerRef.current = 0;
        void transmitPresence();
      }, delay);
    }
  }, [resourceId, transmitPresence]);

  const refresh = useCallback(async () => {
    if (!resourceId || document.visibilityState === "hidden") return null;
    const result = await api<CollaborationState>(`/api/collaboration/state?tool=${tool}&resourceId=${encodeURIComponent(resourceId)}`).catch(() => null);
    if (result) applyState(result, "poll");
    return result;
  }, [tool, resourceId, applyState]);

  const updatePresence = useCallback((patch: Partial<LocalCollaborationPresence>, immediate = false) => {
    localPresenceRef.current = { ...localPresenceRef.current, ...patch };
    sendHeartbeat(immediate).catch(() => null);
  }, [sendHeartbeat]);

  useEffect(() => {
    if (!resourceId) {
      streamRef.current?.close();
      streamRef.current = null;
      setState({ presence: [], actions: [], sequence: 0, changeSequence: 0 });
      setConnection(initialConnection());
      return;
    }

    let cancelled = false;
    let reconnectTimer = 0;
    let pollTimer = 0;
    let heartbeatTimer = 0;
    let attempts = 0;
    let pollingWanted = false;
    let pollRequestInFlight = false;
    let nativeSubscriptionId = "";
    let unsubscribeNativeFrames: (() => void) | undefined;
    localPresenceRef.current = { cursor: null, viewport: null, activity: "viewing", selection: null, editing: null };

    const stopPolling = (disable = true) => {
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = 0;
      if (disable) pollingWanted = false;
    };

    const runPoll = async () => {
      if (cancelled || !pollingWanted || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (!pollRequestInFlight) {
        pollRequestInFlight = true;
        try { await refresh(); } catch { /* polling remains a degraded recovery path */ }
        finally { pollRequestInFlight = false; }
      }
      if (cancelled || !pollingWanted || document.visibilityState !== "visible" || !navigator.onLine) return;
      pollTimer = window.setTimeout(() => { pollTimer = 0; void runPoll(); }, COLLABORATION_POLL_INTERVAL_MS);
    };

    const startPolling = () => {
      if (cancelled || !navigator.onLine) return;
      pollingWanted = true;
      if (document.visibilityState !== "visible" || pollTimer || pollRequestInFlight) return;
      setConnection((current) => ({ ...current, state: "polling", transport: "poll", reconnectAttempts: attempts }));
      void runPoll();
    };

    const scheduleReconnect = (delayMs: number) => {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = 0;
      if (cancelled || document.visibilityState !== "visible" || !navigator.onLine) return;
      reconnectTimer = window.setTimeout(() => { reconnectTimer = 0; connect(); }, delayMs);
    };

    const connect = () => {
      if (cancelled) return;
      streamRef.current?.close();
      streamRef.current = null;
      if (nativeSubscriptionId) { void window.clusterDesktop?.unsubscribeCollaboration?.(nativeSubscriptionId); nativeSubscriptionId = ""; }
      unsubscribeNativeFrames?.();
      unsubscribeNativeFrames = undefined;
      if (!navigator.onLine) {
        stopPolling();
        setConnection((current) => ({ ...current, state: "offline", transport: "none", reconnectAttempts: attempts, quality: "offline" }));
        return;
      }
      setConnection((current) => ({ ...current, state: attempts ? "reconnecting" : "connecting", transport: current.transport, reconnectAttempts: attempts }));
      if (canvasTool && window.clusterDesktop?.subscribeCollaboration && window.clusterDesktop?.onCollaborationFrame) {
        unsubscribeNativeFrames = window.clusterDesktop.onCollaborationFrame((frame) => {
          if (cancelled || frame.subscriptionId !== nativeSubscriptionId) return;
          if (frame.event === "desktop-open" || frame.event === "ready") {
            attempts = 0; stopPolling();
            setConnection((current) => ({ ...current, state: "live", transport: "stream", reconnectAttempts: 0 }));
          } else if (frame.event === "state") {
            try { applyState(JSON.parse(frame.data) as CollaborationState, "stream"); } catch { /* ignore malformed native frames */ }
          } else if (frame.event === "ping") {
            try {
              const payload = JSON.parse(frame.data) as { serverTime?: number };
              const now = Date.now();
              setConnection((current) => ({ ...current, state: "live", transport: "stream", lastSyncedAt: now, latencyMs: typeof payload.serverTime === "number" ? Math.max(0, now - payload.serverTime) : current.latencyMs }));
            } catch { /* keep current state */ }
          } else if (frame.event === "session") {
            try {
              const payload = JSON.parse(frame.data) as { state?: string; reason?: string };
              if (sessionControlAction(payload) === "invalidate") void invalidateAuthenticatedClientState(payload.reason || "realtime_session_revoked");
            } catch { /* ignore malformed session frames */ }
          } else if (frame.event === "desktop-error") {
            attempts += 1;
            setConnection((current) => ({ ...current, state: "reconnecting", transport: "stream", reconnectAttempts: attempts }));
          }
        });
        void window.clusterDesktop.subscribeCollaboration({ tool: canvasTool, resourceId, clientId: clientIdRef.current }).then((id) => {
          if (cancelled) { void window.clusterDesktop?.unsubscribeCollaboration?.(id); return; }
          nativeSubscriptionId = id;
        }).catch(() => {
          unsubscribeNativeFrames?.(); unsubscribeNativeFrames = undefined; attempts += 1; startPolling();
          scheduleReconnect(collaborationFallbackDelay(attempts));
        });
        return;
      }
      try {
        const url = new URL(`${API_URL}/api/collaboration/stream`, window.location.origin);
        url.searchParams.set("tool", tool);
        url.searchParams.set("resourceId", resourceId);
        url.searchParams.set("clientId", clientIdRef.current);
        const source = new EventSource(url.toString(), { withCredentials: true });
        streamRef.current = source;
        const markStreamLive = () => { if (!cancelled) { attempts = 0; stopPolling(); setConnection((current) => ({ ...current, state: "live", transport: "stream", reconnectAttempts: 0 })); } };
        source.onopen = markStreamLive;
        source.addEventListener("ready", markStreamLive);
        source.addEventListener("state", (event) => { if (!cancelled) { try { applyState(JSON.parse((event as MessageEvent).data) as CollaborationState, "stream"); } catch { /* malformed */ } } });
        source.addEventListener("ping", (event) => {
          if (cancelled) return;
          try { const payload = JSON.parse((event as MessageEvent).data) as { serverTime?: number }; const now = Date.now(); setConnection((current) => ({ ...current, state: "live", transport: "stream", lastSyncedAt: now, latencyMs: typeof payload.serverTime === "number" ? Math.max(0, now - payload.serverTime) : current.latencyMs })); } catch { /* keep state */ }
        });
        source.addEventListener("session", (event) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { state?: string; reason?: string };
            source.close();
            const action = sessionControlAction(payload);
            if (action === "invalidate") {
              void invalidateAuthenticatedClientState(payload.reason || "realtime_session_revoked");
              return;
            }
            if (action === "reconnect") {
              window.clearTimeout(reconnectTimer);
              scheduleReconnect(100);
            }
          } catch { /* malformed session control frame */ }
        });
        source.onerror = () => {
          if (cancelled) return; source.close(); attempts += 1;
          setConnection((current) => ({ ...current, state: navigator.onLine ? "reconnecting" : "offline", transport: current.transport, reconnectAttempts: attempts }));
          if (attempts >= 3) startPolling();
          scheduleReconnect(collaborationReconnectDelay(attempts));
        };
      } catch { attempts += 1; startPolling(); scheduleReconnect(collaborationFallbackDelay(attempts)); }
    };

    const clearHeartbeat = () => { if (heartbeatTimer) window.clearTimeout(heartbeatTimer); heartbeatTimer = 0; };
    const scheduleHeartbeat = (immediate = false) => {
      clearHeartbeat();
      if (cancelled || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (immediate) sendHeartbeat(true).catch(() => null);
      heartbeatTimer = window.setTimeout(() => { heartbeatTimer = 0; sendHeartbeat(true).catch(() => null); scheduleHeartbeat(false); }, COLLABORATION_HEARTBEAT_MS);
    };
    const visibility = () => {
      updatePresence({ activity: document.hidden ? "away" : "viewing" }, true);
      if (document.hidden) {
        clearHeartbeat();
        window.clearTimeout(reconnectTimer); reconnectTimer = 0;
        if (pollingWanted) stopPolling(false);
        return;
      }
      if (pollingWanted) startPolling();
      refresh().catch(() => null);
      if (!streamRef.current && !nativeSubscriptionId) connect();
      scheduleHeartbeat(true);
      if (canvasTool) flushCollaborationMutationQueue(canvasTool, resourceId).catch(() => null);
    };
    const online = () => { attempts = 0; const flushed = canvasTool ? flushCollaborationMutationQueue(canvasTool, resourceId) : Promise.resolve([]); flushed.then(() => refresh()).catch(() => null); connect(); scheduleHeartbeat(true); };
    const offline = () => {
      streamRef.current?.close();
      streamRef.current = null;
      window.clearTimeout(reconnectTimer); reconnectTimer = 0;
      clearHeartbeat();
      stopPolling();
      setConnection((current) => ({ ...current, state: "offline", transport: "none", quality: "offline" }));
    };

    sendHeartbeat(true).catch(() => null);
    refresh().catch(() => null);
    connect();
    (canvasTool ? flushCollaborationMutationQueue(canvasTool, resourceId) : Promise.resolve([])).then(() => refresh()).catch(() => null);
    scheduleHeartbeat(false);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
      if (applyStateFrameRef.current) window.cancelAnimationFrame(applyStateFrameRef.current);
      if (presenceSendTimerRef.current) window.clearTimeout(presenceSendTimerRef.current);
      presenceSendTimerRef.current = 0;
      applyStateFrameRef.current = 0;
      pendingStateRef.current = null;
      if (nativeSubscriptionId) void window.clusterDesktop?.unsubscribeCollaboration?.(nativeSubscriptionId);
      unsubscribeNativeFrames?.();
      window.clearTimeout(reconnectTimer);
      clearHeartbeat();
      stopPolling();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      api("/api/collaboration/leave", { method: "POST", body: JSON.stringify({ tool, resourceId, clientId: clientIdRef.current }) }).catch(() => null);
    };
  }, [tool, canvasTool, resourceId, projectId, sendHeartbeat, refresh, updatePresence, applyState]);

  const mutate = useCallback(async <T,>(input: {
    path: string;
    method: "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    label: string;
    entityType?: string | null;
    entityId?: string | null;
  }) => {
    if (!resourceId) throw new Error("No collaboration resource selected.");
    if (!canvasTool) throw new Error("Offline collaboration mutations are only available for Board and Whiteboard resources.");
    const result = await sendOrQueueCollaborationMutation<T>({
      tool: canvasTool,
      resourceId,
      path: input.path,
      method: input.method,
      body: input.body,
      label: input.label,
      entityType: input.entityType || null,
      entityId: input.entityId || null
    });
    if (result.queued) {
      setConnection((current) => ({ ...current, state: navigator.onLine ? current.state : "offline", pendingMutations: current.pendingMutations + 1 }));
    }
    return result;
  }, [canvasTool, resourceId]);

  const replayQueued = useCallback(async () => {
    if (!resourceId || !canvasTool) return [];
    const queue = await flushCollaborationMutationQueue(canvasTool, resourceId);
    await refresh();
    return queue;
  }, [canvasTool, resourceId, refresh]);

  const publish = useCallback(async (action: string, detail?: string | null, entity?: CollaborationEntityRef | null, resourceChanged = true) => {
    if (!resourceId) return;
    await api<CollaborationAction>("/api/collaboration/action", { method: "POST", body: JSON.stringify({ tool, resourceId, projectId: projectId || null, entity: entity || null, action, detail: detail || null, resourceChanged }) }).catch(() => null);
    if (connection.transport !== "stream") await refresh();
  }, [tool, resourceId, projectId, refresh, connection.transport]);

  return {
    ...state,
    presence: state.presence.filter((item) => collaborationPresenceIsActive(item.updatedAt)),
    me,
    publish,
    updatePresence,
    refresh,
    connection,
    queuedMutations,
    mutate,
    replayQueued,
    sequence: Number(state.sequence || 0),
    changeSequence: Number(state.changeSequence || 0),
    clientId: clientIdRef.current
  };
}

function connectionLabel(connection?: CollaborationConnection) {
  if (!connection) return "Live";
  if (connection.conflictMutations) return `${connection.conflictMutations} sync conflict${connection.conflictMutations === 1 ? "" : "s"}`;
  if (connection.pendingMutations) return `${connection.pendingMutations} queued change${connection.pendingMutations === 1 ? "" : "s"}`;
  if (connection.state === "live") {
    const latency = connection.latencyMs != null ? ` · ${connection.latencyMs}ms` : "";
    const gaps = connection.sequenceGaps ? ` · ${connection.sequenceGaps} recovered gap${connection.sequenceGaps === 1 ? "" : "s"}` : "";
    return `${connection.quality === "degraded" ? "Live degraded" : "Live"}${latency}${gaps}`;
  }
  if (connection.state === "polling") return "Polling fallback";
  if (connection.state === "reconnecting") return `Reconnecting${connection.reconnectAttempts ? ` · ${connection.reconnectAttempts}` : ""}`;
  if (connection.state === "offline") return "Offline";
  return "Connecting";
}

export function CollaborationStrip({ presence, actions, currentUserId, followedUserId, onFollowUser, connection }: { presence: CollaborationPresence[]; actions: CollaborationAction[]; currentUserId?: string | null; followedUserId?: string | null; onFollowUser?: (presence: CollaborationPresence) => void; connection?: CollaborationConnection }) {
  const active = presence.filter((item) => collaborationPresenceIsActive(item.updatedAt));
  const otherEditors = active.filter((item) => item.userId !== currentUserId && item.editing);
  const contextualPeers = active.filter((item) => item.userId !== currentUserId && (item.declaredStatus || item.availability || item.clockState || item.workContext?.projectName || item.workContext?.branch)).slice(0, 2);
  return <div className="collaboration-strip-v193 collaboration-strip-v196 collaboration-strip-v201">
    <div className="collaboration-presence-v193"><span className="eyebrow">Live</span><div className="collaboration-avatar-row-v193">
      {active.length ? active.slice(0, 10).map((item) => {
        const presenceDetail = [item.declaredStatus || item.availability, item.clockState === "break" ? "on break" : item.clockState === "in" ? "clocked in" : item.clockState === "out" ? "clocked out" : null, item.workContext?.projectName, item.workContext?.branch].filter(Boolean).join(" · ");
        const label = `${item.userName}${item.userId === currentUserId ? " (you)" : ""}${presenceDetail ? ` · ${presenceDetail}` : ""}${item.activity ? ` · ${item.activity}` : ""}${item.editing?.label ? ` · editing ${item.editing.label}` : ""}`;
        const avatar = <>{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.userName.slice(0, 1).toUpperCase()}<i style={runtimeStyle({ background: collaborationColor(item.userId) })} /></>;
        return onFollowUser && item.userId !== currentUserId
          ? <ClusterButton unstyled type="button" className={`collaboration-avatar-v193 ${followedUserId === item.userId ? "following" : ""}`} key={`${item.userId}-${item.clientId || "default"}`} title={`${label}${followedUserId === item.userId ? " · following" : " · click to follow"}`} onClick={() => onFollowUser(item)}>{avatar}</ClusterButton>
          : <span className="collaboration-avatar-v193" key={`${item.userId}-${item.clientId || "default"}`} title={label}>{avatar}</span>;
      }) : <span className="muted">No one else active</span>}
    </div><strong>{active.length} active{otherEditors.length ? ` · ${otherEditors.length} editing` : ""}</strong><span className={`collaboration-transport-v201 ${connection?.state || "live"}`} title={connection?.lastSyncedAt ? `Last sync ${new Date(connection.lastSyncedAt).toLocaleTimeString()}` : "Connecting to collaboration service"}>{connectionLabel(connection)}</span></div>
    <div className="collaboration-actions-v193">
      {otherEditors.slice(0, 2).map((item) => <span key={`edit-${item.userId}-${item.clientId || "default"}`}><b>{item.userName}</b> editing {item.editing?.label || item.editing?.entityType}</span>)}
      {!otherEditors.length && contextualPeers.map((item) => <span key={`presence-${item.userId}-${item.clientId || "default"}`}><b>{item.userName}</b> {item.declaredStatus || item.availability || "active"}{item.clockState === "break" ? " · on break" : item.clockState === "in" ? " · clocked in" : ""}{item.workContext?.projectName ? ` · ${item.workContext.projectName}` : ""}{item.workContext?.branch ? ` · ${item.workContext.branch}` : ""}</span>)}
      {actions.slice(0, Math.max(1, 3 - Math.min(2, otherEditors.length || contextualPeers.length))).map((item) => <span key={item.id}><b>{item.userName}</b> {item.action}{item.detail ? ` · ${item.detail}` : ""}</span>)}
    </div>
  </div>;
}


export function ProjectCollaborationStrip({ tool, projectId, activity, editing = null }: {
  tool: Exclude<CollaborationTool, "board" | "whiteboard">;
  projectId: string;
  activity: string;
  editing?: CollaborationEntityRef | null;
}) {
  const collaboration = useToolCollaboration(tool, projectId, projectId);
  useEffect(() => {
    collaboration.updatePresence({ activity, editing }, true);
  }, [activity, editing?.entityType, editing?.entityId, editing?.label, collaboration.updatePresence]);
  return <CollaborationStrip
    presence={collaboration.presence}
    actions={collaboration.actions}
    currentUserId={collaboration.me?.id || null}
    connection={collaboration.connection}
  />;
}


export function CollaborationQueuePanel({ mutations, onReplay }: { mutations: CollaborationMutation[]; onReplay: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  if (!mutations.length) return null;
  const pending = mutations.filter((item) => ["pending", "replaying"].includes(item.status));
  const conflicts = mutations.filter((item) => item.status === "conflict");
  const failed = mutations.filter((item) => item.status === "failed");
  async function replay() {
    setBusy(true);
    try { await onReplay(); } finally { setBusy(false); }
  }
  return <details className="collaboration-queue-v206" open={conflicts.length > 0}>
    <summary><strong>Sync queue</strong><span>{pending.length} pending · {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}{failed.length ? ` · ${failed.length} failed` : ""}</span></summary>
    <div className="collaboration-queue-actions-v206"><ClusterButton type="button" className="" onClick={replay} disabled={busy || !pending.length} variant="quiet" size="compact">{busy ? "Replaying…" : "Replay pending"}</ClusterButton></div>
    <div className="collaboration-queue-list-v206">{mutations.slice().reverse().map((item) => <article key={item.id} className={item.status}>
      <div><strong>{item.label}</strong><span>{item.status} · {new Date(item.updatedAt).toLocaleString()}</span>{item.lastError && <em>{item.lastError}</em>}</div>
      <div className="button-row compact">{["conflict", "failed"].includes(item.status) && <ClusterButton type="button" className="" onClick={() => retryCollaborationMutation(item.id)} variant="quiet" size="compact">{item.status === "conflict" ? "Apply local" : "Retry"}</ClusterButton>}<ClusterButton type="button" className="" onClick={() => discardCollaborationMutation(item.id)} variant="quiet" size="compact">Discard</ClusterButton></div>
    </article>)}</div>
  </details>;
}
