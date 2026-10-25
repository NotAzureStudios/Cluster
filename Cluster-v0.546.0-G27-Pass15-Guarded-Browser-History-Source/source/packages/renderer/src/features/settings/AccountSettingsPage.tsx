import "../application/admin-control-center.css";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClusterNativeSelect, ClusterInput, ClusterTextarea } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, apiErrorPresentation, createDeviceProofRotationPayload, currentDeviceProofKeyFingerprint, mutateApi, promotePendingDeviceProofKey, queryApi, recoverPendingDeviceProofKey } from "../../core/api";
import { clearOfflineDraft, readOfflineDraft, saveOfflineDraft } from "../../core/offline-storage";
import { accessibilityPreferenceDefaults } from "../../core/accessibility-preferences";
import { applyDesktopPreferences, connectDesktopServer, getClusterRuntimeInfo, getDesktopServerUrl, requestDesktopNotificationPermission, testDesktopServerConnection } from "../../core/desktop";
import { compactDateTime } from "../../core/date-time";
import { NumberStepper } from "../../components/NumberStepper";
import { ClusterSlider } from "../../components/ClusterSlider";
import { ColorField } from "../../components/ColorField";
import { ClusterToggle } from "../../components/ClusterToggle";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { configureClusterSounds, previewClusterNotificationSound, previewClusterUiSound } from "../../core/cluster-sounds";
import { DesignSystemPreview } from "../../components/DesignSystemPreview";
import { AppearanceShellPreview } from "./AppearanceShellPreview";
import { SyncSettingsPanel } from "../../components/SyncStatusIndicator";
import { ErrorCodeReferencePanel } from "./ErrorCodeReferencePanel";
import { PrivacyDataControlCenter } from "../legal/PrivacyDataControlCenter";
import { ClusterSelect } from "../../components/ClusterSelect";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_DETAILS, NOTIFICATION_DELIVERY_OPTIONS, NOTIFICATION_TOOLS, NOTIFICATION_TOOL_DETAILS, normalizedNotificationCategoryDelivery, normalizedNotificationToolModes, type NotificationCategory, type NotificationDeliveryMode, type NotificationToolMode } from "../notifications/notification-preferences";
import { SettingsLoadingState } from "../../components/LoadingState";
import { AccountAccessibilitySettingsSection } from "./AccountAccessibilitySettingsSection";
import { DesktopDevicePackagesPanel } from "./DesktopDevicePackagesPanel";
import { MyFormsPanel } from "./MyFormsPanel";
import { MyInventoryLicensesPanel } from "./MyInventoryLicensesPanel";
import { RequestErrorState } from "../../components/RequestState";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { displayUserName, presenceLabel, presenceState, userInitial } from "../people/people-utils";
import { requestSecurityPinChange, requestSecurityPinSetup } from "../../core/security-pin";
import type { AppTheme, Project, ServerSessionRecord, Settings, SettingsSection, User } from "../application/application-models";
import { projectMemberIds } from "../projects/projects-utils";
import "./settings-workspace.css";
import { ClusterButton } from "../../components/ClusterButton";
import { createWebAuthnCredential, webAuthnAvailable } from "../../core/webauthn-client";

import type { AccountSettingsPageProps } from "./settings-workspace-contracts";
import { ACCOUNT_SETTINGS_DEPENDENCIES } from "./account-settings-dependencies";
import { buildAccountSettingsSections } from "./account-settings-registry";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";

type PersonalDeviceRecord = {
  id: string;
  deviceId: string;
  label: string;
  customLabel?: string | null;
  platform?: string | null;
  userAgent: string;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt?: string | null;
  activeSessionCount: number;
  current?: boolean;
  confidence?: string;
  proofStatus?: string;
  proofAlgorithm?: string | null;
  proofKeyFingerprint?: string | null;
  proofVerifiedAt?: string | null;
  proofLastSeenAt?: string | null;
  cryptographicallyBound?: boolean;
};

type MfaFactorRecord = { id: string; kind: string; label?: string | null; state: string; strength: string; attachment?: string | null; discoverable?: boolean; backupEligible?: boolean; backupState?: boolean; enrolledAt?: string | null; lastUsedAt?: string | null; };
type MfaStatusRecord = {
  enabled: boolean;
  enrolledAt?: string | null;
  lastUsedAt?: string | null;
  recoveryCodesRemaining: number;
  factors?: MfaFactorRecord[];
  activeFactorCount?: number;
  phishingResistantFactorCount?: number;
};


type PresenceAvailability = "available" | "busy" | "focus" | "do_not_disturb" | "away";
type ConnectionVisibility = "visible" | "invisible";

function readProfileImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Profile image could not be read."));
    reader.readAsDataURL(file);
  });
}

type ProfileForm = {
  displayName: string;
  preferredName: string;
  pronouns: string;
  email: string;
  phoneNumber: string;
  timezone: string;
  workLocation: string;
  profileBio: string;
  skillsCsv: string;
  expertise: NonNullable<User["expertise"]>;
  workingHours: NonNullable<User["workingHours"]>;
  customProfileFields: Record<string, unknown>;
  profileWebsite: string;
  profileDiscordUsername: string;
  profilePreferredContact: "cluster" | "discord" | "email" | "phone";
  profilePinnedProjectIds: string[];
  profileShowEmail: boolean;
  profileShowPhone: boolean;
  profileShowDiscord: boolean;
  profileShowTimezone: boolean;
  profileShowStatus: boolean;
};

function profileFormFromUser(user: User): ProfileForm {
  return {
    displayName: user.displayName || "",
    preferredName: user.preferredName || "",
    pronouns: user.pronouns || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    timezone: user.timezone || "",
    workLocation: user.workLocation || "",
    profileBio: user.profileBio || "",
    skillsCsv: (user.skills || []).join(", "),
    expertise: (user.expertise || []).slice(0, 40),
    workingHours: { ...(user.workingHours || {}), timezone: user.timezone || String(user.workingHours?.timezone || "") || null },
    customProfileFields: { ...(user.customProfileFields || {}) },
    profileWebsite: user.profileWebsite || "",
    profileDiscordUsername: user.profileDiscordUsername || user.discordUsername || "",
    profilePreferredContact: (["cluster", "discord", "email", "phone"].includes(String(user.profilePreferredContact)) ? user.profilePreferredContact : "cluster") as ProfileForm["profilePreferredContact"],
    profilePinnedProjectIds: (user.profilePinnedProjectIds || []).slice(0, 4),
    profileShowEmail: Boolean(user.profileShowEmail),
    profileShowPhone: Boolean(user.profileShowPhone),
    profileShowDiscord: Boolean(user.profileShowDiscord),
    profileShowTimezone: user.profileShowTimezone !== false,
    profileShowStatus: user.profileShowStatus !== false,
  };
}

