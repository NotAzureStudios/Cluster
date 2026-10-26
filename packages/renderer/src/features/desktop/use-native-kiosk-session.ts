import { useCallback, useEffect, useState } from "react";
import { api } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";

export type NativeKioskSessionMode = "signed-in" | "signed-out";
export const CLUSTER_KIOSK_ADMIN_EXIT_REQUEST_EVENT = "cluster:kiosk-admin-exit-request";

export function useNativeKioskSession(desktopHost: boolean) {
  const signedOutHint = desktopHost && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterKioskSession") === "signed-out";
  const [active, setActive] = useState(signedOutHint);
  const [sessionMode, setSessionMode] = useState<NativeKioskSessionMode>(signedOutHint ? "signed-out" : "signed-in");
  const [exitShortcut, setExitShortcut] = useState("Ctrl+Shift+F10");

  useEffect(() => {
    if (!desktopHost) {
      setActive(false);
      setSessionMode("signed-in");
      return;
    }
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const { getNativeKioskStatus } = await import("../../core/desktop");
        const status = await getNativeKioskStatus();
        if (cancelled) return;
        setActive(Boolean(status?.enabled));
        setSessionMode(status?.sessionMode === "signed-out" ? "signed-out" : "signed-in");
        if (status?.exitShortcut) setExitShortcut(status.exitShortcut);
      } catch {
        if (!cancelled) { setActive(false); setSessionMode("signed-in"); }
      }
    };
    const clearTimer = () => { if (timer) window.clearTimeout(timer); timer = 0; };
    const schedule = () => {
      clearTimer();
      if (cancelled || document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => { timer = 0; await refresh(); schedule(); }, 5_000);
    };
    const recover = () => { if (document.visibilityState === "visible") void refresh(); schedule(); };
    void refresh();
    schedule();
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => { cancelled = true; clearTimer(); window.removeEventListener("focus", recover); document.removeEventListener("visibilitychange", recover); };
  }, [desktopHost]);

  return { active, sessionMode, exitShortcut } as const;
}

type KioskExitNotice = {
  title: string;
  message: string;
  tone?: "info" | "warning" | "success";
};

export function useManagedNativeKioskExit(input: {
  active: boolean;
  sessionMode: NativeKioskSessionMode;
  pinConfigured: boolean;
  managedExitRequired: boolean;
  onNotice: (notice: KioskExitNotice) => void;
}) {
  const { active, sessionMode, pinConfigured, managedExitRequired, onNotice } = input;
  return useCallback(async () => {
    if (!active) return;
    if (sessionMode === "signed-out") {
      window.dispatchEvent(new CustomEvent(CLUSTER_KIOSK_ADMIN_EXIT_REQUEST_EVENT));
      return;
    }
    let pin: string | null = null;
    if (managedExitRequired) {
      pin = pinConfigured
        ? await requestSecurityPin({ title: "Exit kiosk mode", description: "Enter your security PIN to leave this managed kiosk session.", purpose: "exit_kiosk", confirmLabel: "Exit kiosk" })
        : await requestSecurityPinSetup({ title: "Create security PIN", description: "Create a security PIN before using managed kiosk exit.", purpose: "setup_for_exit_kiosk" });
      if (!pin) return;
    }
    try {
      await api("/api/kiosk/session/end", {
        method: "POST",
        body: JSON.stringify(pin ? { pin } : {}),
        skipCacheInvalidation: true,
      });
      const { setNativeKioskMode } = await import("../../core/desktop");
      await setNativeKioskMode(false, "signed-in");
    } catch {
      onNotice({
        title: "Kiosk exit failed",
        message: "Cluster could not complete the managed kiosk exit. Administrator verification is still required to leave kiosk mode.",
        tone: "warning",
      });
    }
  }, [active, sessionMode, pinConfigured, managedExitRequired, onNotice]);
}
