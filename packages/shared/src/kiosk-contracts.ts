import { z } from "zod";

export const CLUSTER_KIOSK_SCREENS = [
  "dashboard",
  "mywork",
  "projects",
  "project",
  "board",
  "whiteboard",
  "timeline",
  "builds",
  "qa",
  "tickets",
  "inbox",
  "people",
  "activity",
  "library",
] as const;

export const CLUSTER_KIOSK_HOME_SCREENS = ["dashboard", "projects", "mywork", "activity"] as const;
export const CLUSTER_KIOSK_SESSION_MODES = ["signed-in", "signed-out"] as const;
export const CLUSTER_KIOSK_PRESETS = ["wallboard", "interactive", "operations", "qa", "guest", "custom"] as const;
export const CLUSTER_KIOSK_OFFLINE_BEHAVIORS = ["last-known", "status", "message"] as const;
export const CLUSTER_KIOSK_SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const kioskClockSchema = z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const clusterKioskPublicCardSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(800),
  tone: z.enum(["neutral", "info", "success", "warning"]).default("neutral"),
}).strict();

export const clusterKioskProfileSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i),
  name: z.string().trim().min(1).max(64),
  preset: z.enum(CLUSTER_KIOSK_PRESETS).default("custom"),
  enabled: z.boolean().default(true),
  sessionMode: z.enum(CLUSTER_KIOSK_SESSION_MODES).default("signed-in"),
  lockNavigation: z.boolean().default(true),
  hideNavigation: z.boolean().default(false),
  homeScreen: z.enum(CLUSTER_KIOSK_HOME_SCREENS).default("dashboard"),
  allowedScreens: z.array(z.enum(CLUSTER_KIOSK_SCREENS)).max(CLUSTER_KIOSK_SCREENS.length).default(["dashboard"]),
  allowedProjectIds: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
  homeWidgetIds: z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9._:-]{0,95}$/i)).max(24).default([]),
  idleResetMinutes: z.number().int().min(0).max(120).default(10),
  readOnly: z.boolean().default(false),
  managedExitRequired: z.boolean().default(true),
  rotationSeconds: z.number().int().min(0).max(600).default(0),
  rotationScreens: z.array(z.enum(CLUSTER_KIOSK_SCREENS)).max(8).default([]),
  touchMode: z.boolean().default(false),
  hidePointerSeconds: z.number().int().min(0).max(120).default(0),
  keepAwake: z.boolean().default(false),
  autoStart: z.boolean().default(false),
  scheduleEnabled: z.boolean().default(false),
  scheduleDays: z.array(z.enum(CLUSTER_KIOSK_SCHEDULE_DAYS)).max(7).default([...CLUSTER_KIOSK_SCHEDULE_DAYS]),
  scheduleStart: kioskClockSchema.default("00:00"),
  scheduleEnd: kioskClockSchema.default("23:59"),
  offlineBehavior: z.enum(CLUSTER_KIOSK_OFFLINE_BEHAVIORS).default("last-known"),
  offlineMessage: z.string().trim().max(300).default("This kiosk is temporarily offline. Cluster will reconnect automatically."),
  publicEnabled: z.boolean().default(false),
  publicTitle: z.string().trim().max(80).default("Cluster"),
  publicMessage: z.string().trim().max(600).default(""),
  publicShowServerStatus: z.boolean().default(true),
  publicCards: z.array(clusterKioskPublicCardSchema).max(12).default([]),
}).strict();

export const clusterKioskProfilesSchema = z.array(clusterKioskProfileSchema).max(24);

export type ClusterKioskScreen = typeof CLUSTER_KIOSK_SCREENS[number];
export type ClusterKioskHomeScreen = typeof CLUSTER_KIOSK_HOME_SCREENS[number];
export type ClusterKioskSessionMode = typeof CLUSTER_KIOSK_SESSION_MODES[number];
export type ClusterKioskPreset = typeof CLUSTER_KIOSK_PRESETS[number];
export type ClusterKioskOfflineBehavior = typeof CLUSTER_KIOSK_OFFLINE_BEHAVIORS[number];
export type ClusterKioskScheduleDay = typeof CLUSTER_KIOSK_SCHEDULE_DAYS[number];
export type ClusterKioskPublicCard = z.infer<typeof clusterKioskPublicCardSchema>;
export type ClusterKioskProfile = z.infer<typeof clusterKioskProfileSchema>;

