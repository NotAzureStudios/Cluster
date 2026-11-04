import { reconcileAfterCommit } from "../../core/post-commit-reconciliation";
import { decideDraftRecovery, studioSettingsDraftBaseline } from "./settings-draft-authority";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import "../application/admin-control-center.css";
import { ClusterNativeSelect, ClusterInput, ClusterTextarea } from "../../components/ClusterNativeControls";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, queryApi } from "../../core/api";
import { clusterProjectBundleCap, CLUSTER_PROJECT_TOOL_IDS, CLUSTER_PROJECT_TOOL_MANIFEST, setClusterProjectToolState, CLUSTER_PRODUCTION_PROFILE_DEFINITIONS, CLUSTER_TOOL_PERMISSION_KEYS, type ClusterProjectToolId, resolveAssignedPermissionBundles, type ClusterPermissionBundle, CLUSTER_PROFILE_FIELD_TYPES, CLUSTER_PROFILE_FIELD_VISIBILITIES, DEFAULT_CLUSTER_KIOSK_PROFILES } from "@cluster/shared";
import { clearOfflineDraft, readOfflineDraft, saveOfflineDraft } from "../../core/offline-storage";
import { DEFAULT_MEMBER_TOOL_PERMISSIONS, type ToolPermissionKey, type ToolPermissionLevel } from "../../core/permissions";
import { unique } from "../../core/storage";
import { TIMEZONE_OPTIONS, optionsWithCurrent } from "../../core/options";
import { NumberStepper } from "../../components/NumberStepper";
import { ColorField } from "../../components/ColorField";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ResourceIconPicker } from "../../components/ResourceIconPicker";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { LegalComplianceCenter } from "../legal/LegalComplianceCenter";
import { BUILD_PLATFORM_PROFILES } from "../projects/ProjectBuildsPanel";
import { PROJECT_STATUS_OPTIONS } from "../projects/projects-utils";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import type { DashboardWidgetKey, Priority, ProjectStatus, ProjectTypePreset, Settings, StudioDepartmentDefinition, StudioRoleDefinition, StudioSettingsSection } from "../application/application-models";
import "./settings-workspace.css";
import "./people-management-layout-v11.css";

