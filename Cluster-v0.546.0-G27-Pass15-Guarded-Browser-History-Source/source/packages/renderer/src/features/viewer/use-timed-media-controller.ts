import { useEffect, useMemo, useState } from "react";
import { TimedMediaController, type TimedMediaSnapshot } from "./timed-media-controller";

const MEDIA_UI_SNAPSHOT_INTERVAL_MS = 33;

export function useTimedMediaController(identity: string) {
  const controller = useMemo(() => new TimedMediaController(), [identity]);
  const [snapshot, setSnapshot] = useState<TimedMediaSnapshot>(() => controller.getSnapshot());
  useEffect(() => {
    let active = true;
    let timer = 0;
    let lastCommitAt = 0;
    let lastCommitted = controller.getSnapshot();
    let pending = lastCommitted;

    const clearTimer = () => { if (timer) window.clearTimeout(timer); timer = 0; };
    const commit = () => {
      clearTimer();
      if (!active || document.visibilityState !== "visible") return;
      lastCommitAt = performance.now();
      lastCommitted = pending;
      setSnapshot(pending);
    };
    const queueCommit = (next: TimedMediaSnapshot) => {
      pending = next;
      if (document.visibilityState !== "visible") return;
      const now = performance.now();
      const phaseChanged = next.phase !== lastCommitted.phase
        || next.ended !== lastCommitted.ended
        || next.seeking !== lastCommitted.seeking
        || next.errorCode !== lastCommitted.errorCode
        || next.duration !== lastCommitted.duration
        || next.playbackRate !== lastCommitted.playbackRate;
      const remaining = MEDIA_UI_SNAPSHOT_INTERVAL_MS - (now - lastCommitAt);
      if (phaseChanged || remaining <= 0) { commit(); return; }
      if (!timer) timer = window.setTimeout(commit, Math.max(1, Math.ceil(remaining)));
    };

    const unsubscribe = controller.subscribe(queueCommit);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") { clearTimer(); return; }
      pending = controller.getSnapshot();
      commit();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
  return { controller, snapshot };
}