export function AccountSettingsPage({ theme, onThemeChange, onSettingsSaved, currentUser, onUserUpdated, initialSection = "privacy", onSectionChange }: AccountSettingsPageProps) {
  const { userPreferenceSettingsPayload, DASHBOARD_WIDGETS, useDashboardWidgets, DashboardCustomizer, projectTypeBadge, applyCustomization, appearanceKeys } = ACCOUNT_SETTINGS_DEPENDENCIES;
  const [settings, setSettings] = useState<Settings>({});
  // Read-version of the original Account Settings snapshot, not a freshly fetched
  // value at save time. Stale tabs must not overwrite changes made elsewhere.
  const preferencesFingerprintRef = useRef<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => profileFormFromUser(currentUser));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<unknown>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(currentUser.avatarUrl || null);
  const [presenceAvailability, setPresenceAvailability] = useState<PresenceAvailability>(() => (["available", "busy", "focus", "do_not_disturb", "away"].includes(String(currentUser.status)) ? currentUser.status as PresenceAvailability : "available"));
  const [presenceStatusMessage, setPresenceStatusMessage] = useState(currentUser.statusMessage || "");
  const [presenceVisibility, setPresenceVisibility] = useState<ConnectionVisibility>(currentUser.connectionVisibility === "invisible" ? "invisible" : "visible");
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");
  const [expertiseDraft, setExpertiseDraft] = useState("");
  const [expertiseLevel, setExpertiseLevel] = useState<"learning" | "working" | "advanced" | "expert">("working");
  const [personalAccentColor, setPersonalAccentColor] = useState(currentUser.personalAccentColor || "#57c1ff");
  const [pinForm, setPinForm] = useState({
    currentPassword: "",
    currentPin: "",
    pin: "",
    confirmPin: "",
  });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [settingsProjects, setSettingsProjects] = useState<Project[]>([]);
  const runtimeInfo = useMemo(() => getClusterRuntimeInfo(), []);
  const [desktopServerUrl, setDesktopServerUrl] = useState(runtimeInfo.serverUrl || "");
  const [desktopConnectionStatus, setDesktopConnectionStatus] = useState("");
  const [desktopConnectionBusy, setDesktopConnectionBusy] = useState(false);
  const [personalSessions, setPersonalSessions] = useState<ServerSessionRecord[]>([]);
  const [personalSessionsLoading, setPersonalSessionsLoading] = useState(false);
  const [personalDevices, setPersonalDevices] = useState<PersonalDeviceRecord[]>([]);
  const [personalDevicesLoading, setPersonalDevicesLoading] = useState(false);
  const [deviceLabels, setDeviceLabels] = useState<Record<string, string>>({});
  const [localDeviceProofFingerprint, setLocalDeviceProofFingerprint] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatusRecord>({ enabled: false, recoveryCodesRemaining: 0 });
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ secret: string; provisioningUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const dashboardWidgets = useDashboardWidgets();
  const accountDraftTimer = useRef<number | null>(null);
  const accountDraftKey = `account-settings:${currentUser.id}`;
  function persistAccountDraft(nextSettings: Settings, nextAccent = personalAccentColor, nextTheme = theme) {
    if (accountDraftTimer.current) window.clearTimeout(accountDraftTimer.current);
    accountDraftTimer.current = window.setTimeout(() => {
      void saveOfflineDraft(accountDraftKey, { settings: nextSettings, personalAccentColor: nextAccent, theme: nextTheme });
    }, 220);
  }
  useUnsavedChangesGuard({
    dirty: dirty || profileDirty,
    title: "Discard unsaved account settings?",
    message: "You have unsaved account or profile changes. Leave this work and discard them?",
  });
  useEffect(() => setSection(initialSection), [initialSection]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    Promise.all([queryApi<Settings>("/api/settings", { staleMs: 30_000, signal: controller.signal }).catch(() => ({} as Settings)), queryApi<{ ok: boolean; preferences: Partial<Settings>; fingerprint: string; user: User }>("/api/me/preferences", { staleMs: 0, force: true, signal: controller.signal }), queryApi<Project[]>("/api/projects", { staleMs: 15_000, signal: controller.signal }).catch(() => [])])
      .then(async ([studioSettings, preferenceResult, projectRows]) => {
        const merged: Settings = {
          appDisplayName: "Cluster",
          organizationLogoUrl: "",
          studioName: studioSettings.studioName || "Studio",
          workspaceName: studioSettings.workspaceName || "Cluster Workspace",
          interfaceDensity: (document.documentElement.dataset.density as Settings["interfaceDensity"]) || "compact",
          sidebarStyle: (document.documentElement.dataset.sidebarStyle as Settings["sidebarStyle"]) || "solid",
          sidebarSurface: (document.documentElement.dataset.sidebarSurface as Settings["sidebarSurface"]) || "match",
          taskbarSurface: (document.documentElement.dataset.taskbarSurface as Settings["taskbarSurface"]) || "match",
          taskbarLayout: (document.documentElement.dataset.taskbarLayout as Settings["taskbarLayout"]) || "floating",
          sidebarLayout: (document.documentElement.dataset.sidebarLayout as Settings["sidebarLayout"]) || "docked",
          surfaceDepth: (document.documentElement.dataset.surfaceDepth as Settings["surfaceDepth"]) || "soft",
          surfaceTexture: (document.documentElement.dataset.surfaceTexture as Settings["surfaceTexture"]) || "fine",
          surfaceTextureIntensity: 6,
          iconSize: (document.documentElement.dataset.iconSize as Settings["iconSize"]) || "standard",
          panelBorders: (document.documentElement.dataset.panelBorders as Settings["panelBorders"]) || "subtle",
          scrollbarStyle: (document.documentElement.dataset.scrollbarStyle as Settings["scrollbarStyle"]) || "standard",
          projectTabStyle: (document.documentElement.dataset.projectTabStyle as Settings["projectTabStyle"]) || "standard",
          fontFamily: (document.documentElement.dataset.font as Settings["fontFamily"]) || "comfortaa",
          accentColor: "#57c1ff",
          secondaryAccentColor: "#60a5fa",
          dangerColor: "#ef4444",
          cornerRadius: 10,
          glassStrength: 72,
          backgroundStyle: (document.documentElement.dataset.background as Settings["backgroundStyle"]) || "clean",
          backgroundBaseStyle: (document.documentElement.dataset.backgroundBase as Settings["backgroundBaseStyle"]) || "clean",
          backgroundPattern: (document.documentElement.dataset.backgroundPattern as Settings["backgroundPattern"]) || "hex",
          backgroundPatternIntensity: 4,
          backgroundPatternScale: "medium",
          cardStyle: (document.documentElement.dataset.cardStyle as Settings["cardStyle"]) || "outlined",
          surfaceStyle: (document.documentElement.dataset.surfaceStyle as Settings["surfaceStyle"]) || "outlined",
          motionLevel: "full",
          userStartScreen: "dashboard",
          userTaskbarLabels: "auto",
          userCommandSearchScope: "all",
          userSearchContextAware: true,
          userSearchLockCurrentPage: false,
          userQuickCreateTarget: "project",
          userShowHelpText: false,
          userCalendarDefaultView: null,
          userTimeTrackingDefault: "timer",
          userQuietHoursEnabled: false,
          userQuietHoursStart: "18:00",
          userQuietHoursEnd: "09:00",
          userDigestCadence: "daily",
          userDigestTime: "09:00",
          userDigestWeekday: 1,
          userUiSoundsEnabled: true,
          userUiSoundVolume: 50,
          userNotificationSoundsEnabled: true,
          userNotificationSoundVolume: 70,
          browserNotifications: false,
          userShortcutProfile: "default",
          userCommandPaletteHotkey: "Ctrl+K",
          userPinnedToolsCsv: "Dashboard, Projects, My Work, Builds, QA",
          userReducedContrast: false,
          userMotionPreference: "system",
          userContrastPreference: "system",
          userTransparencyPreference: "system",
          userFocusIndicator: "auto",
          userTextScale: "default",
          userLargeClickTargets: false,
          userStatusPalette: "default",
          userFocusModeDefault: false,
          userDashboardDensity: "balanced",
          userHomeMobileLayout: "stack",
          userDefaultFilterScope: "mine",
          notifyCardCreated: false,
          notifyCardMoved: false,
          notifyCardCompleted: true,
          notifyGitEvents: true,
          notifyWhiteboardUpdates: false,
          notifyUpcomingEvents: true,
          notifyDueDates: true,
          notificationLookaheadDays: 7,
          notificationProjectModes: {},
          notificationToolModes: {},
          notificationPriorityFloor: "all",
          notificationEscalationMode: "standard",
          notificationCategoryDelivery: { activity: "toast", mentions: "toast", approvals: "toast", delivery: "toast", qa: "toast", schedule: "toast", work: "toast", system: "toast" },
          notificationQuietHoursBehavior: "critical-only",
          notificationDiscordDelivery: "action-required",
          desktopLaunchAtStartup: false,
          desktopMinimizeToTray: true,
          desktopCloseBehavior: "ask",
          desktopNotificationDelivery: "both",
          desktopOpenExternalLinksInBrowser: true,
          ...preferenceResult.preferences,
          userAutoSaveDrafts: true,
        };
        const recoveredDraft = await readOfflineDraft<{ settings?: Settings; personalAccentColor?: string; theme?: AppTheme }>(accountDraftKey);
        const effectiveSettings = recoveredDraft?.value?.settings ? { ...merged, ...recoveredDraft.value.settings, userAutoSaveDrafts: true } : merged;
        const effectiveAccent = recoveredDraft?.value?.personalAccentColor || preferenceResult.user.personalAccentColor || "#57c1ff";
        const effectiveTheme = recoveredDraft?.value?.theme || theme;
        if (controller.signal.aborted) return;
        preferencesFingerprintRef.current = preferenceResult.fingerprint;
        setSettings(effectiveSettings);
        setSettingsProjects(projectRows);
        setPersonalAccentColor(effectiveAccent);
        onUserUpdated(preferenceResult.user);
        setProfileForm(profileFormFromUser(preferenceResult.user));
        setProfileDirty(false);
        applyCustomization(effectiveSettings, effectiveAccent);
        if (effectiveTheme !== theme) onThemeChange(effectiveTheme);
        setDirty(Boolean(recoveredDraft));
        if (recoveredDraft) setStatus("Recovered unsaved settings from this device.");
      })
      .catch((error) => { if (!controller.signal.aborted) { setLoadError(error); setStatus("Account settings could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt]);
  useEffect(() => {
    void loadPersonalSessions();
    void loadPersonalDevices();
    void loadMfaStatus();
  }, []);
  useEffect(() => {
    if (runtimeInfo.kind !== "desktop") return;
    void getDesktopServerUrl().then((value) => {
      if (value) setDesktopServerUrl(value);
    });
  }, [runtimeInfo.kind]);
  useEffect(() => { setProfileAvatarUrl(currentUser.avatarUrl || null); }, [currentUser.avatarUrl]);
  useEffect(() => { setPresenceAvailability((["available", "busy", "focus", "do_not_disturb", "away"].includes(String(currentUser.status)) ? currentUser.status : "available") as PresenceAvailability); }, [currentUser.status]);
  useEffect(() => { setPresenceStatusMessage(currentUser.statusMessage || ""); }, [currentUser.statusMessage]);
  useEffect(() => { setPresenceVisibility(currentUser.connectionVisibility === "invisible" ? "invisible" : "visible"); }, [currentUser.connectionVisibility]);

  async function uploadProfileAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowed = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/gif"]);
    if (!allowed.has(file.type)) { setStatus("Choose a PNG, JPG, WEBP, or GIF image."); return; }
    if (file.size > 5 * 1024 * 1024) { setStatus("Profile images must be 5 MB or smaller."); return; }
    setAvatarUploading(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const dataUrl = await readProfileImageAsDataUrl(file);
      const result = await api<{ user: Pick<User, "id" | "avatarUrl"> }>("/api/me/avatar", { method: "POST", body: JSON.stringify({ originalName: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl }) });
      const avatarUrl = result.user.avatarUrl || null;
      setProfileAvatarUrl(avatarUrl);
      onUserUpdated({ ...currentUser, avatarUrl });
      window.dispatchEvent(new CustomEvent("cluster-avatar-updated", { detail: { userId: currentUser.id, avatarUrl } }));
      setStatus("Profile image uploaded and queued for admin review.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Profile image upload failed."); }
    finally { setAvatarUploading(false); }
  }

  async function updateAccountPresence(patch: { availability?: PresenceAvailability; message?: string | null; connectionVisibility?: ConnectionVisibility }) {
    if (presenceBusy) return;
    const nextAvailability = patch.availability ?? presenceAvailability;
    const nextMessage = patch.message === undefined ? currentUser.statusMessage || null : patch.message;
    const nextVisibility = patch.connectionVisibility ?? presenceVisibility;
    setPresenceBusy(true);
    try {
      const result = await api<{ ok: boolean; user: User }>("/api/me/presence", { method: "PATCH", body: JSON.stringify({ availability: nextAvailability, message: nextMessage, connectionVisibility: nextVisibility }) });
      setPresenceAvailability(nextAvailability);
      if (patch.message !== undefined) setPresenceStatusMessage(nextMessage || "");
      setPresenceVisibility(nextVisibility);
      onUserUpdated(result.user);
      setStatus("Presence updated.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Presence could not be updated."); }
    finally { setPresenceBusy(false); }
  }

  function patchProfile<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setProfileDirty(true);
    setProfileForm((current) => ({ ...current, [key]: value }));
  }
  const profileSkills = useMemo(() => [...new Set(profileForm.skillsCsv.split(",").map((skill) => skill.trim()).filter(Boolean))].slice(0, 40), [profileForm.skillsCsv]);
  function addProfileSkill(value = skillDraft) {
    const next = String(value || "").trim().replace(/,+$/g, "");
    if (!next || profileSkills.some((skill) => skill.toLowerCase() === next.toLowerCase()) || profileSkills.length >= 40) {
      setSkillDraft("");
      return;
    }
    patchProfile("skillsCsv", [...profileSkills, next].join(", "));
    setSkillDraft("");
  }
  function removeProfileSkill(skill: string) {
    patchProfile("skillsCsv", profileSkills.filter((item) => item !== skill).join(", "));
  }
  function addExpertise() {
    const name = expertiseDraft.trim();
    if (!name || profileForm.expertise.some((item) => item.name.toLowerCase() === name.toLowerCase()) || profileForm.expertise.length >= 40) return;
    patchProfile("expertise", [...profileForm.expertise, { name, level: expertiseLevel }]);
    if (!profileSkills.some((skill) => skill.toLowerCase() === name.toLowerCase())) patchProfile("skillsCsv", [...profileSkills, name].join(", "));
    setExpertiseDraft("");
  }
  function removeExpertise(name: string) { patchProfile("expertise", profileForm.expertise.filter((item) => item.name !== name)); }
  const workingDayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  function patchWorkingDay(day: typeof workingDayKeys[number], enabled: boolean, start?: string, end?: string) {
    const current = Array.isArray(profileForm.workingHours[day]) ? profileForm.workingHours[day] as Array<{ start: string; end: string }> : [];
    const first = current[0] || { start: "09:00", end: "17:00" };
    patchProfile("workingHours", { ...profileForm.workingHours, timezone: profileForm.timezone || null, [day]: enabled ? [{ start: start || first.start, end: end || first.end }, ...current.slice(1)] : [] });
  }
  function patchCustomProfileField(id: string, value: unknown) { patchProfile("customProfileFields", { ...profileForm.customProfileFields, [id]: value }); }
  function togglePinnedProject(projectId: string) {
    const current = profileForm.profilePinnedProjectIds;
    if (current.includes(projectId)) {
      patchProfile("profilePinnedProjectIds", current.filter((id) => id !== projectId));
      return;
    }
    if (current.length >= 4) {
      setStatus("You can showcase up to four projects.");
      return;
    }
    patchProfile("profilePinnedProjectIds", [...current, projectId]);
  }
  async function reloadProfileFromServer() {
    setProfileSaving(true);
    try {
      const result = await queryApi<{ ok: boolean; preferences: Partial<Settings>; user: User }>("/api/me/preferences", { force: true, staleMs: 0, tags: ["account", "profile"] });
      onUserUpdated(result.user);
      setProfileForm(profileFormFromUser(result.user));
      setProfileDirty(false);
      setProfileSaveError(null);
      setStatus("Profile reloaded from the server.");
    } catch (error) {
      setProfileSaveError(error);
      setStatus("");
    } finally {
      setProfileSaving(false);
    }
  }
  async function saveProfile() {
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileSaveError(null);
    setStatus("Saving profile…");
    try {
      const { skillsCsv, ...profilePayload } = profileForm;
      const skills = [...new Set(skillsCsv.split(",").map((skill) => skill.trim()).filter(Boolean))].slice(0, 40);
      const result = await api<{ ok: boolean; user: User }>("/api/me/profile", { method: "PATCH", body: JSON.stringify({ ...profilePayload, skills, personalAccentColor, expectedProfileRevision: currentUser.profileRevision || undefined }) });
      onUserUpdated(result.user);
      setProfileForm(profileFormFromUser(result.user));
      setProfileDirty(false);
      setLastSavedAt(new Date().toISOString());
      setStatus("Profile saved.");
    } catch (error) {
      setProfileSaveError(error);
      setStatus("");
    } finally {
      setProfileSaving(false);
    }
  }
  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDirty(true);
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (appearanceKeys.has(key)) applyCustomization(next, personalAccentColor);
      if (["userUiSoundsEnabled", "userUiSoundVolume", "userNotificationSoundsEnabled", "userNotificationSoundVolume"].includes(String(key))) configureClusterSounds(next);
      persistAccountDraft(next);
      return next;
    });
  }
  function applyVisualDefaults() {
    setDirty(true);
    const next: Settings = {
      ...settings,
      interfaceDensity: "compact",
      sidebarStyle: "solid",
      sidebarSurface: "match",
      taskbarSurface: "match",
      taskbarLayout: "floating",
      sidebarLayout: "docked",
      surfaceDepth: "soft",
      surfaceTexture: "fine",
      surfaceTextureIntensity: 6,
      iconSize: "standard",
      panelBorders: "subtle",
      scrollbarStyle: "standard",
      projectTabStyle: "standard",
      userTaskbarLabels: "auto",
      fontFamily: "comfortaa",
      accentColor: "#57c1ff",
      secondaryAccentColor: "#60a5fa",
      dangerColor: "#ef4444",
      cornerRadius: 8,
      glassStrength: 48,
      backgroundStyle: "clean",
      backgroundBaseStyle: "clean",
      backgroundPattern: "hex",
      backgroundPatternIntensity: 4,
      backgroundPatternScale: "medium",
      cardStyle: "outlined",
      surfaceStyle: "outlined",
      motionLevel: "full",
      userMotionPreference: "system",
    };
    setSettings(next);
    persistAccountDraft(next);
    applyCustomization(next, personalAccentColor);
    onThemeChange("dark");
  }
  function applyAppearancePreset(preset: "dense" | "dark" | "clean" | "lowMotion") {
    setDirty(true);
    const presets: Record<"dense" | "dark" | "clean" | "lowMotion", Partial<Settings> & { theme: AppTheme }> = {
      dense: {
        theme: "dark",
        interfaceDensity: "compact",
        sidebarStyle: "solid",
        sidebarSurface: "solid",
        taskbarSurface: "solid",
        projectTabStyle: "compact",
        userTaskbarLabels: "auto",
        fontFamily: "comfortaa",
        backgroundStyle: "clean",
        backgroundBaseStyle: "clean",
        backgroundPattern: "hex",
        backgroundPatternIntensity: 3,
        backgroundPatternScale: "small",
        cardStyle: "outlined",
        surfaceStyle: "outlined",
        cornerRadius: 8,
        glassStrength: 58,
        userMotionPreference: "reduced",
      },
      dark: {
        theme: "dark",
        interfaceDensity: "compact",
        sidebarStyle: "glass",
        sidebarSurface: "glass",
        taskbarSurface: "glass",
        projectTabStyle: "standard",
        userTaskbarLabels: "auto",
        fontFamily: "comfortaa",
        backgroundStyle: "clean",
        backgroundBaseStyle: "clean",
        backgroundPattern: "hex",
        backgroundPatternIntensity: 4,
        backgroundPatternScale: "medium",
        cardStyle: "glass",
        surfaceStyle: "glass",
        accentColor: "#57c1ff",
        secondaryAccentColor: "#38bdf8",
        cornerRadius: 12,
        glassStrength: 72,
        userMotionPreference: "full",
      },
      clean: {
        theme: "light",
        interfaceDensity: "compact",
        sidebarStyle: "solid",
        sidebarSurface: "solid",
        taskbarSurface: "solid",
        projectTabStyle: "standard",
        userTaskbarLabels: "auto",
        fontFamily: "comfortaa",
        backgroundStyle: "clean",
        backgroundBaseStyle: "clean",
        backgroundPattern: "none",
        backgroundPatternIntensity: 0,
        backgroundPatternScale: "medium",
        cardStyle: "flat",
        surfaceStyle: "flat",
        accentColor: "#57c1ff",
        secondaryAccentColor: "#0ea5e9",
        cornerRadius: 10,
        glassStrength: 42,
        userMotionPreference: "reduced",
      },
      lowMotion: {
        theme,
        interfaceDensity: "compact",
        sidebarStyle: settings.sidebarStyle || "solid",
        sidebarSurface: settings.sidebarSurface || "match",
        taskbarSurface: settings.taskbarSurface || "match",
        projectTabStyle: settings.projectTabStyle || "standard",
        userTaskbarLabels: settings.userTaskbarLabels || "auto",
        fontFamily: settings.fontFamily || "comfortaa",
        backgroundStyle: settings.backgroundStyle || "clean",
        backgroundBaseStyle: settings.backgroundBaseStyle || "clean",
        backgroundPattern: settings.backgroundPattern || "hex",
        backgroundPatternIntensity: settings.backgroundPatternIntensity ?? 4,
        backgroundPatternScale: settings.backgroundPatternScale || "medium",
        cardStyle: "outlined",
        surfaceStyle: "outlined",
        cornerRadius: Math.min(settings.cornerRadius ?? 10, 10),
        glassStrength: Math.min(settings.glassStrength ?? 72, 55),
        userMotionPreference: "none",
      },
    };
    const selected = presets[preset];
    const { theme: nextTheme, ...nextPatch } = selected;
    const next: Settings = { ...settings, ...nextPatch };
    setSettings(next);
    persistAccountDraft(next, personalAccentColor, nextTheme);
    applyCustomization(next, personalAccentColor);
    onThemeChange(nextTheme);
  }
  async function save() {
    setSaving(true);
    setStatus("Saving account settings...");
    try {
      const preferencePayload = { ...userPreferenceSettingsPayload(settings, theme), userAutoSaveDrafts: true };
      if (!preferencesFingerprintRef.current) {
        throw new Error("Settings revision is unavailable. Reload Account Settings before saving.");
      }
      const optimisticPreferenceResult = {
        ok: true,
        preferences: preferencePayload,
        user: { ...currentUser, personalAccentColor, preferences: preferencePayload },
      };
      const preferenceMutation = await mutateApi<{
        ok: boolean;
        preferences: Partial<Settings>;
        fingerprint: string;
        user: User;
      }>("/api/me/preferences", {
        method: "PATCH",
        body: { personalAccentColor, preferences: preferencePayload, expectedFingerprint: preferencesFingerprintRef.current },
        label: "Save account settings",
        dedupeKey: `account-settings:${currentUser.id}`,
        entityType: "user-preferences",
        entityId: currentUser.id,
        optimisticResult: optimisticPreferenceResult,
        optimisticCache: {
          "/api/me/preferences": optimisticPreferenceResult,
          "/api/me": { user: optimisticPreferenceResult.user },
        },
        invalidate: ["/api/me/preferences", "/api/me"],
      });
      const preferenceResult = preferenceMutation.result!;
      // Queued offline mutations are not server-committed versions yet.
      if (!preferenceMutation.queued) preferencesFingerprintRef.current = preferenceResult.fingerprint;
      onUserUpdated(preferenceResult.user);
      applyCustomization(settings, preferenceResult.user.personalAccentColor);
      onSettingsSaved?.({ ...settings, appDisplayName: "Cluster" });
      setDirty(false);
      // The server is the authority: do not reload from stale server state if
      // this mutation was only queued locally while offline.
      if (!preferenceMutation.queued && (currentUser.preferences?.userCalendarDefaultView ?? null) !== (settings.userCalendarDefaultView ?? null)) {
        window.dispatchEvent(new Event("cluster-calendar-view-preference-changed"));
      }
      await clearOfflineDraft(accountDraftKey);
      setLastSavedAt(new Date().toISOString());
      setStatus(preferenceMutation.queued ? "Settings saved on this device and queued for synchronization." : "Account settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? `Could not save account settings: ${error.message}` : "Could not save account settings.");
    } finally {
      setSaving(false);
    }
  }
  async function checkDesktopServer(connect: boolean) {
    if (runtimeInfo.kind !== "desktop") return;
    setDesktopConnectionBusy(true);
    setDesktopConnectionStatus(connect ? "Connecting to server..." : "Testing server connection...");
    try {
      const result = connect
        ? await connectDesktopServer(desktopServerUrl)
        : await testDesktopServerConnection(desktopServerUrl);
      setDesktopConnectionStatus(
        result.ok
          ? `Connected${result.version ? ` · Cluster ${result.version}` : ""}${Number.isFinite(result.latencyMs) ? ` · ${result.latencyMs} ms` : ""}`
          : result.message,
      );
    } catch (error) {
      setDesktopConnectionStatus(error instanceof Error ? error.message : "Server connection failed.");
    } finally {
      setDesktopConnectionBusy(false);
    }
  }
  async function savePin() {
    if (!/^\d{4,8}$/.test(pinForm.pin)) {
      setStatus("PIN must contain 4–8 digits.");
      return;
    }
    if (pinForm.pin !== pinForm.confirmPin) {
      setStatus("PIN confirmation does not match.");
      return;
    }
    setStatus("Saving security PIN...");
    try {
      const result = await api<{ user: User }>("/api/me/pin", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: pinForm.currentPassword || undefined,
          currentPin: pinForm.currentPin || undefined,
          pin: pinForm.pin,
        }),
      });
      onUserUpdated(result.user);
      setPinForm({
        currentPassword: "",
        currentPin: "",
        pin: "",
        confirmPin: "",
      });
      setStatus("Security PIN saved. Protected actions are ready.");
    } catch (error) {
      setStatus(error instanceof Error ? `Could not save security PIN: ${error.message}` : "Could not save security PIN.");
    }
  }
  async function openSecurityPinPad() {
    const pin = currentUser.pinConfigured
      ? await requestSecurityPinChange({
          title: "Change security PIN",
          description: "Enter your current PIN, then choose a new PIN.",
          purpose: "change_security_pin",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Choose a 4–8 digit PIN for protected actions.",
          purpose: "create_security_pin",
        });
    if (pin) setStatus(currentUser.pinConfigured ? "Security PIN changed." : "Security PIN created.");
  }

  async function loadPersonalSessions() {
    setPersonalSessionsLoading(true);
    try {
      const result = await api<{
        ok: boolean;
        sessions: ServerSessionRecord[];
      }>("/api/me/sessions");
      setPersonalSessions(result.sessions || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sessions could not be loaded.");
    } finally {
      setPersonalSessionsLoading(false);
    }
  }
  async function revokePersonalSession(sessionId: string) {
    await api(`/api/me/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    setStatus("Session revoked.");
    await loadPersonalSessions();
  }
  async function revokeOtherPersonalSessions() {
    if (!await confirmCluster({ title: "Sign out other sessions?", message: "Sign out every other active Cluster session?", confirmLabel: "Sign out sessions", tone: "danger" })) return;
    const result = await api<{ ok: boolean; revoked: number }>("/api/me/sessions/revoke-others", {
      method: "POST",
      headers: { "X-Cluster-Confirmation": "REVOKE OTHER SESSIONS" },
    });
    setStatus(`${result.revoked} other session${result.revoked === 1 ? "" : "s"} revoked.`);
    await loadPersonalSessions();
  }

  async function loadPersonalDevices() {
    setPersonalDevicesLoading(true);
    try {
      const result = await api<{ ok: boolean; devices: PersonalDeviceRecord[] }>("/api/me/devices");
      const devices = result.devices || [];
      const currentDevice = devices.find((device) => device.current);
      if (currentDevice?.proofKeyFingerprint) await recoverPendingDeviceProofKey(currentDevice.proofKeyFingerprint).catch(() => false);
      setLocalDeviceProofFingerprint(await currentDeviceProofKeyFingerprint().catch(() => null));
      setPersonalDevices(devices);
      setDeviceLabels(Object.fromEntries(devices.map((device) => [device.deviceId, device.customLabel || ""])));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Devices could not be loaded.");
    } finally {
      setPersonalDevicesLoading(false);
    }
  }
  async function saveDeviceLabel(deviceId: string) {
    const result = await api<{ ok: boolean; device: PersonalDeviceRecord }>(`/api/me/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: JSON.stringify({ label: deviceLabels[deviceId] || null }) });
    setStatus("Device label saved.");
    setPersonalDevices((current) => current.map((device) => device.deviceId === deviceId ? { ...device, ...result.device } : device));
  }
  async function rotateCurrentDeviceProof(device: PersonalDeviceRecord) {
    if (!device.current) return;
    const accepted = await confirmCluster({ title: "Rebind this device?", message: "Cluster will replace the asymmetric key bound to this installation. Use this only after local browser/app storage was reset or the device key changed.", confirmLabel: "Rebind device", tone: "default" });
    if (!accepted) return;
    const payload = await createDeviceProofRotationPayload(device.deviceId);
    const result = await api<{ ok: boolean; device: PersonalDeviceRecord }>(`/api/me/devices/${encodeURIComponent(device.deviceId)}/proof/rotate`, { method: "POST", headers: { "X-Cluster-Confirmation": "ROTATE DEVICE PROOF" }, body: JSON.stringify({ publicKeySpki: payload.publicKeySpki, signature: payload.signature, timestamp: payload.timestamp }) });
    const acceptedFingerprint = result.device.proofKeyFingerprint || null;
    if (!acceptedFingerprint || acceptedFingerprint !== payload.keyFingerprint || !(await promotePendingDeviceProofKey(acceptedFingerprint))) {
      throw new Error("The server accepted a device key that does not match the durable replacement staged by this installation.");
    }
    setLocalDeviceProofFingerprint(acceptedFingerprint);
    setPersonalDevices((current) => current.map((item) => item.deviceId === device.deviceId ? result.device : item));
    setStatus("This installation is cryptographically bound again.");
  }

  async function revokePersonalDevice(device: PersonalDeviceRecord) {
    if (!await confirmCluster({ title: "Revoke this device?", message: `Sign out all active Cluster sessions on ${device.label}?`, confirmLabel: "Revoke device", tone: "danger" })) return;
    const result = await api<{ ok: boolean; revoked: number; currentSessionRevoked?: boolean }>(`/api/me/devices/${encodeURIComponent(device.deviceId)}`, { method: "DELETE", headers: { "X-Cluster-Confirmation": "REVOKE DEVICE" } });
    setStatus(`${result.revoked} session${result.revoked === 1 ? "" : "s"} revoked from ${device.label}.`);
    if (!result.currentSessionRevoked) await Promise.all([loadPersonalDevices(), loadPersonalSessions()]);
  }
  async function loadMfaStatus() {
    try {
      const result = await api<{ ok: boolean } & MfaStatusRecord>("/api/auth/mfa/status");
      setMfaStatus(result);
    } catch {
      setMfaStatus({ enabled: false, recoveryCodesRemaining: 0 });
    }
  }
  async function enrollPasskey() {
    if (!webAuthnAvailable()) { setStatus("Passkeys are not available in this browser or runtime."); return; }
    setMfaBusy(true); setStatus("");
    try {
      const start = await api<{ ok: boolean; publicKey: any }>("/api/auth/mfa/passkeys/enroll/start", { method: "POST", body: JSON.stringify({}) });
      const credential = await createWebAuthnCredential(start.publicKey);
      const result = await api<{ ok: boolean; factor: MfaFactorRecord }>("/api/auth/mfa/passkeys/enroll/verify", { method: "POST", body: JSON.stringify({ credential }) });
      await loadMfaStatus();
      setStatus(`${result.factor.attachment === "cross-platform" ? "Security key" : "Passkey"} added.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Passkey enrollment could not be completed."); }
    finally { setMfaBusy(false); }
  }
  async function removeMfaFactor(factor: MfaFactorRecord) {
    if (!await confirmCluster({ title: "Remove authenticator?", message: `Remove ${factor.label || "this authenticator"} from your account?`, confirmLabel: "Remove", tone: "danger" })) return;
    setMfaBusy(true);
    try { await api(`/api/auth/mfa/factors/${encodeURIComponent(factor.id)}`, { method: "DELETE" }); await loadMfaStatus(); setStatus("Authenticator removed."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Authenticator could not be removed."); }
    finally { setMfaBusy(false); }
  }
  async function beginMfaEnrollment() {
    setMfaBusy(true); setStatus(""); setMfaRecoveryCodes([]);
    try {
      const result = await api<{ ok: boolean; secret: string; provisioningUri: string }>("/api/auth/mfa/enroll/start", { method: "POST" });
      setMfaEnrollment({ secret: result.secret, provisioningUri: result.provisioningUri });
      setStatus("Authenticator enrollment started. Verify a code before leaving this screen.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "MFA enrollment could not start."); }
    finally { setMfaBusy(false); }
  }
  async function verifyMfaEnrollment() {
    setMfaBusy(true); setStatus("");
    try {
      const result = await api<{ ok: boolean; recoveryCodes: string[] }>("/api/auth/mfa/enroll/verify", { method: "POST", body: JSON.stringify({ code: mfaCode }) });
      setMfaRecoveryCodes(result.recoveryCodes || []); setMfaEnrollment(null); setMfaCode(""); await loadMfaStatus();
      setStatus("Multi-factor authentication enabled. Save the recovery codes now; Cluster will not show this set again.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The authenticator code was not accepted."); }
    finally { setMfaBusy(false); }
  }
  async function regenerateMfaRecoveryCodes() {
    if (!/^\d{6}$/.test(mfaCode)) { setStatus("Enter the current six-digit authenticator code first."); return; }
    setMfaBusy(true);
    try {
      const result = await api<{ ok: boolean; recoveryCodes: string[] }>("/api/auth/mfa/recovery/regenerate", { method: "POST", body: JSON.stringify({ code: mfaCode }) });
      setMfaRecoveryCodes(result.recoveryCodes || []); setMfaCode(""); await loadMfaStatus(); setStatus("Recovery codes replaced. Save the new set now.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Recovery codes could not be regenerated."); }
    finally { setMfaBusy(false); }
  }
  async function disableMfa() {
    if (!/^\d{6}$/.test(mfaCode)) { setStatus("Enter the current six-digit authenticator code before disabling MFA."); return; }
    if (!await confirmCluster({ title: "Disable MFA?", message: "Password-only sign in will be allowed again for this account.", confirmLabel: "Disable MFA", tone: "danger" })) return;
    setMfaBusy(true);
    try {
      await api("/api/auth/mfa/disable", { method: "POST", body: JSON.stringify({ code: mfaCode }) });
      setMfaCode(""); setMfaEnrollment(null); setMfaRecoveryCodes([]); await loadMfaStatus(); setStatus("Multi-factor authentication disabled.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "MFA could not be disabled."); }
    finally { setMfaBusy(false); }
  }
  const settingsSections = buildAccountSettingsSections({
    profile: profileForm.profilePreferredContact,
    privacy: presenceVisibility === "invisible" ? "offline" : presenceAvailability,
    pin: currentUser.pinConfigured ? "configured" : "required",
    notifications: settings.userDigestCadence || `${settings.notificationLookaheadDays || 7} days`,
    appearance: settings.interfaceDensity || "compact",
    navigation: settings.userStartScreen || "dashboard",
    home: `${DASHBOARD_WIDGETS.filter((item) => dashboardWidgets.widgets[item.key] !== false).length}/${DASHBOARD_WIDGETS.length} widgets`,
    shortcuts: settings.userShortcutProfile || "default",
    accessibility: settings.userMotionPreference || "system",
    desktop: runtimeInfo.kind === "desktop" ? runtimeInfo.platform : "web preview",
    licenses: "assigned assets & keys",
    forms: "available forms",
  });
  const notificationCategoryDelivery = normalizedNotificationCategoryDelivery(settings);
  const notificationToolModes = normalizedNotificationToolModes(settings);
  const enabledNotificationCount = NOTIFICATION_CATEGORIES.filter((category) => notificationCategoryDelivery[category] !== "off").length;
  const notificationCategoryIcon = (category: NotificationCategory): ClusterIconName => ({ mentions: "comment", approvals: "check", work: "work", schedule: "calendar", delivery: "cloud", qa: "check", system: "warning", activity: "activity" } satisfies Record<NotificationCategory, ClusterIconName>)[category];
  const profileSaveRecovery = profileSaveError ? apiErrorPresentation(profileSaveError) : null;
  if (loading) return <SettingsLoadingState label="Loading account settings" />;
  if (loadError) return (
    <section className="page settings-workspace-v298">
      <RequestErrorState error={loadError} title="Account settings unavailable" onRetry={() => { setLoading(true); setLoadAttempt((current) => current + 1); }} />
    </section>
  );
  return (
    <SettingsWorkspaceShell
      className="settings-workspace-v298 settings-page-v092 account-settings-page-v267 account-settings-console-v271 settings-console-v269"
      title="Account Settings"
      icon="user"
      description={`Personal preferences, profile, privacy, notifications, accessibility, and navigation for @${currentUser.username}.`}
      metrics={[
        { label: "Notifications", value: `${enabledNotificationCount}/${NOTIFICATION_CATEGORIES.length}`, tone: enabledNotificationCount ? "good" : "warning" },
        { label: "Home widgets", value: `${DASHBOARD_WIDGETS.filter((item) => dashboardWidgets.widgets[item.key] !== false).length}/${DASHBOARD_WIDGETS.length}` },
        { label: "Runtime", value: runtimeInfo.kind === "desktop" ? runtimeInfo.platform : "Web" },
      ]}
      actions={section === "licenses" || section === "forms" ? null : section === "profile" ? (
        <ClusterButton type="button" variant={profileDirty ? "primary" : "secondary"} onClick={() => void saveProfile()} disabled={profileSaving || !profileDirty}>
          {profileSaving ? "Saving…" : profileDirty ? "Save profile" : "Saved"}
        </ClusterButton>
      ) : (
        <ClusterButton type="button" variant={dirty ? "primary" : "secondary"} onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </ClusterButton>
      )}
      status={status}
      navLabel="Account settings sections"
      activeId={section}
      onChange={(nextSection) => { setSection(nextSection); onSectionChange?.(nextSection); }}
      primaryIds={["profile", "privacy", "pin", "notifications", "appearance", "navigation"] as SettingsSection[]}
      items={settingsSections.map((item) => ({ id: item.key, label: item.label, detail: item.meta, group: item.domain }))}
    >
      {profileSaveError ? <RequestErrorState
        compact
        error={profileSaveError}
        title={profileSaveRecovery?.recoveryKind === "review" ? "Profile changed on another client" : "Profile was not saved"}
        onRetry={profileSaveRecovery?.recoveryKind === "review" ? undefined : () => void saveProfile()}
        onReload={() => void reloadProfileFromServer()}
        reloadLabel="Reload server profile"
      /> : null}

      <div className="settings-primary-layout-v469 settings-layout settings-layout-v092">
        <div className="settings-content panel settings-content-v092 settings-content-v267">
          {section === "profile" && (
            <div className="settings-section-v092 profile-editor-v473">
              <div className="settings-panel-head-v092 profile-editor-head-v473">
                <div>
                  <p className="eyebrow">Your profile</p>
                  <h2>Identity & contact</h2>
                  <p className="muted tight">Choose how people recognize and contact you. Email and phone stay private unless you explicitly share them.</p>
                </div>
              </div>
              <section className="profile-account-hero-v547">
                <div className="profile-account-avatar-v547">
                  <PresenceAvatar userId={currentUser.id} imageUrl={profileAvatarUrl} accentColor={personalAccentColor} label={displayUserName(currentUser)} fallback={userInitial(currentUser)} state={presenceState(currentUser)} title={presenceLabel(currentUser)} />
                  <ClusterFileButton label="Change profile image" accept="image/png,image/jpeg,image/webp,image/gif" size="compact" busy={avatarUploading} busyLabel="Uploading…" onChange={uploadProfileAvatar}>Change image</ClusterFileButton>
                </div>
                <div className="profile-account-hero-copy-v547">
                  <span className="eyebrow">Account identity</span>
                  <h3>{profileForm.preferredName || profileForm.displayName || currentUser.username}</h3>
                  <p>@{currentUser.username}{currentUser.title ? ` · ${currentUser.title}` : ""}{currentUser.department ? ` · ${currentUser.department}` : ""}</p>
                  <div className="profile-account-hero-meta-v547"><span>{presenceVisibility === "invisible" ? "Appearing offline" : presenceLabel({ ...currentUser, status: presenceAvailability })}</span><span>{profileForm.timezone || "Timezone not set"}</span><span>{profileSkills.length} skills</span></div>
                </div>
                <div className="profile-account-color-v547"><span>User color</span><ColorField label="User color" value={personalAccentColor} onChange={(next) => { setPersonalAccentColor(next); setProfileDirty(true); persistAccountDraft(settings, next, theme); applyCustomization(settings, next); }} /></div>
              </section>
              <div className="profile-editor-grid-v473">
                <section className="settings-card-v092 profile-editor-card-v473">
                  <div className="settings-card-head-v092"><h3>Identity</h3><span>@{currentUser.username}</span></div>
                  <div className="profile-fields-v473">
                    <label className="field"><span>Display name</span><ClusterInput value={profileForm.displayName} onChange={(event) => patchProfile("displayName", event.target.value)} placeholder="How your name appears" /></label>
                    <label className="field"><span>Preferred name</span><ClusterInput value={profileForm.preferredName} onChange={(event) => patchProfile("preferredName", event.target.value)} placeholder="Optional" /></label>
                    <label className="field"><span>Pronouns</span><ClusterInput value={profileForm.pronouns} onChange={(event) => patchProfile("pronouns", event.target.value)} placeholder="Optional" /></label>
                    <label className="field"><span>Location</span><ClusterInput value={profileForm.workLocation} onChange={(event) => patchProfile("workLocation", event.target.value)} placeholder="Studio, city, remote..." /></label>
                    <label className="field"><span>Timezone</span><ClusterInput value={profileForm.timezone} onChange={(event) => patchProfile("timezone", event.target.value)} placeholder="America/New_York" /></label>
                    <label className="field span-2"><span>Bio</span><ClusterTextarea rows={4} maxLength={600} value={profileForm.profileBio} onChange={(event) => patchProfile("profileBio", event.target.value)} placeholder="A short introduction, specialties, or what you work on." /></label>
                    <div className="field span-2 profile-skill-editor-v473"><span>Skills</span><div className="profile-skill-input-v473"><ClusterInput value={skillDraft} onChange={(event) => setSkillDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addProfileSkill(); } }} placeholder="Add a skill" /><ClusterButton type="button" variant="secondary" onClick={() => addProfileSkill()} disabled={!skillDraft.trim() || profileSkills.length >= 40}>Add</ClusterButton></div><div className="profile-skill-tags-v473">{profileSkills.map((skill) => <ClusterButton type="button" key={skill} className="tag-chip profile-skill-tag-v473" onClick={() => removeProfileSkill(skill)} title={`Remove ${skill}`}>{skill}<span aria-hidden="true"><ClusterIcon name="close" /></span></ClusterButton>)}</div></div>
                  </div>
                </section>
                <section className="settings-card-v092 profile-editor-card-v473">
                  <div className="settings-card-head-v092"><h3>Contact</h3><span>Optional</span></div>
                  <div className="profile-fields-v473">
                    <label className="field"><span>Email</span><ClusterInput type="email" value={profileForm.email} onChange={(event) => patchProfile("email", event.target.value)} placeholder="name@example.com" /></label>
                    <ClusterToggle className="profile-visibility-toggle-v547" checked={profileForm.profileShowEmail} disabled={!profileForm.email} onCheckedChange={(checked) => patchProfile("profileShowEmail", checked)} label="Show email" description="Visible on your Studio profile." />
                    <label className="field"><span>Phone</span><ClusterInput inputMode="tel" value={profileForm.phoneNumber} onChange={(event) => patchProfile("phoneNumber", event.target.value)} placeholder="Optional" /></label>
                    <ClusterToggle className="profile-visibility-toggle-v547" checked={profileForm.profileShowPhone} disabled={!profileForm.phoneNumber} onCheckedChange={(checked) => patchProfile("profileShowPhone", checked)} label="Show phone" description="Visible on your Studio profile." />
                    <label className="field"><span>Discord username</span><ClusterInput value={profileForm.profileDiscordUsername} onChange={(event) => patchProfile("profileDiscordUsername", event.target.value)} placeholder="username" /></label>
                    <ClusterToggle className="profile-visibility-toggle-v547" checked={profileForm.profileShowDiscord} disabled={!profileForm.profileDiscordUsername && !currentUser.discordUsername} onCheckedChange={(checked) => patchProfile("profileShowDiscord", checked)} label="Show Discord" description="Visible on your Studio profile." />
                    <label className="field span-2"><span>Website / portfolio</span><ClusterInput type="url" value={profileForm.profileWebsite} onChange={(event) => patchProfile("profileWebsite", event.target.value)} placeholder="https://..." /></label>
                    <label className="field span-2"><span>Preferred contact</span><ClusterNativeSelect value={profileForm.profilePreferredContact} onChange={(event) => patchProfile("profilePreferredContact", event.target.value as ProfileForm["profilePreferredContact"])}><option value="cluster">Cluster</option><option value="discord" disabled={!profileForm.profileDiscordUsername && !currentUser.discordUsername}>Discord</option><option value="email" disabled={!profileForm.email}>Email</option><option value="phone" disabled={!profileForm.phoneNumber}>Phone</option></ClusterNativeSelect></label>
                  </div>
                </section>
                <section className="settings-card-v092 profile-editor-card-v473 span-2 people-capability-editor-v495">
                  <div className="settings-card-head-v092"><h3>Expertise & working hours</h3><span>{profileForm.expertise.length} expertise areas</span></div>
                  <div className="people-expertise-editor-v495">
                    <div className="people-expertise-add-v495"><ClusterInput value={expertiseDraft} onChange={(event) => setExpertiseDraft(event.target.value)} placeholder="Expertise area" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addExpertise(); } }} /><ClusterNativeSelect value={expertiseLevel} onChange={(event) => setExpertiseLevel(event.target.value as typeof expertiseLevel)}><option value="learning">Learning</option><option value="working">Working</option><option value="advanced">Advanced</option><option value="expert">Expert</option></ClusterNativeSelect><ClusterButton type="button" variant="secondary" onClick={addExpertise} disabled={!expertiseDraft.trim()}>Add</ClusterButton></div>
                    <div className="people-expertise-tags-v495">{profileForm.expertise.map((item) => <ClusterButton type="button" key={item.name} className="tag-chip" onClick={() => removeExpertise(item.name)} title={`Remove ${item.name}`}><strong>{item.name}</strong><span>{item.level}</span><b aria-hidden="true"><ClusterIcon name="close" /></b></ClusterButton>)}{!profileForm.expertise.length && <span className="muted">Add proficiency levels for the skills teammates depend on.</span>}</div>
                  </div>
                  <div className="people-working-hours-v495">
                    {workingDayKeys.map((day) => { const intervals = Array.isArray(profileForm.workingHours[day]) ? profileForm.workingHours[day] as Array<{ start: string; end: string }> : []; const first = intervals[0] || { start: "09:00", end: "17:00" }; const enabled = intervals.length > 0; return <div key={day}><label><ClusterInput type="checkbox" checked={enabled} onChange={(event) => patchWorkingDay(day, event.target.checked)} /><span>{day.slice(0,3).toUpperCase()}</span></label><ClusterInput type="time" value={first.start} disabled={!enabled} onChange={(event) => patchWorkingDay(day, true, event.target.value, first.end)} /><span>to</span><ClusterInput type="time" value={first.end} disabled={!enabled} onChange={(event) => patchWorkingDay(day, true, first.start, event.target.value)} /></div>; })}
                  </div>
                  <small className="muted">Working hours are profile context, not a time-off authority. Scheduler availability and approved time off still win when planning work.</small>
                </section>
                {(settings.studioPeopleProfileFields || []).length > 0 && <section className="settings-card-v092 profile-editor-card-v473 span-2 people-custom-fields-v495">
                  <div className="settings-card-head-v092"><h3>Studio profile fields</h3><span>{(settings.studioPeopleProfileFields || []).length} configured</span></div>
                  <div className="profile-fields-v473">{(settings.studioPeopleProfileFields || []).map((field) => { const value = profileForm.customProfileFields[field.id]; if (field.type === "select") return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span><ClusterNativeSelect value={String(value || "")} onChange={(event) => patchCustomProfileField(field.id, event.target.value)}><option value="">Unset</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</ClusterNativeSelect></label>; if (field.type === "multi_select") return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span><ClusterInput value={Array.isArray(value) ? value.join(", ") : ""} onChange={(event) => patchCustomProfileField(field.id, event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Comma-separated" /></label>; return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span><ClusterInput type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} value={value == null ? "" : String(value)} onChange={(event) => patchCustomProfileField(field.id, field.type === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} /></label>; })}</div>
                </section>}
                <section className="settings-card-v092 profile-editor-card-v473 span-2">
                  <div className="settings-card-head-v092"><h3>Profile visibility</h3><span>Studio profile</span></div>
                  <div className="profile-visibility-grid-v473">
                    <ClusterToggle className="profile-visibility-toggle-v547" checked={profileForm.profileShowTimezone} onCheckedChange={(checked) => patchProfile("profileShowTimezone", checked)} label="Show timezone" description="Helps teammates understand your local time." />
                    <ClusterToggle className="profile-visibility-toggle-v547" checked={profileForm.profileShowStatus} onCheckedChange={(checked) => patchProfile("profileShowStatus", checked)} label="Show presence" description="Expose availability and custom status." />
                  </div>
                  <div className="profile-preview-v473">
                    <div><span className="eyebrow">Preview</span><strong>{profileForm.preferredName || profileForm.displayName || currentUser.username}</strong><small>@{currentUser.username}{currentUser.title ? ` · ${currentUser.title}` : ""}</small></div>
                    <div className="profile-contact-preview-v473">
                      {profileForm.profileShowEmail && profileForm.email && <span>Email</span>}
                      {profileForm.profileShowPhone && profileForm.phoneNumber && <span>Phone</span>}
                      {profileForm.profileShowDiscord && (profileForm.profileDiscordUsername || currentUser.discordUsername) && <span>Discord</span>}
                      {profileForm.profileWebsite && <span>Website</span>}
                      {profileForm.profileShowTimezone && profileForm.timezone && <span>{profileForm.timezone}</span>}
                    </div>
                  </div>
                </section>
                <section className="settings-card-v092 profile-editor-card-v473 span-2">
                  <div className="settings-card-head-v092"><h3>Showcase work</h3><span>{profileForm.profilePinnedProjectIds.length}/4 pinned</span></div>
                  <p className="muted tight">Pin a few projects to the top of your profile. Only projects the viewer can access will be shown.</p>
                  <div className="profile-showcase-picker-v473">
                    {settingsProjects.filter((project) => projectMemberIds(project).includes(currentUser.id)).map((project) => {
                      const selected = profileForm.profilePinnedProjectIds.includes(project.id);
                      return <ClusterButton type="button" key={project.id} className={selected ? "active" : ""} onClick={() => togglePinnedProject(project.id)}><span><strong>{project.name}</strong><small>{project.status || project.projectType || "Project"}</small></span><b>{selected ? "Pinned" : "Pin"}</b></ClusterButton>;
                    })}
                    {!settingsProjects.some((project) => projectMemberIds(project).includes(currentUser.id)) && <span className="muted">No assigned projects are available to showcase yet.</span>}
                  </div>
                </section>
              </div>
            </div>
          )}

          {section === "pin" && (
            <div className="settings-section-v092 security-pin-section-v267">
              <div className="settings-panel-head-v092">
                <div>
                  <p className="eyebrow">Account security</p>
                  <h2>Security PIN</h2>
                  <p className="muted tight">Used for clock and break actions, applying protected settings, project archiving, and completion submission.</p>
                </div>
              </div>
              <div className="pin-control-layout-v267">
                <section className="settings-card-v092 pin-status-card-v267">
                  <div className="pin-status-icon-v267" data-configured={currentUser.pinConfigured ? "true" : "false"}>••••</div>
                  <div>
                    <span className="eyebrow">Status</span>
                    <h3>{currentUser.pinConfigured ? "PIN configured" : "PIN required"}</h3>
                    <p className="muted tight">{currentUser.pinConfigured ? "Protected actions use the PIN pad." : "Create a PIN to enable protected actions."}</p>
                  </div>
                  <ClusterButton variant="primary" type="button" onClick={() => void openSecurityPinPad()}>
                    {currentUser.pinConfigured ? "Change PIN" : "Create PIN"}
                  </ClusterButton>
                </section>
                <section className="settings-card-v092 pin-protection-card-v267">
                  <div className="settings-card-head-v092">
                    <h3>Protected actions</h3>
                    <span>PIN pad</span>
                  </div>
                  <div className="pin-protection-list-v267">
                    <span>Clock in and out</span>
                    <span>Apply Studio Settings</span>
                    <span>Apply Server Configuration</span>
                    <span>Archive or restore projects</span>
                    <span>Submit project completion</span>
                  </div>
                </section>
                <section className="settings-card-v092 pin-security-note-v267">
                  <div className="settings-card-head-v092">
                    <h3>Security controls</h3>
                    <span>Server enforced</span>
                  </div>
                  <p className="muted tight">PINs contain 4–8 digits, are hashed on the server, and lock temporarily after repeated failed attempts.</p>
                  <ClusterButton variant="secondary" type="button" onClick={() => void openSecurityPinPad()}>
                    Open PIN pad
                  </ClusterButton>
                </section>
              </div>
            </div>
          )}

          {section === "appearance" && (
            <div className="settings-section-v092 appearance-section-v092">
              <div className="settings-panel-head-v092" id="appearance-theme-v546">
                <p className="eyebrow">Interface</p>
                <h2>Appearance</h2>
                <ClusterButton type="button" variant="secondary" onClick={applyVisualDefaults}>
                  Reset visuals
                </ClusterButton>
              </div>
              <nav className="appearance-area-nav-v546" aria-label="Appearance categories">
                {([ ["appearance-theme-v546", "Theme"], ["appearance-materials-v546", "Materials"], ["appearance-layout-v546", "Layout"], ["appearance-motion-v546", "Motion"], ["appearance-presets-v546", "Presets"] ] as const).map(([id, label]) => (
                  <ClusterButton key={id} type="button" variant="secondary" onClick={() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" })}>{label}</ClusterButton>
                ))}
              </nav>
              <div className="appearance-choice-board-v267">
                <section className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Theme</h3>
                    <span>Base contrast</span>
                  </div>
                  <div className="segmented-choice-v267">
                    {(["light", "dark", "system"] as AppTheme[]).map((option) => (
                      <ClusterButton
                        key={option}
                        type="button"
                        className={theme === option ? "active" : ""}
                        onClick={() => {
                          setDirty(true);
                          onThemeChange(option);
                        }}
                      >
                        {option === "system" ? "System" : option === "light" ? "Light" : "Dark"}
                      </ClusterButton>
                    ))}
                  </div>
                </section>
                <section id="appearance-materials-v546" className="settings-card-v092 span-3 appearance-surface-combined-v270">
                  <div className="settings-card-head-v092">
                    <h3>Materials & background</h3>
                    <span>Color foundation, texture, elevation and glass</span>
                  </div>
                  <div className="appearance-surface-row-v270 appearance-visual-instance-v3">
                    <div>
                      <label>Background base</label>
                      <div className="background-choice-grid-v267">
                        {(["clean", "gradient", "aurora", "midnight"] as Array<NonNullable<Settings["backgroundBaseStyle"]>>).map((option) => (
                          <ClusterButton key={option} type="button" data-background-preview={option} className={(settings.backgroundBaseStyle || "clean") === option ? "active" : ""} onClick={() => patch("backgroundBaseStyle", option)}>
                            <span />
                            <strong>{option.charAt(0).toUpperCase() + option.slice(1)}</strong>
                          </ClusterButton>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label>Background pattern</label>
                      <div className="background-choice-grid-v267 appearance-pattern-grid-v3">
                        {(["none", "hex", "grid", "dots"] as Array<NonNullable<Settings["backgroundPattern"]>>).map((option) => (
                          <ClusterButton key={option} type="button" data-pattern-preview={option} className={(settings.backgroundPattern || "hex") === option ? "active" : ""} onClick={() => patch("backgroundPattern", option)}>
                            <span />
                            <strong>{option.charAt(0).toUpperCase() + option.slice(1)}</strong>
                          </ClusterButton>
                        ))}
                      </div>
                    </div>
                    <div className="appearance-pattern-controls-v3">
                      <div className="field">
                        <label>Pattern intensity: {settings.backgroundPatternIntensity ?? 4}%</label>
                        <ClusterSlider min="0" max="12" value={settings.backgroundPatternIntensity ?? 4} onChange={(e) => patch("backgroundPatternIntensity", Number(e.target.value))} />
                      </div>
                      <div className="field">
                        <label>Pattern scale</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Background pattern scale">
                          {(["small", "medium", "large"] as Array<NonNullable<Settings["backgroundPatternScale"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.backgroundPatternScale || "medium") === option ? "active" : ""} onClick={() => patch("backgroundPatternScale", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="appearance-material-controls-v546">
                      <div className="field">
                        <label>Surface depth</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Surface depth">
                          {(["flat", "soft", "elevated"] as Array<NonNullable<Settings["surfaceDepth"]>>).map((option) => <ClusterButton type="button" key={option} aria-pressed={(settings.surfaceDepth || "soft") === option} className={(settings.surfaceDepth || "soft") === option ? "active" : ""} onClick={() => patch("surfaceDepth", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                      </div>
                      <div className="field">
                        <label>Surface texture</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Surface texture">
                          {(["none", "fine", "brushed"] as Array<NonNullable<Settings["surfaceTexture"]>>).map((option) => <ClusterButton type="button" key={option} aria-pressed={(settings.surfaceTexture || "fine") === option} className={(settings.surfaceTexture || "fine") === option ? "active" : ""} onClick={() => patch("surfaceTexture", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                      </div>
                      <div className="field">
                        <label>Texture visibility: {settings.surfaceTextureIntensity ?? 6}%</label>
                        <ClusterSlider min="0" max="20" value={settings.surfaceTextureIntensity ?? 6} onChange={(event) => patch("surfaceTextureIntensity", Number(event.target.value))} />
                      </div>
                      <div className="field">
                        <label>Panel borders</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Panel border definition">
                          {(["minimal", "subtle", "defined"] as Array<NonNullable<Settings["panelBorders"]>>).map((option) => <ClusterButton key={option} type="button" aria-pressed={(settings.panelBorders || "subtle") === option} className={(settings.panelBorders || "subtle") === option ? "active" : ""} onClick={() => patch("panelBorders", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label>Panel style</label>
                      <div className="segmented-choice-v267">
                        {(["flat", "outlined", "glass"] as Array<NonNullable<Settings["surfaceStyle"]>>).map((option) => (
                          <ClusterButton key={option} type="button" className={(settings.surfaceStyle || "outlined") === option ? "active" : ""} onClick={() => patch("surfaceStyle", option)}>
                            {option.charAt(0).toUpperCase() + option.slice(1)}
                          </ClusterButton>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <DesignSystemPreview />
              <div className="appearance-layout-v093">
                <AppearanceShellPreview settings={settings} theme={theme} />
                <div className="settings-card-grid-v092 appearance-card-grid-v092">
                  <div id="appearance-layout-v546" className="settings-card-v092">
                    <div className="settings-card-head-v092">
                      <h3>Layout & navigation</h3>
                      <span>Density and chrome</span>
                    </div>
                    <div className="settings-stack compact-fields-v092 appearance-layout-controls-v522">
                      <div className="field">
                        <label>Font</label>
                        <ClusterNativeSelect value={settings.fontFamily || "comfortaa"} onChange={(e) => patch("fontFamily", e.target.value as Settings["fontFamily"])}>
                          <option value="comfortaa">Comfortaa</option>
                          <option value="inter">Inter</option>
                          <option value="system">System</option>
                          <option value="mono">Mono</option>
                        </ClusterNativeSelect>
                      </div>
                      <div className="field">
                        <label>Icon scale</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Icon scale">
                          {(["small", "standard", "large"] as Array<NonNullable<Settings["iconSize"]>>).map((option) => <ClusterButton key={option} type="button" aria-pressed={(settings.iconSize || "standard") === option} className={(settings.iconSize || "standard") === option ? "active" : ""} onClick={() => patch("iconSize", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                        <small className="muted">Adjusts navigation and action icon artwork without reducing button hit targets.</small>
                      </div>
                      <div className="field">
                        <label>Scrollbars</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Scrollbar prominence">
                          {(["minimal", "standard", "prominent"] as Array<NonNullable<Settings["scrollbarStyle"]>>).map((option) => <ClusterButton key={option} type="button" aria-pressed={(settings.scrollbarStyle || "standard") === option} className={(settings.scrollbarStyle || "standard") === option ? "active" : ""} onClick={() => patch("scrollbarStyle", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                        <small className="muted">Scrollbars stay available; high contrast always favors visibility.</small>
                      </div>
                      <div className="field">
                        <label>Density</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Interface density">
                          {(["dense", "compact", "comfortable"] as Array<NonNullable<Settings["interfaceDensity"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.interfaceDensity || "compact") === option ? "active" : ""} onClick={() => patch("interfaceDensity", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                      <div className="field">
                        <label>Sidebar surface</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Sidebar surface">
                          {(["match", "solid", "glass"] as Array<NonNullable<Settings["sidebarSurface"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.sidebarSurface || "match") === option ? "active" : ""} onClick={() => patch("sidebarSurface", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                      <div className="field sidebar-layout-field-v546">
                        <label>Sidebar layout</label>
                        <div className="segmented-choice-v267 two-options-v522" role="group" aria-label="Sidebar layout">
                          {(["docked", "floating"] as Array<NonNullable<Settings["sidebarLayout"]>>).map((option) => <ClusterButton type="button" key={option} aria-pressed={(settings.sidebarLayout || "docked") === option} className={(settings.sidebarLayout || "docked") === option ? "active" : ""} onClick={() => patch("sidebarLayout", option)}>{option.charAt(0).toUpperCase() + option.slice(1)}</ClusterButton>)}
                        </div>
                        <small className="muted">Floating separates navigation from workspace content on large screens. Phones keep the existing drawer.</small>
                      </div>
                      <div className="field taskbar-layout-field-v546">
                        <label>Top taskbar layout</label>
                        <div className="segmented-choice-v267 two-options-v522" role="group" aria-label="Top taskbar layout">
                          {(["floating", "full-width"] as Array<NonNullable<Settings["taskbarLayout"]>>).map((option) => (
                            <ClusterButton key={option} type="button" aria-pressed={(settings.taskbarLayout || "floating") === option} className={(settings.taskbarLayout || "floating") === option ? "active" : ""} onClick={() => patch("taskbarLayout", option)}>
                              {option === "floating" ? "Floating" : "Full width"}
                            </ClusterButton>
                          ))}
                        </div>
                        <small className="muted">Both stay visible while scrolling. Floating has inset edges; Full width spans the workspace.</small>
                      </div>
                      <div className="field">
                        <label>Taskbar surface</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Taskbar surface">
                          {(["match", "solid", "glass"] as Array<NonNullable<Settings["taskbarSurface"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.taskbarSurface || "match") === option ? "active" : ""} onClick={() => patch("taskbarSurface", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                      <div className="field">
                        <label>Taskbar labels</label>
                        <div className="segmented-choice-v267" role="group" aria-label="Taskbar labels">
                          {(["auto", "always", "icons"] as Array<NonNullable<Settings["userTaskbarLabels"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.userTaskbarLabels || "auto") === option ? "active" : ""} onClick={() => patch("userTaskbarLabels", option)}>
                              {option === "icons" ? "Icons" : option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                      <div className="field">
                        <label>Project tabs</label>
                        <div className="segmented-choice-v267 two-options-v522" role="group" aria-label="Project tab style">
                          {(["compact", "standard"] as Array<NonNullable<Settings["projectTabStyle"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.projectTabStyle || "standard") === option ? "active" : ""} onClick={() => patch("projectTabStyle", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="settings-card-v092">
                    <div className="settings-card-head-v092">
                      <h3 id="appearance-motion-v546">Motion & interaction</h3>
                      <span>Feedback, shape, and movement</span>
                    </div>
                    <div className="settings-stack compact-fields-v092">
                      <div className="field">
                        <label>Motion</label>
                        <div className="segmented-choice-v267 appearance-motion-choice-v3" role="group" aria-label="Motion preference">
                          {(["system", "full", "reduced", "none"] as Array<NonNullable<Settings["userMotionPreference"]>>).map((option) => (
                            <ClusterButton key={option} type="button" className={(settings.userMotionPreference || "system") === option ? "active" : ""} onClick={() => patch("userMotionPreference", option)}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </ClusterButton>
                          ))}
                        </div>
                      </div>
                      <div className="field">
                        <label>Corner radius: {settings.cornerRadius ?? 10}px</label>
                        <ClusterSlider min="2" max="24" value={settings.cornerRadius ?? 10} onChange={(e) => patch("cornerRadius", Number(e.target.value))} />
                      </div>
                      <div className="field">
                        <label>Glass strength: {settings.glassStrength ?? 72}%</label>
                        <ClusterSlider min="20" max="95" value={settings.glassStrength ?? 72} onChange={(e) => patch("glassStrength", Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div id="appearance-presets-v546" className="appearance-preset-row-v093">
                <ClusterButton type="button" onClick={() => applyAppearancePreset("dense")}>
                  <strong>Dense workspace</strong>
                  <span>Smaller chrome, more content</span>
                </ClusterButton>
                <ClusterButton type="button" onClick={() => applyAppearancePreset("dark")}>
                  <strong>Studio dark</strong>
                  <span>Glass panels and blue accents</span>
                </ClusterButton>
                <ClusterButton type="button" onClick={() => applyAppearancePreset("clean")}>
                  <strong>Clean light</strong>
                  <span>Flat cards, brighter surfaces</span>
                </ClusterButton>
                <ClusterButton type="button" onClick={() => applyAppearancePreset("lowMotion")}>
                  <strong>Low motion</strong>
                  <span>Reduced effects and outlines</span>
                </ClusterButton>
              </div>
            </div>
          )}

          {section === "navigation" && (
            <div className="settings-section-v092 user-settings-navigation-v166">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">User</p>
                <h2>Navigation</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Startup and command behavior</h3>
                    <span>Choose the default area opened at launch</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Landing screen</label>
                      <ClusterNativeSelect value={settings.userStartScreen || "dashboard"} onChange={(e) => patch("userStartScreen", e.target.value)}>
                        <option value="dashboard">Dashboard</option>
                        <option value="mywork">My Work</option>
                        <option value="projects">Projects</option>
                        <option value="calendar">Calendar</option>
                        <option value="timeline">Timeline</option>
                        <option value="activity">Activity</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Calendar default view</label>
                      <ClusterNativeSelect value={settings.userCalendarDefaultView || "inherit"} onChange={(e) => patch("userCalendarDefaultView", e.target.value === "inherit" ? null : e.target.value as Settings["userCalendarDefaultView"])}>
                        <option value="inherit">Follow Project / Studio default</option>
                        <option value="agenda">Agenda</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                        <option value="day">Day</option>
                      </ClusterNativeSelect>
                      <small className="muted">Your choice applies across Projects. Follow the default to use each Project's configured view.</small>
                    </div>
                    <div className="field">
                      <label>Default search scope</label>
                      <ClusterNativeSelect value={settings.userCommandSearchScope || "all"} onChange={(e) => patch("userCommandSearchScope", e.target.value as Settings["userCommandSearchScope"])}>
                        <option value="all">Everything I can access</option>
                        <option value="workspace">Workspace content</option>
                        <option value="current">Current page first</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Quick-create target</label>
                      <ClusterNativeSelect value={settings.userQuickCreateTarget || "project"} onChange={(e) => patch("userQuickCreateTarget", e.target.value as Settings["userQuickCreateTarget"])}>
                        <option value="project">Project</option>
                        <option value="card">Card</option>
                        <option value="ticket">Ticket</option>
                        <option value="bug">Bug / QA</option>
                        <option value="build">Build</option>
                        <option value="timeline">Timeline</option>
                        <option value="calendar">Calendar event</option>
                        <option value="scheduler">Schedule block</option>
                        <option value="meeting">Meeting</option>
                        <option value="whiteboard">Whiteboard</option>
                      </ClusterNativeSelect>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Search behavior</h3>
                    <span>Controls the taskbar and command search</span>
                  </div>
                  <div className="toggle-grid compact-toggle-grid-v092">
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.userSearchContextAware ?? true} onChange={(e) => patch("userSearchContextAware", e.target.checked)} /> Rank results from the current page and project first
                    </label>
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.userSearchLockCurrentPage ?? false} onChange={(e) => patch("userSearchLockCurrentPage", e.target.checked)} /> Lock taskbar search to the current page
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "home" && (
            <div className="settings-section-v092 settings-home-widgets-v143">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Home</p>
                <h2>Dashboard layout</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2 home-widget-settings-card-v143">
                  <DashboardCustomizer widgets={dashboardWidgets.widgets} layout={dashboardWidgets.layout} onChange={dashboardWidgets.update} onSizeChange={dashboardWidgets.setSize} onResetLayout={dashboardWidgets.resetLayout} onQuietDefaults={dashboardWidgets.resetQuietDefaults} onCoreTools={dashboardWidgets.enableCoreTools} onEnableEverything={dashboardWidgets.enableEverything} />
                </div>
                <div className="settings-card-v092 home-widget-note-v143">
                  <div className="settings-card-head-v092">
                    <h3>Home rule</h3>
                    <span>Keep dashboards calm</span>
                  </div>
                  <p className="muted tight">Core widgets stay on Home. Search lives in the taskbar. Secondary tools stay grouped in the sidebar under Tools and Administration.</p>
                </div>
              </div>
            </div>
          )}

          {section === "notifications" && (
            <div className="settings-section-v092 notification-settings-v261">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Alerts</p>
                <h2>Notifications</h2>
                <p className="muted tight">Choose how each kind of update reaches you. Toasts are immediate inside Cluster, native push uses the operating system, Silent keeps an inbox record without interrupting you, and Off hides the category.</p>
                <ClusterButton type="button"
                  variant="secondary"
                  onClick={async () => {
                    const granted = await requestDesktopNotificationPermission();
                    patch("browserNotifications", granted);
                    setStatus(granted ? "Native notification permission enabled on this device." : "Native notification permission was not granted on this device.");
                  }}
                >
                  Enable native alerts on this device
                </ClusterButton>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Delivery behavior</h3>
                    <span>Per notification type</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="notification-delivery-row-v473">
                      <span><strong>In-app inbox</strong><small>Toast, Native push, Both, and Silent all retain a durable inbox item.</small></span><b>Core</b>
                    </div>
                    <div className="notification-delivery-row-v473">
                      <span><strong>Native alerts</strong><small>Categories using Native push or Both require permission on each device.</small></span><b>{settings.browserNotifications ? "Ready" : "Permission needed"}</b>
                    </div>
                    <div className="cluster-sound-settings-v533">
                      <section className="cluster-sound-card-v533">
                        <header>
                          <span><strong>Interface sounds</strong><small>Buttons, confirmations, popups, and errors.</small></span>
                          <ClusterToggle className="cluster-sound-toggle-v533" checked={settings.userUiSoundsEnabled !== false} onCheckedChange={(checked) => patch("userUiSoundsEnabled", checked)} aria-label="Enable interface sounds" />
                        </header>
                        <label className="cluster-slider-field-v533">
                          <span>Volume</span><output className="cluster-slider-value-v533">{Math.round(settings.userUiSoundVolume ?? 50)}%</output>
                          <ClusterSlider min="0" max="100" step="1" value={settings.userUiSoundVolume ?? 50} disabled={settings.userUiSoundsEnabled === false} aria-label="Interface sound volume" onChange={(event) => patch("userUiSoundVolume", Number(event.target.value))} onPointerUp={(event) => previewClusterUiSound(Number(event.currentTarget.value))} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) previewClusterUiSound(Number(event.currentTarget.value)); }} />
                        </label>
                      </section>
                      <section className="cluster-sound-card-v533">
                        <header>
                          <span><strong>Notification sounds</strong><small>Separate volume for incoming Cluster notifications.</small></span>
                          <ClusterToggle className="cluster-sound-toggle-v533" checked={settings.userNotificationSoundsEnabled !== false} onCheckedChange={(checked) => patch("userNotificationSoundsEnabled", checked)} aria-label="Enable notification sounds" />
                        </header>
                        <label className="cluster-slider-field-v533">
                          <span>Volume</span><output className="cluster-slider-value-v533">{Math.round(settings.userNotificationSoundVolume ?? 70)}%</output>
                          <ClusterSlider min="0" max="100" step="1" value={settings.userNotificationSoundVolume ?? 70} disabled={settings.userNotificationSoundsEnabled === false} aria-label="Notification sound volume" onChange={(event) => patch("userNotificationSoundVolume", Number(event.target.value))} onPointerUp={(event) => previewClusterNotificationSound(Number(event.currentTarget.value))} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) previewClusterNotificationSound(Number(event.currentTarget.value)); }} />
                        </label>
                      </section>
                    </div>
                    <div className="field">
                      <label>Minimum priority</label>
                      <ClusterNativeSelect value={settings.notificationPriorityFloor || "all"} onChange={(e) => patch("notificationPriorityFloor", e.target.value as Settings["notificationPriorityFloor"])}>
                        <option value="all">All signal</option>
                        <option value="medium">Normal and above</option>
                        <option value="high">Important and critical only</option>
                        <option value="critical">Critical only</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Escalation</label>
                      <ClusterNativeSelect value={settings.notificationEscalationMode || "standard"} onChange={(e) => patch("notificationEscalationMode", e.target.value as Settings["notificationEscalationMode"])}>
                        <option value="standard">Standard priority</option>
                        <option value="action-required">Raise action-required work</option>
                        <option value="aggressive">Escalate blockers and failures</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Discord delivery</label>
                      <ClusterNativeSelect value={settings.notificationDiscordDelivery || "action-required"} onChange={(e) => patch("notificationDiscordDelivery", e.target.value as Settings["notificationDiscordDelivery"])}>
                        <option value="off">Off</option>
                        <option value="mentions">Mentions only</option>
                        <option value="action-required">Mentions and action-required work</option>
                        <option value="all">All routed updates</option>
                      </ClusterNativeSelect>
                      <small>Controls when Cluster may mention your linked Discord account. Your Cluster Inbox remains the canonical record.</small>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Quiet hours</h3>
                    <span>{settings.userQuietHoursEnabled ? "active" : "off"}</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <ClusterToggle checked={settings.userQuietHoursEnabled ?? false} onCheckedChange={(checked) => patch("userQuietHoursEnabled", checked)} label="Enable quiet hours" />
                    <div className="field">
                      <label>During quiet hours</label>
                      <ClusterNativeSelect value={settings.notificationQuietHoursBehavior || "critical-only"} onChange={(e) => patch("notificationQuietHoursBehavior", e.target.value as Settings["notificationQuietHoursBehavior"])}>
                        <option value="critical-only">Critical can interrupt</option>
                        <option value="silent">Everything becomes silent</option>
                        <option value="normal">Use normal delivery rules</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="two-col compact-fields-v092">
                      <div className="field"><label>Start</label><ClusterInput type="time" value={settings.userQuietHoursStart || "18:00"} onChange={(e) => patch("userQuietHoursStart", e.target.value)} /></div>
                      <div className="field"><label>End</label><ClusterInput type="time" value={settings.userQuietHoursEnd || "09:00"} onChange={(e) => patch("userQuietHoursEnd", e.target.value)} /></div>
                    </div>
                    <div className="two-col compact-fields-v092">
                      <div className="field">
                        <label>Digest</label>
                        <ClusterNativeSelect value={settings.userDigestCadence || "daily"} onChange={(e) => patch("userDigestCadence", e.target.value as Settings["userDigestCadence"])}>
                          <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                        </ClusterNativeSelect>
                      </div>
                      <div className="field"><label>Lookahead days</label><NumberStepper min={1} max={30} value={settings.notificationLookaheadDays || 7} onValueChange={(value) => patch("notificationLookaheadDays", Number(value || 7))} ariaLabel="Lookahead days" /></div>
                    </div>
                    {settings.userDigestCadence !== "off" ? <div className="two-col compact-fields-v092">
                      <div className="field"><label>Digest time</label><ClusterInput type="time" value={settings.userDigestTime || "09:00"} onChange={(e) => patch("userDigestTime", e.target.value)} /></div>
                      {settings.userDigestCadence === "weekly" ? <div className="field"><label>Weekly digest day</label><ClusterNativeSelect value={settings.userDigestWeekday || 1} onChange={(e) => patch("userDigestWeekday", Number(e.target.value))}><option value={1}>Monday</option><option value={2}>Tuesday</option><option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option><option value={6}>Saturday</option><option value={7}>Sunday</option></ClusterNativeSelect></div> : <div className="field"><label>Digest schedule</label><small className="muted">Delivered after quiet hours if the selected time is muted.</small></div>}
                    </div> : null}
                  </div>
                </div>
                <div className="settings-card-v092 span-2 notification-types-card-v473">
                  <div className="settings-card-head-v092">
                    <div>
                      <h3>Notification types</h3>
                      <p className="muted tight">Set delivery independently for every category. Off removes that category from the inbox and unread count; Silent keeps it available without a toast or native push.</p>
                    </div>
                    <span>{enabledNotificationCount}/{NOTIFICATION_CATEGORIES.length} active</span>
                  </div>
                  <div className="notification-type-list-v473">
                    {NOTIFICATION_CATEGORIES.map((category) => {
                      const detail = NOTIFICATION_CATEGORY_DETAILS[category];
                      const mode = notificationCategoryDelivery[category];
                      const enabled = mode !== "off";
                      return (
                        <div className="notification-type-row-v473" key={category} data-category={category} data-enabled={enabled ? "true" : "false"}>
                          <span className="notification-type-icon-v473"><ClusterIcon name={notificationCategoryIcon(category)} /></span>
                          <span className="notification-type-copy-v473"><strong>{detail.label}</strong><small>{detail.description}</small></span>
                          <ClusterNativeSelect
                            className="notification-delivery-select-v473"
                            value={mode}
                            onChange={(event) => {
                              const nextMode = event.target.value as NotificationDeliveryMode;
                              const nextDelivery = { ...notificationCategoryDelivery, [category]: nextMode };
                              patch("notificationCategoryDelivery", nextDelivery);
                              if (nextMode === "native" || nextMode === "both") setStatus(settings.browserNotifications ? "Native delivery enabled for this notification type." : "Native delivery selected. Enable native alerts on this device to receive system notifications here.");
                            }}
                            aria-label={`${detail.label} delivery`}
                          >
                            {NOTIFICATION_DELIVERY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </ClusterNativeSelect>
                        </div>
                      );
                    })}
                  </div>
                  <div className="notification-delivery-legend-v473">
                    {NOTIFICATION_DELIVERY_OPTIONS.map((option) => <span key={option.value}><strong>{option.label}</strong><small>{option.detail}</small></span>)}
                  </div>
                </div>
                <div className="settings-card-v092 span-2 project-notification-settings-v261 notification-tool-settings-v495">
                  <div className="settings-card-head-v092"><h3>Tool notification levels</h3><span>{NOTIFICATION_TOOLS.filter((tool) => notificationToolModes[tool] !== "off").length}/{NOTIFICATION_TOOLS.length} active</span></div>
                  <p className="muted tight">Tool rules sit between category delivery and project rules. Important keeps high and critical work; Off mutes the tool except direct mentions and system/security events.</p>
                  <div className="project-notification-list-v261">
                    {NOTIFICATION_TOOLS.map((tool) => {
                      const detail = NOTIFICATION_TOOL_DETAILS[tool];
                      const mode = notificationToolModes[tool];
                      return <div key={tool} className="project-notification-row-v261"><div><strong>{detail.label}</strong><span>{detail.description}</span></div><ClusterSelect value={mode} options={[{ value: "all", label: "All" }, { value: "important", label: "Important" }, { value: "off", label: "Off" }]} onChange={(value) => patch("notificationToolModes", { ...(settings.notificationToolModes || {}), [tool]: value as NotificationToolMode })} ariaLabel={`${detail.label} notification level`} /></div>;
                    })}
                  </div>
                </div>
                <div className="settings-card-v092 span-2 project-notification-settings-v261">
                  <div className="settings-card-head-v092"><h3>Project notification levels</h3><span>{settingsProjects.length} projects</span></div>
                  <p className="muted tight">Project rules are applied after the category delivery rule. Important keeps only direct mentions, failures, approvals, blockers, and urgent due work. Off mutes that project except direct mentions and system events.</p>
                  <div className="project-notification-list-v261">
                    {settingsProjects.length ? (settingsProjects.filter((project) => !project.archived).map((project) => {
                      const mode = settings.notificationProjectModes?.[project.id] || "all";
                      return <div key={project.id} className="project-notification-row-v261"><div><strong>{project.name}</strong><span>{projectTypeBadge(project)} · {project.status || "active"}</span></div><ClusterSelect value={mode} options={[{ value: "all", label: "All" }, { value: "important", label: "Important" }, { value: "off", label: "Off" }]} onChange={(value) => patch("notificationProjectModes", { ...(settings.notificationProjectModes || {}), [project.id]: value as "all" | "important" | "off" })} ariaLabel={`${project.name} notification level`} /></div>;
                    })) : <p className="muted tight">No projects are available yet.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "privacy" && (
            <div className="settings-section-v092 user-settings-privacy-v166">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">User</p>
                <h2>Privacy & data</h2>
              </div>
              <div className="settings-card-grid-v092">
                <PrivacyDataControlCenter currentUser={currentUser} />
                <div className="settings-card-v092 span-2 account-presence-card-v547">
                  <div className="settings-card-head-v092">
                    <div><h3>Presence & visibility</h3><small className="muted">Live state. Changes apply immediately and are not part of Settings save.</small></div>
                    <span>{presenceVisibility === "invisible" ? "Appearing offline" : presenceAvailability}</span>
                  </div>
                  <div className="account-presence-grid-v547">
                    <div className="field">
                      <label>Availability</label>
                      <ClusterSelect value={presenceAvailability} disabled={presenceBusy} onChange={(value) => void updateAccountPresence({ availability: value as PresenceAvailability })} ariaLabel="Availability" options={[{ value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "focus", label: "Focus" }, { value: "do_not_disturb", label: "Do not disturb" }, { value: "away", label: "Away" }]} />
                    </div>
                    <ClusterToggle checked={presenceVisibility === "invisible"} disabled={presenceBusy} onCheckedChange={(checked) => void updateAccountPresence({ connectionVisibility: checked ? "invisible" : "visible" })} label="Appear offline" description="Hide your live presence without changing availability or time records." />
                    <div className="field account-presence-message-v547">
                      <label>Status message</label>
                      <div><ClusterInput value={presenceStatusMessage} maxLength={160} disabled={presenceBusy} onChange={(event) => setPresenceStatusMessage(event.target.value)} placeholder="What should teammates know?" /><ClusterButton type="button" variant="secondary" size="compact" disabled={presenceBusy || (presenceStatusMessage.trim() || "") === (currentUser.statusMessage || "")} onClick={() => void updateAccountPresence({ message: presenceStatusMessage.trim() || null })}>Save status</ClusterButton></div>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Local comfort</h3>
                    <span>Personal-only toggles</span>
                  </div>
                  <div className="toggle-grid compact-toggle-grid-v092">
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.userShowHelpText ?? false} onChange={(e) => patch("userShowHelpText", e.target.checked)} /> Show helper text
                    </label>
                  </div>
                </div>
                <div className="settings-card-v092 span-2 account-mfa-v495">
                  <div className="settings-card-head-v092"><h3>Multi-factor authentication</h3><span>{mfaStatus.enabled ? "Enabled" : "Optional"}</span></div>
                  <p className="muted tight">Use authenticator apps, passkeys, or hardware security keys. Cluster stores public-key credential metadata for WebAuthn, never biometric templates.</p>
                  <div className="button-row compact"><ClusterButton type="button" variant="secondary" onClick={() => void enrollPasskey()} disabled={mfaBusy || !webAuthnAvailable()}>Add passkey or security key</ClusterButton></div>
                  {(mfaStatus.factors || []).length > 0 && <div className="server-session-list-v202">{(mfaStatus.factors || []).map((factor) => <article key={factor.id}><div><strong>{factor.label || (factor.kind === "webauthn" ? "Passkey" : "Authenticator app")}</strong><span>{factor.kind === "webauthn" ? `${factor.attachment === "cross-platform" ? "Security key" : "Passkey"} · ${factor.strength.replace(/_/g, " ")}` : "Authenticator app · MFA"}</span><em>{factor.state} · last used {factor.lastUsedAt ? compactDateTime(factor.lastUsedAt) : "never"}</em></div>{factor.state === "active" && (mfaStatus.activeFactorCount || 0) > 1 && <ClusterButton type="button" variant="danger" size="compact" onClick={() => void removeMfaFactor(factor)}>Remove</ClusterButton>}</article>)}</div>}
                  {!mfaStatus.enabled && !mfaEnrollment && <div className="button-row compact"><ClusterButton type="button" variant="secondary" onClick={beginMfaEnrollment} disabled={mfaBusy}>Set up authenticator</ClusterButton></div>}
                  {mfaEnrollment && <div className="settings-stack-v092">
                    <div className="hint-box"><strong>Authenticator secret</strong><code>{mfaEnrollment.secret}</code><span>Add this secret to your authenticator app. The provisioning URI is available below for apps that accept it directly.</span><code className="security-secret-uri-v495">{mfaEnrollment.provisioningUri}</code></div>
                    <div className="field"><label>Six-digit code</label><ClusterInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
                    <div className="button-row compact"><ClusterButton type="button" variant="primary" onClick={verifyMfaEnrollment} disabled={mfaBusy || mfaCode.length !== 6}>Verify and enable</ClusterButton><ClusterButton type="button" variant="quiet" onClick={() => { setMfaEnrollment(null); setMfaCode(""); }}>Cancel</ClusterButton></div>
                  </div>}
                  {mfaStatus.enabled && <div className="settings-stack-v092">
                    <div className="two-col compact-fields-v092"><div><strong>Recovery codes</strong><p className="muted tight">{mfaStatus.recoveryCodesRemaining} unused · last used {mfaStatus.lastUsedAt ? compactDateTime(mfaStatus.lastUsedAt) : "never"}</p></div><div className="field"><label>Current authenticator code</label><ClusterInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></div></div>
                    <div className="button-row compact"><ClusterButton type="button" variant="secondary" onClick={regenerateMfaRecoveryCodes} disabled={mfaBusy || mfaCode.length !== 6}>Replace recovery codes</ClusterButton><ClusterButton type="button" variant="danger" onClick={disableMfa} disabled={mfaBusy || mfaCode.length !== 6}>Disable MFA</ClusterButton></div>
                  </div>}
                  {mfaRecoveryCodes.length > 0 && <div className="hint-box security-recovery-codes-v495"><strong>Save these recovery codes now</strong><div>{mfaRecoveryCodes.map((code) => <code key={code}>{code}</code>)}</div></div>}
                </div>
                <div className="settings-card-v092 span-2 account-devices-v495">
                  <div className="settings-card-head-v092"><h3>Devices</h3><span>{personalDevicesLoading ? "Refreshing" : `${personalDevices.filter((device) => !device.revokedAt).length} known`}</span></div>
                  <p className="muted tight">Device identity groups sessions by this Cluster installation. It is inventory metadata, not a trusted authentication factor.</p>
                  <div className="button-row compact"><ClusterButton type="button" variant="secondary" onClick={loadPersonalDevices} disabled={personalDevicesLoading}>Refresh</ClusterButton></div>
                  <div className="server-session-list-v202">
                    {personalDevices.length ? personalDevices.slice(0, 16).map((device) => { const proofMismatch = Boolean(device.current && device.proofKeyFingerprint && localDeviceProofFingerprint && device.proofKeyFingerprint !== localDeviceProofFingerprint); return <article key={device.deviceId}><div><strong>{device.current ? `${device.label} · current` : device.label}</strong><span>{device.userAgent}</span><em>{device.activeSessionCount} active session{device.activeSessionCount === 1 ? "" : "s"} · seen {compactDateTime(device.lastSeenAt)} · {device.platform || "unknown platform"} · {device.cryptographicallyBound ? `device proof verified${device.proofKeyFingerprint ? ` · ${device.proofKeyFingerprint}` : ""}` : "installation ID only"}</em>{proofMismatch && <div className="hint-box"><strong>Device key mismatch</strong><span>The server is bound to a different key than this installation currently holds. Rebind this device before security-sensitive operations.</span></div>}<div className="button-row compact"><ClusterInput aria-label={`Label ${device.label}`} value={deviceLabels[device.deviceId] ?? ""} onChange={(event) => setDeviceLabels((current) => ({ ...current, [device.deviceId]: event.target.value.slice(0, 80) }))} placeholder="Custom device label" /><ClusterButton type="button" size="compact" onClick={() => saveDeviceLabel(device.deviceId)}>Save label</ClusterButton>{device.current && <ClusterButton type="button" size="compact" variant={proofMismatch ? "primary" : "secondary"} onClick={() => void rotateCurrentDeviceProof(device)}>Rebind device key</ClusterButton>}</div></div><ClusterButton type="button" variant="danger" size="compact" onClick={() => revokePersonalDevice(device)}>Revoke device</ClusterButton></article>; }) : <ClusterEmptyState compact kind="empty" title="No installation devices" description="Device records will appear after this account signs in through a Cluster installation." />}
                  </div>
                </div>
                <div className="settings-card-v092 span-2 account-sessions-v202">
                  <div className="settings-card-head-v092">
                    <h3>Active sessions</h3>
                    <span>{personalSessionsLoading ? "Refreshing" : `${personalSessions.length} active`}</span>
                  </div>
                  <div className="button-row compact">
                    <ClusterButton type="button" variant="secondary" onClick={loadPersonalSessions} disabled={personalSessionsLoading}>
                      Refresh
                    </ClusterButton>
                    <ClusterButton type="button" variant="quiet" onClick={revokeOtherPersonalSessions} disabled={personalSessions.filter((item) => !item.current).length === 0}>
                      Sign out other sessions
                    </ClusterButton>
                  </div>
                  <div className="server-session-list-v202">
                    {personalSessions.length ? (
                      personalSessions.slice(0, 12).map((session) => (
                        <article key={session.id}>
                          <div>
                            <strong>{session.current ? "Current session" : "Cluster session"}</strong>
                            <span>{session.userAgent}</span>
                            <em>
                              {session.ipAddress || "Unknown IP"} · {String(session.authMethod || "password").replace(/-/g, " ")} · seen {compactDateTime(session.lastSeenAt)} · expires {compactDateTime(session.expiresAt)}
                            </em>
                          </div>
                          {!session.current && (
                            <ClusterButton type="button" variant="danger" size="compact" onClick={() => revokePersonalSession(session.id)}>
                              Revoke
                            </ClusterButton>
                          )}
                        </article>
                      ))
                    ) : (
                      <ClusterEmptyState compact kind="empty" title="No active sessions" description="This account has no active authenticated sessions." />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "shortcuts" && (
            <div className="settings-section-v092 user-settings-shortcuts-v167">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">User</p>
                <h2>Shortcuts & personal rails</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Command behavior</h3>
                    <span>{settings.userShortcutProfile || "default"}</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Shortcut profile</label>
                      <ClusterNativeSelect value={settings.userShortcutProfile || "default"} onChange={(e) => patch("userShortcutProfile", e.target.value as Settings["userShortcutProfile"])}>
                        <option value="default">Default</option>
                        <option value="editor">Editor</option>
                        <option value="producer">Producer</option>
                        <option value="qa">QA</option>
                        <option value="custom">Custom</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Command palette hotkey</label>
                      <ClusterInput value={settings.userCommandPaletteHotkey || "Ctrl+K"} onChange={(e) => patch("userCommandPaletteHotkey", e.target.value)} placeholder="Ctrl+K" />
                    </div>
                    <div className="field">
                      <label>Default filter scope</label>
                      <ClusterNativeSelect value={settings.userDefaultFilterScope || "mine"} onChange={(e) => patch("userDefaultFilterScope", e.target.value as Settings["userDefaultFilterScope"])}>
                        <option value="mine">My work</option>
                        <option value="team">Team</option>
                        <option value="project">Current project</option>
                        <option value="all">Everything</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Dashboard density</label>
                      <ClusterNativeSelect value={settings.userDashboardDensity || "balanced"} onChange={(e) => patch("userDashboardDensity", e.target.value as Settings["userDashboardDensity"])}>
                        <option value="compact">Compact</option>
                        <option value="balanced">Balanced</option>
                        <option value="expanded">Expanded</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Mobile Home layout</label>
                      <ClusterNativeSelect value={settings.userHomeMobileLayout || "stack"} onChange={(e) => patch("userHomeMobileLayout", e.target.value as Settings["userHomeMobileLayout"])}>
                        <option value="stack">Stack</option>
                        <option value="grid">Grid</option>
                        <option value="carousel">Carousel</option>
                        <option value="focus">Focus</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field span-2">
                      <label>Pinned tools</label>
                      <ClusterTextarea value={settings.userPinnedToolsCsv || ""} onChange={(e) => patch("userPinnedToolsCsv", e.target.value)} placeholder="Dashboard, Projects, Builds, QA" />
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Pinned tools</h3>
                    <span>Personal only</span>
                  </div>
                  <div className="chip-row">
                    {(settings.userPinnedToolsCsv || "Dashboard, Projects, Builds, QA")
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .slice(0, 8)
                      .map((item) => (
                        <span className="soft-pill" key={item}>
                          {item}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="settings-card-v092 span-2 shortcut-reference-v270">
                  <div className="settings-card-head-v092"><h3>Keyboard reference</h3><span>Available app-wide</span></div>
                  <div className="shortcut-reference-grid-v270">
                    <div><kbd>Ctrl K</kbd><span>Open command search</span></div>
                    <div><kbd>Ctrl /</kbd><span>Show available shortcuts</span></div>
                    <div><kbd>Alt 1–9</kbd><span>Open pinned tools</span></div>
                    <div><kbd>Esc</kbd><span>Close the active dialog or viewer</span></div>
                    <div><kbd>Shift ← / →</kbd><span>Previous or next media item</span></div>
                    <div><kbd>?</kbd><span>Open viewer shortcut help</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "accessibility" && (
            <AccountAccessibilitySettingsSection
              settings={settings}
              patch={patch}
              onReset={() => {
                const defaults = accessibilityPreferenceDefaults();
                setSettings((current) => ({ ...current, ...defaults, userShowHelpText: false, userFocusModeDefault: false }));
                setDirty(true);
              }}
            />
          )}

          {section === "forms" && <MyFormsPanel key={currentUser.id} />}
          {section === "licenses" && <MyInventoryLicensesPanel key={currentUser.id} pinConfigured={Boolean(currentUser.pinConfigured)} />}

          {section === "desktop" && (
            <div className="settings-section-v092 desktop-settings-v261">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Desktop application</p>
                <h2>Desktop & device</h2>
                <p className="muted tight">Manage the native app connection, startup behavior, tray behavior, notifications, and window controls for this device.</p>
              </div>
              <div className="desktop-runtime-card-v261">
                <div>
                  <strong>{runtimeInfo.kind === "desktop" ? `Cluster Desktop · ${runtimeInfo.platform}` : "Web browser"}</strong>
                  <span>{runtimeInfo.kind === "desktop" ? `Native shell connected${runtimeInfo.appVersion ? ` · ${runtimeInfo.appVersion}` : ""}` : "Install and open Cluster Desktop to use device controls."}</span>
                </div>
                <b data-ready={runtimeInfo.kind === "desktop" ? "true" : "false"}>{runtimeInfo.kind === "desktop" ? "Connected" : "Web"}</b>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2 desktop-server-card-v264">
                  <div className="settings-card-head-v092">
                    <h3>Cluster server</h3>
                    <span>{runtimeInfo.kind === "desktop" ? "Device setting" : "Desktop only"}</span>
                  </div>
                  <p className="muted tight">The desktop app can connect to a Cluster Host on this computer, a trusted studio network, or an HTTPS endpoint. Use the Host web address, not the private API port. This address is stored only on this device.</p>
                  <div className="desktop-server-controls-v264">
                    <div className="field">
                      <label>Server URL</label>
                      <ClusterInput
                        type="url"
                        value={desktopServerUrl}
                        onChange={(event) => setDesktopServerUrl(event.target.value)}
                        placeholder="http://192.168.1.50:3000"
                        disabled={runtimeInfo.kind !== "desktop" || desktopConnectionBusy}
                      />
                    </div>
                    <ClusterButton variant="secondary" type="button" disabled={runtimeInfo.kind !== "desktop" || desktopConnectionBusy || !desktopServerUrl.trim()} onClick={() => void checkDesktopServer(false)}>Test</ClusterButton>
                    <ClusterButton variant="primary" type="button" disabled={runtimeInfo.kind !== "desktop" || desktopConnectionBusy || !desktopServerUrl.trim()} onClick={() => void checkDesktopServer(true)}>Connect</ClusterButton>
                  </div>
                  {desktopConnectionStatus && <p className="desktop-connection-status-v264" role="status">{desktopConnectionStatus}</p>}
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Startup</h3>
                    <span>{settings.desktopLaunchAtStartup ? "Enabled" : "Manual"}</span>
                  </div>
                  <p className="muted tight">Control when Cluster starts and whether it remains available after the main window is hidden.</p>
                  <div className="toggle-grid compact-toggle-grid-v092">
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.desktopLaunchAtStartup ?? false} onChange={(e) => patch("desktopLaunchAtStartup", e.target.checked)} /> Launch Cluster when the device starts
                    </label>
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.desktopMinimizeToTray ?? true} onChange={(e) => patch("desktopMinimizeToTray", e.target.checked)} /> Keep Cluster available in the system tray
                    </label>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Window behavior</h3>
                    <span>{settings.desktopCloseBehavior || "ask"}</span>
                  </div>
                  <p className="muted tight">Choose whether closing the main window hides Cluster, exits immediately, or asks each time.</p>
                  <div className="field">
                    <label>When the window closes</label>
                    <ClusterNativeSelect value={settings.desktopCloseBehavior || "ask"} onChange={(e) => patch("desktopCloseBehavior", e.target.value as Settings["desktopCloseBehavior"])}>
                      <option value="ask">Ask each time</option>
                      <option value="minimize">Keep running in tray</option>
                      <option value="quit">Quit Cluster</option>
                    </ClusterNativeSelect>
                  </div>
                  <label className="tool-check">
                    <ClusterInput type="checkbox" checked={settings.desktopOpenExternalLinksInBrowser ?? true} onChange={(e) => patch("desktopOpenExternalLinksInBrowser", e.target.checked)} /> Open external links in the system browser
                  </label>
                </div>
                <div className="settings-card-v092 span-2 sync-settings-card-v311">
                  <div className="settings-card-head-v092">
                    <div>
                      <h3>Offline sync & recovery</h3>
                      <p className="muted tight">Review queued changes, failed uploads, and conflicts here instead of in the taskbar.</p>
                    </div>
                    <span>Device state</span>
                  </div>
                  <SyncSettingsPanel />
                </div>
                <DesktopDevicePackagesPanel available={runtimeInfo.kind === "desktop"} runtimePlatform={String(runtimeInfo.platform || "windows")} />
                <ErrorCodeReferencePanel />
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Native capabilities</h3>
                    <span>{runtimeInfo.kind === "desktop" ? "Available" : "Requires desktop app"}</span>
                  </div>
                  <div className="desktop-capability-grid-v261">
                    <span data-ready={runtimeInfo.nativeNotifications}>Native notifications</span>
                    <span data-ready={runtimeInfo.kind === "desktop"}>Native file pickers</span>
                    <span data-ready={runtimeInfo.kind === "desktop"}>Isolated server profiles</span>
                    <span data-ready={runtimeInfo.connectionControl}>Server manager</span>
                  </div>
                  <p className="muted tight">Desktop uses an allowlisted capability broker. Raw filesystem paths, credentials, process execution, and generic IPC are not exposed to the renderer.</p>
                </div>
              </div>
            </div>
          )}
        </div>
        <aside className="settings-context-v267 panel">
          <div className="settings-context-block-v267">
            <span className="eyebrow">Current profile</span>
            <strong>{displayUserName(currentUser)}</strong>
            <small>@{currentUser.username}</small>
          </div>
          <div className="settings-context-block-v267">
            <span className="eyebrow">Interface</span>
            <div className="settings-context-chips-v267">
              <span>{theme}</span>
              <span>{settings.backgroundBaseStyle || "clean"}</span>
              <span>{settings.backgroundPattern || "hex"}</span>
              <span>{settings.surfaceStyle || "outlined"}</span>
              <span>{settings.interfaceDensity || "compact"}</span>
            </div>
          </div>
          <div className="settings-context-block-v267">
            <span className="eyebrow">Security</span>
            <strong>{currentUser.pinConfigured ? "PIN configured" : "PIN required"}</strong>
            <ClusterButton variant="secondary" type="button" onClick={() => void openSecurityPinPad()}>
              Open PIN pad
            </ClusterButton>
          </div>
          <div className="settings-context-block-v267">
            <span className="eyebrow">Sync</span>
            <strong>{section === "profile" ? (profileDirty ? "Profile changes not saved" : "Profile synchronized") : (dirty ? "Changes not saved" : "Settings synchronized")}</strong>
            <small>{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Changes are stored with your account."}</small>
            {section === "forms" || section === "licenses" ? <small>Resource actions are saved in their respective panels.</small> : section === "profile" ? (
              <ClusterButton variant="primary" type="button" onClick={() => void saveProfile()} disabled={profileSaving || !profileDirty}>
                {profileSaving ? "Saving…" : "Save profile"}
              </ClusterButton>
            ) : (
              <ClusterButton variant="primary" type="button" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save settings"}
              </ClusterButton>
            )}
          </div>
        </aside>
      </div>
    </SettingsWorkspaceShell>
  );
}

