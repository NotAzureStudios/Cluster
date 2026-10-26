import { useEffect, useRef } from "react";
import { clusterKioskScheduleActive, clusterKioskScheduleWindowActive, normalizeClusterKioskProfiles, kioskProfileForSession } from "@cluster/shared";
import { api } from "../../core/api";
import type { AppScreen } from "../../core/navigation";
import type { Settings } from "../application/application-models";
import type { ClusterKioskPolicy } from "./kiosk-policy";
import type { NativeKioskSessionMode } from "./use-native-kiosk-session";
import { hasUnsavedChanges } from "../../components/useUnsavedChangesGuard";

export function useKioskRotation(input: {
  active: boolean;
  policy: ClusterKioskPolicy;
  screen: AppScreen;
  navigate: (screen: AppScreen) => void;
}) {
  const navigateRef = useRef(input.navigate);
  navigateRef.current = input.navigate;
  useEffect(() => {
    const seconds = input.policy.rotationSeconds;
    const screens = input.policy.rotationScreens.filter((screen) => input.policy.allowedScreens.includes(screen));
    if (!input.active || seconds < 10 || screens.length < 2) return;
    let timer = 0;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        const current = screens.indexOf(input.screen);
        const next = screens[(current < 0 ? 0 : current + 1) % screens.length];
        if (next) navigateRef.current(next);
      }, seconds * 1_000);
    };
    const onVisible = () => schedule();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [input.active, input.policy.rotationSeconds, input.policy.rotationScreens, input.policy.allowedScreens, input.screen]);
}

type PublicKioskAutomation = {
  autoStart: boolean;
  scheduleEnabled: boolean;
  scheduleDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  scheduleStart: string;
  scheduleEnd: string;
};

export function useKioskScheduleAutomation(input: {
  desktopHost: boolean;
  active: boolean;
  sessionMode: NativeKioskSessionMode;
  settings: Settings;
  settingsLoaded: boolean;
}) {
  useEffect(() => {
    if (!input.desktopHost) return;
    if (input.sessionMode === "signed-in" && !input.settingsLoaded) return;
    let timer = 0;
    let inFlight = false;
    const evaluate = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      let autoStart = false;
      let scheduled = input.active;
      if (input.sessionMode === "signed-out") {
        try {
          const result = await api<{ ok: true; profile: { automation?: PublicKioskAutomation } }>("/api/kiosk/public", { skipCacheInvalidation: true });
          const automation = result.profile?.automation;
          autoStart = Boolean(automation?.autoStart);
          scheduled = automation ? clusterKioskScheduleWindowActive(automation) : input.active;
        } catch {
          return;
        }
      } else {
        const profiles = normalizeClusterKioskProfiles(input.settings.desktopKioskProfiles);
        const profile = kioskProfileForSession(profiles, "signed-in", input.settings.desktopKioskSignedInProfileId);
        autoStart = Boolean(profile?.autoStart);
        scheduled = profile ? clusterKioskScheduleActive(profile) : input.active;
      }
      if (!autoStart || scheduled === input.active) return;
      inFlight = true;
      try { const { setNativeKioskMode } = await import("../../core/desktop"); await setNativeKioskMode(scheduled, input.sessionMode); } catch { /* native automation is best-effort */ } finally { inFlight = false; }
    };
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => { timer = 0; await evaluate(); schedule(); }, 30_000);
    };
    void evaluate();
    schedule();
    const onVisibility = () => { if (document.visibilityState === "visible") void evaluate(); schedule(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [input.desktopHost, input.active, input.sessionMode, input.settings, input.settingsLoaded]);
}

export function useKioskIdleReset(input: {
  active: boolean;
  policy: ClusterKioskPolicy;
  screen: AppScreen;
  navigateHome: () => void;
}) {
  const navigateRef = useRef(input.navigateHome);
  navigateRef.current = input.navigateHome;
  useEffect(() => {
    if (!input.active || input.policy.idleResetMinutes <= 0) return;
    let lastActivityAt = Date.now();
    let timer = 0;
    const markActive = () => { lastActivityAt = Date.now(); };
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastActivityAt < input.policy.idleResetMinutes * 60_000) return;
      lastActivityAt = Date.now();
      if (hasUnsavedChanges() || input.screen === input.policy.homeScreen) return;
      navigateRef.current();
    };
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => { timer = 0; check(); schedule(); }, 5_000);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") check(); schedule(); };
    schedule();
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("wheel", markActive, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("wheel", markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [input.active, input.policy.idleResetMinutes, input.policy.homeScreen, input.screen]);
}
