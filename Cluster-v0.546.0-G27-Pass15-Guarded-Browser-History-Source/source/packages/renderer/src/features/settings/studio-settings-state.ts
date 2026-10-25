import type { Settings, StudioSettingsSection } from "../application/application-models";

export type StudioSettingsSectionDescriptor = {
  key: StudioSettingsSection;
  label: string;
  meta: string;
  group: "Studio" | "People & Access" | "Projects" | "Delivery" | "Automation";
};

export type StudioSettingsGroupDefinition = {
  id: "studio" | "people" | "projects" | "delivery" | "automation";
  label: string;
  description: string;
  anchor: StudioSettingsSection;
  sections: StudioSettingsSection[];
};

export const STUDIO_SETTINGS_GROUPS: readonly StudioSettingsGroupDefinition[] = [
  { id: "studio", label: "Studio", description: "Identity, privacy, kiosk behavior, forms, policies, and shared organization defaults.", anchor: "identity", sections: ["identity", "domains", "privacy", "kiosk", "studioSystems"] },
  { id: "people", label: "People & Access", description: "Profile schema, departments, roles, permission inheritance, and onboarding defaults.", anchor: "people", sections: ["people", "departments", "roles"] },
  { id: "projects", label: "Projects", description: "Project defaults, reusable project types, creation fields, starter structure, and workspace behavior.", anchor: "defaults", sections: ["defaults", "projectTypes", "createFields", "customFields", "starters", "whiteboards"] },
  { id: "delivery", label: "Delivery", description: "Build, release, versioning, and QA policy shared across project types.", anchor: "builds", sections: ["builds", "versioning", "qa"] },
  { id: "automation", label: "Automation", description: "Studio automations and integration policy without turning Settings into a scavenger hunt.", anchor: "automations", sections: ["automations", "workflow"] },
] as const;

export function studioSettingsGroupForSection(section: StudioSettingsSection) {
  return STUDIO_SETTINGS_GROUPS.find((group) => group.sections.includes(section)) || STUDIO_SETTINGS_GROUPS[0];
}

export function studioSettingsNavAnchor(section: StudioSettingsSection) {
  return studioSettingsGroupForSection(section).anchor;
}

export const STUDIO_ACTION_RULES = [
  { key: "studioProjectCreateRolesCsv", label: "Create projects", detail: "Create new studio projects and select their initial structure." },
  { key: "studioBuildApprovalRolesCsv", label: "Approve builds", detail: "Approve release candidates and build sign-off decisions." },
  { key: "studioQaApprovalRolesCsv", label: "Approve QA", detail: "Close QA gates and approve validation passes." },
  { key: "studioAdminRolesCsv", label: "Studio administration", detail: "Manage protected studio configuration and administration policy." },
] as const;

export function buildStudioSettingsSections(input: {
  settings: Settings;
  isAdmin: boolean;
  profileFieldCount: number;
  departmentCount: number;
  roleCount: number;
  defaultPresetLabel: string;
  projectTypePresetCount: number;
  projectCreationFieldCount: number;
  starterCount: number;
}): StudioSettingsSectionDescriptor[] {
  const { settings } = input;
  return [
    { key: "identity", group: "Studio", label: "Identity", meta: settings.studioName || "Studio" },
    ...(input.isAdmin ? [{ key: "domains" as StudioSettingsSection, group: "Studio" as const, label: "Domains", meta: "Ownership · registrar · renewal" }] : []),
    ...(input.isAdmin ? [
      { key: "privacy" as StudioSettingsSection, group: "Studio" as const, label: "Privacy & data", meta: "Notice · retention · integrations" },
      { key: "kiosk" as StudioSettingsSection, group: "Studio" as const, label: "Desktop kiosk", meta: `${(settings.desktopKioskProfiles || [])[0]?.idleResetMinutes ?? 10} min reset` },
    ] : []),
    { key: "studioSystems", group: "Studio", label: "Forms & policies", meta: "Versioned studio systems" },
    { key: "people", group: "People & Access", label: "People profiles", meta: `${input.profileFieldCount} custom fields` },
    { key: "departments", group: "People & Access", label: "Departments", meta: `${input.departmentCount} active` },
    { key: "roles", group: "People & Access", label: "Roles & permissions", meta: `${input.roleCount} roles` },
    { key: "defaults", group: "Projects", label: "Project defaults", meta: input.defaultPresetLabel || "Generic" },
    { key: "projectTypes", group: "Projects", label: "Project types", meta: `${input.projectTypePresetCount} presets` },
    { key: "createFields", group: "Projects", label: "Creation fields", meta: `${input.projectCreationFieldCount} fields` },
    { key: "customFields", group: "Projects", label: "Custom fields", meta: "Server managed" },
    { key: "starters", group: "Projects", label: "Starter structure", meta: `${input.starterCount}/2 on` },
    { key: "builds", group: "Delivery", label: "Builds & releases", meta: settings.studioReleaseChannel || "internal" },
    { key: "versioning", group: "Delivery", label: "Versioning", meta: "Formats · policies · project overrides" },
    { key: "qa", group: "Delivery", label: "QA gates", meta: settings.studioQaGateMode || "blocking" },
    { key: "whiteboards", group: "Delivery", label: "Whiteboards", meta: `${settings.whiteboardDefaultWidth || 1800}×${settings.whiteboardDefaultHeight || 950}` },
    { key: "automations", group: "Automation", label: "Automations", meta: "Server managed" },
    { key: "workflow", group: "Automation", label: "Integration policy", meta: settings.studioIntegrationPolicy || "suggested" },
  ];
}

export function studioSettingsSectionLabel(section: StudioSettingsSection) {
  const labels: Partial<Record<StudioSettingsSection, string>> = {
    identity: "Identity & branding",
    domains: "Domains & ownership",
    privacy: "Privacy & data",
    kiosk: "Desktop kiosk",
    studioSystems: "Forms & policies",
    people: "People profiles",
    departments: "Departments",
    roles: "Roles & permissions",
    defaults: "Project defaults",
    projectTypes: "Project types",
    createFields: "Creation fields",
    customFields: "Custom fields",
    starters: "Starter structure",
    whiteboards: "Whiteboards",
    builds: "Builds & releases",
    versioning: "Versioning",
    qa: "QA gates",
    automations: "Automations",
    workflow: "Integration policy",
  };
  return labels[section] || section;
}