import type { StudioSettingsPageProps } from "./settings-workspace-contracts";
import { STUDIO_SETTINGS_DEPENDENCIES } from "./studio-settings-dependencies";
import { SettingsLoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { StudioKioskSettingsSection } from "./StudioKioskSettingsSection";
import { StudioSystemsSettingsSection } from "./StudioSystemsSettingsSection";
import { DASHBOARD_WIDGETS, HOME_WIDGET_PERMISSIONS, homeWidgetExtensionPolicyFromSettings, parseHomeWidgetKeyCsv, type HomeWidgetPermission } from "../home-widgets/home-widget-model";
import { useHomeWidgetLibrary } from "../home-widgets/home-widget-library";
import { STUDIO_SETTINGS_GROUPS, buildStudioSettingsSections, STUDIO_ACTION_RULES } from "./studio-settings-state";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { StudioDomainsPanel } from "../domains/DomainManagementPanel";
import { VersioningAdminPage } from "../admin/ProductionIntegrationAdminPages";

/** Navigation is the single section locator; avoid a second numbered progress rail. */
const STUDIO_SETTINGS_NAV_ICONS: Record<StudioSettingsSection, import("../../components/ClusterIcon").ClusterIconName> = {
  identity: "user", domains: "link", privacy: "lock", kiosk: "fullscreen", studioSystems: "file",
  people: "users", departments: "users", roles: "lock", defaults: "settings", projectTypes: "project",
  createFields: "plus", customFields: "list", starters: "folder", whiteboards: "palette",
  builds: "code", versioning: "timeline", qa: "check", automations: "sync", workflow: "link",
};

const SETTINGS_EXTENSION_RENDER_BATCH = 80;

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
  const customWidgetPolicy = homeWidgetExtensionPolicyFromSettings(settings.studioCustomWidgetPolicy, settings.studioCustomWidgetAllowedPermissionsCsv, settings.studioCustomWidgetBlockedIdsCsv);
  const customWidgetLibrary = useHomeWidgetLibrary(customWidgetPolicy);
  const [extensionRenderLimit, setExtensionRenderLimit] = useState(SETTINGS_EXTENSION_RENDER_BATCH);
  const visibleInstalledWidgetManifests = useMemo(() => customWidgetLibrary.installedManifests.slice(0, extensionRenderLimit), [customWidgetLibrary.installedManifests, extensionRenderLimit]);
  const hasMoreInstalledWidgetManifests = visibleInstalledWidgetManifests.length < customWidgetLibrary.installedManifests.length;
  useEffect(() => { setExtensionRenderLimit(SETTINGS_EXTENSION_RENDER_BATCH); }, [customWidgetLibrary.status?.widgetCount, customWidgetLibrary.status?.lastOperation?.id]);
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
  const [bundlePreview, setBundlePreview] = useState<{ changes: Array<{ tool: string; current: { level: string }; proposed: { level: string; provenance?: { effective?: { label: string } } } }> } | null>(null);
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
          studioHomeDefaultPreset: "balanced",
          studioHomeRequiredWidgetsCsv: "",
          studioHomeUnavailableWidgetsCsv: "",
          studioHomeRecommendedWidgetsCsv: "brief, roleFocus, readiness, myWork, upcoming, builds, notifications, people, scheduler, activity, clock",
          studioCustomWidgetPolicy: "allow",
          studioCustomWidgetAllowedPermissionsCsv: HOME_WIDGET_PERMISSIONS.join(", "),
          studioCustomWidgetBlockedIdsCsv: "",
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
      setBundlePreviewLoading(false);
    }
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persistStudioDraft(next);
      return next;
    });
  }
  function toggleCustomWidgetPermission(permission: HomeWidgetPermission, enabled: boolean) {
    const next = new Set(homeWidgetExtensionPolicyFromSettings("allow", settings.studioCustomWidgetAllowedPermissionsCsv).allowedPermissions);
    if (enabled) next.add(permission); else next.delete(permission);
    patch("studioCustomWidgetAllowedPermissionsCsv", HOME_WIDGET_PERMISSIONS.filter((item) => next.has(item)).join(", "));
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
    try {
      const result = await api<{ ok: boolean; changes: Array<{ tool: string; current: { level: string }; proposed: { level: string; provenance?: { effective?: { label: string } } } }> }>("/api/access/permission-preview", {
        method: "POST",
        body: JSON.stringify({ roleId, departmentId, studioPermissionBundles: settings.studioPermissionBundles || [], studioRoleDefinitions: mergeStudioRoles(settings), studioDepartmentDefinitions: mergeStudioDepartments(settings.studioDepartmentDefinitions) }),
      });
      if (permissionPreviewSequence.current === sequence) setBundlePreview(result);
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
        label: `${base.label} Custom`,
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
  function resetProjectTypePresets() {
    const next = mergeProjectTypePresets(DEFAULT_PROJECT_TYPE_PRESETS);
    patch("projectTypePresets", next);
    setSelectedProjectTypeId(next[0]?.id || "");
    writeProjectTypePresetsCache(next);
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
  const selectedRole = studioRoles.find((role) => role.id === selectedRoleId) || studioRoles[0];
  const selectedDepartment = studioDepartments.find((department) => department.id === selectedDepartmentId) || studioDepartments[0];
  const selectedDepartmentRoles = selectedDepartment ? studioRoles.filter((role) => role.departmentId === selectedDepartment.id) : [];
  const selectedRoleDepartment = selectedRole ? studioDepartments.find((department) => department.id === selectedRole.departmentId) : undefined;
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
          <SettingsStateChip tone={dirty ? "warning" : "neutral"} icon={dirty ? "note" : "check"}>{dirty ? "Unsaved studio changes" : "No pending edits"}</SettingsStateChip>
          <ClusterButton type="button" variant={dirty ? "primary" : "secondary"} onClick={() => void save()} disabled={!dirty || saving} busy={saving} busyLabel="Saving…">
            <ClusterIcon name={dirty ? "check" : "settings"} aria-hidden="true" /> {dirty ? "Save changes" : "Saved"}
          </ClusterButton>
        </>
      }
      status={status}
      navLabel="Studio settings sections"
      activeId={section}
      onChange={setSection}
      items={studioSections.map((item) => ({ id: item.key, label: item.label, group: item.group, icon: STUDIO_SETTINGS_NAV_ICONS[item.key] }))}
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
                  <div className="two-col compact-fields-v092">
                    <div className="field">
                      <label>Studio / organization name</label>
                      <ClusterInput value={settings.studioName || ""} onChange={(e) => patch("studioName", e.target.value)} placeholder="Your studio" />
                    </div>
                    <div className="field">
                      <label>Workspace name</label>
                      <ClusterInput value={settings.workspaceName || ""} onChange={(e) => patch("workspaceName", e.target.value)} placeholder="Cluster Workspace" />
                    </div>
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
                    <div className="field">
                      <label>Project code prefix</label>
                      <ClusterInput value={settings.studioProjectCodePrefix || "CLST"} onChange={(e) => patch("studioProjectCodePrefix", e.target.value.toUpperCase())} placeholder="CLST" />
                    </div>
                    <div className="field">
                      <label>Studio timezone</label>
                      <ClusterNativeSelect value={settings.studioTimezone || "America/New_York"} onChange={(e) => patch("studioTimezone", e.target.value)}>
                        {optionsWithCurrent(TIMEZONE_OPTIONS, settings.studioTimezone || "America/New_York").map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </ClusterNativeSelect>
                    </div>
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

          {section === "privacy" && currentUser.isAdmin && <LegalComplianceCenter />}

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
                  <span className="studio-section-count-v272">{enabledStudioDepartments.length} active</span>
                  <ClusterButton type="button" variant="primary" size="compact" aria-expanded={departmentCreationOpen} onClick={() => setDepartmentCreationOpen((open) => !open)}>{departmentCreationOpen ? "Close form" : "New department"}</ClusterButton>
                </div>
              </div>

              {departmentCreationOpen && (
              <div className="studio-create-strip-v272">
                <div><strong>New</strong></div>
                <ClusterInput value={newDepartmentLabel} onChange={(event) => setNewDepartmentLabel(event.target.value)} placeholder="Department name" />
                <ClusterInput value={newDepartmentTeam} onChange={(event) => setNewDepartmentTeam(event.target.value)} placeholder="Default team name" />
                <ClusterButton type="button" variant="secondary" onClick={addStudioDepartment} disabled={!newDepartmentLabel.trim()}>Add department</ClusterButton>
              </div>
              )}

              <div className="studio-entity-manager-v272">
                <aside className="studio-entity-list-v272" aria-label="Departments">
                  <div className="studio-entity-list-head-v272">
                    <strong>Directory</strong>
                    <span>{studioDepartments.length}</span>
                  </div>
                  {departmentRoleCoverage.map((department) => (
                    <ClusterButton type="button" key={department.id} className={selectedDepartment?.id === department.id ? "active" : ""} onClick={() => { setSelectedDepartmentId(department.id); setDepartmentEditorTab("details"); }}>
                      <span className="studio-entity-icon-rc46" aria-hidden="true"><ResourceIdentityMark iconId={department.iconId} label={department.label} accentColor={department.accentColor} /></span>
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
                        <ResourceIdentityMark iconId={selectedDepartment.iconId} label={selectedDepartment.label} accentColor={selectedDepartment.accentColor} />
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
                          <div className="field span-2"><label>Department icon</label><ResourceIconPicker label={selectedDepartment.label} value={selectedDepartment.iconId} onChange={(iconId) => updateStudioDepartment(selectedDepartment.id, { iconId })} /></div>
                          <div className="field"><ColorField label="Accent" value={selectedDepartment.accentColor || "#57c1ff"} onChange={(accentColor) => updateStudioDepartment(selectedDepartment.id, { accentColor })} /></div>
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
              <details className="studio-advanced-access-v11">
                <summary><strong>Department defaults & access policies</strong><span>Onboarding department, required fields and capacity rules</span></summary>
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
            <div className="settings-section-v092 studio-settings-section-v272 studio-people-management-v11 studio-roles-management-v11">
              <div className="settings-panel-head-v092 studio-section-intro-v272">
                <div>
                  <p className="eyebrow">Access</p>
                  <h2>Roles & permissions</h2>
                  <p className="muted tight">Build reusable access profiles for studio members. Department access is inherited first, role access is applied next, and user-specific permissions remain the final override.</p>
                </div>
                <div className="studio-people-manager-head-actions-v11">
                  <span className="studio-section-count-v272">{enabledStudioRoles.length} active</span>
                  <ClusterButton type="button" variant="primary" size="compact" aria-expanded={roleCreationOpen} onClick={() => setRoleCreationOpen((open) => !open)}>{roleCreationOpen ? "Close form" : "New role"}</ClusterButton>
                </div>
              </div>

              {roleCreationOpen && (
              <div className="studio-create-strip-v272 studio-create-role-v272">
                <div><strong>Add role</strong><span>Create a role from a permission preset, then refine its access.</span></div>
                <ClusterInput value={newRoleLabel} onChange={(event) => setNewRoleLabel(event.target.value)} placeholder="Role name" />
                <ClusterNativeSelect value={newRoleDepartmentId} onChange={(event) => setNewRoleDepartmentId(event.target.value)}>{enabledStudioDepartments.map((department) => <option key={department.id} value={department.id}>{department.label}</option>)}</ClusterNativeSelect>
                <ClusterNativeSelect value={newRoleTemplateKey} onChange={(event) => setNewRoleTemplateKey(event.target.value)}>{rolePermissionTemplateOptions().map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</ClusterNativeSelect>
                <ClusterButton type="button" variant="secondary" onClick={addStudioRole} disabled={!newRoleLabel.trim()}>Add role</ClusterButton>
              </div>
              )}

              <div className="studio-entity-manager-v272">
                <aside className="studio-entity-list-v272" aria-label="Studio roles">
                  <div className="studio-entity-list-head-v272"><strong>Roles</strong><span>{studioRoles.length}</span></div>
                  {studioRoles.map((role) => (
                    <ClusterButton type="button" key={role.id} className={selectedRole?.id === role.id ? "active" : ""} onClick={() => { permissionPreviewSequence.current += 1; setBundlePreview(null); setSelectedRoleId(role.id); setRoleEditorTab("details"); }}>
                      <span className="studio-entity-list-copy-v272"><strong>{role.label}</strong><small>{studioDepartments.find((department) => department.id === role.departmentId)?.label || "No department"}</small></span>
                      <span className="studio-entity-list-meta-v272">{role.enabled === false ? "Disabled" : role.permissionTemplateKey || "Custom"}</span>
                    </ClusterButton>
                  ))}
                </aside>

                {selectedRole && (
                  <div className="studio-entity-editor-v272">
                    <header className="studio-entity-editor-head-v272">
                      <div><span className="eyebrow">Role</span><h3>{selectedRole.label}</h3><p>{selectedRole.description || "Add a concise explanation of who should receive this role."}</p></div>
                      <div className="button-row compact"><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={selectedRole.enabled !== false} onChange={(event) => void setStudioRoleEnabled(selectedRole.id, event.target.checked)} /> Enabled</label><ClusterButton type="button" size="compact" onClick={() => void removeStudioRole(selectedRole.id)}>{selectedRole.locked ? "Disable" : "Remove"}</ClusterButton></div>
                    </header>

                    <ClusterSegmentedControl
                      value={roleEditorTab}
                      onChange={setRoleEditorTab}
                      label="Role settings"
                      className="studio-editor-tabs-v272"
                      options={[
                        { value: "details", label: "Details" },
                        { value: "permissions", label: "Tool access" },
                        { value: "actions", label: "Protected actions" },
                      ]}
                    />

                    {roleEditorTab === "details" && (
                      <div className="studio-editor-panel-v272">
                        <div className="studio-explanation-v272"><strong>Role identity and defaults</strong><span>These values are suggested when this role is assigned to a user. Changing a role does not silently overwrite existing user profile fields.</span></div>
                        <div className="studio-form-grid-v272">
                          <div className="field"><label>Display name</label><ClusterInput value={selectedRole.label} onChange={(event) => updateStudioRole(selectedRole.id, { label: event.target.value })} /></div>
                          <div className="field"><label>Role key</label><ClusterInput value={selectedRole.id} readOnly disabled aria-label="Immutable role key" /><small>Role IDs are immutable because account memberships and permission policies reference them. Create a new role to change the key.</small></div>
                          <div className="field"><label>Department</label><ClusterNativeSelect value={selectedRole.departmentId || ""} onChange={(event) => updateStudioRole(selectedRole.id, { departmentId: event.target.value, toolPermissions: {} })}><option value="">No department</option>{studioDepartments.map((department) => <option key={department.id} value={department.id}>{department.label}</option>)}</ClusterNativeSelect><small>Provides the baseline permission layer.</small></div>
                          <div className="field"><label>Default title</label><ClusterInput value={selectedRole.defaultTitle || ""} onChange={(event) => updateStudioRole(selectedRole.id, { defaultTitle: event.target.value })} placeholder={selectedRole.label} /></div>
                          <div className="field span-2"><label>Description</label><ClusterTextarea value={selectedRole.description || ""} onChange={(event) => updateStudioRole(selectedRole.id, { description: event.target.value })} placeholder="Responsibilities, expected access, and intended users" /></div>
                        </div>
                      </div>
                    )}

                    {roleEditorTab === "permissions" && (
                      <div className="studio-editor-panel-v272">
                        <div className="studio-explanation-v272"><strong>Role tool access</strong><span>{selectedRoleDepartment ? `This role starts with the ${selectedRoleDepartment.label} department baseline.` : "This role starts with the studio member baseline."} The preset is applied next, followed by the explicit overrides below.</span></div>
                        <div className="field studio-template-field-v272"><label>Role permission preset</label><ClusterNativeSelect value={selectedRole.permissionTemplateKey || "member"} disabled={["owner", "admin"].includes(selectedRole.id)} onChange={(event) => updateStudioRole(selectedRole.id, { permissionTemplateKey: event.target.value, toolPermissions: {} })}>{rolePermissionTemplateOptions().map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</ClusterNativeSelect><small>Changing the preset clears role-specific overrides. Owner and Admin always retain management access.</small></div>
                        <div className="studio-explanation-v272"><strong>Assigned role bundles</strong><span>Applied in the listed order after the role preset, before explicit overrides.</span></div>
                        <div className="studio-action-rule-list-v272">{studioBundles.map((bundle) => <label key={bundle.id} className="studio-action-rule-v272"><span><strong>{bundle.label}</strong><small>rev {bundle.revision}{bundle.enabled === false ? " · disabled" : ""}</small></span><ClusterInput type="checkbox" checked={(selectedRole.permissionBundleIds || []).includes(bundle.id)} disabled={["owner", "admin"].includes(selectedRole.id)} onChange={(event) => assignBundle("role", selectedRole.id, bundle.id, event.target.checked)} /></label>)}</div>
                        <StudioPermissionEditor permissions={selectedRole.toolPermissions} inherited={selectedRoleInheritedPermissions} readOnly={["owner", "admin"].includes(selectedRole.id)} onChange={(tool, level) => updateStudioRolePermission(selectedRole.id, tool, level)} />
                        <div className="button-row compact"><ClusterButton type="button" variant="secondary" disabled={bundlePreviewLoading} onClick={() => void previewPermissionBundleChanges(selectedRole.id, selectedRole.departmentId || null)}>{bundlePreviewLoading ? "Comparing…" : "Preview effective-access changes"}</ClusterButton></div>
                        {bundlePreviewError && <p role="alert">{bundlePreviewError}</p>}
                        {bundlePreview && <div role="status" className="studio-action-rule-list-v272"><strong>{bundlePreview.changes.length ? `${bundlePreview.changes.length} effective policy differences` : "No effective access differences"}</strong>{bundlePreview.changes.map((change) => <div key={change.tool} className="studio-action-rule-v272"><span><strong>{change.tool}</strong><small>{change.current.level} → {change.proposed.level}</small></span><small>{change.proposed.provenance?.effective?.label || "Inherited"}</small></div>)}</div>}
                      </div>
                    )}

                    {roleEditorTab === "actions" && (
                      <div className="studio-editor-panel-v272">
                        <div className="studio-explanation-v272"><strong>Protected action policy</strong><span>These permissions control studio-wide actions that are not represented by ordinary page access. Server-side checks continue to protect administrator-only operations.</span></div>
                        <div className="studio-action-rule-list-v272">
                          {studioActionRules.map((rule) => (
                            <label key={`${selectedRole.id}-${rule.key}`} className="studio-action-rule-v272">
                              <span><strong>{rule.label}</strong><small>{rule.detail}</small></span>
                              <ClusterInput type="checkbox" checked={roleIsSelected(rule.key, selectedRole.id)} onChange={(event) => setRoleList(rule.key, selectedRole.id, event.target.checked)} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
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
                  <p className="muted tight">Set the initial values and starter structure used by project creation. Project type presets can still replace fields that are specific to a production platform.</p>
                </div>
                <ClusterButton type="button" variant="secondary" onClick={() => setSection("projectTypes")}><ClusterIcon name="settings" aria-hidden="true" /> Manage project types</ClusterButton>
              </div>

              <div className="studio-defaults-preview-heading-v103">
                <h3><ClusterIcon name="grid" aria-hidden="true" /> New project starter preview</h3>
                <SettingsStateChip tone={dirty ? "warning" : "neutral"} icon={dirty ? "note" : "check"}>{dirty ? "Contains unsaved changes" : "Current draft matches saved settings"}</SettingsStateChip>
              </div>
              <div className="studio-systems-status-overview-v103 studio-project-defaults-preview-v103" aria-label="New project configuration preview">
                <article><div><ClusterIcon name="project" aria-hidden="true" /><span>Project type</span></div><strong>{projectTypePresets.find((preset) => preset.id === (settings.defaultProjectTypeId || projectTypePresets[0]?.id))?.label || "General"}</strong><SettingsStateChip tone="info" icon="settings">{settings.defaultProjectSource === "external" ? "External project source" : "Internal project source"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="lock" aria-hidden="true" /><span>Initial visibility</span></div><strong>{settings.defaultProjectVisibility === "private" ? "Private" : settings.defaultProjectVisibility === "external_review" ? "External review" : "Studio"}</strong><SettingsStateChip tone="neutral" icon="lock">Permissions apply separately</SettingsStateChip></article>
                <article><div><ClusterIcon name="list" aria-hidden="true" /><span>Starter board</span></div><strong>{settings.defaultCreateStarterBoard !== false ? "Included" : "Skipped"}</strong><SettingsStateChip tone={settings.defaultCreateStarterBoard !== false ? "info" : "neutral"} icon={settings.defaultCreateStarterBoard !== false ? "check" : "minus"}>{settings.defaultCreateStarterBoard !== false ? "Created by default" : "Opted out"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="palette" aria-hidden="true" /><span>Starter whiteboard</span></div><strong>{settings.defaultCreateStarterWhiteboard !== false ? "Included" : "Skipped"}</strong><SettingsStateChip tone={settings.defaultCreateStarterWhiteboard !== false ? "info" : "neutral"} icon={settings.defaultCreateStarterWhiteboard !== false ? "check" : "minus"}>{settings.defaultCreateStarterWhiteboard !== false ? "Created by default" : "Opted out"}</SettingsStateChip></article>
                <article><div><ClusterIcon name="folder" aria-hidden="true" /><span>Library folder</span></div><strong>Included</strong><SettingsStateChip tone="neutral" icon="lock">Protected project folder</SettingsStateChip></article>
              </div>
              <p className="muted tight studio-project-defaults-disclaimer-v103">Preview of the currently selected defaults. Project-type presets, object permissions and creation rules still determine the final project; this panel does not create anything.</p>
              <div className="studio-defaults-layout-v272">
                <section className="studio-settings-block-v272">
                  <header><div><strong>Creation defaults</strong><span>Initial classification and visibility for every new project.</span></div></header>
                  <div className="studio-form-grid-v272">
                    <div className="field"><label>Project type</label><ClusterNativeSelect value={settings.defaultProjectTypeId || projectTypePresets[0]?.id || "general"} onChange={(event) => patch("defaultProjectTypeId", event.target.value)}>{projectTypePresets.filter((preset) => preset.enabled !== false).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</ClusterNativeSelect><small>Controls platform-specific fields and starter structure.</small></div>
                    <div className="field"><label>Status</label><ClusterNativeSelect value={settings.defaultProjectStatus || "active"} onChange={(event) => patch("defaultProjectStatus", event.target.value as ProjectStatus)}>{PROJECT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ClusterNativeSelect><small>Projects can be changed after creation.</small></div>
                    <div className="field"><label>Source</label><ClusterNativeSelect value={settings.defaultProjectSource || "internal"} onChange={(event) => patch("defaultProjectSource", event.target.value as Settings["defaultProjectSource"])}><option value="internal">Internal studio project</option><option value="external">External or partner project</option></ClusterNativeSelect><small>External projects can require additional ownership information.</small></div>
                    <div className="field"><label>Visibility</label><ClusterNativeSelect value={settings.defaultProjectVisibility || "studio"} onChange={(event) => patch("defaultProjectVisibility", event.target.value as Settings["defaultProjectVisibility"])}><option value="private">Private until shared</option><option value="studio">Visible to studio members</option><option value="external_review">Prepared for external review</option></ClusterNativeSelect><small>Folder and user permissions still determine actual access.</small></div>
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Starter workspace</strong><span>Choose which tools are created with the project.</span></div></header>
                  <div className="studio-toggle-grid-v272">
                    <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={settings.defaultCreateStarterBoard !== false} onChange={(event) => patch("defaultCreateStarterBoard", event.target.checked)} /><span><strong>Starter board</strong><small>Create the board defined by the project type preset.</small></span></label>
                    <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={settings.defaultCreateStarterWhiteboard !== false} onChange={(event) => patch("defaultCreateStarterWhiteboard", event.target.checked)} /><span><strong>Starter whiteboard</strong><small>Create a planning canvas linked to the project.</small></span></label>
                    <div className="studio-setting-toggle-v272 locked"><ClusterInput type="checkbox" checked readOnly /><span><strong>Library folder</strong><small>Always create a protected project folder in Library.</small></span></div>
                  </div>
                  <div className="studio-form-grid-v272 compact">
                    <div className="field"><label>Board naming</label><ClusterNativeSelect value={settings.defaultProjectBoardNameMode || "type"} onChange={(event) => patch("defaultProjectBoardNameMode", event.target.value as Settings["defaultProjectBoardNameMode"])}><option value="type">Use the preset board name</option><option value="project">Use the project name</option></ClusterNativeSelect></div>
                    <div className="field"><label>Template policy</label><ClusterNativeSelect value={settings.studioTemplatePolicy || "recommended"} onChange={(event) => patch("studioTemplatePolicy", event.target.value as Settings["studioTemplatePolicy"])}><option value="optional">Optional</option><option value="recommended">Recommended</option><option value="required">Required</option></ClusterNativeSelect></div>
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Home dashboard default and governance</strong><span>Recommend useful defaults, require critical widgets, or remove widgets that do not belong in this Studio.</span></div></header>
                  <div className="studio-form-grid-v272 compact">
                    <div className="field"><label>Recommended layout</label><ClusterSelect ariaLabel="Recommended Home layout" value={settings.studioHomeDefaultPreset || "balanced"} options={[{ value: "balanced", label: "Balanced" }, { value: "quiet", label: "Quiet" }, { value: "core-tools", label: "Core + tools" }, { value: "everything", label: "Everything" }]} onChange={(value) => patch("studioHomeDefaultPreset", value as Settings["studioHomeDefaultPreset"])} /><small>Preset recovery remains user-invoked. The widget set below is a separate Studio recommendation.</small></div>
                    <div className="info-row"><span>Preset policy</span><strong>Recommended, not locked</strong><small>The named preset remains a user-invoked recovery path.</small></div><div className="info-row"><span>Managed rules</span><strong>{parseHomeWidgetKeyCsv(settings.studioHomeRequiredWidgetsCsv).length} required · {parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv).length} unavailable</strong><small>Required and unavailable rules apply when Home layouts or saved profiles are restored.</small></div>
                  </div>
                  <div className="studio-home-governance-grid-v486">
                    {DASHBOARD_WIDGETS.filter((widget) => !widget.desktopOnly).map((widget) => {
                      const required = parseHomeWidgetKeyCsv(settings.studioHomeRequiredWidgetsCsv).includes(widget.key);
                      const unavailable = parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv).includes(widget.key);
                      const recommended = parseHomeWidgetKeyCsv(settings.studioHomeRecommendedWidgetsCsv).includes(widget.key);
                      return <article key={widget.key}><div><strong>{widget.label}</strong><span>{widget.detail}</span></div><div className="studio-home-policy-actions-v486"><ClusterButton variant={recommended ? "secondary" : "quiet"} size="compact" disabled={unavailable} aria-pressed={recommended} onClick={() => toggleHomeWidgetPolicy("studioHomeRecommendedWidgetsCsv", widget.key, !recommended)}>Recommend</ClusterButton><ClusterButton variant={required ? "secondary" : "quiet"} size="compact" aria-pressed={required} onClick={() => toggleHomeWidgetPolicy("studioHomeRequiredWidgetsCsv", widget.key, !required)}>Require</ClusterButton><ClusterButton variant={unavailable ? "danger" : "quiet"} size="compact" aria-pressed={unavailable} onClick={() => toggleHomeWidgetPolicy("studioHomeUnavailableWidgetsCsv", widget.key, !unavailable)}>Unavailable</ClusterButton></div></article>;
                    })}
                  </div>
                  <div className="studio-home-role-recommendations-v487">
                    <header><div><strong>Role-aware recommendations</strong><span>Give each Studio role a useful starting widget set. Roles without one inherit the Studio-wide recommendation.</span></div><ClusterSelect ariaLabel="Home recommendation role" value={homeRecommendationRoleId} options={enabledStudioRoles.map((role) => ({ value: role.id, label: role.label }))} onChange={setHomeRecommendationRoleId} /></header>
                    {(() => {
                      const role = enabledStudioRoles.find((item) => item.id === homeRecommendationRoleId) || enabledStudioRoles[0];
                      if (!role) return <ClusterEmptyState compact kind="empty" title="No active Studio roles" description="Create or enable a role before configuring role-based recommendations." />;
                      const roleRecommended = new Set(parseHomeWidgetKeyCsv(role.homeRecommendedWidgetsCsv));
                      const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
                      return <div className="studio-home-role-widget-grid-v487">{DASHBOARD_WIDGETS.filter((widget) => !widget.desktopOnly).map((widget) => <ClusterButton key={`${role.id}-${widget.key}`} variant={roleRecommended.has(widget.key) ? "secondary" : "quiet"} size="compact" disabled={unavailable.has(widget.key)} aria-pressed={roleRecommended.has(widget.key)} onClick={() => toggleRoleHomeRecommendation(role.id, widget.key, !roleRecommended.has(widget.key))}>{widget.label}</ClusterButton>)}</div>;
                    })()}
                  </div>
                  <div className="studio-home-department-recommendations-v488">
                    <header><div><strong>Department-aware recommendations</strong><span>Departments provide the middle fallback between role-specific and Studio-wide Home recommendations.</span></div><ClusterSelect ariaLabel="Home recommendation department" value={homeRecommendationDepartmentId} options={enabledStudioDepartments.map((department) => ({ value: department.id, label: department.label }))} onChange={setHomeRecommendationDepartmentId} /></header>
                    {(() => {
                      const department = enabledStudioDepartments.find((item) => item.id === homeRecommendationDepartmentId) || enabledStudioDepartments[0];
                      if (!department) return <ClusterEmptyState compact kind="empty" title="No active Studio departments" description="Create or enable a department before configuring department defaults." />;
                      const departmentRecommended = new Set(parseHomeWidgetKeyCsv(department.homeRecommendedWidgetsCsv));
                      const unavailable = new Set(parseHomeWidgetKeyCsv(settings.studioHomeUnavailableWidgetsCsv));
                      return <div className="studio-home-department-widget-grid-v488">{DASHBOARD_WIDGETS.filter((widget) => !widget.desktopOnly).map((widget) => <ClusterButton key={`${department.id}-${widget.key}`} variant={departmentRecommended.has(widget.key) ? "secondary" : "quiet"} size="compact" disabled={unavailable.has(widget.key)} aria-pressed={departmentRecommended.has(widget.key)} onClick={() => toggleDepartmentHomeRecommendation(department.id, widget.key, !departmentRecommended.has(widget.key))}>{widget.label}</ClusterButton>)}</div>;
                    })()}
                  </div>
                </section>

                <section className="studio-settings-block-v272">
                  <header><div><strong>Extension widget policy</strong><span>Control declarative Home extensions, review data permissions, and audit the local Desktop widget inventory without enabling executable plugins.</span></div></header>
                  <div className="studio-form-grid-v272 compact">
                    <div className="field"><label>Extension policy</label><ClusterSelect ariaLabel="Extension widget policy" value={settings.studioCustomWidgetPolicy || "allow"} options={[{ value: "allow", label: "Allow curated + installed" }, { value: "curated-only", label: "Curated only" }, { value: "disabled", label: "Disable extension widgets" }]} onChange={(value) => patch("studioCustomWidgetPolicy", value as Settings["studioCustomWidgetPolicy"])} /><small>Installed widgets remain declarative JSON. Arbitrary executable widget code is not supported.</small></div>
                    <div className="field"><label>Blocked widget IDs</label><ClusterInput value={settings.studioCustomWidgetBlockedIdsCsv || ""} onChange={(event) => patch("studioCustomWidgetBlockedIdsCsv", event.target.value)} placeholder="vendor.widget-id, legacy.widget" /><small>Comma-separated installed widget IDs blocked across Studio Home layouts.</small></div>
                    <div className="info-row"><span>Runtime</span><strong>declarative-v1</strong><small>Validated metric, list, text, and clock blocks only.</small></div>
                    <div className="info-row"><span>Allowed permissions</span><strong>{customWidgetPolicy.allowedPermissions.length}/{HOME_WIDGET_PERMISSIONS.length}</strong><small>Widgets requesting a blocked permission are hidden and cannot be added.</small></div>
                  </div>
                  <div className="studio-home-role-widget-grid-v487">
                    {HOME_WIDGET_PERMISSIONS.map((permission) => { const allowed = customWidgetPolicy.allowedPermissions.includes(permission); return <ClusterButton key={permission} variant={allowed ? "secondary" : "quiet"} size="compact" aria-pressed={allowed} onClick={() => toggleCustomWidgetPermission(permission, !allowed)}>{permission}</ClusterButton>; })}
                  </div>
                  <div className="studio-home-governance-grid-v486">
                    {customWidgetLibrary.desktop ? visibleInstalledWidgetManifests.map((manifest) => {
                      const blocked = customWidgetLibrary.blockedManifests.find((entry) => entry.manifest.id === manifest.id);
                      return <article key={manifest.id}><div><strong>{manifest.name}</strong><span>{manifest.id} · v{manifest.version}{manifest.publisher ? ` · ${manifest.publisher}` : ""}</span><small>{manifest.permissions?.length ? manifest.permissions.join(" · ") : "No data permissions"}{manifest.provenance?.digest ? ` · ${manifest.provenance.digest.slice(0, 12)}` : ""}</small></div><div className="studio-home-policy-actions-v486">{blocked ? <span className="home-widget-managed-badge-v486">Blocked</span> : <span className="home-widget-managed-badge-v486">Allowed</span>}</div></article>;
                    }) : <ClusterEmptyState compact kind="restricted" title="Desktop inventory unavailable on Web" description="Studio policy still applies, while local widget installation and provenance stay on Cluster Desktop." />}
                  </div>
                  {hasMoreInstalledWidgetManifests ? <div className="settings-extension-load-more-v494"><ClusterButton variant="quiet" size="compact" onClick={() => setExtensionRenderLimit((current) => current + SETTINGS_EXTENSION_RENDER_BATCH)}>Show {Math.min(SETTINGS_EXTENSION_RENDER_BATCH, customWidgetLibrary.installedManifests.length - visibleInstalledWidgetManifests.length)} more · {customWidgetLibrary.installedManifests.length - visibleInstalledWidgetManifests.length} remaining</ClusterButton></div> : null}
                  {customWidgetLibrary.desktop && <div className="home-widget-library-actions-v484"><ClusterButton variant="secondary" size="compact" disabled={customWidgetLibrary.loading} onClick={() => void customWidgetLibrary.refresh()}>Rescan inventory</ClusterButton><ClusterButton variant="secondary" size="compact" onClick={() => void customWidgetLibrary.openFolder()}>Open local library</ClusterButton><span>{customWidgetLibrary.status?.widgetCount || 0} installed · {customWidgetLibrary.status?.invalidCount || 0} rejected</span></div>}
                  {Boolean(customWidgetLibrary.status?.invalidWidgets?.length) && <div className="home-widget-library-message-v484" role="status"><strong>Rejected local manifests</strong>{customWidgetLibrary.status!.invalidWidgets.slice(0, 5).map((item) => <span key={item.entry}>{item.entry}: {item.reason}</span>)}</div>}
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
                <div><p className="eyebrow">Projects</p><h2>Project types</h2><span>Reusable project behavior without hard-coded platform logic.</span></div>
                <div className="button-row"><ClusterButton type="button" variant="secondary" onClick={() => addProjectTypePreset(selectedProjectTypePreset?.id || "general")}>Add type</ClusterButton><ClusterButton type="button" variant="quiet" onClick={resetProjectTypePresets}>Restore defaults</ClusterButton></div>
              </div>
              <section className="project-profile-opt-in-v5123" aria-label="Technology profile enablement">
                <header><strong>Technology profiles</strong><small>Specialized workflows are optional. New studios start generic, without vendor-specific creation choices.</small></header>
                <div className="project-profile-opt-in-grid-v5123">
                  {CLUSTER_PRODUCTION_PROFILE_DEFINITIONS.filter((profile) => profile.classification === "specialized").map((profile) => (
                    <label key={profile.id}><ClusterInput type="checkbox" checked={(settings.studioEnabledProductionProfileIds || []).includes(profile.id)} onChange={(event) => patch("studioEnabledProductionProfileIds", event.target.checked ? unique([...(settings.studioEnabledProductionProfileIds || []), profile.id]) : (settings.studioEnabledProductionProfileIds || []).filter((id) => id !== profile.id))} /><span>{profile.label}</span></label>
                  ))}
                </div>
                <small>Disabling a technology only removes it from new Project choices. Existing Project references remain unchanged.</small>
              </section>
              <div className="project-type-workbench-v470">
                <aside className="project-type-list-v470" aria-label="Project types">
                  <header><strong>{projectTypePresets.length} types</strong><small>{enabledPresetCount} enabled</small></header>
                  <div>{projectTypePresets.map((preset) => <ClusterButton type="button" key={preset.id} className={selectedProjectTypePreset?.id === preset.id ? "active" : ""} aria-pressed={selectedProjectTypePreset?.id === preset.id} onClick={() => setSelectedProjectTypeId(preset.id)}><span><strong>{preset.label}</strong><small>{preset.buildProfileKey}</small></span><i className={preset.enabled === false ? "off" : "on"} aria-hidden="true" /></ClusterButton>)}</div>
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
                    <header><div><strong>{preset.label}</strong><small>{preset.id} · {preset.buildProfileKey}</small></div><div className="button-row"><label className="project-type-enabled-v470"><ClusterInput type="checkbox" checked={preset.enabled !== false} onChange={(e) => updateProjectTypePreset(preset.id, { enabled: e.target.checked })} />Enabled</label><ClusterButton type="button" size="compact" onClick={() => addProjectTypePreset(preset.id)}>Duplicate</ClusterButton><ClusterButton type="button" variant="danger" size="compact" onClick={() => removeProjectTypePreset(preset.id)}>{preset.locked ? "Disable" : "Remove"}</ClusterButton></div></header>
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
                        <small>One authoritative state per tool. On = shown by default, Optional = available when needed, Off = hidden for this Project Type.</small>
                        <div className="project-type-tool-matrix-v5123">
                          {CLUSTER_PROJECT_TOOL_IDS.map((tool) => {
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

