import {
  CLUSTER_KIOSK_SCREENS,
  PRODUCT_TERMS,
  kioskProfileForSession,
  normalizeClusterKioskProfiles,
  type ClusterKioskProfile,
  type ClusterKioskSessionMode,
} from "@cluster/shared";
import type { AppScreen } from "../../core/navigation";
import type { Settings } from "../application/application-models";

export type ClusterKioskHomeScreen = "dashboard" | "projects" | "mywork" | "activity";

export type ClusterKioskPolicy = {
  profileId: string | null;
  profileName: string;
  sessionMode: ClusterKioskSessionMode;
  lockNavigation: boolean;
  hideNavigation: boolean;
  homeScreen: ClusterKioskHomeScreen;
  allowedScreens: AppScreen[];
  idleResetMinutes: number;
  readOnly: boolean;
  managedExitRequired: boolean;
  allowedProjectIds: string[];
  homeWidgetIds: string[];
  rotationSeconds: number;
  rotationScreens: AppScreen[];
  touchMode: boolean;
  hidePointerSeconds: number;
  keepAwake: boolean;
  autoStart: boolean;
  scheduleEnabled: boolean;
  scheduleDays: string[];
  scheduleStart: string;
  scheduleEnd: string;
  offlineBehavior: "last-known" | "status" | "message";
  offlineMessage: string;
};

export const KIOSK_POLICY_SCREEN_OPTIONS: Array<{ value: AppScreen; label: string }> = [
  { value: "dashboard", label: PRODUCT_TERMS.home },
  { value: "mywork", label: PRODUCT_TERMS.myWork },
  { value: "projects", label: PRODUCT_TERMS.projects },
  { value: "project", label: "Project detail" },
  { value: "board", label: PRODUCT_TERMS.boards },
  { value: "whiteboard", label: PRODUCT_TERMS.whiteboards },
  { value: "timeline", label: PRODUCT_TERMS.timeline },
  { value: "builds", label: PRODUCT_TERMS.builds },
  { value: "qa", label: PRODUCT_TERMS.qa },
  { value: "tickets", label: PRODUCT_TERMS.tickets },
  { value: "inbox", label: PRODUCT_TERMS.inbox },
  { value: "people", label: PRODUCT_TERMS.people },
  { value: "activity", label: "Activity" },
  { value: "library", label: PRODUCT_TERMS.library },
];

const VALID_SCREENS = new Set<AppScreen>(CLUSTER_KIOSK_SCREENS as readonly AppScreen[]);
const HOME_SCREENS = new Set<ClusterKioskHomeScreen>(["dashboard", "projects", "mywork", "activity"]);

export const DEFAULT_KIOSK_POLICY: ClusterKioskPolicy = {
  profileId: null,
  profileName: "Default kiosk policy",
  sessionMode: "signed-in",
  lockNavigation: true,
  hideNavigation: false,
  homeScreen: "dashboard",
  allowedScreens: ["dashboard"],
  idleResetMinutes: 10,
  readOnly: false,
  managedExitRequired: true,
  allowedProjectIds: [],
  homeWidgetIds: [],
  rotationSeconds: 0,
  rotationScreens: [],
  touchMode: false,
  hidePointerSeconds: 0,
  keepAwake: false,
  autoStart: false,
  scheduleEnabled: false,
  scheduleDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  scheduleStart: "00:00",
  scheduleEnd: "23:59",
  offlineBehavior: "last-known",
  offlineMessage: "This kiosk is temporarily offline. Cluster will reconnect automatically.",
};

function clampIdleMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.min(120, Math.trunc(parsed)));
}

export function kioskProfilesFromSettings(settings: Settings): ClusterKioskProfile[] {
  return normalizeClusterKioskProfiles(settings.desktopKioskProfiles);
}

export function kioskPolicyFromSettings(settings: Settings, sessionMode: ClusterKioskSessionMode = "signed-in"): ClusterKioskPolicy {
  const profiles = kioskProfilesFromSettings(settings);
  const preferredId = sessionMode === "signed-out" ? settings.desktopKioskSignedOutProfileId : settings.desktopKioskSignedInProfileId;
  const profile = kioskProfileForSession(profiles, sessionMode, preferredId);
  if (!profile) return { ...DEFAULT_KIOSK_POLICY, sessionMode, readOnly: true };
  const homeScreen = profile.homeScreen as ClusterKioskHomeScreen;
  const allowedScreens = Array.from(new Set<AppScreen>([homeScreen, ...profile.allowedScreens.filter((screen) => VALID_SCREENS.has(screen as AppScreen)) as AppScreen[]]));
  return {
    profileId: profile.id,
    profileName: profile.name,
    sessionMode,
    lockNavigation: profile.lockNavigation,
    hideNavigation: profile.hideNavigation,
    homeScreen,
    allowedScreens,
    idleResetMinutes: clampIdleMinutes(profile.idleResetMinutes),
    readOnly: profile.readOnly || sessionMode === "signed-out",
    managedExitRequired: profile.managedExitRequired,
    allowedProjectIds: [...profile.allowedProjectIds],
    homeWidgetIds: [...profile.homeWidgetIds],
    rotationSeconds: profile.rotationSeconds,
    rotationScreens: profile.rotationScreens.filter((screen) => VALID_SCREENS.has(screen as AppScreen)) as AppScreen[],
    touchMode: profile.touchMode,
    hidePointerSeconds: profile.hidePointerSeconds,
    keepAwake: profile.keepAwake,
    autoStart: profile.autoStart,
    scheduleEnabled: profile.scheduleEnabled,
    scheduleDays: [...profile.scheduleDays],
    scheduleStart: profile.scheduleStart,
    scheduleEnd: profile.scheduleEnd,
    offlineBehavior: profile.offlineBehavior,
    offlineMessage: profile.offlineMessage,
  };
}

export function kioskScreenAllowed(policy: ClusterKioskPolicy, screen: AppScreen) {
  return !policy.lockNavigation || policy.allowedScreens.includes(screen);
}

export function kioskSafeScreen(policy: ClusterKioskPolicy, requested: AppScreen): AppScreen {
  return kioskScreenAllowed(policy, requested) ? requested : policy.homeScreen;
}
