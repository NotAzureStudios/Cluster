import type * as React from "react";
import type { ToolPermissionKey, ToolPermissionLevel, ToolPermissions } from "../../core/permissions";
import type { AppTheme, ProjectTypePreset, ServerConfigSection, Settings, SettingsSection, StudioSettingsSection, StudioDepartmentDefinition, StudioRoleDefinition, User } from "../application/application-models";

export type AccountSettingsDependencies = {
  userPreferenceSettingsPayload: any; DASHBOARD_WIDGETS: any[]; useDashboardWidgets: any; DashboardCustomizer: React.ComponentType<any>; projectTypeBadge: any; applyCustomization: any; appearanceKeys: Set<keyof Settings>;
};
export type AccountSettingsPageProps = { theme: AppTheme; onThemeChange: (theme: AppTheme) => void; onSettingsSaved?: (settings: Settings) => void; currentUser: User; onUserUpdated: (user: User) => void; initialSection?: SettingsSection; onSectionChange?: (section: SettingsSection) => void; };

type RolePermissionTemplateOption = {
  key: string;
  label: string;
  tools: ToolPermissions;
};

type StudioPermissionEditorProps = {
  permissions?: ToolPermissions;
  inherited: ToolPermissions;
  onChange: (tool: ToolPermissionKey, level: ToolPermissionLevel | "inherit") => void;
  readOnly?: boolean;
};

export type StudioSettingsDependencies = {
  withoutServerManagedSettings: (settings: Settings) => Partial<Settings>;
  DEFAULT_CREATE_PROJECT_FIELDS: readonly string[];
  DEFAULT_CREATE_BUILD_FIELDS: readonly string[];
  DEFAULT_BUILD_STATUSES: readonly string[];
  DEFAULT_QA_CHECKLIST: readonly string[];
  DEFAULT_QA_SEVERITIES: readonly string[];
  DEFAULT_QA_CATEGORIES: readonly string[];
  DEFAULT_WEBHOOK_EVENTS: readonly string[];
  DEFAULT_ROLE_CREATE_ROLES: readonly string[];
  DEFAULT_ROLE_APPROVAL_ROLES: readonly string[];
  studioSlug: (value: string, fallback?: string) => string;
  splitCsv: (value?: string | null) => string[];
  normalizeRoleId: (value: string) => string;
  roleLabelFromId: (id: string) => string;
  mergeStudioDepartments: (input?: StudioDepartmentDefinition[] | null) => StudioDepartmentDefinition[];
  mergeStudioRoles: (settings?: Pick<Settings, "studioRoleDefinitions" | "studioProjectCreateRolesCsv" | "studioBuildApprovalRolesCsv" | "studioQaApprovalRolesCsv" | "studioAdminRolesCsv" | "studioDefaultWorkspaceRole"> | null) => StudioRoleDefinition[];
  rolesCsvFromIds: (ids: string[]) => string;
  rolePermissionTemplateOptions: () => RolePermissionTemplateOption[];
  permissionTemplateTools: (templateKey?: string | null) => ToolPermissions;
  departmentPermissionsFromSettings: (settings: Settings | null | undefined, departmentId?: string | null) => ToolPermissions;
  DEFAULT_PROJECT_TYPE_PRESETS: ProjectTypePreset[];
  slugProjectTypeId: (value: string) => string;
  sanitizeProjectTypePreset: (input: Partial<ProjectTypePreset> | null | undefined, fallback?: ProjectTypePreset) => ProjectTypePreset;
  mergeProjectTypePresets: (presets?: ProjectTypePreset[] | null) => ProjectTypePreset[];
  writeProjectTypePresetsCache: (presets?: ProjectTypePreset[] | null) => void;
  projectTypePresetsFromSettings: (settings?: Settings | null) => ProjectTypePreset[];
  readFileAsDataUrl: (file: File) => Promise<string>;
  normalizeClusterAccent: (value: string | null | undefined, fallback: string) => string;
  applyCustomization: (settings: Partial<Settings>, personalAccentColor?: string | null) => void;
  CustomFieldDefinitionsPanel: React.ComponentType<any>;
  AutomationRulesPanel: React.ComponentType<any>;
  StudioPermissionEditor: React.ComponentType<StudioPermissionEditorProps>;
};
export type StudioSettingsPageProps = { onSettingsSaved?: (settings: Settings) => void; currentUser: User; initialSection?: StudioSettingsSection | string | null; onSectionChange?: (section: StudioSettingsSection) => void; };

export type ServerConfigDependencies = { SERVER_MANAGED_SETTING_KEYS: Array<keyof Settings>; };
export type ServerConfigPageProps = { onSettingsSaved?: (settings: Settings) => void; initialSection?: ServerConfigSection; onSectionChange?: (section: ServerConfigSection) => void; currentUser: User; };
