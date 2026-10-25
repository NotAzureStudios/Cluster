import { useEffect } from "react";
import { clusterResourceChangeSchema } from "@cluster/shared";
import { API_URL, invalidateApiQueries } from "../../core/api";
import { refreshOfflineSyncState } from "../../core/offline-runtime-shell";
import { applyResourceChangeInvalidation, emitResourceChangeFeedReset } from "../../core/resource-change-client";
import { reconnectBackoffDelay } from "../../core/reconnect-backoff";

export function useResourceChangeInvalidation(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let reconnectTimer = 0;
    let reconcileTimer = 0;
    let reconnectAttempts = 0;
    let stopped = false;
    const cursorKey = `cluster-resource-change-cursor:${userId}`;
    let cursor = window.localStorage.getItem(cursorKey) || "";
    const identityKey = `cluster-resource-change-cursor-identity:${userId}`;
    let cursorIdentity = window.localStorage.getItem(identityKey) || "";

    const rememberCursor = (value: unknown, identity?: unknown) => {
      const next = String(value || "").trim();
      if (!/^[0-9]+$/.test(next)) return;
      // A sequence number is not a stable cursor through database restore.
      // Persist the immutable outbox identity with it, never independently.
      const proof = typeof identity === "string" && identity.length <= 200 && identity.trim() ? identity.trim() : "";
      cursor = next;
      cursorIdentity = proof;
      window.localStorage.setItem(cursorKey, next);
      if (proof) window.localStorage.setItem(identityKey, proof);
      else window.localStorage.removeItem?.(identityKey);
    };
    const scheduleReconciliation = (delay = 220) => {
      if (stopped) return;
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = 0;
        if (navigator.onLine && document.visibilityState === "visible") void refreshOfflineSyncState({ pull: true });
      }, delay);
    };
    const disconnect = () => {
      if (source) source.close();
      source = null;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    };
    const canConnect = () => !stopped && navigator.onLine && document.visibilityState === "visible";
    const scheduleReconnect = () => {
      if (!canConnect() || reconnectTimer) return;
      reconnectAttempts += 1;
      const delay = reconnectBackoffDelay(reconnectAttempts, { baseMs: 2_000, maxMs: 60_000 });
      reconnectTimer = window.setTimeout(() => { reconnectTimer = 0; connect(); }, delay);
    };
    const connect = () => {
      if (!canConnect() || source) return;
      try {
        const url = new URL(`${API_URL}/api/changes/stream`, window.location.origin);
        if (cursor) url.searchParams.set("after", cursor);
        if (cursor && cursorIdentity) url.searchParams.set("afterIdentity", cursorIdentity);
        const next = new EventSource(url.toString(), { withCredentials: true });
        source = next;
        next.addEventListener("ready", (event) => {
          reconnectAttempts = 0;
          try { const payload = JSON.parse((event as MessageEvent).data); rememberCursor(payload?.cursor, payload?.cursorIdentity); } catch { /* malformed ready frame */ }
          // A reconnect can bridge a period where the current workspace kept rendering
          // stale component state even though its query cache was invalidated. Run one
          // coalesced delta reconciliation after the stream is live again.
          scheduleReconciliation(120);
        });
        next.addEventListener("ping", (event) => {
          try { const payload = JSON.parse((event as MessageEvent).data); rememberCursor(payload?.cursor, payload?.cursorIdentity); } catch { /* malformed ping frame */ }
        });
        next.addEventListener("change", (event) => {
          try {
            const decoded = clusterResourceChangeSchema.safeParse(JSON.parse((event as MessageEvent).data));
            if (!decoded.success) {
              // Never advance the durable cursor for an unknown/invalid wire
              // contract. A full authorized refetch is safer than silently
              // missing updates while the connection still looks healthy.
              invalidateApiQueries();
              emitResourceChangeFeedReset({ reason: "invalid_change_envelope" });
              scheduleReconciliation(50);
              return;
            }
            rememberCursor(decoded.data.sequence, decoded.data.cursorIdentity);
            applyResourceChangeInvalidation(decoded.data);
            scheduleReconciliation();
          } catch {
            invalidateApiQueries();
            emitResourceChangeFeedReset({ reason: "malformed_change_frame" });
            scheduleReconciliation(50);
          }
        });
        next.addEventListener("reset", (event) => {
          let reason = "server_reset";
          let resetCursor: string | undefined;
          try {
            const payload = JSON.parse((event as MessageEvent).data);
            rememberCursor(payload?.cursor, payload?.cursorIdentity);
            resetCursor = typeof payload?.cursor === "string" ? payload.cursor : undefined;
            if (typeof payload?.reason === "string") reason = payload.reason;
          } catch { /* malformed reset frame still requires reconciliation */ }
          invalidateApiQueries();
          // Mounted workspace state also needs a refresh. Clearing the query
          // cache alone does not refresh already-rendered local projections.
          emitResourceChangeFeedReset({ reason, cursor: resetCursor });
          scheduleReconciliation(50);
        });
        next.onerror = () => {
          if (source === next) source = null;
          next.close();
          scheduleReconnect();
        };
      } catch { scheduleReconnect(); }
    };
    const onEnvironmentChange = () => {
      if (canConnect()) {
        reconnectAttempts = 0;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = 0;
        connect();
      } else disconnect();
    };
    window.addEventListener("online", onEnvironmentChange);
    window.addEventListener("offline", onEnvironmentChange);
    document.addEventListener("visibilitychange", onEnvironmentChange);
    connect();
    return () => {
      stopped = true;
      disconnect();
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      reconnectTimer = 0;
      reconcileTimer = 0;
      window.removeEventListener("online", onEnvironmentChange);
      window.removeEventListener("offline", onEnvironmentChange);
      document.removeEventListener("visibilitychange", onEnvironmentChange);
    };
  }, [userId]);
}
