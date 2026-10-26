import { useEffect, useRef } from "react";
import type { ViewerAssetSession } from "./viewer-contracts";
import type { TimedMediaController, TimedMediaSnapshot } from "./timed-media-controller";

type WakeLockSentinelLike = { released?: boolean; release: () => Promise<void>; addEventListener?: (type: string, listener: () => void) => void };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

function canUseMediaSession() {
  return typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession;
}

function setMediaSessionAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  const session = canUseMediaSession();
  if (!session) return;
  try { session.setActionHandler(action, handler); } catch { /* unsupported action in this runtime */ }
}

export function useTimedMediaSystemIntegration(input: {
  controller: TimedMediaController;
  snapshot: TimedMediaSnapshot;
  session: ViewerAssetSession | null;
  enabled?: boolean;
}) {
  const { controller, snapshot, session, enabled = true } = input;
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const playingRef = useRef(false);
  playingRef.current = enabled && snapshot.phase === "playing";

  useEffect(() => {
    const mediaSession = canUseMediaSession();
    if (!enabled || !mediaSession || !session) return;
    const source = session.resource.source;
    try {
      mediaSession.metadata = new MediaMetadata({
        title: source.title || source.originalName || "Cluster media",
        artist: "Cluster review",
        album: source.originalName || undefined,
      });
    } catch { /* metadata is advisory; playback must not depend on it */ }
    return () => {
      try { if (mediaSession.metadata?.title === (source.title || source.originalName || "Cluster media")) mediaSession.metadata = null; } catch { /* noop */ }
    };
  }, [enabled, session?.resource.source.id, session?.resource.source.title, session?.resource.source.originalName]);

  useEffect(() => {
    const mediaSession = canUseMediaSession();
    if (!enabled || !mediaSession) return;
    setMediaSessionAction("play", () => { void controller.play(); });
    setMediaSessionAction("pause", () => controller.pause());
    setMediaSessionAction("stop", () => controller.stop());
    setMediaSessionAction("seekbackward", (details) => controller.jump(-Math.max(1, Number(details.seekOffset || 10))));
    setMediaSessionAction("seekforward", (details) => controller.jump(Math.max(1, Number(details.seekOffset || 10))));
    setMediaSessionAction("seekto", (details) => {
      if (Number.isFinite(details.seekTime)) controller.seek(Number(details.seekTime), { exactFollowers: true });
    });
    return () => {
      for (const action of ["play", "pause", "stop", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]) setMediaSessionAction(action, null);
    };
  }, [controller, enabled]);

  useEffect(() => {
    const mediaSession = canUseMediaSession();
    if (!enabled || !mediaSession) return;
    try { mediaSession.playbackState = snapshot.phase === "playing" ? "playing" : snapshot.phase === "paused" || snapshot.phase === "ended" ? "paused" : "none"; } catch { /* advisory */ }
    if (snapshot.duration > 0 && Number.isFinite(snapshot.duration) && snapshot.currentTime >= 0 && snapshot.currentTime <= snapshot.duration) {
      try { mediaSession.setPositionState({ duration: snapshot.duration, playbackRate: snapshot.playbackRate || 1, position: Math.min(snapshot.currentTime, snapshot.duration) }); } catch { /* runtime may reject transient media state */ }
    }
  }, [enabled, snapshot.phase, snapshot.currentTime, snapshot.duration, snapshot.playbackRate]);

  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? navigator as WakeLockNavigator : null;
    let cancelled = false;
    const release = async () => {
      const current = wakeLockRef.current;
      wakeLockRef.current = null;
      if (current && !current.released) await current.release().catch(() => undefined);
    };
    const acquire = async () => {
      if (!enabled || !playingRef.current || typeof document === "undefined" || document.visibilityState !== "visible" || !nav?.wakeLock?.request || wakeLockRef.current) return;
      try {
        const sentinel = await nav.wakeLock.request("screen");
        if (cancelled || !playingRef.current) { await sentinel.release().catch(() => undefined); return; }
        wakeLockRef.current = sentinel;
        sentinel.addEventListener?.("release", () => { if (wakeLockRef.current === sentinel) wakeLockRef.current = null; });
      } catch { /* wake lock is optional and may be denied by OS/browser policy */ }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible" && playingRef.current) void acquire();
      else void release();
    };
    if (snapshot.phase === "playing") void acquire(); else void release();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancelled = true;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityChanged);
      void release();
    };
  }, [enabled, snapshot.phase]);
}
