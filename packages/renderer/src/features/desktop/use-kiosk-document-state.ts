import { useEffect } from "react";
import type { ClusterKioskPolicy } from "./kiosk-policy";
import type { NativeKioskSessionMode } from "./use-native-kiosk-session";

export const CLUSTER_KIOSK_POLICY_CHANGED_EVENT = "cluster:kiosk-policy-changed";

export function useKioskDocumentState(active: boolean, sessionMode: NativeKioskSessionMode, policy: ClusterKioskPolicy) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.clusterKiosk = active ? "true" : "false";
    root.dataset.clusterKioskSession = active ? sessionMode : "signed-in";
    root.dataset.clusterKioskHideNavigation = active && policy.hideNavigation ? "true" : "false";
    root.dataset.clusterKioskReadOnly = active && policy.readOnly ? "true" : "false";
    root.dataset.clusterKioskProfile = active && policy.profileId ? policy.profileId : "";
    root.dataset.clusterKioskTouch = active && policy.touchMode ? "true" : "false";
    root.dataset.clusterKioskHomeWidgets = active ? policy.homeWidgetIds.join(",") : "";
    root.dataset.clusterKioskPointerHidden = "false";
    window.dispatchEvent(new CustomEvent(CLUSTER_KIOSK_POLICY_CHANGED_EVENT, { detail: { active, sessionMode, policy } }));
    return () => {
      if (active) return;
      delete root.dataset.clusterKiosk;
      delete root.dataset.clusterKioskSession;
      delete root.dataset.clusterKioskHideNavigation;
      delete root.dataset.clusterKioskReadOnly;
      delete root.dataset.clusterKioskProfile;
      delete root.dataset.clusterKioskTouch;
      delete root.dataset.clusterKioskHomeWidgets;
      delete root.dataset.clusterKioskPointerHidden;
    };
  }, [active, sessionMode, policy]);

  useEffect(() => {
    if (!active || policy.hidePointerSeconds <= 0) return;
    const root = document.documentElement;
    let timer = 0;
    const reveal = () => {
      root.dataset.clusterKioskPointerHidden = "false";
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { root.dataset.clusterKioskPointerHidden = "true"; }, policy.hidePointerSeconds * 1_000);
    };
    reveal();
    window.addEventListener("pointermove", reveal, { passive: true });
    window.addEventListener("pointerdown", reveal, { passive: true });
    return () => {
      if (timer) window.clearTimeout(timer);
      root.dataset.clusterKioskPointerHidden = "false";
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
    };
  }, [active, policy.hidePointerSeconds]);

  useEffect(() => {
    if (!active || !policy.keepAwake) return;
    let cancelled = false;
    let lock: { release: () => Promise<void>; released?: boolean; addEventListener?: (type: string, listener: () => void) => void } | null = null;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible" || lock) return;
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (kind: "screen") => Promise<any> } }).wakeLock;
        if (!wakeLock) return;
        lock = await wakeLock.request("screen");
        lock?.addEventListener?.("release", () => { lock = null; });
      } catch { lock = null; }
    };
    const sync = () => {
      if (document.visibilityState === "visible") void acquire();
      else if (lock) { const current = lock; lock = null; void current.release().catch(() => undefined); }
    };
    void acquire();
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", sync);
      if (lock) { const current = lock; lock = null; void current.release().catch(() => undefined); }
    };
  }, [active, policy.keepAwake]);
}
