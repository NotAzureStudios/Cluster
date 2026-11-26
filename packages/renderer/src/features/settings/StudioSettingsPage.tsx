import { reconcileAfterCommit } from "../../core/post-commit-reconciliation";
import { decideDraftRecovery, studioSettingsDraftBaseline } from "./settings-draft-authority";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import "../application/admin-control-center.css";
import { ClusterNativeSelect, ClusterInput, ClusterTextarea } from "../../components/ClusterNativeControls";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, queryApi } from "../../core/api";
import { clusterProjectBundleCap, CLUSTER_PROJECT_TOOL_IDS, CLUSTER_PROJECT_TOOL_MANIFEST, setClusterProjectToolState, CLUSTER_PRODUCTION_PROFILE_DEFINITIONS, CLUSTER_PROJECT_TYPE_TEMPLATES, CLUSTER_PROJECT_TYPE_STARTERS, CLUSTER_TOOL_PERMISSION_KEYS, type ClusterProjectToolId, resolveAssignedPermissionBundles, type ClusterPermissionBundle, CLUSTER_PROFILE_FIELD_TYPES, CLUSTER_PROFILE_FIELD_VISIBILITIES, DEFAULT_CLUSTER_KIOSK_PROFILES } from "@cluster/shared";
import { clearOfflineDraft, readOfflineDraft, saveOfflineDraft } from "../../core/offline-storage";
import { DEFAULT_MEMBER_TOOL_PERMISSIONS, TOOL_PERMISSION_OPTIONS, type ToolPermissionKey, type ToolPermissionLevel } from "../../core/permissions";
import { unique } from "../../core/storage";
import { NumberStepper } from "../../components/NumberStepper";
import { ColorField } from "../../components/ColorField";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";
import { ClusterSettingsRow } from "../../components/ClusterSettingsPrimitives";
import { ClusterSettingsSearch } from "../../components/ClusterSettingsSearch";
import { buildStudioSettingsSearchEntries } from "./studio-settings-search";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ResourceIconPicker } from "../../components/ResourceIconPicker";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { DepartmentIdentityMark } from "../../components/DepartmentIdentityMark";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterToggle } from "../../components/ClusterToggle";
import "./roles-permissions.css";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { DataRetentionAdminPanel } from "../legal/DataRetentionAdminPanel";
import { BUILD_PLATFORM_PROFILES } from "../projects/ProjectBuildsPanel";
import { PROJECT_STATUS_OPTIONS } from "../projects/projects-utils";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import type { DashboardWidgetKey, Priority, ProjectStatus, ProjectTypePreset, Settings, StudioDepartmentDefinition, StudioRoleDefinition, StudioSettingsSection } from "../application/application-models";
import "./settings-workspace.css";
import "./people-management-layout-v11.css";
import { WorkforceDepartmentManager } from "./WorkforceDepartmentManager";
import { RoleMembershipReviewPanel, type RoleMemberSnapshot } from "./RoleMembershipReviewPanel";
import { ClusterEntityPicker } from "../../components/ClusterEntityPicker";
import { ClusterEffectiveAccessInspector, type ClusterEffectiveAccessPreview } from "../../components/ClusterEffectiveAccessInspector";
import { filterRoleDirectory, type RoleDirectoryFilter } from "./role-directory-filter";