const PROFILE_DEFAULTS: Omit<ClusterKioskProfile, "id" | "name" | "preset" | "sessionMode" | "allowedScreens" | "publicEnabled" | "publicMessage"> = {
  enabled: true,
  lockNavigation: true,
  hideNavigation: false,
  homeScreen: "dashboard",
  allowedProjectIds: [],
  homeWidgetIds: [],
  idleResetMinutes: 10,
  readOnly: false,
  managedExitRequired: true,
  rotationSeconds: 0,
  rotationScreens: [],
  touchMode: false,
  hidePointerSeconds: 0,
  keepAwake: false,
  autoStart: false,
  scheduleEnabled: false,
  scheduleDays: [...CLUSTER_KIOSK_SCHEDULE_DAYS],
  scheduleStart: "00:00",
  scheduleEnd: "23:59",
  offlineBehavior: "last-known",
  offlineMessage: "This kiosk is temporarily offline. Cluster will reconnect automatically.",
  publicTitle: "Cluster",
  publicShowServerStatus: true,
  publicCards: [],
};

export const DEFAULT_CLUSTER_KIOSK_PROFILES: ClusterKioskProfile[] = [
  {
    ...PROFILE_DEFAULTS,
    id: "staff",
    name: "Interactive station",
    preset: "interactive",
    sessionMode: "signed-in",
    allowedScreens: ["dashboard", "mywork", "projects", "project", "board", "whiteboard", "timeline", "builds", "qa", "tickets", "inbox", "activity", "library"],
    idleResetMinutes: 15,
    publicEnabled: false,
    publicMessage: "",
  },
  {
    ...PROFILE_DEFAULTS,
    id: "guest",
    name: "Guest display",
    preset: "guest",
    sessionMode: "signed-out",
    hideNavigation: true,
    allowedScreens: ["dashboard"],
    idleResetMinutes: 5,
    readOnly: true,
    rotationSeconds: 20,
    hidePointerSeconds: 3,
    keepAwake: true,
    offlineBehavior: "last-known",
    publicEnabled: true,
    publicMessage: "This display is intentionally signed out. Only content published for this kiosk profile is available.",
  },
];

function cloneProfile(profile: ClusterKioskProfile): ClusterKioskProfile {
  return {
    ...profile,
    allowedScreens: [...profile.allowedScreens],
    allowedProjectIds: [...profile.allowedProjectIds],
    homeWidgetIds: [...profile.homeWidgetIds],
    rotationScreens: [...profile.rotationScreens],
    scheduleDays: [...profile.scheduleDays],
    publicCards: profile.publicCards.map((card) => ({ ...card })),
  };
}

export function normalizeClusterKioskProfiles(value: unknown): ClusterKioskProfile[] {
  const parsed = clusterKioskProfilesSchema.safeParse(value);
  return parsed.success && parsed.data.length ? parsed.data.map(cloneProfile) : DEFAULT_CLUSTER_KIOSK_PROFILES.map(cloneProfile);
}

export function kioskProfileForSession(profiles: ClusterKioskProfile[], sessionMode: ClusterKioskSessionMode, preferredId?: string | null) {
  const enabled = profiles.filter((profile) => profile.enabled && profile.sessionMode === sessionMode);
  return enabled.find((profile) => profile.id === preferredId) || enabled[0] || null;
}

export function clusterKioskScheduleWindowActive(profile: Pick<ClusterKioskProfile, "scheduleEnabled" | "scheduleDays" | "scheduleStart" | "scheduleEnd">, at = new Date()) {
  if (!profile.scheduleEnabled) return true;
  const day = CLUSTER_KIOSK_SCHEDULE_DAYS[(at.getDay() + 6) % 7];
  if (!profile.scheduleDays.includes(day)) return false;
  const minute = at.getHours() * 60 + at.getMinutes();
  const [startHour, startMinute] = profile.scheduleStart.split(":").map(Number);
  const [endHour, endMinute] = profile.scheduleEnd.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function clusterKioskScheduleActive(profile: ClusterKioskProfile, at = new Date()) {
  return profile.enabled && clusterKioskScheduleWindowActive(profile, at);
}