import type { StudioSettingsPageProps } from "./settings-workspace-contracts";
import { STUDIO_SETTINGS_DEPENDENCIES } from "./studio-settings-dependencies";
import { SettingsLoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { StudioKioskSettingsSection } from "./StudioKioskSettingsSection";
import { StudioSystemsSettingsSection } from "./StudioSystemsSettingsSection";
import { DASHBOARD_WIDGETS, parseHomeWidgetKeyCsv } from "../home-widgets/home-widget-model";
import { STUDIO_SETTINGS_GROUPS, buildStudioSettingsSections, studioSettingsGroupForSection, studioSettingsSectionLabel, STUDIO_ACTION_RULES } from "./studio-settings-state";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { StudioDomainsPanel } from "../domains/DomainManagementPanel";
import { VersioningAdminPage } from "../admin/ProductionIntegrationAdminPages";
import { ClusterTimezoneSelect } from "../../components/ClusterTimezoneSelect";

/** Navigation is the single section locator; avoid a second numbered progress rail. */
const STUDIO_SETTINGS_NAV_ICONS: Record<StudioSettingsSection, import("../../components/ClusterIcon").ClusterIconName> = {
  identity: "user", domains: "link", privacy: "lock", kiosk: "fullscreen", studioSystems: "file",
  people: "users", departments: "users", roles: "lock", defaults: "settings", projectTypes: "project",
  createFields: "plus", customFields: "list", starters: "folder", whiteboards: "palette",
  builds: "code", versioning: "timeline", qa: "check", automations: "sync", workflow: "link",
};

const ROLE_DIRECTORY_FILTER_OPTIONS: readonly { value: RoleDirectoryFilter; label: string; needsCounts?: boolean }[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Active" },
  { value: "disabled", label: "Disabled" },
  { value: "assigned", label: "Assigned", needsCounts: true },
  { value: "unassigned", label: "Unused", needsCounts: true },
];

export function StudioSettingsPage({ onSettingsSaved, currentUser, initialSection, initialSubsection, onSubsectionChange, onSectionChange }: StudioSettingsPageProps) {
  const { withoutServerManagedSettings, DEFAULT_CREATE_PROJECT_FIELDS, DEFAULT_CREATE_BUILD_FIELDS, DEFAULT_BUILD_STATUSES, DEFAULT_QA_CHECKLIST, DEFAULT_QA_SEVERITIES, DEFAULT_QA_CATEGORIES, DEFAULT_WEBHOOK_EVENTS, DEFAULT_ROLE_CREATE_ROLES, DEFAULT_ROLE_APPROVAL_ROLES, studioSlug, splitCsv, normalizeRoleId, roleLabelFromId, mergeStudioDepartments, mergeStudioRoles, rolesCsvFromIds, rolePermissionTemplateOptions, permissionTemplateTools, departmentPermissionsFromSettings, DEFAULT_PROJECT_TYPE_PRESETS, slugProjectTypeId, sanitizeProjectTypePreset, mergeProjectTypePresets, writeProjectTypePresetsCache, projectTypePresetsFromSettings, readFileAsDataUrl, normalizeClusterAccent, applyCustomization, CustomFieldDefinitionsPanel, AutomationRulesPanel, StudioPermissionEditor } = STUDIO_SETTINGS_DEPENDENCIES;
  const [settings, setSettings] = useState<Settings>({});
  const [heldStudioDraft, setHeldStudioDraft] = useState<{ settings?: Settings; section?: StudioSettingsSection } | null>(null);
  const [projectBundleTarget, setProjectBundleTarget] = useState("");
  // Capture the loaded values separately from the working draft. Sending the
  // entire settings snapshot would overwrite changes made in other admin tabs.
  const loadedSettingsRef = useRef<Settings>({});
  // Keep the raw server snapshot, not local UI defaults, for expected-value
  // checks. A missing database key is different from an explicit default.
  const loadedRawSettingsRef = useRef<Settings>({});
  const studioSettingsBaseDigestRef = useRef<string | null>(null);
  const conflictDraftRef = useRef<Partial<Settings> | null>(null);
  const [studioResource, setStudioResource] = useState<{ scope: string; id: string } | null>(() => {
    const inspect = new URLSearchParams(window.location.search).get("inspect") || "";
    const separator = inspect.indexOf(":");
    return separator > 0 && ["studio-form", "form-submission", "studio-application", "studio-announcement", "studio-announcement-new", "studio-announcement-list"].includes(inspect.slice(0, separator))
      ? { scope: inspect.slice(0, separator), id: inspect.slice(separator + 1) } : null;
  });
  useEffect(() => {
    const onInspector = (event: Event) => {
      const selection = (event as CustomEvent<{ scope: string; id: string | null }>).detail;
      if (selection && ["studio-form", "form-submission", "studio-application", "studio-announcement", "studio-announcement-new", "studio-announcement-list"].includes(selection.scope)) {
        setStudioResource(selection.id ? { scope: selection.scope, id: selection.id } : null);
      }
    };
    window.addEventListener("cluster:inspector-state-changed", onInspector);
    return () => window.removeEventListener("cluster:inspector-state-changed", onInspector);
  }, []);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const studioSaveGateRef = useRef<{ ownerId: string } | null>(null);
  const studioSaveOwnerRef = useRef(currentUser.id);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const validStudioSection = (value: unknown): StudioSettingsSection =>
    value === "people" ? "customFields" : STUDIO_SETTINGS_GROUPS.some((group) => group.sections.includes(value as StudioSettingsSection))
      ? value as StudioSettingsSection : "identity";
  const [section, setSection] = useState<StudioSettingsSection>(() => validStudioSection(initialSection));
  useEffect(() => { const selected = validStudioSection(initialSection); setSection((current: StudioSettingsSection) => current === selected ? current : selected); }, [initialSection]);
  useEffect(() => { onSectionChange?.(section); }, [section]);
  const [newBundleLabel, setNewBundleLabel] = useState("");
  const [selectedBundleId, setSelectedBundleId] = useState("");
  const [bundlePreview, setBundlePreview] = useState<(ClusterEffectiveAccessPreview & { requestKey: string }) | null>(null);
  const [bundlePreviewError, setBundlePreviewError] = useState("");
  const [bundlePreviewLoading, setBundlePreviewLoading] = useState(false);
  const permissionPreviewSequence = useRef(0);
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleDepartmentId, setNewRoleDepartmentId] = useState("development");
  const [newRoleTemplateKey, setNewRoleTemplateKey] = useState("member");
  const [newDepartmentLabel, setNewDepartmentLabel] = useState("");
  const [newDepartmentTeam, setNewDepartmentTeam] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("member");
  const [homeRecommendationRoleId, setHomeRecommendationRoleId] = useState("member");
  const [homeRecommendationDepartmentId, setHomeRecommendationDepartmentId] = useState("studio");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("studio");
  const [roleEditorTab, setRoleEditorTab] = useState<"details" | "permissions" | "actions">("details");
  const [departmentEditorTab, setDepartmentEditorTab] = useState<"details" | "permissions" | "roles">("details");
  const [departmentCreationOpen, setDepartmentCreationOpen] = useState(false);
  const [roleCreationOpen, setRoleCreationOpen] = useState(false);
  const [roleDirectorySearch, setRoleDirectorySearch] = useState("");
  const [roleDirectoryFilter, setRoleDirectoryFilter] = useState<RoleDirectoryFilter>("all");
  const [roleMemberCounts, setRoleMemberCounts] = useState<Record<string, number> | null>(null);
  const [roleMemberCountsError, setRoleMemberCountsError] = useState("");
  const [roleMemberSnapshot, setRoleMemberSnapshot] = useState<RoleMemberSnapshot | null>(null);
  const [roleMemberReviewLoading, setRoleMemberReviewLoading] = useState(false);
  const [roleMemberReviewError, setRoleMemberReviewError] = useState("");
  const roleMemberReviewSequence = useRef(0);
  useEffect(() => {
    // Never carry a private member list between roles or signed-in editors.
    roleMemberReviewSequence.current += 1;
    setRoleMemberSnapshot(null);
    setRoleMemberReviewLoading(false);
    setRoleMemberReviewError("");
  }, [currentUser.id, selectedRoleId, section]);
  useEffect(() => {
    if (section !== "roles" || !currentUser.isAdmin) return;
    let cancelled = false;
    setRoleMemberCounts(null);
    setRoleMemberCountsError("");
    void queryApi<{ roles: Array<{ id: string; members: number }> }>("/api/admin/users/assignable-roles", {
      staleMs: 15_000, maxAgeMs: 60_000, persist: false, tags: ["roles", "users", "people"],
    }).then(({ roles }) => {
      if (!cancelled) setRoleMemberCounts(Object.fromEntries(roles.map((role) => [role.id, role.members])));
    }).catch((error: unknown) => {
      if (!cancelled) setRoleMemberCountsError(error instanceof Error ? error.message : "Member counts unavailable.");
    });
    return () => { cancelled = true; };
  }, [section, currentUser.id, currentUser.isAdmin]);
  const [workforceDepartmentRows, setWorkforceDepartmentRows] = useState<Array<{ id: string; name: string; color?: string | null; iconId?: string | null }>>([]);
  useEffect(() => { setWorkforceDepartmentRows([]); }, [currentUser.id]);
  const workforceDepartmentById = useMemo(() => new Map(workforceDepartmentRows.map((department) => [department.id, department])), [workforceDepartmentRows]);

  const [selectedProjectTypeId, setSelectedProjectTypeId] = useState("");
  const studioDraftTimer = useRef<number | null>(null);
  const studioDraftKey = `studio-settings:${currentUser.id}`;
  const projectTypePresets = useMemo(() => projectTypePresetsFromSettings(settings), [settings.projectTypePresets]);
  function persistStudioDraft(nextSettings: Settings, nextSection = section) {
    if (studioDraftTimer.current) window.clearTimeout(studioDraftTimer.current);
    const baseSignature = studioSettingsBaseDigestRef.current; // Capture at edit time, not after a later reload.
    studioDraftTimer.current = window.setTimeout(() => {
      void saveOfflineDraft(studioDraftKey, { settings: nextSettings, section: nextSection, baseSignature }).catch(() => {
        if (studioSaveOwnerRef.current === currentUser.id) setStatus("Automatic Studio draft save failed. Keep the settings editor open until your changes can be saved.");
      });
    }, 220);
  }
  useEffect(() => {
    studioSaveOwnerRef.current = currentUser.id;
    if (studioSaveGateRef.current?.ownerId !== currentUser.id) {
      studioSaveGateRef.current = null;
      setSaving(false);
    }
  }, [currentUser.id]);
  useEffect(() => () => {
    if (studioDraftTimer.current !== null) window.clearTimeout(studioDraftTimer.current);
    studioDraftTimer.current = null;
  }, [currentUser.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    studioSettingsBaseDigestRef.current = null;
    setHeldStudioDraft(null);
    setLoadError(null);
    queryApi<Settings>("/api/settings", { staleMs: 30_000, signal: controller.signal, force: loadAttempt > 0, persist: false })
      .then(async (loaded) => {
        const merged: Settings = {
          appDisplayName: "Cluster",
          studioPrimaryColor: "#57c1ff",
          studioSecondaryColor: "#8ae7ff",
          studioName: "Studio",
          organizationLogoUrl: "",
          workspaceName: "Cluster Workspace",
          studioTimezone: "America/New_York",
          studioWorkingDaysCsv: "Mon, Tue, Wed, Thu, Fri",
          studioWorkdayStart: "09:00",
          studioWorkdayEnd: "17:00",
          studioExternalProjectOwnerRequired: true,
          studioExternalOwnerFieldLabel: "External project owner",
          studioProjectCodePrefix: "CLST",
          studioDefaultMilestoneCadence: "biweekly",
          studioStatusReportCadence: "weekly",
          tagPresetCsv: "bug, feature, polish, art, design, audio, ui, backend, docs, question",
          defaultCardPriority: "medium",
          defaultCardLabels: "",
          defaultProjectTypeId: "general",
          defaultProjectStatus: "active",
          defaultProjectSource: "internal",
          defaultProjectVisibility: "studio",
          defaultCreateStarterBoard: true,
          defaultCreateStarterWhiteboard: true,
          defaultCreateStarterLibrary: true,
          defaultBuildProfileKey: "generic",
          defaultProjectBoardNameMode: "type",
          studioReleaseChannel: "internal",
          studioVersioningScheme: "semver",
          studioBuildRetentionDays: 30,
          studioArtifactNamingPattern: "{project}-{version}-{platform}",
          studioQaRequired: true,
          studioApprovalRequired: true,
          studioQaGateMode: "blocking",
          studioBugSeverityDefault: "medium",
          studioExternalReviewLabel: "external-review",
          studioArchiveAfterDays: 180,
          studioRiskThreshold: "medium",
          studioLibraryRootName: "Studio Library",
          studioDefaultLicense: "Internal use",
          studioTemplatePolicy: "recommended",
          studioRolePermissionMode: "role-based",
          studioDefaultWorkspaceRole: "member",
          studioDefaultDepartmentId: "studio",
          studioDepartmentRequired: true,
          studioDepartmentCapacityMode: "advisory",
          studioProjectCreateRolesCsv: DEFAULT_ROLE_CREATE_ROLES.join(", "),
          studioBuildApprovalRolesCsv: DEFAULT_ROLE_APPROVAL_ROLES.join(", "),
          studioQaApprovalRolesCsv: DEFAULT_ROLE_APPROVAL_ROLES.join(", "),
          studioAdminRolesCsv: "owner, admin",
          studioExternalAccessDefault: "viewer",
          desktopKioskProfiles: DEFAULT_CLUSTER_KIOSK_PROFILES.map((profile) => ({ ...profile, allowedScreens: [...profile.allowedScreens], publicCards: [...profile.publicCards] })),
          desktopKioskSignedInProfileId: "staff",
          desktopKioskSignedOutProfileId: "guest",
          studioHomeRequiredWidgetsCsv: "",
          studioHomeUnavailableWidgetsCsv: "",
          studioHomeRecommendedWidgetsCsv: "brief, roleFocus, scheduler, inbox, upcoming, projects, builds, people, activity, clock, quickCapture",
          studioCreateProjectFieldsCsv: DEFAULT_CREATE_PROJECT_FIELDS.join(", "),
          studioCreateBuildFieldsCsv: DEFAULT_CREATE_BUILD_FIELDS.join(", "),
          studioCreateRequiredFieldsCsv: "name, project type, project, version",
          studioCreateConditionalFieldsCsv: "external project: external project owner",
          studioBuildStatusesCsv: DEFAULT_BUILD_STATUSES.join(", "),
          studioBuildNumberPattern: "{project}-{date}-{count}",
          studioBuildChecklistCsv: "Branch selected, Version set, Artifact attached, Release notes written, QA target chosen",
          studioBuildFailurePolicy: "auto-ticket",
          studioArtifactStoragePolicy: "hybrid",
          studioCiProvider: "none",
          studioQaChecklistCsv: DEFAULT_QA_CHECKLIST.join(", "),
          studioQaSeverityLevelsCsv: DEFAULT_QA_SEVERITIES.join(", "),
          studioQaBugCategoriesCsv: DEFAULT_QA_CATEGORIES.join(", "),
          studioQaRequiredPasses: 1,
          studioQaTestMatrixCsv: "Windows, Linux, Server, Client, Multiplayer, Install",
          studioQaKnownIssuePolicy: "requires-waiver",
          studioIntegrationPolicy: "suggested",
          studioWebhookEventsCsv: DEFAULT_WEBHOOK_EVENTS.join(", "),
          studioGitSyncDirection: "import-only",
          studioDiscordNotifyEventsCsv: "build.failed, qa.failed, release.approved",
          studioCurseForgePublishingMode: "checklist",
          studioDataBackupMode: "scheduled",
          studioBackupStartDate: new Date().toISOString().slice(0, 10),
          studioBackupTime: "03:00",
          studioBackupFrequency: "daily",
          studioBackupScheduleDaysCsv: "Mon, Tue, Wed, Thu, Fri",
          studioBackupScheduleRule: "Run local backup job into data/backups using retention policy",
          studioBackupTimezone: "America/New_York",
          studioDeletedRetentionDays: 30,
          studioExportBundlePolicy: "project-assets",
          studioAuditLogRetentionDays: 180,
          notifyWhiteboardUpdates: false,
          whiteboardAutosaveSeconds: 20,
          whiteboardDefaultWidth: 1800,
          whiteboardDefaultHeight: 950,
          ...loaded,
          studioDepartmentDefinitions: mergeStudioDepartments(loaded.studioDepartmentDefinitions),
          studioRoleDefinitions: mergeStudioRoles(loaded),
          projectTypePresets: mergeProjectTypePresets(loaded.projectTypePresets),
        };
        const recoveredDraft = await readOfflineDraft<{ settings?: Settings; section?: StudioSettingsSection; baseSignature?: string }>(studioDraftKey);
        const pendingConflictDraft = conflictDraftRef.current;
        const currentBaseSignature = await studioSettingsDraftBaseline(loaded);
        const draftAuthority = decideDraftRecovery(Boolean(recoveredDraft), recoveredDraft?.value?.baseSignature, currentBaseSignature || "");
        const trustedDraft = draftAuthority === "matching" ? recoveredDraft?.value : null;
        const recoveredSettings = pendingConflictDraft || trustedDraft?.settings;
        const effectiveSettings = recoveredSettings
          ? {
              ...merged,
              ...recoveredSettings,
              studioDepartmentDefinitions: mergeStudioDepartments(recoveredSettings.studioDepartmentDefinitions || merged.studioDepartmentDefinitions),
              studioRoleDefinitions: mergeStudioRoles({ ...merged, ...recoveredSettings }),
              projectTypePresets: mergeProjectTypePresets(recoveredSettings.projectTypePresets || merged.projectTypePresets),
            }
          : merged;
        if (controller.signal.aborted) return;
        conflictDraftRef.current = null;
        loadedRawSettingsRef.current = loaded;
        studioSettingsBaseDigestRef.current = currentBaseSignature;
        loadedSettingsRef.current = merged;
        setHeldStudioDraft(!pendingConflictDraft && draftAuthority === "older-or-unverified" ? recoveredDraft?.value || null : null);
        setSettings(effectiveSettings);
        if (!initialSection && trustedDraft?.section) setSection(validStudioSection(trustedDraft.section));
        setDirty(Boolean(pendingConflictDraft || trustedDraft));
        setSaveError(null);
        if (pendingConflictDraft) {
          persistStudioDraft(effectiveSettings);
          setStatus("Current server settings loaded. Review your retained edits before saving again.");
        } else if (trustedDraft) setStatus("Recovered an unsaved Studio Settings draft from the current server revision.");
        else if (draftAuthority === "older-or-unverified") setStatus("A saved Studio Settings draft is based on older or unverified server settings. It was not applied; review or discard it below.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt, currentUser.id]);
  useUnsavedChangesGuard({
    dirty,
    title: "Discard unsaved studio settings?",
    message: "You have unsaved Studio Settings changes. Leave this work and discard them?",
  });
  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDirty(true);
    if (["studioPermissionBundles", "studioRoleDefinitions", "studioDepartmentDefinitions"].includes(String(key))) {
      permissionPreviewSequence.current += 1;
      setBundlePreview(null);
      setBundlePreviewError("");
      setBundlePreviewLoading(false);
    }
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persistStudioDraft(next);
      return next;
    });
  }
  function toggleHomeWidgetPolicy(field: "studioHomeRequiredWidgetsCsv" | "studioHomeUnavailableWidgetsCsv" | "studioHomeRecommendedWidgetsCsv", widgetKey: DashboardWidgetKey, enabled: boolean) {
    const next = new Set(parseHomeWidgetKeyCsv(settings[field]));
    if (enabled) next.add(widgetKey); else next.delete(widgetKey);
    const updates: Partial<Settings> = { [field]: Array.from(next).join(", ") };
    if (field === "studioHomeRequiredWidgetsCsv" && enabled) {
      updates.studioHomeUnavailableWidgetsCsv = parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv).filter((key) => key !== widgetKey).join(", ");
    }
    if (field === "studioHomeUnavailableWidgetsCsv" && enabled) {
      updates.studioHomeRequiredWidgetsCsv = parseHomeWidgetKeyCsv(settings.studioHomeRequiredWidgetsCsv).filter((key) => key !== widgetKey).join(", ");
      updates.studioHomeRecommendedWidgetsCsv = parseHomeWidgetKeyCsv(settings.studioHomeRecommendedWidgetsCsv).filter((key) => key !== widgetKey).join(", ");
      updates.studioRoleDefinitions = mergeStudioRoles(settings).map((role) => ({ ...role, homeRecommendedWidgetsCsv: parseHomeWidgetKeyCsv(role.homeRecommendedWidgetsCsv).filter((key) => key !== widgetKey).join(", ") }));
      updates.studioDepartmentDefinitions = mergeStudioDepartments(settings.studioDepartmentDefinitions).map((department) => ({ ...department, homeRecommendedWidgetsCsv: parseHomeWidgetKeyCsv(department.homeRecommendedWidgetsCsv).filter((key) => key !== widgetKey).join(", ") }));
    }
    setDirty(true);
    if (["studioPermissionBundles", "studioRoleDefinitions", "studioDepartmentDefinitions"].includes(String(field))) {
      permissionPreviewSequence.current += 1;
      setBundlePreview(null);
      setBundlePreviewError("");
      setBundlePreviewLoading(false);
    }
    setSettings((prev) => { const merged = { ...prev, ...updates }; persistStudioDraft(merged); return merged; });
  }
  function toggleRoleHomeRecommendation(roleId: string, widgetKey: DashboardWidgetKey, enabled: boolean) {
    const role = mergeStudioRoles(settings).find((item) => item.id === roleId);
    if (!role) return;
    const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
    if (enabled && unavailable.has(widgetKey)) return;
    const next = new Set(parseHomeWidgetKeyCsv(role.homeRecommendedWidgetsCsv));
    if (enabled) next.add(widgetKey); else next.delete(widgetKey);
    updateStudioRole(role.id, { homeRecommendedWidgetsCsv: Array.from(next).join(", ") });
  }
  function toggleDepartmentHomeRecommendation(departmentId: string, widgetKey: DashboardWidgetKey, enabled: boolean) {
    const department = mergeStudioDepartments(settings.studioDepartmentDefinitions).find((item) => item.id === departmentId);
    if (!department) return;
    const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
    if (enabled && unavailable.has(widgetKey)) return;
    const next = new Set(parseHomeWidgetKeyCsv(department.homeRecommendedWidgetsCsv));
    if (enabled) next.add(widgetKey); else next.delete(widgetKey);
    updateStudioDepartment(department.id, { homeRecommendedWidgetsCsv: Array.from(next).join(", ") });
  }
  async function uploadStudioLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setStatus("Choose a PNG, JPG, WEBP, or GIF logo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus("Studio logos must be 5 MB or smaller.");
      return;
    }
    setLogoUploading(true);
    setStatus(`Uploading ${file.name}...`);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await api<{ logoUrl: string }>("/api/admin/branding/logo", {
        method: "POST",
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl,
        }),
      });
      patch("organizationLogoUrl", result.logoUrl);
      setStatus("Logo uploaded. Save Studio Settings to publish it.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Logo upload failed.");
    } finally {
      setLogoUploading(false);
    }
  }
  function setRoleList(key: "studioProjectCreateRolesCsv" | "studioBuildApprovalRolesCsv" | "studioQaApprovalRolesCsv" | "studioAdminRolesCsv", roleId: string, enabled: boolean) {
    const current = splitCsv(settings[key]);
    const next = enabled ? unique([...current, roleId]) : current.filter((item) => normalizeRoleId(item) !== roleId);
    patch(key, rolesCsvFromIds(next));
  }
  function roleIsSelected(key: "studioProjectCreateRolesCsv" | "studioBuildApprovalRolesCsv" | "studioQaApprovalRolesCsv" | "studioAdminRolesCsv", roleId: string) {
    return splitCsv(settings[key]).map(normalizeRoleId).includes(roleId);
  }
  function createPermissionBundle() {
    const label = newBundleLabel.trim();
    if (!label) return;
    const key = `bundle_${studioSlug(label, "new")}`;
    if ((settings.studioPermissionBundles || []).some((bundle) => bundle.id === key)) {
      setStatus("A permission bundle with that ID already exists. Choose another name.");
      return;
    }
    patch("studioPermissionBundles", [...(settings.studioPermissionBundles || []), { id: key, label, revision: 1, enabled: true, toolPermissions: {} }]);
    setSelectedBundleId(key);
    setNewBundleLabel("");
  }
  function updatePermissionBundle(id: string, updates: Partial<ClusterPermissionBundle>) {
    const published = (loadedRawSettingsRef.current.studioPermissionBundles || []).find((item) => item.id === id);
    const next = (settings.studioPermissionBundles || []).map((bundle) => {
      if (bundle.id !== id) return bundle;
      const changed = { ...bundle, ...updates };
      // Edits to the same unpublished draft share a single revision. Returning
      // to the published values removes the unnecessary revision bump.
      const signature = (value: ClusterPermissionBundle) => JSON.stringify({
        label: value.label.trim(), description: value.description || "", enabled: value.enabled !== false,
        permissions: Object.entries(value.toolPermissions).sort(([a], [b]) => a.localeCompare(b)),
      });
      return { ...changed, revision: published ? published.revision + (signature(changed) === signature(published) ? 0 : 1) : 1 };
    });
    patch("studioPermissionBundles", next);
    setBundlePreview(null);
  }
  function updatePermissionBundleTool(id: string, tool: ToolPermissionKey, level: ToolPermissionLevel | "inherit") {
    const bundle = (settings.studioPermissionBundles || []).find((item) => item.id === id);
    if (!bundle) return;
    const next = { ...bundle.toolPermissions };
    if (level === "inherit") delete next[tool];
    else next[tool] = level;
    updatePermissionBundle(id, { toolPermissions: next });
  }
  function assignBundle(kind: "role" | "department", subjectId: string, bundleId: string, enabled: boolean) {
    const subject = kind === "role" ? mergeStudioRoles(settings).find((item) => item.id === subjectId) : mergeStudioDepartments(settings.studioDepartmentDefinitions).find((item) => item.id === subjectId);
    if (!subject) return;
    const current = subject.permissionBundleIds || [];
    const permissionBundleIds = enabled ? unique([...current, bundleId]) : current.filter((item) => item !== bundleId);
    if (kind === "role") updateStudioRole(subjectId, { permissionBundleIds });
    else updateStudioDepartment(subjectId, { permissionBundleIds });
    setBundlePreview(null);
  }
  function addProjectBundlePolicy() {
    const projectId = projectBundleTarget.trim();
    if (!projectId || projectId.length > 128 || (settings.studioProjectBundlePolicies || []).some((policy) => policy.projectId === projectId)) {
      setStatus("Enter an unassigned Project ID (up to 128 characters).");
      return;
    }
    patch("studioProjectBundlePolicies", [...(settings.studioProjectBundlePolicies || []), { projectId, permissionBundleIds: [] }]);
    setProjectBundleTarget("");
  }
  function assignProjectBundle(projectId: string, bundleId: string, enabled: boolean) {
    patch("studioProjectBundlePolicies", (settings.studioProjectBundlePolicies || []).map((policy) => policy.projectId === projectId
      ? { ...policy, permissionBundleIds: enabled ? unique([...policy.permissionBundleIds, bundleId]) : policy.permissionBundleIds.filter((item) => item !== bundleId) }
      : policy));
  }

  async function previewPermissionBundleChanges(roleId: string, departmentId: string | null) {
    setBundlePreview(null);
    setBundlePreviewError("");
    setBundlePreviewLoading(true);
    const sequence = ++permissionPreviewSequence.current;
    const requestBody = {
      roleId,
      departmentId,
      studioPermissionBundles: settings.studioPermissionBundles || [],
      studioRoleDefinitions: mergeStudioRoles(settings),
      studioDepartmentDefinitions: mergeStudioDepartments(settings.studioDepartmentDefinitions),
    };
    const requestKey = JSON.stringify(requestBody);
    try {
      const result = await api<ClusterEffectiveAccessPreview>("/api/access/permission-preview", {
        method: "POST",
        body: requestKey,
      });
      if (!result.ok || result.roleId !== roleId || result.departmentId !== departmentId || !result.matrix || !Array.isArray(result.changes)) {
        throw new Error("The server returned an incomplete or mismatched role-policy preview.");
      }
      if (permissionPreviewSequence.current === sequence) setBundlePreview({ ...result, requestKey });
    } catch (error) {
      if (permissionPreviewSequence.current === sequence) setBundlePreviewError(error instanceof Error ? error.message : "Could not preview access policy.");
    } finally {
      if (permissionPreviewSequence.current === sequence) setBundlePreviewLoading(false);
    }
  }
  function setDepartmentRoleList(key: "studioProjectCreateRolesCsv" | "studioBuildApprovalRolesCsv" | "studioQaApprovalRolesCsv" | "studioAdminRolesCsv", departmentId: string, enabled: boolean) {
    const departmentRoleIds = mergeStudioRoles(settings)
      .filter((role) => role.enabled !== false && role.departmentId === departmentId)
      .map((role) => role.id);
    const current = splitCsv(settings[key]).map(normalizeRoleId);
    const next = enabled ? unique([...current, ...departmentRoleIds]) : current.filter((roleId) => !departmentRoleIds.includes(roleId));
    patch(key, rolesCsvFromIds(next));
  }
  function departmentRoleListIsSelected(key: "studioProjectCreateRolesCsv" | "studioBuildApprovalRolesCsv" | "studioQaApprovalRolesCsv" | "studioAdminRolesCsv", departmentId: string) {
    const departmentRoleIds = mergeStudioRoles(settings)
      .filter((role) => role.enabled !== false && role.departmentId === departmentId)
      .map((role) => role.id);
    return departmentRoleIds.length > 0 && departmentRoleIds.every((roleId) => roleIsSelected(key, roleId));
  }
  function updateStudioRole(id: string, patchRole: Partial<StudioRoleDefinition>) {
    const next = mergeStudioRoles(settings).map((role) =>
      role.id === id
        ? {
            ...role,
            ...patchRole,
            id,
            label: patchRole.label !== undefined ? patchRole.label.trim() || role.label : role.label,
          }
        : role,
    );
    patch("studioRoleDefinitions", next);
  }
  function updateStudioRolePermission(id: string, tool: ToolPermissionKey, level: ToolPermissionLevel | "inherit") {
    const role = mergeStudioRoles(settings).find((item) => item.id === id);
    if (!role) return;
    const nextPermissions = { ...(role.toolPermissions || {}) };
    if (level === "inherit") delete nextPermissions[tool];
    else nextPermissions[tool] = level;
    updateStudioRole(id, { toolPermissions: nextPermissions });
  }
  async function loadRoleMembers(roleId: string) {
    if (!currentUser.isAdmin || section !== "roles") return;
    const ownerId = currentUser.id;
    const sequence = ++roleMemberReviewSequence.current;
    setRoleMemberSnapshot(null);
    setRoleMemberReviewError("");
    setRoleMemberReviewLoading(true);
    try {
      const page = await queryApi<{ items: RoleMemberSnapshot["items"]; hasMore: boolean }>(
        `/api/users?role=${encodeURIComponent(roleId)}&paged=true&limit=25&includeArchived=true`,
        { force: true, staleMs: 0, persist: false, tags: ["people", "roles", "users"] },
      );
      if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
        throw new Error("The server returned an incomplete role membership response.");
      }
      if (roleMemberReviewSequence.current === sequence) {
        setRoleMemberSnapshot({ roleId, ownerId, items: page.items, hasMore: page.hasMore });
      }
    } catch (cause) {
      if (roleMemberReviewSequence.current === sequence) {
        setRoleMemberReviewError(cause instanceof Error ? cause.message : "Role membership review is unavailable.");
      }
    } finally {
      if (roleMemberReviewSequence.current === sequence) setRoleMemberReviewLoading(false);
    }
  }

  async function roleHasAssignments(id: string): Promise<boolean> {
    // A role definition is a permission policy, not a user record. Never
    // delete or disable it while stored membership roles still reference it.
    const page = await queryApi<{ items: Array<{ id: string }> }>(
      `/api/users?role=${encodeURIComponent(id)}&paged=true&limit=1&includeArchived=true`,
      { force: true, staleMs: 0, persist: false },
    );
    return page.items.length > 0;
  }
  async function setStudioRoleEnabled(id: string, enabled: boolean) {
    if (enabled) { updateStudioRole(id, { enabled: true }); return; }
    try {
      if (await roleHasAssignments(id)) {
        setStatus("This role is still assigned to users. Reassign them before disabling it.");
        return;
      }
      updateStudioRole(id, { enabled: false });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not verify role assignments.");
    }
  }
  function addStudioRole() {
    const label = newRoleLabel.trim();
    if (!label) return;
    const id = normalizeRoleId(label);
    const roles = mergeStudioRoles(settings);
    if (roles.some((role) => role.id === id)) {
      setStatus(`Role already exists: ${label}`);
      return;
    }
    const next = [
      ...roles,
      {
        id,
        label,
        departmentId: newRoleDepartmentId || "studio",
        permissionTemplateKey: newRoleTemplateKey || "member",
        defaultTitle: label,
        enabled: true,
        locked: false,
      },
    ];
    patch("studioRoleDefinitions", next);
    setNewRoleLabel("");
    setRoleCreationOpen(false);
    setSelectedRoleId(id);
    setRoleEditorTab("details");
    setStatus(`Added editable role: ${label}`);
  }
  async function removeStudioRole(id: string) {
    const roles = mergeStudioRoles(settings);
    const target = roles.find((role) => role.id === id);
    if (!target) return;
    try {
      if (await roleHasAssignments(id)) {
        setStatus("This role is assigned to users. Reassign members before changing its availability.");
        return;
      }
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not verify role assignments.");
      return;
    }
    if (target.locked) {
      updateStudioRole(id, { enabled: false });
      setStatus("Built-in role disabled. The role key remains reserved.");
      return;
    }
    if (!(await confirmCluster({
      title: `Remove role ${target.label}?`,
      message: "This unassigned role's permission definition will be removed. This cannot be undone after saving Studio Settings.",
      confirmLabel: "Remove role",
      tone: "danger",
    }))) return;
    patch("studioRoleDefinitions", roles.filter((role) => role.id !== id));
    (["studioProjectCreateRolesCsv", "studioBuildApprovalRolesCsv", "studioQaApprovalRolesCsv", "studioAdminRolesCsv"] as const).forEach((key) => {
      const next = splitCsv(settings[key]).filter((item) => normalizeRoleId(item) !== id);
      patch(key, rolesCsvFromIds(next));
    });
    if (settings.studioDefaultWorkspaceRole === id) patch("studioDefaultWorkspaceRole", "member");
    patch("studioDepartmentDefinitions", mergeStudioDepartments(settings.studioDepartmentDefinitions).map((department) =>
      department.leadRoleId === id ? { ...department, leadRoleId: undefined } : department,
    ));
    patch("projectTypePresets", projectTypePresets.map((preset) => ({
      ...preset, approvalRoles: (preset.approvalRoles || []).filter((roleId) => normalizeRoleId(roleId) !== id),
    })));
    setSelectedRoleId("member");
    setStatus(`Removed unassigned role definition ${target.label} and its policy references from the draft.`);
  }
  function updateStudioDepartment(id: string, patchDepartment: Partial<StudioDepartmentDefinition>) {
    const next = mergeStudioDepartments(settings.studioDepartmentDefinitions).map((department) => (department.id === id ? { ...department, ...patchDepartment, id } : department));
    patch("studioDepartmentDefinitions", next);
  }
  function updateStudioDepartmentPermission(id: string, tool: ToolPermissionKey, level: ToolPermissionLevel | "inherit") {
    const department = mergeStudioDepartments(settings.studioDepartmentDefinitions).find((item) => item.id === id);
    if (!department) return;
    const nextPermissions = { ...(department.toolPermissions || {}) };
    if (level === "inherit") delete nextPermissions[tool];
    else nextPermissions[tool] = level;
    updateStudioDepartment(id, { toolPermissions: nextPermissions });
  }
  function addStudioDepartment() {
    const label = newDepartmentLabel.trim();
    if (!label) return;
    const id = studioSlug(label, "department");
    const departments = mergeStudioDepartments(settings.studioDepartmentDefinitions);
    if (departments.some((department) => department.id === id)) {
      setStatus(`Department already exists: ${label}`);
      return;
    }
    patch("studioDepartmentDefinitions", [
      ...departments,
      {
        id,
        label,
        defaultTeamName: newDepartmentTeam.trim() || label,
        capacityTargetHours: 36,
        permissionTemplateKey: "member",
        toolPermissions: {},
        enabled: true,
        locked: false,
      },
    ]);
    setNewDepartmentLabel("");
    setNewDepartmentTeam("");
    setDepartmentCreationOpen(false);
    setSelectedDepartmentId(id);
    setDepartmentEditorTab("details");
    setStatus(`Added department: ${label}`);
  }
  function removeStudioDepartment(id: string) {
    const departments = mergeStudioDepartments(settings.studioDepartmentDefinitions);
    const target = departments.find((department) => department.id === id);
    if (!target) return;
    if (target.locked) updateStudioDepartment(id, { enabled: false });
    else
      patch(
        "studioDepartmentDefinitions",
        departments.filter((department) => department.id !== id),
      );
    if (settings.studioDefaultDepartmentId === id) patch("studioDefaultDepartmentId", "studio");
  }
  function applyDepartmentDefaults(department: StudioDepartmentDefinition) {
    patch("studioDefaultDepartmentId", department.id);
    if (department.leadRoleId) patch("studioDefaultWorkspaceRole", department.leadRoleId);
    setStatus(`${department.label} is now the default department for new users and intake suggestions.`);
  }
  function updateProjectTypePreset(id: string, patchPreset: Partial<ProjectTypePreset>) {
    const next = projectTypePresets.map((preset) => (preset.id === id ? sanitizeProjectTypePreset({ ...preset, ...patchPreset }, preset) : preset));
    patch("projectTypePresets", next);
  }
  function addProjectTypePreset(baseKey = settings.defaultProjectTypeId || "general") {
    const base = projectTypePresets.find((preset) => preset.id === baseKey) || DEFAULT_PROJECT_TYPE_PRESETS[0];
    const id = `${base.id}_custom_${Date.now().toString(36)}`.slice(0, 48);
    const next = sanitizeProjectTypePreset(
      {
        ...base,
        id,
        label: `${base.label} copy`,
        locked: false,
        enabled: true,
      },
      base,
    );
    patch("projectTypePresets", [...projectTypePresets, next]);
    setSelectedProjectTypeId(next.id);
    setSection("projectTypes");
  }
  function removeProjectTypePreset(id: string) {
    const target = projectTypePresets.find((preset) => preset.id === id);
    if (!target) return;
    if (projectTypePresets.length <= 1) {
      setStatus("Keep at least one project type so project creation remains usable.");
      return;
    }
    const next = projectTypePresets.filter((preset) => preset.id !== id);
    patch("projectTypePresets", next);
    if (selectedProjectTypeId === id) setSelectedProjectTypeId(next[0]?.id || "");
    if (settings.defaultProjectTypeId === id) patch("defaultProjectTypeId", next[0]?.id || "general");
  }
  function addProjectTypeFromTemplate(templateId: string) {
    const template = CLUSTER_PROJECT_TYPE_TEMPLATES.find((item) => item.id === templateId);
    const base = template || CLUSTER_PROJECT_TYPE_TEMPLATES[0];
    const label = template ? template.label : "New project type";
    let id = slugProjectTypeId(template ? template.id : label);
    if (projectTypePresets.some((preset) => preset.id === id)) id = `${id}_${Date.now().toString(36)}`.slice(0, 48);
    const next = sanitizeProjectTypePreset({ ...base, id, label, note: template ? base.note : "", enabled: true, locked: false }, base);
    patch("projectTypePresets", [...projectTypePresets, next]);
    setSelectedProjectTypeId(next.id);
  }
  function projectTypeToolMode(preset: ProjectTypePreset, toolId: ClusterProjectToolId): "included" | "optional" | "hidden" {
    if ((preset.hiddenTools || []).includes(toolId)) return "hidden";
    if ((preset.optionalTools || []).includes(toolId)) return "optional";
    return (preset.defaultTools || []).includes(toolId) ? "included" : "hidden";
  }
  function setProjectTypeToolMode(preset: ProjectTypePreset, toolId: ClusterProjectToolId, mode: "included" | "optional" | "hidden") {
    const without = (items?: ClusterProjectToolId[]) => (items || []).filter((item) => item !== toolId);
    updateProjectTypePreset(preset.id, {
      defaultTools: mode === "included" ? [...without(preset.defaultTools), toolId] : without(preset.defaultTools),
      optionalTools: mode === "optional" ? [...without(preset.optionalTools), toolId] : without(preset.optionalTools),
      hiddenTools: mode === "hidden" ? [...without(preset.hiddenTools), toolId] : without(preset.hiddenTools),
    });
  }
  function toggleSpecializedProductionProfile(profileId: string) {
    const current = new Set<string>(settings.studioEnabledProductionProfileIds || []);
    if (current.has(profileId)) current.delete(profileId); else current.add(profileId);
    patch("studioEnabledProductionProfileIds", Array.from(current));
  }
  function reviewHeldStudioDraft() {
    if (!heldStudioDraft) return;
    const draft = heldStudioDraft.settings || {};
    const next: Settings = {
      ...settings, ...draft,
      studioDepartmentDefinitions: mergeStudioDepartments(draft.studioDepartmentDefinitions || settings.studioDepartmentDefinitions),
      studioRoleDefinitions: mergeStudioRoles({ ...settings, ...draft }),
      projectTypePresets: mergeProjectTypePresets(draft.projectTypePresets || settings.projectTypePresets),
    };
    setSettings(next);
    if (heldStudioDraft.section) setSection(validStudioSection(heldStudioDraft.section));
    setHeldStudioDraft(null);
    setDirty(true);
    persistStudioDraft(next); // Explicit review rebinds to the current server snapshot.
    setStatus("Older Studio draft loaded for review. Changes may override newer Studio values; inspect before saving with your PIN.");
  }
  async function discardHeldStudioDraft() {
    const warning = await reconcileAfterCommit(() => clearOfflineDraft(studioDraftKey));
    if (warning) { setStatus("Could not discard the stored Studio draft. It has not been applied."); return; }
    setHeldStudioDraft(null);
    setStatus("Stored Studio draft discarded. Current server settings are unchanged.");
  }
  async function save() {
    if (saving || studioSaveGateRef.current) return;
    const ticket = { ownerId: currentUser.id };
    studioSaveGateRef.current = ticket; // Admit before awaiting the PIN prompt.
    try {
      const pin = currentUser.pinConfigured
        ? await requestSecurityPin({
            title: "Apply Studio Settings",
            description: "Enter your security PIN to apply these changes.",
            purpose: "apply_studio_settings",
            confirmLabel: "Apply settings",
          })
        : await requestSecurityPinSetup({
            title: "Create security PIN",
            description: "Create a PIN before applying Studio Settings.",
            purpose: "setup_for_apply_studio_settings",
          });
      if (!pin || studioSaveOwnerRef.current !== ticket.ownerId) return;
      const nextSettings: Settings = { ...settings, projectTypePresets };
      const allowedNext = withoutServerManagedSettings(nextSettings);
      const original = withoutServerManagedSettings(loadedSettingsRef.current);
      const changedSettings: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(allowedNext)) {
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify((original as Record<string, unknown>)[key])) {
          changedSettings[key] = value;
        }
      }
      const rawLoaded = loadedRawSettingsRef.current as Record<string, unknown>;
      const expectedSettings = Object.fromEntries(Object.keys(changedSettings).map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(rawLoaded, key)
          ? { exists: true, value: rawLoaded[key] }
          : { exists: false },
      ]));
      setSaving(true);
      setSaveError(null);
      setStatus("Saving studio settings…");
      try {
        await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({
            ...changedSettings,
            expectedSettings,
            securityPin: pin,
          }),
        });
        if (studioSaveOwnerRef.current !== ticket.ownerId) return;
        loadedSettingsRef.current = nextSettings;
        loadedRawSettingsRef.current = { ...loadedRawSettingsRef.current, ...changedSettings } as Settings;
        studioSettingsBaseDigestRef.current = await studioSettingsDraftBaseline(loadedRawSettingsRef.current);
        setDirty(false);
        const presentationWarning = await reconcileAfterCommit(async () => {
          writeProjectTypePresetsCache(nextSettings.projectTypePresets);
          onSettingsSaved?.({ ...nextSettings, appDisplayName: "Cluster" });
        });
        if (studioDraftTimer.current !== null) window.clearTimeout(studioDraftTimer.current);
        studioDraftTimer.current = null;
        const cleanupWarning = await reconcileAfterCommit(() => clearOfflineDraft(studioDraftKey));
        setStatus([
          "Studio settings saved.",
          presentationWarning ? "Local UI update failed; reopen Studio Settings." : "",
          cleanupWarning ? "The previous local draft could not be cleared and may reappear when reopened." : "",
        ].filter(Boolean).join(" "));
      } catch (error) {
        if (studioSaveOwnerRef.current === ticket.ownerId) { setSaveError(error); setStatus(""); }
      } finally {
        if (studioSaveGateRef.current === ticket) setSaving(false);
      }
    } catch (error) {
      if (studioSaveOwnerRef.current === ticket.ownerId) {
        setSaveError(error);
        setStatus(error instanceof Error ? error.message : "Could not start the Studio settings save.");
      }
    } finally {
      if (studioSaveGateRef.current === ticket) studioSaveGateRef.current = null;
    }
  }
  function refreshAfterConflict() {
    // Preserve only fields the administrator changed; reapplying a complete old
    // snapshot after refresh would silently undo other administrators' edits.
    const allowedDraft = withoutServerManagedSettings({ ...settings, projectTypePresets });
    const previous = withoutServerManagedSettings(loadedSettingsRef.current);
    const overrides: Partial<Settings> = {};
    for (const [key, value] of Object.entries(allowedDraft)) {
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify((previous as Record<string, unknown>)[key])) {
        (overrides as Record<string, unknown>)[key] = value;
      }
    }
    conflictDraftRef.current = overrides;
    setLoading(true);
    setLoadAttempt((attempt) => attempt + 1);
  }
  const settingsConflict = saveError instanceof ApiError && saveError.code === "STUDIO_SETTINGS_CONFLICT";
  const defaultPreset = projectTypePresets.find((preset) => preset.id === (settings.defaultProjectTypeId || "general")) || projectTypePresets[0];
  const defaultBuildProfile = BUILD_PLATFORM_PROFILES.find((profile) => profile.key === (settings.defaultBuildProfileKey || defaultPreset?.buildProfileKey || "generic"));
  const studioDepartments = mergeStudioDepartments(settings.studioDepartmentDefinitions);
  const studioRoles = mergeStudioRoles(settings);
  const studioBundles = settings.studioPermissionBundles || [];
  const selectedBundle = studioBundles.find((bundle) => bundle.id === selectedBundleId) || studioBundles[0];
  const profileFieldDefinitions = settings.studioPeopleProfileFields || [];
  function addPeopleProfileField() {
    const index = profileFieldDefinitions.length + 1;
    patch("studioPeopleProfileFields", [...profileFieldDefinitions, { id: `profile_field_${index}`, label: `Profile field ${index}`, type: "text", required: false, visibility: "studio", options: [] }]);
  }
  function updatePeopleProfileField(id: string, updates: Partial<NonNullable<Settings["studioPeopleProfileFields"]>[number]>) { patch("studioPeopleProfileFields", profileFieldDefinitions.map((field) => field.id === id ? { ...field, ...updates } : field)); }
  function removePeopleProfileField(id: string) { patch("studioPeopleProfileFields", profileFieldDefinitions.filter((field) => field.id !== id)); }
  const enabledStudioRoles = studioRoles.filter((role) => role.enabled !== false);
  const enabledStudioDepartments = studioDepartments.filter((department) => department.enabled !== false);
  const defaultDepartment = enabledStudioDepartments.find((department) => department.id === settings.studioDefaultDepartmentId) || enabledStudioDepartments[0];
  const departmentRoleCoverage = enabledStudioDepartments.map((department) => ({
    ...department,
    roles: enabledStudioRoles.filter((role) => role.departmentId === department.id),
  }));
  const roleLabel = (id: string) => studioRoles.find((role) => role.id === normalizeRoleId(id))?.label || roleLabelFromId(normalizeRoleId(id));
  const selectedProjectTypePreset = projectTypePresets.find((preset) => preset.id === selectedProjectTypeId) || projectTypePresets[0];
  useEffect(() => {
    if (projectTypePresets.length && !projectTypePresets.some((preset) => preset.id === selectedProjectTypeId)) setSelectedProjectTypeId(projectTypePresets[0].id);
  }, [projectTypePresets, selectedProjectTypeId]);
  const enabledPresetCount = projectTypePresets.filter((preset) => preset.enabled !== false).length;
  const starterCount = [settings.defaultCreateStarterBoard, settings.defaultCreateStarterWhiteboard].filter((value) => value !== false).length;
  const roleDepartmentLabels = Object.fromEntries(studioDepartments.map((department) => [department.id, department.label]));
  const visibleStudioRoles = filterRoleDirectory(studioRoles, {
    search: roleDirectorySearch,
    filter: roleDirectoryFilter,
    departmentLabels: roleDepartmentLabels,
    memberCounts: roleMemberCounts,
  });
  const selectedRole = studioRoles.find((role) => role.id === selectedRoleId) || studioRoles[0];
  const selectedDepartment = studioDepartments.find((department) => department.id === selectedDepartmentId) || studioDepartments[0];
  const selectedDepartmentRoles = selectedDepartment ? studioRoles.filter((role) => role.departmentId === selectedDepartment.id) : [];
  const selectedRoleDepartment = selectedRole ? studioDepartments.find((department) => department.id === selectedRole.departmentId) : undefined;
  const selectedRolePreviewRequest = selectedRole ? {
    roleId: selectedRole.id,
    departmentId: selectedRole.departmentId || null,
    studioPermissionBundles: settings.studioPermissionBundles || [],
    studioRoleDefinitions: studioRoles,
    studioDepartmentDefinitions: studioDepartments,
  } : null;
  // Never show a previously authorized preview against a changed draft, role,
  // department or account. The backend remains the source of truth.
  const activeRolePreview = bundlePreview && selectedRolePreviewRequest
    && bundlePreview.roleId === selectedRole.id
    && bundlePreview.requestKey === JSON.stringify(selectedRolePreviewRequest)
      ? bundlePreview : null;
  const selectedDepartmentInheritedPermissions = selectedDepartment ? {
    ...permissionTemplateTools(selectedDepartment.permissionTemplateKey || "member"),
    ...Object.assign({}, ...resolveAssignedPermissionBundles(studioBundles, selectedDepartment.permissionBundleIds).map((bundle) => bundle.toolPermissions)),
  } : DEFAULT_MEMBER_TOOL_PERMISSIONS;
  const selectedRoleInheritedPermissions = selectedRole
    ? {
        ...departmentPermissionsFromSettings(settings, selectedRole.departmentId),
        ...permissionTemplateTools(selectedRole.permissionTemplateKey || "member"),
        ...Object.assign({}, ...resolveAssignedPermissionBundles(studioBundles, selectedRole.permissionBundleIds).map((bundle) => bundle.toolPermissions)),
      }
    : DEFAULT_MEMBER_TOOL_PERMISSIONS;
  const studioActionRules = STUDIO_ACTION_RULES;
  useEffect(() => {
    if (studioRoles.length && !studioRoles.some((role) => role.id === selectedRoleId)) setSelectedRoleId(studioRoles[0].id);
  }, [studioRoles, selectedRoleId]);
  useEffect(() => {
    if (studioDepartments.length && !studioDepartments.some((department) => department.id === selectedDepartmentId)) setSelectedDepartmentId(studioDepartments[0].id);
  }, [studioDepartments, selectedDepartmentId]);
  const studioSections = buildStudioSettingsSections({
    settings,
    isAdmin: Boolean(currentUser.isAdmin),
    profileFieldCount: profileFieldDefinitions.length,
    departmentCount: enabledStudioDepartments.length,
    roleCount: enabledStudioRoles.length,
    defaultPresetLabel: defaultPreset?.label || "Generic",
    projectTypePresetCount: projectTypePresets.length,
    projectCreationFieldCount: (settings.studioCreateProjectFieldsCsv || DEFAULT_CREATE_PROJECT_FIELDS.join(", ")).split(",").filter(Boolean).length,
    starterCount,
  });
  const enabledSpecializedProductionProfiles = new Set(settings.studioEnabledProductionProfileIds || []);
  const enabledSpecializedProfileDefinitions = CLUSTER_PRODUCTION_PROFILE_DEFINITIONS.filter((profile) => profile.classification === "specialized" && enabledSpecializedProductionProfiles.has(profile.id));
  const enabledSpecializedBuildProfileKeys = new Set(enabledSpecializedProfileDefinitions.map((profile) => profile.buildProfileKey));
  const availableBuildProfiles = BUILD_PLATFORM_PROFILES.filter((profile) => profile.key === "generic" || enabledSpecializedBuildProfileKeys.has(profile.key));
  const curseForgePublishingEnabled = enabledSpecializedProfileDefinitions.some((profile) => ["curseforge", "ark_mod", "ark_map", "minecraft_map", "minecraft_mod"].includes(profile.id));
  if (loading) return <SettingsLoadingState label="Loading studio settings" />;
  if (loadError) return (
    <section className="page settings-workspace-v298">
      <RequestErrorState error={loadError} title="Studio settings unavailable" onRetry={() => { setLoading(true); setLoadAttempt((current) => current + 1); }} />
    </section>
  );
  return (
    <SettingsWorkspaceShell
      className="settings-workspace-v298 settings-page-v092 studio-settings-page-v165 studio-settings-console-v271 settings-console-v269"
      title="Studio Settings"
      icon="settings"
      actions={
        <>
          {heldStudioDraft && <SettingsStateChip tone="warning" icon="note">Stored draft requires review</SettingsStateChip>}
          {dirty ? <SettingsStateChip tone="warning" icon="note">Unsaved studio changes</SettingsStateChip> : null}
          <ClusterButton type="button" variant={dirty ? "primary" : "secondary"} onClick={() => void save()} disabled={!dirty || saving} busy={saving} busyLabel="Saving…">
            <ClusterIcon name="check" aria-hidden="true" /> Save changes
          </ClusterButton>
        </>
      }
      status={status}
      navLabel="Studio settings sections"
      activeId={section}
      onChange={(value) => setSection(value as StudioSettingsSection)}
      items={STUDIO_SETTINGS_GROUPS.flatMap((group) => group.sections
        .filter((key) => currentUser.isAdmin || !["domains", "privacy", "kiosk", "studioSystems"].includes(key))
        .map((key) => ({ id: key, label: studioSettingsSectionLabel(key), icon: STUDIO_SETTINGS_NAV_ICONS[key], group: group.label })))}
      navTop={<ClusterSettingsSearch className="settings-compact-search-v12" label="Find studio settings" entries={buildStudioSettingsSearchEntries(studioSections)} onNavigate={(entry) => setSection(entry.section)} />}
    >
      {heldStudioDraft && <section className="settings-card-v092" role="alert" aria-label="Outdated Studio settings draft">
        <strong>Stored Studio draft needs review</strong>
        <p className="muted">This draft was saved before the current server Settings snapshot or has no trusted baseline. It was not applied automatically. Loading it may overwrite newer administrator changes if you save it.</p>
        <div className="button-row compact">
          <ClusterButton type="button" variant="secondary" onClick={reviewHeldStudioDraft} disabled={saving}>Load draft for review</ClusterButton>
          <ClusterButton type="button" variant="quiet" onClick={() => void discardHeldStudioDraft()} disabled={saving}>Discard stored draft</ClusterButton>
        </div>
      </section>}
      {saveError ? <RequestErrorState compact error={saveError} title="Studio settings were not saved"
        onRetry={settingsConflict ? undefined : () => void save()}
        onReload={settingsConflict ? refreshAfterConflict : undefined}
        reloadLabel="Refresh and review edits" /> : null}

      <div className="settings-primary-layout-v469 studio-settings-layout-v165">
        <div className="panel settings-content-v092 studio-settings-content-v165">
          {section === "domains" && currentUser.isAdmin && <StudioDomainsPanel />}
          {section === "identity" && (
            <div className="settings-section-v092">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Identity</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Workspace identity</h3>
                    <span>Shown in shared app chrome</span>
                  </div>
                  <div className="two-col compact-fields-v092 studio-identity-controls-v11">
                    <ClusterSettingsRow label="Studio / organization name" controlId="studio-name-field-v11">
                      <ClusterInput id="studio-name-field-v11" value={settings.studioName || ""} onChange={(e) => patch("studioName", e.target.value)} placeholder="Your studio" />
                    </ClusterSettingsRow>
                    <ClusterSettingsRow label="Workspace name" controlId="studio-workspace-field-v11">
                      <ClusterInput id="studio-workspace-field-v11" value={settings.workspaceName || ""} onChange={(e) => patch("workspaceName", e.target.value)} placeholder="Cluster Workspace" />
                    </ClusterSettingsRow>
                    <div className="field span-2">
                      <label>Organization logo</label>
                      <div className="studio-logo-controls-v239">
                        <ClusterFileButton
                          label="Upload studio image"
                          accept="image/png,.png,image/jpeg,image/webp,image/gif"
                          busy={logoUploading}
                          busyLabel="Uploading…"
                          onChange={uploadStudioLogo}
                        >Upload image</ClusterFileButton>
                        <ClusterButton variant="secondary" type="button" disabled={!settings.organizationLogoUrl} onClick={() => patch("organizationLogoUrl", "")}>
                          Remove
                        </ClusterButton>
                      </div>
                      <ClusterInput value={settings.organizationLogoUrl || ""} onChange={(e) => patch("organizationLogoUrl", e.target.value)} placeholder="Uploaded path or https://..." />
                    </div>
                    <ColorField
                      label="Studio primary color"
                      value={normalizeClusterAccent(settings.studioPrimaryColor, "#57c1ff")}
                      onChange={(value) => {
                        patch("studioPrimaryColor", value);
                        applyCustomization({ ...settings, studioPrimaryColor: value });
                      }}
                    />
                    <ColorField
                      label="Studio secondary color"
                      value={normalizeClusterAccent(settings.studioSecondaryColor, "#8ae7ff")}
                      onChange={(value) => {
                        patch("studioSecondaryColor", value);
                        applyCustomization({ ...settings, studioSecondaryColor: value });
                      }}
                    />
                    <ClusterSettingsRow label="Project code prefix" controlId="studio-code-prefix-field-v11" help="Used when generating new project codes. Existing project identities are not renamed.">
                      <ClusterInput id="studio-code-prefix-field-v11" value={settings.studioProjectCodePrefix || "CLST"} onChange={(e) => patch("studioProjectCodePrefix", e.target.value.toUpperCase())} placeholder="CLST" />
                    </ClusterSettingsRow>
                    <ClusterSettingsRow label="Studio timezone" controlId="studio-timezone-field-v11">
                      <ClusterTimezoneSelect ariaLabel="Studio timezone" value={settings.studioTimezone || "America/New_York"} onChange={(value) => patch("studioTimezone", value)} />
                    </ClusterSettingsRow>
                  </div>
                  <div className="logo-preview-card logo-preview-card-v092">
                    {settings.organizationLogoUrl ? <img loading="lazy" decoding="async" src={settings.organizationLogoUrl} alt="Organization logo preview" /> : <div className="logo-preview-empty">Logo</div>}
                    <div>
                      <strong>{settings.studioName || "Your organization"}</strong>
                      <span>{settings.workspaceName || "Cluster Workspace"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* The compliance centre hosted six panels built for public users;
              data retention is the one a self-hosted studio actually runs. */}
          {section === "privacy" && currentUser.isAdmin && <DataRetentionAdminPanel />}

          {section === "kiosk" && currentUser.isAdmin && <StudioKioskSettingsSection settings={settings} patch={patch} />}

          {section === "studioSystems" && currentUser.isAdmin && <StudioSystemsSettingsSection
            initialTab={initialSubsection} onTabChange={onSubsectionChange}
            targetFormId={studioResource?.scope === "studio-form" ? studioResource.id : null}
            targetSubmissionId={studioResource?.scope === "form-submission" ? studioResource.id : null}
            targetApplicationId={studioResource?.scope === "studio-application" ? studioResource.id : null}
            targetAnnouncementId={studioResource?.scope === "studio-announcement" ? studioResource.id : null}
            composeAnnouncement={studioResource?.scope === "studio-announcement-new"}
            showAnnouncements={studioResource?.scope === "studio-announcement-list"}
          />}

          {section === "departments" && (
            <div className="settings-section-v092 studio-settings-section-v272 studio-people-management-v11 studio-departments-management-v11">
              <div className="settings-panel-head-v092 studio-section-intro-v272">
                <div>
                  <p className="eyebrow">Organization</p>
                  <h2>Departments</h2>
                </div>
                <div className="studio-people-manager-head-actions-v11">
                  <span className="studio-section-count-v272">{enabledStudioDepartments.length} access templates</span>
                </div>
              </div>

              <WorkforceDepartmentManager key={currentUser.id} canEdit={Boolean(currentUser.isAdmin)} onRowsLoaded={setWorkforceDepartmentRows} />

              <details className="studio-advanced-access-v11 studio-department-templates-v11">
                <summary><strong>Department access templates & defaults</strong><span>Permission inheritance, role suggestions and onboarding policies</span></summary>
                <div className="studio-department-policy-actions-v11">
                  <span>These templates are permission policies, not separate organizational departments.</span>
                  <ClusterButton type="button" variant="secondary" size="compact" aria-expanded={departmentCreationOpen} onClick={() => setDepartmentCreationOpen((open) => !open)}>{departmentCreationOpen ? "Close template form" : "New access template"}</ClusterButton>
                </div>
              {departmentCreationOpen && (
              <div className="studio-create-strip-v272">
                <div><strong>New policy template</strong></div>
                <ClusterInput value={newDepartmentLabel} onChange={(event) => setNewDepartmentLabel(event.target.value)} placeholder="Department name" />
                <ClusterInput value={newDepartmentTeam} onChange={(event) => setNewDepartmentTeam(event.target.value)} placeholder="Default team name" />
                <ClusterButton type="button" variant="secondary" onClick={addStudioDepartment} disabled={!newDepartmentLabel.trim()}>Add template</ClusterButton>
              </div>
              )}
              <div className="studio-entity-manager-v272">
                <aside className="studio-entity-list-v272" aria-label="Department access templates">
                  <div className="studio-entity-list-head-v272">
                    <strong>Directory</strong>
                    <span>{studioDepartments.length}</span>
                  </div>
                  {departmentRoleCoverage.map((department) => (
                    <ClusterButton type="button" key={department.id} className={selectedDepartment?.id === department.id ? "active" : ""} onClick={() => { setSelectedDepartmentId(department.id); setDepartmentEditorTab("details"); }}>
                      <span className="studio-entity-icon-rc46" aria-hidden="true">{workforceDepartmentById.get(department.workforceDepartmentId || "")
                          ? <DepartmentIdentityMark department={workforceDepartmentById.get(department.workforceDepartmentId || "")!} size={24} />
                          : <ResourceIdentityMark iconId="glyph:users" label={department.label} accentColor="#81919b" />}</span>
                      <span className="studio-entity-list-copy-v272">
                        <strong>{department.label}</strong>
                        {department.defaultTeamName && <small>{department.defaultTeamName}</small>}
                      </span>
                      <span className="studio-entity-list-meta-v272">{department.roles.length} roles</span>
                    </ClusterButton>
                  ))}
                </aside>

                {selectedDepartment && (
                  <div className="studio-entity-editor-v272">
                    <header className="studio-entity-editor-head-v272">
                      <div className="studio-department-heading-rc46">
                        {workforceDepartmentById.get(selectedDepartment.workforceDepartmentId || "")
                          ? <DepartmentIdentityMark department={workforceDepartmentById.get(selectedDepartment.workforceDepartmentId || "")!} size={30} />
                          : <ResourceIdentityMark iconId="glyph:users" label={selectedDepartment.label} accentColor="#81919b" />}
                        <div><h3>{selectedDepartment.label}</h3>
                        {selectedDepartment.description && <p>{selectedDepartment.description}</p>}
                        </div>
                      </div>
                      <div className="button-row compact">
                        <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={selectedDepartment.enabled !== false} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { enabled: event.target.checked })} /> Enabled</label>
                        <ClusterButton type="button" size="compact" onClick={() => removeStudioDepartment(selectedDepartment.id)}>{selectedDepartment.locked ? "Disable" : "Remove"}</ClusterButton>
                      </div>
                    </header>

                    <ClusterSegmentedControl
                      value={departmentEditorTab}
                      onChange={setDepartmentEditorTab}
                      label="Department settings"
                      className="studio-editor-tabs-v272"
                      options={[
                        { value: "details", label: "Details" },
                        { value: "permissions", label: "Permissions" },
                        { value: "roles", label: "Roles & actions" },
                      ]}
                    />

                    {departmentEditorTab === "details" && (
                      <div className="studio-editor-panel-v272">
                        
                        <div className="studio-form-grid-v272">
                          <div className="field span-2"><div className="studio-department-template-note-v11">The linked Workforce Department owns its icon, color and organizational membership. This template controls access defaults, not the department's appearance.</div></div>
                          <div className="field span-2">
                            <label>Linked Workforce Department</label>
                            <ClusterNativeSelect value={selectedDepartment.workforceDepartmentId || ""} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { workforceDepartmentId: event.target.value || null })}>
                              <option value="">No link · policy template only</option>
                              {selectedDepartment.workforceDepartmentId && !workforceDepartmentById.has(selectedDepartment.workforceDepartmentId) && <option value={selectedDepartment.workforceDepartmentId} disabled>Unavailable or archived department</option>}
                              {workforceDepartmentRows.map((department) => <option key={department.id} value={department.id} disabled={studioDepartments.some((template) => template.id !== selectedDepartment.id && template.workforceDepartmentId === department.id)}>{department.name}</option>)}
                            </ClusterNativeSelect>
                            <small>Links by immutable department ID. A link does not grant permissions automatically; role policies still define access.</small>
                          </div>
                          
                          <div className="field"><label>Name</label><ClusterInput value={selectedDepartment.label} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { label: event.target.value })} /></div>
                          <div className="field"><label>Default team</label><ClusterInput value={selectedDepartment.defaultTeamName || ""} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { defaultTeamName: event.target.value })} placeholder="Team suggestion" /></div>
                          <div className="field"><label>Lead role</label><ClusterNativeSelect value={selectedDepartment.leadRoleId || ""} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { leadRoleId: event.target.value })}><option value="">No lead role</option>{enabledStudioRoles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</ClusterNativeSelect><small>Used for coverage and leadership suggestions.</small></div>
                          <div className="field"><label>Capacity (hrs/week)</label><ClusterInput type="number" min="0" max="168" value={selectedDepartment.capacityTargetHours ?? 0} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { capacityTargetHours: Number(event.target.value || 0) })} /></div>
                          <div className="field span-2"><label>Description</label><ClusterTextarea value={selectedDepartment.description || ""} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { description: event.target.value })} placeholder="Responsibilities, ownership, and scope" /></div>
                        </div>
                        <div className="button-row"><ClusterButton type="button" variant="secondary" onClick={() => applyDepartmentDefaults(selectedDepartment)}>Use as onboarding default</ClusterButton></div>
                      </div>
                    )}

                    {departmentEditorTab === "permissions" && (
                      <div className="studio-editor-panel-v272">
                        <div className="studio-explanation-v272"><strong>Inherited access</strong><span>Role and user permissions may override these defaults.</span></div>
                        <div className="field studio-template-field-v272">
                          <label>Baseline permission preset</label>
                          <ClusterNativeSelect value={selectedDepartment.permissionTemplateKey || "member"} onChange={(event) => updateStudioDepartment(selectedDepartment.id, { permissionTemplateKey: event.target.value, toolPermissions: {} })}>
                            {rolePermissionTemplateOptions().map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
                          </ClusterNativeSelect>
                          <small>Changing the preset clears department-specific overrides.</small>
                        </div>
                        <div className="studio-explanation-v272"><strong>Assigned department bundles</strong><span>Applied after the department preset, before direct department overrides.</span></div>
                        <div className="studio-action-rule-list-v272">{studioBundles.map((bundle) => <label key={bundle.id} className="studio-action-rule-v272"><span><strong>{bundle.label}</strong><small>rev {bundle.revision}{bundle.enabled === false ? " · disabled" : ""}</small></span><ClusterInput type="checkbox" checked={(selectedDepartment.permissionBundleIds || []).includes(bundle.id)} onChange={(event) => assignBundle("department", selectedDepartment.id, bundle.id, event.target.checked)} /></label>)}</div>
                        <StudioPermissionEditor permissions={selectedDepartment.toolPermissions} inherited={selectedDepartmentInheritedPermissions} onChange={(tool, level) => updateStudioDepartmentPermission(selectedDepartment.id, tool, level)} />
                      </div>
                    )}

                    {departmentEditorTab === "roles" && (
                      <div className="studio-editor-panel-v272">
                        <div className="studio-explanation-v272"><strong>Roles & actions</strong></div>
                        <div className="studio-related-role-list-v272">
                          {selectedDepartmentRoles.length ? selectedDepartmentRoles.map((role) => (
                            <ClusterButton type="button" key={role.id} onClick={() => { setSelectedRoleId(role.id); setRoleEditorTab("details"); setSection("roles"); }}>
                              <span><strong>{role.label}</strong><small>{role.defaultTitle || role.description || "No default title"}</small></span>
                              <span>{role.permissionTemplateKey || "department baseline"}</span>
                            </ClusterButton>
                          )) : <ClusterEmptyState compact kind="empty" title="No roles assigned" description="Assign a Studio role to this department when it should own permissions or workflow responsibilities." />}
                        </div>
                        <div className="studio-action-rule-list-v272">
                          {studioActionRules.map((rule) => (
                            <label key={`${selectedDepartment.id}-${rule.key}`} className="studio-action-rule-v272">
                              <span><strong>{rule.label}</strong><small>{rule.detail}</small></span>
                              <ClusterInput type="checkbox" checked={departmentRoleListIsSelected(rule.key, selectedDepartment.id)} onChange={(event) => setDepartmentRoleList(rule.key, selectedDepartment.id, event.target.checked)} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="studio-policy-strip-v272">
                <div className="field">
                  <label>Default department</label>
                  <ClusterNativeSelect value={settings.studioDefaultDepartmentId || defaultDepartment?.id || "studio"} onChange={(event) => patch("studioDefaultDepartmentId", event.target.value)}>
                    {enabledStudioDepartments.map((department) => (
                      <option key={department.id} value={department.id}>{department.label}</option>
                    ))}
                  </ClusterNativeSelect>
                </div>
                <div className="field">
                  <label>Capacity policy</label>
                  <ClusterNativeSelect value={settings.studioDepartmentCapacityMode || "advisory"} onChange={(event) => patch("studioDepartmentCapacityMode", event.target.value as Settings["studioDepartmentCapacityMode"])}>
                    <option value="off">Do not track targets</option>
                    <option value="advisory">Show capacity guidance</option>
                    <option value="required">Require capacity on profiles</option>
                  </ClusterNativeSelect>
                </div>
                <label className="studio-setting-toggle-v272">
                  <ClusterInput type="checkbox" checked={settings.studioDepartmentRequired !== false} onChange={(event) => patch("studioDepartmentRequired", event.target.checked)} />
                  <span><strong>Required</strong></span>
                </label>
              </div>
              </details>

            </div>
          )}

          {section === "roles" && (
            <div className="settings-section-v092 studio-settings-section-v272 rp">
              <div className="rp-bar">
                <label className="rp-search">
                  <ClusterIcon name="search" aria-hidden="true" />
                  <input type="search" value={roleDirectorySearch} placeholder="Find a role" aria-label="Find a role" autoComplete="off" onChange={(event) => setRoleDirectorySearch(event.target.value)} />
                </label>
                <ClusterSegmentedControl value={roleDirectoryFilter} onChange={setRoleDirectoryFilter} label="Filter roles"
                  options={ROLE_DIRECTORY_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label, disabled: option.needsCounts && !roleMemberCounts }))} />
                <span className="rp-count">{enabledStudioRoles.length} active</span>
                <ClusterButton type="button" variant="primary" size="compact" aria-expanded={roleCreationOpen} onClick={() => setRoleCreationOpen((open) => !open)}><ClusterIcon name={roleCreationOpen ? "close" : "plus"} />{roleCreationOpen ? "Cancel" : "New role"}</ClusterButton>
              </div>

              {roleCreationOpen && (
                <div className="rp-create">
                  <ClusterInput value={newRoleLabel} onChange={(event) => setNewRoleLabel(event.target.value)} placeholder="Role name" aria-label="Role name" autoFocus />
                  <ClusterEntityPicker ariaLabel="New role department" value={newRoleDepartmentId}
                    entities={enabledStudioDepartments.map((department) => ({ id: department.id, label: department.label, kind: "department" }))}
                    onChange={setNewRoleDepartmentId} allowClear={false} placeholder="Department" searchPlaceholder="Find a department" />
                  <ClusterNativeSelect value={newRoleTemplateKey} aria-label="Starting preset" onChange={(event) => setNewRoleTemplateKey(event.target.value)}>{rolePermissionTemplateOptions().map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</ClusterNativeSelect>
                  <ClusterButton type="button" variant="primary" size="compact" onClick={addStudioRole} disabled={!newRoleLabel.trim()}>Add</ClusterButton>
                </div>
              )}

              <div className="rp-body">
                <nav className="rp-list" aria-label="Studio roles">
                  {roleMemberCountsError && <small className="rp-note" role="status" title="Assignment filters are off; editing still works.">Member counts unavailable</small>}
                  {visibleStudioRoles.map((role) => {
                    const members = roleMemberCounts && typeof roleMemberCounts[role.id] === "number" ? roleMemberCounts[role.id] : null;
                    return <button type="button" key={role.id} className="rp-role" aria-current={selectedRole?.id === role.id ? "true" : undefined} data-disabled={role.enabled === false || undefined}
                      onClick={() => { permissionPreviewSequence.current += 1; setBundlePreview(null); setBundlePreviewError(""); setBundlePreviewLoading(false); setSelectedRoleId(role.id); setRoleEditorTab("details"); }}>
                      <span><b>{role.label}</b><small>{studioDepartments.find((department) => department.id === role.departmentId)?.label || "No department"}</small></span>
                      <em title={members === null ? undefined : `${members} member${members === 1 ? "" : "s"}`}>{role.enabled === false ? "Off" : members ?? ""}</em>
                    </button>;
                  })}
                  {!visibleStudioRoles.length && <p className="rp-note">No roles match.</p>}
                </nav>

                {selectedRole && (
                  <section className="rp-editor" aria-label={`${selectedRole.label} role`}>
                    <header className="rp-head">
                      <h3>{selectedRole.label}</h3>
                      <span className="rp-tag">{selectedRoleDepartment?.label || "No department"}</span>
                      {roleMemberCounts && typeof roleMemberCounts[selectedRole.id] === "number" ? <span className="rp-tag"><ClusterIcon name="users" aria-hidden="true" />{roleMemberCounts[selectedRole.id]}</span> : null}
                      {!visibleStudioRoles.some((role) => role.id === selectedRole.id) ? <ClusterButton type="button" size="compact" variant="quiet" onClick={() => { setRoleDirectorySearch(""); setRoleDirectoryFilter("all"); }}>Hidden by filter · clear</ClusterButton> : null}
                      <ClusterToggle className="rp-enabled" checked={selectedRole.enabled !== false} label="Enabled" onCheckedChange={(checked) => void setStudioRoleEnabled(selectedRole.id, checked)} />
                      <ClusterButton type="button" size="compact" variant="quiet" onClick={() => void removeStudioRole(selectedRole.id)}>{selectedRole.locked ? "Disable" : "Remove"}</ClusterButton>
                    </header>

                    <ClusterSegmentedControl value={roleEditorTab} onChange={setRoleEditorTab} label="Role settings"
                      options={[{ value: "details", label: "Details" }, { value: "permissions", label: "Tool access" }, { value: "actions", label: "Protected actions" }]} />

                    {roleEditorTab === "details" && (
                      <div className="rp-rows">
                        <label className="rp-row"><span>Name</span><ClusterInput value={selectedRole.label} onChange={(event) => updateStudioRole(selectedRole.id, { label: event.target.value })} /></label>
                        <div className="rp-row"><span title="Gives the role its starting access. Changing it clears this role's overrides.">Department</span>
                          <ClusterEntityPicker ariaLabel="Role department" value={selectedRole.departmentId || ""}
                            entities={[
                              ...(selectedRole.departmentId && !studioDepartments.some((department) => department.id === selectedRole.departmentId)
                                ? [{ id: selectedRole.departmentId, label: "Existing department unavailable", disabled: true, kind: "department" }]
                                : []),
                              ...studioDepartments.map((department) => ({ id: department.id, label: department.label, kind: "department", disabled: department.enabled === false })),
                            ]}
                            onChange={(departmentId) => updateStudioRole(selectedRole.id, { departmentId, toolPermissions: {} })}
                            placeholder="No department" searchPlaceholder="Find a department" allowClear />
                        </div>
                        <label className="rp-row"><span title="Suggested when the role is assigned; never overwrites a profile.">Default title</span><ClusterInput value={selectedRole.defaultTitle || ""} onChange={(event) => updateStudioRole(selectedRole.id, { defaultTitle: event.target.value })} placeholder={selectedRole.label} /></label>
                        <label className="rp-row rp-row--wide"><span>Description</span><ClusterTextarea rows={2} value={selectedRole.description || ""} onChange={(event) => updateStudioRole(selectedRole.id, { description: event.target.value })} placeholder="Who gets this role" /></label>
                        <div className="rp-row"><span title="Fixed: memberships and policies reference it.">Key</span><code className="rp-key">{selectedRole.id}</code></div>
                        {currentUser.isAdmin && (
                          <details className="rp-members">
                            <summary>Members</summary>
                            <RoleMembershipReviewPanel
                              roleId={selectedRole.id}
                              snapshot={roleMemberSnapshot?.ownerId === currentUser.id && roleMemberSnapshot?.roleId === selectedRole.id ? roleMemberSnapshot : null}
                              loading={roleMemberReviewLoading}
                              error={roleMemberReviewError}
                              onRefresh={() => void loadRoleMembers(selectedRole.id)}
                            />
                          </details>
                        )}
                      </div>
                    )}

                    {roleEditorTab === "permissions" && (
                      <div className="rp-access">
                        <div className="rp-rows">
                          <div className="rp-row"><span title="Starts from the department, then this preset, then bundles, then the overrides below. Changing it clears overrides.">Preset</span>
                            <ClusterNativeSelect value={selectedRole.permissionTemplateKey || "member"} disabled={["owner", "admin"].includes(selectedRole.id)} onChange={(event) => updateStudioRole(selectedRole.id, { permissionTemplateKey: event.target.value, toolPermissions: {} })}>{rolePermissionTemplateOptions().map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</ClusterNativeSelect>
                          </div>
                          {studioBundles.length ? <div className="rp-row"><span title="Applied after the preset, before overrides.">Bundles</span>
                            <span className="rp-chips">{studioBundles.map((bundle) => {
                              const on = (selectedRole.permissionBundleIds || []).includes(bundle.id);
                              return <button type="button" key={bundle.id} className="rp-chip" aria-pressed={on} disabled={["owner", "admin"].includes(selectedRole.id)} title={`Revision ${bundle.revision}${bundle.enabled === false ? " · disabled" : ""}`} onClick={() => assignBundle("role", selectedRole.id, bundle.id, !on)}>{on ? <ClusterIcon name="check" aria-hidden="true" /> : null}{bundle.label}</button>;
                            })}</span>
                          </div> : null}
                        </div>
                        <StudioPermissionEditor permissions={selectedRole.toolPermissions} inherited={selectedRoleInheritedPermissions} readOnly={["owner", "admin"].includes(selectedRole.id)} onChange={(tool, level) => updateStudioRolePermission(selectedRole.id, tool, level)} />
                        <div className="rp-preview">
                          <ClusterButton type="button" size="compact" variant="quiet" disabled={bundlePreviewLoading} onClick={() => void previewPermissionBundleChanges(selectedRole.id, selectedRole.departmentId || null)}>{bundlePreviewLoading ? "Comparing…" : "Preview who this changes"}</ClusterButton>
                          {bundlePreviewError && <span role="alert">{bundlePreviewError}</span>}
                        </div>
                        {activeRolePreview && (
                          <ClusterEffectiveAccessInspector
                            key={activeRolePreview.requestKey}
                            preview={activeRolePreview}
                            tools={TOOL_PERMISSION_OPTIONS.map((tool) => ({ key: tool.key, label: tool.label }))}
                          />
                        )}
                      </div>
                    )}

                    {roleEditorTab === "actions" && (
                      <div className="rp-actions" role="group" aria-label="Protected actions">
                        {studioActionRules.map((rule) => (
                          <div key={`${selectedRole.id}-${rule.key}`} className="rp-action">
                            <span title={rule.detail}><b>{rule.label}</b><small>{rule.detail}</small></span>
                            <ClusterToggle checked={roleIsSelected(rule.key, selectedRole.id)} aria-label={rule.label} onCheckedChange={(checked) => setRoleList(rule.key, selectedRole.id, checked)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
              <details className="studio-advanced-access-v11">
                <summary><strong>Advanced access policies</strong><span>Workspace defaults, reusable bundles and project access ceilings</span></summary>
              <div className="studio-policy-strip-v272">
                <div className="field"><label>Access model</label><ClusterNativeSelect value={settings.studioRolePermissionMode || "role-based"} onChange={(event) => patch("studioRolePermissionMode", event.target.value as Settings["studioRolePermissionMode"])}><option value="open">Open defaults</option><option value="role-based">Role-based access</option><option value="locked">Explicit access only</option></ClusterNativeSelect><small>Role-based access is recommended for normal studio use.</small></div>
                <div className="field"><label>Default role</label><ClusterNativeSelect value={settings.studioDefaultWorkspaceRole || "member"} onChange={(event) => patch("studioDefaultWorkspaceRole", event.target.value)}>{enabledStudioRoles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</ClusterNativeSelect><small>Preselected when administrators create a user.</small></div>
                <div className="field"><label>External access</label><ClusterNativeSelect value={settings.studioExternalAccessDefault || "viewer"} onChange={(event) => patch("studioExternalAccessDefault", event.target.value as Settings["studioExternalAccessDefault"])}><option value="none">No access</option><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="reviewer">Reviewer</option></ClusterNativeSelect><small>Applied before explicit project permissions.</small></div>
              </div>

              <section className="studio-editor-panel-v272" aria-label="Permission bundle library">
                <div className="studio-explanation-v272"><strong>Reusable permission bundles</strong><span>Bundles layer between presets and local overrides. Each published edit advances the revision. Disabling a bundle removes its effective permissions without deleting references.</span></div>
                <div className="button-row compact">
                  <ClusterInput value={newBundleLabel} onChange={(event) => setNewBundleLabel(event.target.value)} maxLength={100} placeholder="New bundle name" aria-label="New permission bundle name" />
                  <ClusterButton type="button" disabled={!newBundleLabel.trim() || studioBundles.length >= 64} onClick={createPermissionBundle}>Create bundle</ClusterButton>
                </div>
                {studioBundles.length > 0 && <div className="studio-form-grid-v272">
                  <div className="field"><label>Edit bundle</label><ClusterNativeSelect value={selectedBundle?.id || ""} onChange={(event) => setSelectedBundleId(event.target.value)}>{studioBundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label} · rev {bundle.revision}{bundle.enabled === false ? " · disabled" : ""}</option>)}</ClusterNativeSelect></div>
                  {selectedBundle && <>
                    <div className="field"><label>Display name</label><ClusterInput value={selectedBundle.label} maxLength={100} onChange={(event) => updatePermissionBundle(selectedBundle.id, { label: event.target.value })} /></div>
                    <div className="field span-2"><label>Description</label><ClusterTextarea value={selectedBundle.description || ""} maxLength={600} onChange={(event) => updatePermissionBundle(selectedBundle.id, { description: event.target.value })} /></div>
                    <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={selectedBundle.enabled !== false} onChange={(event) => updatePermissionBundle(selectedBundle.id, { enabled: event.target.checked })} /> Bundle enabled</label>
                  </>}
                </div>}
                {selectedBundle && <StudioPermissionEditor permissions={selectedBundle.toolPermissions} inherited={{}} onChange={(tool, level) => updatePermissionBundleTool(selectedBundle.id, tool, level)} />}
              </section>

              <section className="studio-editor-panel-v272" aria-label="Project bundle ceilings">
                <div className="studio-explanation-v272"><strong>Project-specific bundle restrictions</strong><span>Assign existing bundles to an individual Project. Their explicit tool levels become maximum permissions inside that Project, never additional grants. Role/User permissions, Access Rules, and Library source restrictions still apply. Admins retain emergency access.</span></div>
                <div className="button-row compact">
                  <ClusterInput value={projectBundleTarget} maxLength={128} aria-label="Project ID for permission policy" placeholder="Immutable Project ID" onChange={(event) => setProjectBundleTarget(event.target.value)} />
                  <ClusterButton type="button" disabled={!projectBundleTarget.trim() || (settings.studioProjectBundlePolicies || []).length >= 256} onClick={addProjectBundlePolicy}>Add Project policy</ClusterButton>
                </div>
                {(settings.studioProjectBundlePolicies || []).map((policy) => <div className="studio-entity-editor-v272" key={policy.projectId}>
                  <div className="button-row compact"><strong>Project {policy.projectId}</strong><ClusterButton type="button" size="compact" variant="quiet" onClick={() => patch("studioProjectBundlePolicies", (settings.studioProjectBundlePolicies || []).filter((item) => item.projectId !== policy.projectId))}>Remove policy</ClusterButton></div>
                  <div className="studio-action-rule-list-v272">
                    {studioBundles.map((bundle) => <label key={bundle.id} className="studio-action-rule-v272"><span><strong>{bundle.label}</strong><small>Ceiling · revision {bundle.revision}{bundle.enabled === false ? " · disabled" : ""}</small></span><ClusterInput type="checkbox" checked={policy.permissionBundleIds.includes(bundle.id)} disabled={policy.permissionBundleIds.length >= 16 && !policy.permissionBundleIds.includes(bundle.id)} onChange={(event) => assignProjectBundle(policy.projectId, bundle.id, event.target.checked)} /></label>)}
                  </div>
                  <small>Draft ceiling: {CLUSTER_TOOL_PERMISSION_KEYS.map((tool) => {
                    const level = clusterProjectBundleCap(policy.projectId, tool, [policy], studioBundles);
                    return level ? `${tool}: ${level}` : null;
                  }).filter(Boolean).join(" · ") || "No active restrictions"}</small>
                  {!studioBundles.length && <small>Create a permission bundle above before assigning a ceiling.</small>}
                </div>)}
              </section>
              </details>

            </div>
          )}

          {section === "defaults" && (
            <div className="settings-section-v092 studio-settings-section-v272">
              <div className="settings-panel-head-v092 studio-section-intro-v272">
                <div>
                  <p className="eyebrow">Projects</p>
                  <h2><ClusterIcon name="project" aria-hidden="true" /> Project defaults</h2>
                  <p className="muted tight">Choose the defaults for new projects.</p>
                </div>
                <ClusterButton type="button" variant="secondary" onClick={() => setSection("projectTypes")}><ClusterIcon name="settings" aria-hidden="true" /> Manage project types</ClusterButton>
              </div>

              <details className="studio-settings-disclosure-v112"><summary>Project creation preview</summary>
              <div className="studio-systems-status-overview-v103 studio-project-defaults-preview-v103" aria-label="New project configuration preview">
                <article><div><ClusterIcon name="project" aria-hidden="true" /><span>Project type</span></div><strong>{projectTypePresets.find((preset) => preset.id === (settings.defaultProjectTypeId || projectTypePresets[0]?.id))?.label || "General"}</strong><SettingsStateChip tone="info" icon="settings">{settings.defaultProjectSource === "external" ? "External project source" : "Internal project source"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="lock" aria-hidden="true" /><span>Initial visibility</span></div><strong>{settings.defaultProjectVisibility === "private" ? "Private" : settings.defaultProjectVisibility === "external_review" ? "External review" : "Studio"}</strong><SettingsStateChip tone="neutral" icon="lock">Permissions apply separately</SettingsStateChip></article>
                <article><div><ClusterIcon name="list" aria-hidden="true" /><span>Starter board</span></div><strong>{settings.defaultCreateStarterBoard !== false ? "Included" : "Skipped"}</strong><SettingsStateChip tone={settings.defaultCreateStarterBoard !== false ? "info" : "neutral"} icon={settings.defaultCreateStarterBoard !== false ? "check" : "minus"}>{settings.defaultCreateStarterBoard !== false ? "Created by default" : "Opted out"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="palette" aria-hidden="true" /><span>Starter whiteboard</span></div><strong>{settings.defaultCreateStarterWhiteboard !== false ? "Included" : "Skipped"}</strong><SettingsStateChip tone={settings.defaultCreateStarterWhiteboard !== false ? "info" : "neutral"} icon={settings.defaultCreateStarterWhiteboard !== false ? "check" : "minus"}>{settings.defaultCreateStarterWhiteboard !== false ? "Created by default" : "Opted out"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="folder" aria-hidden="true" /><span>Library folder</span></div><strong>Included</strong><SettingsStateChip tone="neutral" icon="lock">Protected project folder</SettingsStateChip></article>
              </div>
              <p className="muted tight studio-project-defaults-disclaimer-v103">Preview of the currently selected defaults. Project-type presets, object permissions and creation rules still determine the final project; this panel does not create anything.</p>
                </details>
              <div className="studio-defaults-layout-v272">
                <section className="studio-settings-block-v272">
                  <header><div><strong>Creation defaults</strong></div></header>
                  <div className="studio-form-grid-v272">
                    <div className="field"><label>Project type</label><ClusterNativeSelect value={settings.defaultProjectTypeId || projectTypePresets[0]?.id || "general"} onChange={(event) => patch("defaultProjectTypeId", event.target.value)}>{projectTypePresets.filter((preset) => preset.enabled !== false).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</ClusterNativeSelect></div>
                    <div className="field"><label>Status</label><ClusterNativeSelect value={settings.defaultProjectStatus || "active"} onChange={(event) => patch("defaultProjectStatus", event.target.value as ProjectStatus)}>{PROJECT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ClusterNativeSelect></div>
                    <div className="field"><label>Source</label><ClusterNativeSelect value={settings.defaultProjectSource || "internal"} onChange={(event) => patch("defaultProjectSource", event.target.value as Settings["defaultProjectSource"])}><option value="internal">Internal studio project</option><option value="external">External or partner project</option></ClusterNativeSelect><small>External projects can require additional ownership information.</small></div>
                    <div className="field"><label>Visibility</label><ClusterNativeSelect value={settings.defaultProjectVisibility || "studio"} onChange={(event) => patch("defaultProjectVisibility", event.target.value as Settings["defaultProjectVisibility"])}><option value="private">Private until shared</option><option value="studio">Visible to studio members</option><option value="external_review">Prepared for external review</option></ClusterNativeSelect><small>Folder and user permissions still determine actual access.</small></div>
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Starter workspace</strong></div></header>
                  <div className="studio-toggle-grid-v272">
                    <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={settings.defaultCreateStarterBoard !== false} onChange={(event) => patch("defaultCreateStarterBoard", event.target.checked)} /><span><strong>Starter board</strong><small>Create the board defined by the project type preset.</small></span></label>
                    <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={settings.defaultCreateStarterWhiteboard !== false} onChange={(event) => patch("defaultCreateStarterWhiteboard", event.target.checked)} /><span><strong>Starter whiteboard</strong><small>Create a planning canvas linked to the project.</small></span></label>
                    <div className="studio-setting-toggle-v272 locked"><ClusterInput type="checkbox" checked readOnly /><span><strong>Library folder</strong><small>Always included</small></span></div>
                  </div>
                  <div className="studio-form-grid-v272 compact">
                    <div className="field"><label>Board naming</label><ClusterNativeSelect value={settings.defaultProjectBoardNameMode || "type"} onChange={(event) => patch("defaultProjectBoardNameMode", event.target.value as Settings["defaultProjectBoardNameMode"])}><option value="type">Use the preset board name</option><option value="project">Use the project name</option></ClusterNativeSelect></div>
                    <div className="field"><label>Template policy</label><ClusterNativeSelect value={settings.studioTemplatePolicy || "recommended"} onChange={(event) => patch("studioTemplatePolicy", event.target.value as Settings["studioTemplatePolicy"])}><option value="optional">Optional</option><option value="recommended">Recommended</option><option value="required">Required</option></ClusterNativeSelect></div>
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Home</strong><span>The widgets a new Home starts with, which every Home must keep, and which no Home can show.</span></div></header>
                  <details className="studio-settings-disclosure-v112"><summary>Widgets · {parseHomeWidgetKeyCsv(settings.studioHomeRecommendedWidgetsCsv).length} default · {parseHomeWidgetKeyCsv(settings.studioHomeRequiredWidgetsCsv).length} required · {parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv).length} hidden</summary><div className="studio-home-governance-grid-v486">
                    {DASHBOARD_WIDGETS.map((widget) => {
                      const required = parseHomeWidgetKeyCsv(settings.studioHomeRequiredWidgetsCsv).includes(widget.key);
                      const unavailable = parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv).includes(widget.key);
                      const recommended = parseHomeWidgetKeyCsv(settings.studioHomeRecommendedWidgetsCsv).includes(widget.key);
                      return <article key={widget.key}><div><strong>{widget.label}</strong><span>{widget.detail}</span></div><div className="studio-home-policy-actions-v486"><ClusterButton variant={recommended ? "secondary" : "quiet"} size="compact" disabled={unavailable} aria-pressed={recommended} onClick={() => toggleHomeWidgetPolicy("studioHomeRecommendedWidgetsCsv", widget.key, !recommended)}>Default</ClusterButton><ClusterButton variant={required ? "secondary" : "quiet"} size="compact" aria-pressed={required} onClick={() => toggleHomeWidgetPolicy("studioHomeRequiredWidgetsCsv", widget.key, !required)}>Require</ClusterButton><ClusterButton variant={unavailable ? "danger" : "quiet"} size="compact" aria-pressed={unavailable} onClick={() => toggleHomeWidgetPolicy("studioHomeUnavailableWidgetsCsv", widget.key, !unavailable)}>Hidden</ClusterButton></div></article>;
                    })}
                  </div>
                  <div className="studio-home-role-recommendations-v487">
                    <header><div><strong>Role-aware recommendations</strong><span>Give each Studio role a useful starting widget set. Roles without one inherit the Studio-wide recommendation.</span></div><ClusterSelect ariaLabel="Home recommendation role" value={homeRecommendationRoleId} options={enabledStudioRoles.map((role) => ({ value: role.id, label: role.label }))} onChange={setHomeRecommendationRoleId} /></header>
                    {(() => {
                      const role = enabledStudioRoles.find((item) => item.id === homeRecommendationRoleId) || enabledStudioRoles[0];
                      if (!role) return <ClusterEmptyState compact kind="empty" title="No active Studio roles" description="Create or enable a role before configuring role-based recommendations." />;
                      const roleRecommended = new Set(parseHomeWidgetKeyCsv(role.homeRecommendedWidgetsCsv));
                      const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
                      return <div className="studio-home-role-widget-grid-v487">{DASHBOARD_WIDGETS.map((widget) => <ClusterButton key={`${role.id}-${widget.key}`} variant={roleRecommended.has(widget.key) ? "secondary" : "quiet"} size="compact" disabled={unavailable.has(widget.key)} aria-pressed={roleRecommended.has(widget.key)} onClick={() => toggleRoleHomeRecommendation(role.id, widget.key, !roleRecommended.has(widget.key))}>{widget.label}</ClusterButton>)}</div>;
                    })()}
                  </div>
                  <div className="studio-home-department-recommendations-v488">
                    <header><div><strong>Department-aware recommendations</strong><span>Departments provide the middle fallback between role-specific and Studio-wide Home recommendations.</span></div><ClusterSelect ariaLabel="Home recommendation department" value={homeRecommendationDepartmentId} options={enabledStudioDepartments.map((department) => ({ value: department.id, label: department.label }))} onChange={setHomeRecommendationDepartmentId} /></header>
                    {(() => {
                      const department = enabledStudioDepartments.find((item) => item.id === homeRecommendationDepartmentId) || enabledStudioDepartments[0];
                      if (!department) return <ClusterEmptyState compact kind="empty" title="No active Studio departments" description="Create or enable a department before configuring department defaults." />;
                      const departmentRecommended = new Set(parseHomeWidgetKeyCsv(department.homeRecommendedWidgetsCsv));
                      const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
                      return <div className="studio-home-department-widget-grid-v488">{DASHBOARD_WIDGETS.map((widget) => <ClusterButton key={`${department.id}-${widget.key}`} variant={departmentRecommended.has(widget.key) ? "secondary" : "quiet"} size="compact" disabled={unavailable.has(widget.key)} aria-pressed={departmentRecommended.has(widget.key)} onClick={() => toggleDepartmentHomeRecommendation(department.id, widget.key, !departmentRecommended.has(widget.key))}>{widget.label}</ClusterButton>)}</div>;
                    })()}
                  </div>
                </details>
                </section>


                <section className="studio-settings-block-v272">
                  <header><div><strong>Work item defaults</strong><span>Applied when a card or task is created without an explicit value.</span></div></header>
                  <div className="studio-form-grid-v272">
                    <div className="field"><label>Card priority</label><ClusterNativeSelect value={settings.defaultCardPriority || "medium"} onChange={(event) => patch("defaultCardPriority", event.target.value as Priority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></ClusterNativeSelect></div>
                    <div className="field"><label>Default tags</label><ClusterInput value={settings.defaultCardLabels || ""} onChange={(event) => patch("defaultCardLabels", event.target.value)} placeholder="triage, todo" /><small>Comma-separated tags added to new cards.</small></div>
                    <div className="field"><label>Milestone cadence</label><ClusterNativeSelect value={settings.studioDefaultMilestoneCadence || "biweekly"} onChange={(event) => patch("studioDefaultMilestoneCadence", event.target.value as Settings["studioDefaultMilestoneCadence"])}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="custom">Custom by project</option></ClusterNativeSelect></div>
                    <div className="field"><label>Status report cadence</label><ClusterNativeSelect value={settings.studioStatusReportCadence || "weekly"} onChange={(event) => patch("studioStatusReportCadence", event.target.value as Settings["studioStatusReportCadence"])}><option value="off">Off</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option></ClusterNativeSelect></div>
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Delivery fallback</strong><span>Used when a project type does not define a more specific build profile.</span></div></header>
                  <div className="studio-form-grid-v272">
                    <div className="field"><label>Build profile</label><ClusterNativeSelect value={settings.defaultBuildProfileKey || "generic"} onChange={(event) => patch("defaultBuildProfileKey", event.target.value)}>{availableBuildProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.label}</option>)}</ClusterNativeSelect></div>
                    <div className="field"><label>Release channel</label><ClusterNativeSelect value={settings.studioReleaseChannel || "internal"} onChange={(event) => patch("studioReleaseChannel", event.target.value as Settings["studioReleaseChannel"])}><option value="internal">Internal</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="public">Public</option></ClusterNativeSelect></div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {section === "createFields" && (
            <div className="settings-section-v092 studio-settings-create-fields-v167">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Create</p>
                <h2>Field builder</h2>
                <ClusterButton type="button" variant="secondary" onClick={() => setSection("projectTypes")}>
                  Edit per-type fields
                </ClusterButton>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Global project creation fields</h3>
                    <span>Shown before preset-specific fields</span>
                  </div>
                  <div className="field">
                    <label>Project fields</label>
                    <ClusterTextarea value={settings.studioCreateProjectFieldsCsv || DEFAULT_CREATE_PROJECT_FIELDS.join(", ")} onChange={(e) => patch("studioCreateProjectFieldsCsv", e.target.value)} placeholder="name, project type, status, source" />
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Global build creation fields</h3>
                    <span>Used by Create → Build</span>
                  </div>
                  <div className="field">
                    <label>Build fields</label>
                    <ClusterTextarea value={settings.studioCreateBuildFieldsCsv || DEFAULT_CREATE_BUILD_FIELDS.join(", ")} onChange={(e) => patch("studioCreateBuildFieldsCsv", e.target.value)} placeholder="project, platform, version, lane" />
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Required fields</h3>
                    <span>Validation rules</span>
                  </div>
                  <div className="field">
                    <label>Always required</label>
                    <ClusterTextarea value={settings.studioCreateRequiredFieldsCsv || "name, project type, project, version"} onChange={(e) => patch("studioCreateRequiredFieldsCsv", e.target.value)} placeholder="name, project type, project, version" />
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Conditional rules</h3>
                    <span>Preset-specific prompts</span>
                  </div>
                  <div className="field">
                    <label>Conditional field rules</label>
                    <ClusterTextarea value={settings.studioCreateConditionalFieldsCsv || ""} onChange={(e) => patch("studioCreateConditionalFieldsCsv", e.target.value)} placeholder="external project: external project owner; regulated: compliance owner" />
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Field preview</h3>
                    <span>{defaultPreset?.label || "Default preset"}</span>
                  </div>
                  <div className="studio-policy-chip-grid-v167">
                    {(settings.studioCreateProjectFieldsCsv || DEFAULT_CREATE_PROJECT_FIELDS.join(", "))
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (
                        <span className="soft-pill" key={`project-${item}`}>
                          Project: {item}
                        </span>
                      ))}
                    {(defaultPreset?.createFields || []).map((item) => (
                      <span className="soft-pill" key={`preset-${item}`}>
                        Preset: {item}
                      </span>
                    ))}
                    {(settings.studioCreateRequiredFieldsCsv || "")
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (
                        <span className="soft-pill danger-soft" key={`required-${item}`}>
                          Required: {item}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "customFields" && (
            <div className="settings-section-v092 studio-settings-section-v272 people-profile-fields-admin-v495">
              <div className="settings-panel-head-v092 studio-section-intro-v272"><div><p className="eyebrow">People</p><h2>People profile fields</h2></div><ClusterButton type="button" variant="secondary" onClick={addPeopleProfileField} disabled={profileFieldDefinitions.length >= 30}>Add field</ClusterButton></div>
              <div className="people-profile-field-list-v495">
                {profileFieldDefinitions.map((field) => <div className="settings-card-v092 people-profile-field-row-v495" key={field.id}><div className="field"><label>Label</label><ClusterInput value={field.label} onChange={(event) => updatePeopleProfileField(field.id, { label: event.target.value })} /></div><div className="field"><label>Key</label><ClusterInput value={field.id} onChange={(event) => updatePeopleProfileField(field.id, { id: studioSlug(event.target.value, field.id) })} /></div><div className="field"><label>Type</label><ClusterNativeSelect value={field.type} onChange={(event) => updatePeopleProfileField(field.id, { type: event.target.value as typeof field.type })}>{CLUSTER_PROFILE_FIELD_TYPES.map((type) => <option key={type} value={type}>{type === "multi_select" ? "Multi-select" : type === "url" ? "URL" : `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`}</option>)}</ClusterNativeSelect></div><div className="field"><label>Visibility</label><ClusterNativeSelect value={field.visibility || "studio"} onChange={(event) => updatePeopleProfileField(field.id, { visibility: event.target.value as NonNullable<typeof field.visibility> })}>{CLUSTER_PROFILE_FIELD_VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{visibility === "studio" ? "Studio" : visibility === "managers" ? "Managers" : "Private"}</option>)}</ClusterNativeSelect></div>{["select", "multi_select"].includes(field.type) && <div className="field span-2"><label>Options</label><ClusterInput value={(field.options || []).join(", ")} onChange={(event) => updatePeopleProfileField(field.id, { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 40) })} placeholder="Option A, Option B" /></div>}<label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={Boolean(field.required)} onChange={(event) => updatePeopleProfileField(field.id, { required: event.target.checked })} /> Required</label><ClusterButton type="button" size="compact" onClick={() => removePeopleProfileField(field.id)}>Remove</ClusterButton></div>)}
                {!profileFieldDefinitions.length && <div className="settings-card-v092"><strong>No Studio-specific profile fields</strong><p className="muted">Core identity, contact, expertise, working hours, capacity, teams, and project context remain available without custom fields.</p></div>}
              </div>
            </div>
          )}


          {section === "customFields" && (
            <div className="settings-section-v092 studio-custom-fields-v195">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Custom fields</h2>
                
              </div>
              <CustomFieldDefinitionsPanel />
            </div>
          )}

          {section === "automations" && (
            <div className="settings-section-v092 studio-automations-v195">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Automation rules</h2>
              </div>
              <AutomationRulesPanel />
            </div>
          )}

          {section === "versioning" && <div className="settings-section-v092 studio-versioning-v535"><VersioningAdminPage embedded /></div>}

          {section === "workflow" && (
            <div className="settings-section-v092 studio-settings-workflow-v166">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Workflow policy</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Project governance</h3>
                    <span>studio-owned by default</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="hint-box slim">Internal projects belong to the studio. External projects require a named owner for client or partner accountability.</div>
                    <div className="field">
                      <label>External owner field label</label>
                      <ClusterInput value={settings.studioExternalOwnerFieldLabel || "External project owner"} onChange={(e) => patch("studioExternalOwnerFieldLabel", e.target.value)} placeholder="External project owner" />
                    </div>
                    <div className="info-row">
                      <span>External owner requirement</span>
                      <strong>{settings.studioExternalProjectOwnerRequired !== false ? "Always required" : "Required"}</strong>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>External review</h3>
                    <span>Partner handoff tag</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="field">
                      <label>External review label</label>
                      <ClusterInput value={settings.studioExternalReviewLabel || "external-review"} onChange={(e) => patch("studioExternalReviewLabel", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Archive after days</label>
                      <NumberStepper min={30} max={730} value={settings.studioArchiveAfterDays || 180} onValueChange={(value) => patch("studioArchiveAfterDays", Number(value || 180))} ariaLabel="Archive after days" />
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>External workflow</h3>
                    <span>Project and release behavior</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Connection policy</label>
                      <ClusterNativeSelect value={settings.studioIntegrationPolicy || "suggested"} onChange={(e) => patch("studioIntegrationPolicy", e.target.value as Settings["studioIntegrationPolicy"])}>
                        <option value="manual">Manual only</option>
                        <option value="suggested">Suggested per project</option>
                        <option value="required">Required for releases</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Git sync direction</label>
                      <ClusterNativeSelect value={settings.studioGitSyncDirection || "import-only"} onChange={(e) => patch("studioGitSyncDirection", e.target.value as Settings["studioGitSyncDirection"])}>
                        <option value="import-only">Import only</option>
                        <option value="export-only">Export only</option>
                        <option value="two-way">Two-way</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>CI provider</label>
                      <ClusterNativeSelect value={settings.studioCiProvider || "none"} onChange={(e) => patch("studioCiProvider", e.target.value as Settings["studioCiProvider"])}>
                        <option value="none">None</option>
                        <option value="github">GitHub Actions</option>
                        <option value="gitea">Gitea</option>
                        <option value="jenkins">Jenkins</option>
                        <option value="custom">Custom</option>
                      </ClusterNativeSelect>
                    </div>
                    {curseForgePublishingEnabled ? <div className="field">
                      <label>CurseForge publishing</label>
                      <ClusterNativeSelect value={settings.studioCurseForgePublishingMode || "checklist"} onChange={(e) => patch("studioCurseForgePublishingMode", e.target.value as Settings["studioCurseForgePublishingMode"])}>
                        <option value="manual">Manual notes</option>
                        <option value="checklist">Checklist driven</option>
                        <option value="ready-for-api">API-ready</option>
                      </ClusterNativeSelect>
                    </div> : null}
                    <div className="field span-2">
                      <label>Webhook events</label>
                      <ClusterTextarea value={settings.studioWebhookEventsCsv || DEFAULT_WEBHOOK_EVENTS.join(", ")} onChange={(e) => patch("studioWebhookEventsCsv", e.target.value)} />
                    </div>
                    <div className="field span-2">
                      <label>Discord notification events</label>
                      <ClusterTextarea value={settings.studioDiscordNotifyEventsCsv || "build.failed, qa.failed, release.approved"} onChange={(e) => patch("studioDiscordNotifyEventsCsv", e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "builds" && (
            <div className="settings-section-v092 studio-settings-builds-v166">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Builds & releases</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Release defaults</h3>
                    <span>{settings.studioReleaseChannel || "internal"}</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Release channel</label>
                      <ClusterNativeSelect value={settings.studioReleaseChannel || "internal"} onChange={(e) => patch("studioReleaseChannel", e.target.value as Settings["studioReleaseChannel"])}>
                        <option value="internal">Internal</option>
                        <option value="alpha">Alpha</option>
                        <option value="beta">Beta</option>
                        <option value="public">Public</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Versioning scheme</label>
                      <ClusterNativeSelect value={settings.studioVersioningScheme || "semver"} onChange={(e) => patch("studioVersioningScheme", e.target.value as Settings["studioVersioningScheme"])}>
                        <option value="semver">Semantic versioning</option>
                        <option value="date">Date-based</option>
                        <option value="milestone">Milestone-based</option>
                        <option value="custom">Custom</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Default build profile</label>
                      <ClusterNativeSelect value={settings.defaultBuildProfileKey || "generic"} onChange={(e) => patch("defaultBuildProfileKey", e.target.value)}>
                        {BUILD_PLATFORM_PROFILES.map((profile) => (
                          <option key={profile.key} value={profile.key}>
                            {profile.label}
                          </option>
                        ))}
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Retention days</label>
                      <NumberStepper min={1} max={365} value={settings.studioBuildRetentionDays || 30} onValueChange={(value) => patch("studioBuildRetentionDays", Number(value || 30))} ariaLabel="Build retention days" />
                    </div>
                    <div className="field span-2">
                      <label>Artifact naming pattern</label>
                      <ClusterInput value={settings.studioArtifactNamingPattern || "{project}-{version}-{platform}"} onChange={(e) => patch("studioArtifactNamingPattern", e.target.value)} placeholder="{project}-{version}-{platform}" />
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Profile preview</h3>
                    <span>{defaultBuildProfile?.label || "Generic"}</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="info-row">
                      <span>Fallback</span>
                      <strong>{settings.defaultBuildProfileKey || "generic"}</strong>
                    </div>
                    <div className="info-row">
                      <span>Channel</span>
                      <strong>{settings.studioReleaseChannel || "internal"}</strong>
                    </div>
                    <div className="info-row">
                      <span>Pattern</span>
                      <strong>{settings.studioArtifactNamingPattern || "{project}-{version}-{platform}"}</strong>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Release discipline</h3>
                    <span>Keep project folders consistent and easy to identify</span>
                  </div>
                  <p className="muted tight">These defaults give Builds a policy surface for platform-specific packaging, retention, and release labels while project type presets decide the platform details.</p>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Build status pipeline</h3>
                    <span>Studio-wide statuses</span>
                  </div>
                  <div className="field">
                    <label>Status list</label>
                    <ClusterTextarea value={settings.studioBuildStatusesCsv || DEFAULT_BUILD_STATUSES.join(", ")} onChange={(e) => patch("studioBuildStatusesCsv", e.target.value)} />
                  </div>
                  <div className="chip-row">
                    {(settings.studioBuildStatusesCsv || DEFAULT_BUILD_STATUSES.join(", "))
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (
                        <span className="soft-pill" key={item}>
                          {item}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Build numbering & checklist</h3>
                    <span>Keep project artifacts organized and traceable</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Build number pattern</label>
                      <ClusterInput value={settings.studioBuildNumberPattern || "{project}-{date}-{count}"} onChange={(e) => patch("studioBuildNumberPattern", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Failure policy</label>
                      <ClusterNativeSelect value={settings.studioBuildFailurePolicy || "auto-ticket"} onChange={(e) => patch("studioBuildFailurePolicy", e.target.value as Settings["studioBuildFailurePolicy"])}>
                        <option value="manual-review">Manual review</option>
                        <option value="auto-ticket">Auto-create ticket</option>
                        <option value="block-release">Block release</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Artifact storage</label>
                      <ClusterNativeSelect value={settings.studioArtifactStoragePolicy || "hybrid"} onChange={(e) => patch("studioArtifactStoragePolicy", e.target.value as Settings["studioArtifactStoragePolicy"])}>
                        <option value="local">Local uploads</option>
                        <option value="linked">Linked artifacts</option>
                        <option value="external">External storage</option>
                        <option value="hybrid">Hybrid</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>CI provider</label>
                      <ClusterNativeSelect value={settings.studioCiProvider || "none"} onChange={(e) => patch("studioCiProvider", e.target.value as Settings["studioCiProvider"])}>
                        <option value="none">None</option>
                        <option value="github">GitHub Actions</option>
                        <option value="gitea">Gitea</option>
                        <option value="jenkins">Jenkins</option>
                        <option value="custom">Custom</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field span-2">
                      <label>Build checklist</label>
                      <ClusterTextarea value={settings.studioBuildChecklistCsv || ""} onChange={(e) => patch("studioBuildChecklistCsv", e.target.value)} placeholder="Branch selected, Version set, Artifact attached" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "qa" && (
            <div className="settings-section-v092 studio-settings-qa-v166">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>QA gates</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Release gate policy</h3>
                    <span>{settings.studioQaGateMode || "blocking"}</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Gate mode</label>
                      <ClusterNativeSelect value={settings.studioQaGateMode || "blocking"} onChange={(e) => patch("studioQaGateMode", e.target.value as Settings["studioQaGateMode"])}>
                        <option value="advisory">Advisory</option>
                        <option value="blocking">Blocking</option>
                        <option value="release-only">Release only</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field">
                      <label>Default bug severity</label>
                      <ClusterNativeSelect value={settings.studioBugSeverityDefault || "medium"} onChange={(e) => patch("studioBugSeverityDefault", e.target.value as Settings["studioBugSeverityDefault"])}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </ClusterNativeSelect>
                    </div>
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.studioQaRequired ?? true} onChange={(e) => patch("studioQaRequired", e.target.checked)} /> Require QA before release
                    </label>
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.studioApprovalRequired ?? true} onChange={(e) => patch("studioApprovalRequired", e.target.checked)} /> Require approval sign-off
                    </label>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Risk threshold</h3>
                    <span>{settings.studioRiskThreshold || "medium"}</span>
                  </div>
                  <div className="field">
                    <label>Default release risk threshold</label>
                    <ClusterNativeSelect value={settings.studioRiskThreshold || "medium"} onChange={(e) => patch("studioRiskThreshold", e.target.value as Settings["studioRiskThreshold"])}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </ClusterNativeSelect>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Gate summary</h3>
                    <span>{settings.studioQaRequired ? "QA required" : "QA optional"}</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="info-row">
                      <span>Approval</span>
                      <strong>{settings.studioApprovalRequired ? "Required" : "Optional"}</strong>
                    </div>
                    <div className="info-row">
                      <span>Severity</span>
                      <strong>{settings.studioBugSeverityDefault || "medium"}</strong>
                    </div>
                    <div className="info-row">
                      <span>Mode</span>
                      <strong>{settings.studioQaGateMode || "blocking"}</strong>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>QA checklist templates</h3>
                    <span>Release verification steps</span>
                  </div>
                  <div className="field">
                    <label>Default checklist</label>
                    <ClusterTextarea value={settings.studioQaChecklistCsv || DEFAULT_QA_CHECKLIST.join(", ")} onChange={(e) => patch("studioQaChecklistCsv", e.target.value)} />
                  </div>
                  <div className="chip-row">
                    {(settings.studioQaChecklistCsv || DEFAULT_QA_CHECKLIST.join(", "))
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (
                        <span className="soft-pill" key={item}>
                          {item}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Severity, categories, and matrix</h3>
                    <span>{settings.studioQaRequiredPasses || 1} pass minimum</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Severity levels</label>
                      <ClusterTextarea value={settings.studioQaSeverityLevelsCsv || DEFAULT_QA_SEVERITIES.join(", ")} onChange={(e) => patch("studioQaSeverityLevelsCsv", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Bug categories</label>
                      <ClusterTextarea value={settings.studioQaBugCategoriesCsv || DEFAULT_QA_CATEGORIES.join(", ")} onChange={(e) => patch("studioQaBugCategoriesCsv", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Required QA passes</label>
                      <NumberStepper min={0} max={10} value={settings.studioQaRequiredPasses || 1} onValueChange={(value) => patch("studioQaRequiredPasses", Number(value || 1))} ariaLabel="Required QA passes" />
                    </div>
                    <div className="field">
                      <label>Known issue policy</label>
                      <ClusterNativeSelect value={settings.studioQaKnownIssuePolicy || "requires-waiver"} onChange={(e) => patch("studioQaKnownIssuePolicy", e.target.value as Settings["studioQaKnownIssuePolicy"])}>
                        <option value="allow-with-note">Allow with note</option>
                        <option value="requires-waiver">Requires waiver</option>
                        <option value="block-release">Block release</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="field span-2">
                      <label>Default test matrix</label>
                      <ClusterTextarea value={settings.studioQaTestMatrixCsv || "Windows, Linux, Server, Client, Multiplayer, Install"} onChange={(e) => patch("studioQaTestMatrixCsv", e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "starters" && (
            <div className="settings-section-v092">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Starters</p>
                <h2>Starter assets</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Created with each project</h3>
                    <span>{starterCount}/2 enabled</span>
                  </div>
                  <div className="studio-toggle-stack-v163">
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.defaultCreateStarterBoard ?? true} onChange={(e) => patch("defaultCreateStarterBoard", e.target.checked)} /> Starter board
                    </label>
                    <label className="tool-check">
                      <ClusterInput type="checkbox" checked={settings.defaultCreateStarterWhiteboard ?? true} onChange={(e) => patch("defaultCreateStarterWhiteboard", e.target.checked)} /> Starter whiteboard
                    </label>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Starter naming</h3>
                    <span>Project setup behavior</span>
                  </div>
                  <div className="settings-stack compact-fields-v092">
                    <div className="field">
                      <label>Starter board naming</label>
                      <ClusterNativeSelect value={settings.defaultProjectBoardNameMode || "type"} onChange={(e) => patch("defaultProjectBoardNameMode", e.target.value as Settings["defaultProjectBoardNameMode"])}>
                        <option value="type">Use preset board name</option>
                        <option value="project">Use project name</option>
                      </ClusterNativeSelect>
                    </div>
                    <div className="info-row">
                      <span>Current preset board</span>
                      <strong>{defaultPreset?.starterBoardName || "Starter board"}</strong>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092 span-2">
                  <div className="settings-card-head-v092">
                    <h3>Default board columns</h3>
                    <span>{defaultPreset?.label || "Generic"}</span>
                  </div>
                  <div className="chip-row">
                    {(defaultPreset?.boardColumns || []).map((column) => (
                      <span className="soft-pill" key={column}>
                        {column}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "projectTypes" && (
            <div className="settings-section-v092 studio-project-types-v470">
              <div className="settings-panel-head-v092 project-type-page-head-v470">
                <div><h2>Project types</h2><span>Your studio's own list. Templates are copies you can change or delete.</span></div>
                <ClusterActionMenu label="Add project type" triggerLabel="Add type" items={[
                  { id: "blank", label: "Blank type", icon: "plus", onSelect: () => addProjectTypeFromTemplate("blank") },
                  ...CLUSTER_PROJECT_TYPE_STARTERS.map((template, index) => ({ id: template.id, label: template.label, description: template.note, icon: "project" as const, separatorBefore: index === 0, onSelect: () => addProjectTypeFromTemplate(template.id) })),
                ]} />
              </div>
              <section className="pt-profiles" aria-label="Technology profiles">
                <header><strong>Technology profiles</strong><small>Offer engine and platform pipelines when creating projects. Existing projects keep theirs.</small></header>
                <div className="pt-profiles__chips">
                  {CLUSTER_PRODUCTION_PROFILE_DEFINITIONS.filter((profile) => profile.classification === "specialized").map((profile) => {
                    const on = (settings.studioEnabledProductionProfileIds || []).includes(profile.id);
                    return <ClusterButton key={profile.id} unstyled type="button" aria-pressed={on} title={profile.note} onClick={() => patch("studioEnabledProductionProfileIds", on ? (settings.studioEnabledProductionProfileIds || []).filter((id) => id !== profile.id) : unique([...(settings.studioEnabledProductionProfileIds || []), profile.id]))}>{on ? <ClusterIcon name="check" /> : null}{profile.label}</ClusterButton>;
                  })}
                </div>
              </section>
              <div className="project-type-workbench-v470">
                <aside className="project-type-list-v470" aria-label="Project types">
                  <header><strong>{projectTypePresets.length} types</strong><small>{enabledPresetCount} enabled</small></header>
                  <div>{projectTypePresets.map((preset) => <ClusterButton type="button" key={preset.id} className={`pt-item ${selectedProjectTypePreset?.id === preset.id ? "active" : ""}`} aria-pressed={selectedProjectTypePreset?.id === preset.id} onClick={() => setSelectedProjectTypeId(preset.id)}><ResourceIdentityMark iconId={preset.iconId} projectType={preset.category || preset.id} label={preset.label} /><span><strong>{preset.label}</strong><small>{preset.note}</small></span>{preset.enabled === false ? <em>Off</em> : null}</ClusterButton>)}</div>
                </aside>
                {selectedProjectTypePreset ? (() => {
                  const preset = selectedProjectTypePreset;
                  const csv = (value?: readonly string[]) => (value || []).join(", ");
                  const fromCsv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
                  const terminologyCsv = (value?: Record<string, string>) => Object.entries(value || {}).map(([key, label]) => `${key}=${label}`).join(", ");
                  const terminologyFromCsv = (value: string) => Object.fromEntries(value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => { const [key, ...rest] = item.split("="); return [key.trim(), rest.join("=").trim()]; }).filter(([key, label]) => key && label));
                  const ownershipCsv = (value?: Record<string, string[]>) => Object.entries(value || {}).map(([stage, owners]) => `${stage}=${owners.join("|")}`).join(", ");
                  const ownershipFromCsv = (value: string) => Object.fromEntries(value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => { const [stage, ...rest] = item.split("="); return [stage.trim(), rest.join("=").split("|").map((owner) => owner.trim()).filter(Boolean)]; }).filter(([stage, owners]) => Boolean(stage) && Array.isArray(owners) && owners.length));
                  const workspaceEntitiesCsv = (value?: typeof preset.workspaceEntities) => (value || []).map((entity) => `${entity.id}=${entity.label}|${entity.plural}|${entity.baseKind}|${entity.statuses.join(">")}|${entity.defaultStatus}|${entity.stage || ""}`).join("; ");
                  const workspaceEntitiesFromCsv = (value: string) => value.split(";").map((item) => item.trim()).filter(Boolean).map((item) => { const [idPart, ...rest] = item.split("="); const [label, plural, baseKind, statusesRaw, defaultStatus, stage] = rest.join("=").split("|"); const statuses = (statusesRaw || "planned").split(">").map((status) => status.trim()).filter(Boolean); return { id: idPart.trim(), label: (label || idPart).trim(), plural: (plural || `${label || idPart}s`).trim(), baseKind: (["phase", "milestone", "deliverable", "issue", "change_request", "decision", "baseline"].includes(baseKind) ? baseKind : "deliverable") as "phase" | "milestone" | "deliverable" | "issue" | "change_request" | "decision" | "baseline", statuses, defaultStatus: (defaultStatus || statuses[0] || "planned").trim(), stage: stage?.trim() || undefined }; }).filter((entity) => entity.id && entity.label && entity.statuses.length).slice(0, 16);
                  return <section className="project-type-editor-v470">
                    <header><ResourceIconPicker label={preset.label} projectType={preset.category || preset.id} value={preset.iconId} onChange={(iconId) => updateProjectTypePreset(preset.id, { iconId: iconId || undefined })} /><div className="button-row"><label className="project-type-enabled-v470"><ClusterInput type="checkbox" checked={preset.enabled !== false} onChange={(e) => updateProjectTypePreset(preset.id, { enabled: e.target.checked })} />Offer for new projects</label><ClusterButton type="button" size="compact" variant="quiet" onClick={() => addProjectTypePreset(preset.id)}>Duplicate</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" className="pt-delete" onClick={() => removeProjectTypePreset(preset.id)}>Delete</ClusterButton></div></header>
                    <div className="project-type-editor-grid-v470">
                      <div className="field"><label>Name</label><ClusterInput value={preset.label} onChange={(e) => updateProjectTypePreset(preset.id, { label: e.target.value })} /></div>
                      <div className="field"><label>Build profile</label><ClusterNativeSelect value={preset.buildProfileKey} onChange={(e) => updateProjectTypePreset(preset.id, { buildProfileKey: e.target.value })}>{availableBuildProfiles.some((profile) => profile.key === preset.buildProfileKey) ? availableBuildProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.label}</option>) : [<option key={preset.buildProfileKey} value={preset.buildProfileKey}>{preset.buildProfileKey} (legacy selection)</option>, ...availableBuildProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.label}</option>)]}</ClusterNativeSelect></div>
                      <div className="field span-2"><label>Description</label><ClusterInput value={preset.note} onChange={(e) => updateProjectTypePreset(preset.id, { note: e.target.value })} placeholder="What this project type is for" /></div>
                      <div className="field"><label>Starter board</label><ClusterInput value={preset.starterBoardName || ""} onChange={(e) => updateProjectTypePreset(preset.id, { starterBoardName: e.target.value })} /></div>
                      <div className="field"><label>Workflow statuses</label><ClusterInput value={csv(preset.defaultStatuses)} onChange={(e) => updateProjectTypePreset(preset.id, { defaultStatuses: fromCsv(e.target.value) })} placeholder="active, review, done" /></div>
                      <div className="field span-2"><label>Board columns</label><ClusterInput value={csv(preset.boardColumns)} onChange={(e) => updateProjectTypePreset(preset.id, { boardColumns: fromCsv(e.target.value) })} /></div>
                    </div>
                    <ClusterDisclosureGroup className="project-type-advanced-v470" title="Advanced behavior" summary="Creation, delivery, metadata, approvals" contentClassName="project-type-advanced-content-v547"><div className="project-type-editor-grid-v470">
                      <div className="field"><label>Slug</label><ClusterInput value={preset.id} disabled={preset.locked} onChange={(e) => { const nextId = slugProjectTypeId(e.target.value); updateProjectTypePreset(preset.id, { id: nextId }); setSelectedProjectTypeId(nextId); }} /></div>
                      <div className="field"><label>Tracks</label><ClusterInput value={csv(preset.tracks)} onChange={(e) => updateProjectTypePreset(preset.id, { tracks: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Category</label><ClusterInput value={preset.category || "general"} onChange={(e) => updateProjectTypePreset(preset.id, { category: e.target.value })} /></div>
                      <div className="field span-2"><label>Project tool availability</label>
                        <small>One state per tool. On = shown by default, Optional = available when needed, Off = hidden for this Project Type.</small>
                        <div className="project-type-tool-matrix-v5123">
                          {CLUSTER_PROJECT_TOOL_IDS.filter((tool) => ["tickets", "boards", "builds", "qa", "library", "source", "viewer"].includes(tool)).map((tool) => {
                            const state = (preset.defaultTools || []).includes(tool) ? "on" : (preset.hiddenTools || []).includes(tool) ? "off" : "optional";
                            return <label key={tool} className="project-type-tool-row-v5123"><span>{CLUSTER_PROJECT_TOOL_MANIFEST[tool].label}</span><ClusterNativeSelect aria-label={`${CLUSTER_PROJECT_TOOL_MANIFEST[tool].label} availability`} value={state} onChange={(event) => updateProjectTypePreset(preset.id, setClusterProjectToolState(preset, tool, event.target.value as "on" | "optional" | "off"))}><option value="on">On</option><option value="optional">Optional</option><option value="off">Off</option></ClusterNativeSelect></label>;
                          })}
                        </div>
                      </div>
                      <div className="field"><label>Production hierarchy</label><ClusterTextarea value={csv(preset.productionHierarchy)} onChange={(e) => updateProjectTypePreset(preset.id, { productionHierarchy: fromCsv(e.target.value) })} placeholder="sequence, scene, shot, take" /></div>
                      <div className="field"><label>Delivery stages</label><ClusterTextarea value={csv(preset.deliveryStages)} onChange={(e) => updateProjectTypePreset(preset.id, { deliveryStages: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Review stages</label><ClusterTextarea value={csv(preset.reviewStages)} onChange={(e) => updateProjectTypePreset(preset.id, { reviewStages: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Production templates</label><ClusterTextarea value={csv(preset.productionTemplates)} onChange={(e) => updateProjectTypePreset(preset.id, { productionTemplates: fromCsv(e.target.value) })} placeholder="YouTube Video, Commercial, Short Film" /></div>
                      <div className="field"><label>Stage ownership</label><ClusterTextarea value={ownershipCsv(preset.stageOwnership)} onChange={(e) => updateProjectTypePreset(preset.id, { stageOwnership: ownershipFromCsv(e.target.value) })} placeholder="edit=editorial|producer, review=producer|director" /></div><div className="field"><label>Required delivery gates</label><ClusterTextarea value={csv(preset.deliveryGatePolicy?.requiredGateIds)} onChange={(e) => updateProjectTypePreset(preset.id, { deliveryGatePolicy: { requiredGateIds: fromCsv(e.target.value), optionalGateIds: preset.deliveryGatePolicy?.optionalGateIds || [], channels: preset.deliveryGatePolicy?.channels || ["internal", "release"] } })} placeholder="qa_pass, build_approval, reviewer_approval" /></div><div className="field"><label>Advisory delivery gates</label><ClusterTextarea value={csv(preset.deliveryGatePolicy?.optionalGateIds)} onChange={(e) => updateProjectTypePreset(preset.id, { deliveryGatePolicy: { requiredGateIds: preset.deliveryGatePolicy?.requiredGateIds || [], optionalGateIds: fromCsv(e.target.value), channels: preset.deliveryGatePolicy?.channels || ["internal", "release"] } })} placeholder="release_notes, delivery_schedule" /></div>
                      <div className="field span-2"><label>Specialized workspace entities</label><ClusterTextarea value={workspaceEntitiesCsv(preset.workspaceEntities)} onChange={(e) => updateProjectTypePreset(preset.id, { workspaceEntities: workspaceEntitiesFromCsv(e.target.value) })} placeholder="feature=Feature|Features|deliverable|backlog>ready>in_progress>done|backlog|development" /><small>entity=Label|Plural|base kind|status&gt;status|default status|stage. Up to 16 entities.</small></div>
                      <div className="field span-2"><label>Terminology overrides</label><ClusterTextarea value={terminologyCsv(preset.terminology)} onChange={(e) => updateProjectTypePreset(preset.id, { terminology: terminologyFromCsv(e.target.value) })} placeholder="video=Production Review, builds=Exports" /></div>
                      <div className="field"><label>Create fields</label><ClusterTextarea value={csv(preset.createFields || DEFAULT_CREATE_PROJECT_FIELDS)} onChange={(e) => updateProjectTypePreset(preset.id, { createFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Required fields</label><ClusterTextarea value={csv(preset.requiredFields)} onChange={(e) => updateProjectTypePreset(preset.id, { requiredFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Build fields</label><ClusterTextarea value={csv(preset.buildFields || DEFAULT_CREATE_BUILD_FIELDS)} onChange={(e) => updateProjectTypePreset(preset.id, { buildFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>QA fields</label><ClusterTextarea value={csv(preset.qaFields)} onChange={(e) => updateProjectTypePreset(preset.id, { qaFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Release fields</label><ClusterTextarea value={csv(preset.releaseFields)} onChange={(e) => updateProjectTypePreset(preset.id, { releaseFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Metadata fields</label><ClusterTextarea value={csv(preset.metadataFields)} onChange={(e) => updateProjectTypePreset(preset.id, { metadataFields: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Task templates</label><ClusterTextarea value={csv(preset.taskTemplates)} onChange={(e) => updateProjectTypePreset(preset.id, { taskTemplates: fromCsv(e.target.value) })} /></div>
                      <div className="field"><label>Timeline template</label><ClusterTextarea value={preset.timelineTemplate || ""} onChange={(e) => updateProjectTypePreset(preset.id, { timelineTemplate: e.target.value })} /></div>
                      <div className="field span-2"><label>Approval roles</label><div className="role-toggle-grid-v172">{enabledStudioRoles.map((role) => <label key={`${preset.id}-approval-${role.id}`} className="role-toggle-v172"><ClusterInput type="checkbox" checked={(preset.approvalRoles || DEFAULT_ROLE_APPROVAL_ROLES).map(normalizeRoleId).includes(role.id)} onChange={(e) => { const current = (preset.approvalRoles || DEFAULT_ROLE_APPROVAL_ROLES).map(normalizeRoleId); updateProjectTypePreset(preset.id, { approvalRoles: e.target.checked ? unique([...current, role.id]) : current.filter((item) => item !== role.id) }); }} /><span>{role.label}</span></label>)}</div></div>
                    </div></ClusterDisclosureGroup>
                  </section>;
                })() : <ClusterEmptyState kind="first-use" title="No project types configured" description="Add a project type to define its workflow, defaults, and production surfaces." />}
              </div>
            </div>
          )}

          {section === "whiteboards" && (
            <div className="settings-section-v092">
              <div className="settings-panel-head-v092">
                <p className="eyebrow">Studio</p>
                <h2>Whiteboard defaults</h2>
              </div>
              <div className="settings-card-grid-v092">
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Autosave</h3>
                    <span>Draft persistence</span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Autosave seconds</label>
                      <NumberStepper min={5} max={120} value={settings.whiteboardAutosaveSeconds || 20} onValueChange={(value) => patch("whiteboardAutosaveSeconds", Number(value || 20))} ariaLabel="Autosave seconds" />
                    </div>
                    <div className="field">
                      <label>Notify on saves</label>
                      <ClusterNativeSelect value={String(settings.notifyWhiteboardUpdates ?? false)} onChange={(e) => patch("notifyWhiteboardUpdates", e.target.value === "true")}>
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </ClusterNativeSelect>
                    </div>
                  </div>
                </div>
                <div className="settings-card-v092">
                  <div className="settings-card-head-v092">
                    <h3>Default board size</h3>
                    <span>
                      {settings.whiteboardDefaultWidth || 1800} × {settings.whiteboardDefaultHeight || 950}
                    </span>
                  </div>
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Width</label>
                      <NumberStepper min={600} max={4000} value={settings.whiteboardDefaultWidth || 1800} onValueChange={(value) => patch("whiteboardDefaultWidth", Number(value || 1800))} ariaLabel="Default whiteboard width" />
                    </div>
                    <div className="field">
                      <label>Height</label>
                      <NumberStepper min={400} max={2400} value={settings.whiteboardDefaultHeight || 950} onValueChange={(value) => patch("whiteboardDefaultHeight", Number(value || 950))} ariaLabel="Default whiteboard height" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsWorkspaceShell>
  );
}

