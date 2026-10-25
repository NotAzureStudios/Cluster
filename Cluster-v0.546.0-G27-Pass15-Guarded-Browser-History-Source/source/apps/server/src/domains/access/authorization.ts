import type { FastifyReply, FastifyRequest } from "fastify";
import { CLUSTER_ACCESS_TARGET_KINDS, CLUSTER_TOOL_PERMISSION_KEYS, createClusterExplanation, clusterProjectBundleCap, validateClusterProjectBundlePolicies, resolveAssignedPermissionBundles, validateClusterPermissionBundles, resolveClusterEffectiveState, type ClusterEffectiveStateLayer, type ClusterToolPermissionKey } from "@cluster/shared";
import { membershipIsLead, projectMembershipForUser } from "../projects/project-membership.js";
import { isExclusiveAccessAllow } from "./scoped-grant-policy.js";
import { decisionResource, minimumForAuthorizationAction, type AuthorizationAction, type AuthorizationActor, type AuthorizationContext, type AuthorizationDecision, type AuthorizationResource } from "./authorization-decision.js";
import { workforceAuthorityProjection } from "../workforce/workforce-user-authority.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

export const TOOL_PERMISSION_ORDER: Record<string, number> = { none: 0, view: 1, edit: 2, manage: 3 };
export const PROJECT_PERMISSION_ORDER: Record<string, number> = { none: 0, view: 1, contribute: 2, manage: 3 };
export const ACCESS_RULE_TARGET_KINDS = CLUSTER_ACCESS_TARGET_KINDS;
const DIRECT_ACCESS_TARGET_KINDS = new Set<string>(ACCESS_RULE_TARGET_KINDS);


export const DEFAULT_MEMBER_TOOL_PERMISSIONS: Record<ClusterToolPermissionKey, string> = {
  mywork: "view", inbox: "view", projects: "view", boards: "edit", whiteboards: "edit", viewer: "edit", timeline: "edit", builds: "edit", qa: "edit", tickets: "edit", calendar: "edit", scheduler: "edit", library: "edit", packets: "edit", inventory: "view", vault: "none", sourceControl: "edit", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none",
};

export const DEFAULT_VIEWER_TOOL_PERMISSIONS: Record<ClusterToolPermissionKey, string> = {
  mywork: "view", inbox: "view", projects: "view", boards: "view", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "view", tickets: "view", calendar: "view", scheduler: "view", library: "view", packets: "view", inventory: "view", vault: "none", sourceControl: "view", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none",
};

const EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS: Record<ClusterToolPermissionKey, string> = {
  mywork: "view", inbox: "view", projects: "view", boards: "view", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "edit", tickets: "edit", calendar: "view", scheduler: "none", library: "view", packets: "view", inventory: "view", vault: "none", sourceControl: "view", integrations: "none", people: "none", activity: "none", settings: "view", serverConfig: "none",
};

const TARGET_TOOL: Record<string, ClusterToolPermissionKey> = {
  project: "projects",
  board: "boards",
  card: "boards",
  ticket: "tickets",
  whiteboard: "whiteboards",
  library: "library",
  file: "library",
  review_asset: "viewer",
  source_review: "sourceControl",
  build: "builds",
  release: "builds",
  qa: "qa",
  qa_plan: "qa",
  qa_session: "qa",
  calendar: "calendar",
  timeline: "timeline",
  time: "scheduler",
  schedule: "scheduler",
  scheduler: "scheduler",
  control: "projects",
  meeting: "projects",
  user: "people",
  team: "people",
  department: "people",
  job_role: "people",
  packet: "packets",
  studio_form: "packets",
  form_submission: "packets",
  policy: "packets",
  onboarding_assignment: "people",
  application: "people",
  source_repository: "sourceControl",
  source_commit: "sourceControl",
  integration_connection: "integrations",
  approval: "settings",
  announcement: "settings",
};

export type AuthorizationDependencies = {
  prisma: any;
  authRequired: boolean;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  getStudioPermissionSettings: () => any;
  parseObject: (value: any) => Record<string, string>;
  parseLabels: (value: any) => string[];
};

type RequestIdentity = { user: any | null; decorated: any | null; role: string | null };

export const AUTHORIZATION_RULE_SELECT = Object.freeze({
  targetKind: true,
  targetId: true,
  projectId: true,
  subjectKind: true,
  subjectId: true,
  subjectName: true,
  effect: true,
  level: true,
  status: true,
  expiresAt: true,
  governedGrantId: true,
});

type UserScopedRequirement = {
  ownerUserId?: string | null;
  tool: string;
  minimum?: string;
  allowUnowned?: boolean;
};

function toolLevelAsProjectLevel(level: string | null | undefined) {
  if (level === "manage") return "manage";
  if (level === "edit") return "contribute";
  if (level === "view") return "view";
  return "none";
}

function lowerAccessLevel(left: string, right: string) {
  return (PROJECT_PERMISSION_ORDER[left] || 0) <= (PROJECT_PERMISSION_ORDER[right] || 0) ? left : right;
}

function toolMinimumForProjectLevel(level: string) {
  if (level === "manage") return "manage";
  if (level === "contribute") return "edit";
  return "view";
}

export function createAuthorizationService(deps: AuthorizationDependencies) {
  const { prisma, authRequired, getCurrentUser, decorateUserForClient, getStudioPermissionSettings, parseObject, parseLabels } = deps;
  const identityCache = new WeakMap<FastifyRequest, Promise<RequestIdentity>>();
  const ruleCache = new WeakMap<FastifyRequest, Map<string, Promise<any[]>>>();
  const validatedBundleCache = new WeakMap<object, ReturnType<typeof validateClusterPermissionBundles>>();
  function loadedBundles(value: any) {
    if (!value) return [];
    if (typeof value !== "object") return validateClusterPermissionBundles(value);
    const cached = validatedBundleCache.get(value);
    if (cached) return cached;
    const result = validateClusterPermissionBundles(value);
    validatedBundleCache.set(value, result);
    return result;
  }

  const projectPolicyCache = new WeakMap<object, { rawPolicies: any; rawBundles: any; policies: ReturnType<typeof validateClusterProjectBundlePolicies>; bundles: ReturnType<typeof validateClusterPermissionBundles> }>();
  function projectToolCeiling(project: any, tool: string): string | null {
    if (!project?.id) return null;
    const settings = getStudioPermissionSettings() || {};
    if (settings.studioProjectBundlePolicies === undefined || settings.studioProjectBundlePolicies === null) return null;
    let policy = projectPolicyCache.get(settings);
    if (!policy || policy.rawPolicies !== settings.studioProjectBundlePolicies || policy.rawBundles !== settings.studioPermissionBundles) {
      const bundles = loadedBundles(settings.studioPermissionBundles);
      policy = { rawPolicies: settings.studioProjectBundlePolicies, rawBundles: settings.studioPermissionBundles, bundles, policies: validateClusterProjectBundlePolicies(settings.studioProjectBundlePolicies, bundles) };
      projectPolicyCache.set(settings, policy);
    }
    return clusterProjectBundleCap(project.id, tool, policy.policies, policy.bundles);
  }
  function capProjectLevelForTool(level: string, project: any, tool: string) {
    const ceiling = projectToolCeiling(project, tool);
    return ceiling ? lowerAccessLevel(level, toolLevelAsProjectLevel(ceiling)) : level;
  }

  function isUserAccessExpired(user: any, now = new Date()) {
    if (!user?.accessExpiresAt) return false;
    const expiresAt = user.accessExpiresAt instanceof Date ? user.accessExpiresAt : new Date(user.accessExpiresAt);
    return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime();
  }
  function isUserAccessInactive(user: any) {
    if (!user || user.archived === true) return true;
    const state = String(user.accountState || "").toUpperCase();
    return ["DISABLED", "SUSPENDED", "PRIVACY_ERASED"].includes(state) || isUserAccessExpired(user);
  }

  function isExternalCollaboratorRole(user: any, role?: string | null) {
    const text = `${role || ""} ${user?.accountType || ""}`.toLowerCase();
    return /external|guest|client|contractor|vendor|partner/.test(text);
  }

  function allManageToolPermissions() {
    return Object.fromEntries(CLUSTER_TOOL_PERMISSION_KEYS.map((key) => [key, "manage"]));
  }

  function defaultToolPermissionsForRole(role?: string | null, user?: any) {
    if (["owner", "admin"].includes(String(role || ""))) return allManageToolPermissions();
    if (isExternalCollaboratorRole(user, role)) return EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS;
    if (role === "viewer") return DEFAULT_VIEWER_TOOL_PERMISSIONS;
    return DEFAULT_MEMBER_TOOL_PERMISSIONS;
  }

  function studioPermissionTemplate(key: string | null | undefined, user?: any, role?: string | null) {
    const member = { ...DEFAULT_MEMBER_TOOL_PERMISSIONS };
    const viewer = { ...DEFAULT_VIEWER_TOOL_PERMISSIONS };
    if (key === "all-manage") return allManageToolPermissions();
    if (key === "viewer") return viewer;
    if (key === "client-viewer") return { ...viewer, scheduler: "none", sourceControl: "none", people: "none", activity: "none", serverConfig: "none" };
    if (key === "external-collaborator") return { ...EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS };
    if (key === "producer") return { ...allManageToolPermissions(), integrations: "none", serverConfig: "none", people: "view", activity: "view", settings: "view" };
    if (key === "developer") return { ...member, projects: "view", viewer: "view", calendar: "view", people: "view", serverConfig: "none" };
    if (key === "artist-editor") return { ...member, projects: "view", timeline: "view", builds: "view", qa: "view", tickets: "view", calendar: "view", sourceControl: "view", serverConfig: "none" };
    if (key === "qa") return { ...viewer, boards: "edit", qa: "edit", tickets: "edit", scheduler: "edit", settings: "view", serverConfig: "none" };
    if (key === "member") return member;
    return defaultToolPermissionsForRole(role, user);
  }

  function toolPermissionLayers(role: string | null | undefined, user?: any, includeUser = false, settingsOverride?: any) {
    const roleId = String(role || "member").trim().toLowerCase();
    const defaults = defaultToolPermissionsForRole(role, user);
    const settings = settingsOverride || getStudioPermissionSettings() || {};
    // Bundles are explicit, ordered effective-state layers, not separate grants.
    const bundles = loadedBundles(settings.studioPermissionBundles);
    const roles = Array.isArray(settings.studioRoleDefinitions) ? settings.studioRoleDefinitions : [];
    const departments = Array.isArray(settings.studioDepartmentDefinitions) ? settings.studioDepartmentDefinitions : [];
    const roleDefinition = roles.find((item: any) => String(item?.id || "").trim().toLowerCase() === roleId && item?.enabled !== false);
    const departmentId = String(roleDefinition?.departmentId || workforceAuthorityProjection(user).department || "").trim().toLowerCase();
    const department = departments.find((item: any) => {
      const id = String(item?.id || "").trim().toLowerCase();
      const label = String(item?.label || "").trim().toLowerCase();
      return item?.enabled !== false && (id === departmentId || label === departmentId);
    });
    const layers: ClusterEffectiveStateLayer[] = [{ scope: "default", sourceId: `workspace-role:${roleId}`, label: `Workspace role ${roleId}`, values: defaults }];
    if (department) {
      layers.push({ scope: "department", sourceId: `department-template:${department.id || department.label}`, label: `Department ${department.label || department.id} template`, values: studioPermissionTemplate(department.permissionTemplateKey, user, role) });
      for (const bundle of resolveAssignedPermissionBundles(bundles, department.permissionBundleIds || [])) {
        layers.push({ scope: "department", sourceId: `bundle:${bundle.id}@${bundle.revision}`, label: `Department bundle ${bundle.label} (rev ${bundle.revision})`, values: bundle.toolPermissions });
      }
      layers.push({ scope: "department", sourceId: `department:${department.id || department.label}`, label: `Department ${department.label || department.id} overrides`, values: parseObject(department.toolPermissions) });
    }
    // Active normalized Studio Team memberships contribute reusable bundle
    // layers after department and before role. Sort by stable Team ID so a
    // person's primary-Team UI preference cannot silently alter precedence.
    const memberships = Array.isArray(user?.studioTeamMemberships) ? [...user.studioTeamMemberships] : [];
    for (const membership of memberships.sort((a: any, b: any) => String(a.teamId || "").localeCompare(String(b.teamId || "")))) {
      if (membership?.archived || !membership?.team || membership.team.archived) continue;
      const team = membership.team;
      const rawIds = typeof team.permissionBundleIds === "string" ? JSON.parse(team.permissionBundleIds) : (team.permissionBundleIds ?? []);
      if (!Array.isArray(rawIds) || rawIds.some((id: any) => typeof id !== "string")) throw new Error("Invalid Team bundle reference data.");
      for (const bundle of resolveAssignedPermissionBundles(bundles, rawIds)) {
        layers.push({ scope: "team", sourceId: `team:${team.id}/bundle:${bundle.id}@${bundle.revision}`, label: `Team ${team.name || team.id}: ${bundle.label} (rev ${bundle.revision})`, values: bundle.toolPermissions });
      }
    }
    if (roleDefinition) {
      layers.push({ scope: "role", sourceId: `role-template:${roleDefinition.id || roleId}`, label: `Role ${roleDefinition.label || roleDefinition.id} template`, values: studioPermissionTemplate(roleDefinition.permissionTemplateKey, user, role) });
      for (const bundle of resolveAssignedPermissionBundles(bundles, roleDefinition.permissionBundleIds || [])) {
        layers.push({ scope: "role", sourceId: `bundle:${bundle.id}@${bundle.revision}`, label: `Role bundle ${bundle.label} (rev ${bundle.revision})`, values: bundle.toolPermissions });
      }
      layers.push({ scope: "role", sourceId: `role:${roleDefinition.id || roleId}`, label: `Role ${roleDefinition.label || roleDefinition.id} overrides`, values: parseObject(roleDefinition.toolPermissions) });
    }
    if (includeUser) layers.push({ scope: "user", sourceId: `user:${user?.id || "current"}`, label: "User-specific overrides", values: parseObject(user?.toolPermissions) });
    return { layers, roleDefinition, department, roleId };
  }

  function previewToolPermissionMatrix(role: string, departmentId: string | null, proposedSettings: any) {
    // Evaluate through the EXACT same layering algorithm as live authorize().
    // The synthetic department is a stable property of this preview subject.
    const user = { id: "preview", employment: { department: { name: departmentId || "" } } };
    const configured = { ...(proposedSettings || {}) };
    const layers = toolPermissionLayers(role, user, false, configured).layers;
    const resolution = resolveClusterEffectiveState(layers);
    return Object.fromEntries(CLUSTER_TOOL_PERMISSION_KEYS.map((tool) => [tool, { level: ["owner", "admin"].includes(role) ? "manage" : String(resolution.values[tool] || "none"), provenance: resolution.provenance[tool] || null }]));
  }

  function configuredToolPermissionsForRole(role: string | null | undefined, user?: any) {
    const roleId = String(role || "member").trim().toLowerCase();
    if (["owner", "admin"].includes(roleId)) return allManageToolPermissions();
    return resolveClusterEffectiveState(toolPermissionLayers(role, user, false).layers).values as Record<ClusterToolPermissionKey, string>;
  }

  function getToolPermissionLevel(user: any, role: string | null | undefined, tool: string) {
    if (isUserAccessInactive(user)) return "none";
    if (["owner", "admin"].includes(String(role || ""))) return "manage";
    if (!(CLUSTER_TOOL_PERMISSION_KEYS as readonly string[]).includes(tool)) return "none";
    const resolved = resolveClusterEffectiveState(toolPermissionLayers(role, user, true).layers);
    return String(resolved.values[tool as ClusterToolPermissionKey] || "none");
  }

  function explainToolPermission(user: any, role: string | null | undefined, tool: string) {
    const normalizedRole = String(role || "member");
    if (isUserAccessInactive(user)) {
      const reason = isUserAccessExpired(user) ? "The user's access expiration date has passed." : "This person's account is disabled, suspended, archived or erased.";
      return { tool, level: "none", source: "account-inactive", reasons: [reason], role: normalizedRole, explanation: createClusterExplanation({ code: "ACCESS_TOOL_PERMISSION", title: `${tool} permission`, summary: "Effective permission is none because the account is inactive.", outcome: "none", reasons: [reason] }) };
    }
    if (["owner", "admin"].includes(normalizedRole)) {
      const reasons = [`Workspace role ${normalizedRole} grants manage access.`];
      return { tool, level: "manage", source: "workspace-role", reasons, role: normalizedRole, explanation: createClusterExplanation({ code: "ACCESS_TOOL_PERMISSION", title: `${tool} permission`, summary: `Effective permission is manage.`, outcome: "manage", reasons, evidence: [{ kind: "effective-state", label: `Workspace role ${normalizedRole}`, detail: "manage" }] }) };
    }
    if (!(CLUSTER_TOOL_PERMISSION_KEYS as readonly string[]).includes(tool)) {
      const reasons = [`Unknown tool permission key ${tool}.`];
      return { tool, level: "none", source: "invalid-tool", reasons, role: normalizedRole, explanation: createClusterExplanation({ code: "ACCESS_TOOL_PERMISSION", title: `${tool} permission`, summary: "Effective permission is none because the tool key is unknown.", outcome: "none", reasons, evidence: [{ kind: "permission-key", label: "Unknown tool permission key", detail: tool }] }) };
    }
    const key = tool as ClusterToolPermissionKey;
    const context = toolPermissionLayers(role, user, true);
    const resolved = resolveClusterEffectiveState(context.layers);
    const level = String(resolved.values[key] || "none");
    const provenance = resolved.provenance[key];
    const reasons = (provenance?.chain || []).map((entry) => `${entry.label} sets ${tool} to ${String(entry.value)}.`);
    if (!reasons.length) reasons.push(`No permission layer defines ${tool}; access resolves to none.`);
    const effective = provenance?.effective;
    const source = effective?.scope === "user" ? "user-override" : effective?.scope === "role" ? "studio-role-policy" : effective?.scope === "team" ? "studio-team-bundle" : effective?.scope === "department" ? "department-policy" : "workspace-role-default";
    return {
      tool,
      level,
      source,
      reasons,
      role: normalizedRole,
      department: context.department?.label || context.department?.id || workforceAuthorityProjection(user).department || null,
      effectiveState: { value: level, provenance: provenance || null },
      explanation: createClusterExplanation({
        code: "ACCESS_TOOL_PERMISSION",
        title: `${tool} permission`,
        summary: `Effective permission is ${level}.`,
        outcome: level,
        reasons,
        evidence: (provenance?.chain || []).map((entry) => ({ kind: "effective-state-layer", label: entry.label, detail: String(entry.value), metadata: { scope: entry.scope, sourceId: entry.sourceId, order: entry.order } })),
        metadata: { tool, role: normalizedRole, effectiveSource: effective?.sourceId || null },
      }),
    };
  }

  function hasToolPermission(user: any, role: string | null | undefined, tool: string, min = "view") {
    if (!(CLUSTER_TOOL_PERMISSION_KEYS as readonly string[]).includes(tool)) return false;
    return (TOOL_PERMISSION_ORDER[getToolPermissionLevel(user, role, tool)] || 0) >= (TOOL_PERMISSION_ORDER[min] || 0);
  }

  function getProjectPermissionLevel(user: any, role: string | null | undefined, project: any) {
    if (isUserAccessInactive(user)) return "none";
    if (["owner", "admin"].includes(String(role || ""))) return "manage";
    const base = (() => {
      const permissions = parseObject(user?.projectPermissions);
      const explicit = permissions[project.id];
      if (explicit) return String(explicit);
      if (isExternalCollaboratorRole(user, role)) return String(project?.source || "").toLowerCase() === "external" ? "view" : "none";
      const membership = projectMembershipForUser(project, user?.id);
      if (membershipIsLead(membership)) return "manage";
      if (membership) return ["view", "contribute", "manage"].includes(String(membership.accessLevel)) ? String(membership.accessLevel) : "none";
      return "view";
    })();
    // Project policies restrict even explicit user-project overrides and Project Leads.
    // Admin recovery remains governed by the existing privileged-role boundary.
    return capProjectLevelForTool(base, project, "projects");
  }

  function explainProjectPermission(user: any, role: string | null | undefined, project: any) {
    const normalizedRole = String(role || "member");
    const inheritedCap = projectToolCeiling(project, "projects");
    // Explain below using the same effective ceiling as access enforcement.
    if (isUserAccessInactive(user)) return { projectId: project?.id, level: "none", source: "account-inactive", reasons: [isUserAccessExpired(user) ? "The user's access expiration date has passed." : "This person's account is disabled, archived, suspended or erased."] };
    if (["owner", "admin"].includes(normalizedRole)) return { projectId: project?.id, level: "manage", source: "workspace-role", reasons: [`Workspace role ${normalizedRole} grants project management access.`] };
    const explicit = parseObject(user?.projectPermissions)[project?.id];
    if (explicit) return { projectId: project?.id, level: getProjectPermissionLevel(user, role, project), source: inheritedCap ? "project-bundle-ceiling" : "user-project-override", reasons: [`A user-specific project override sets access to ${String(explicit)}.`, ...(inheritedCap ? [`Project bundle ceiling limits Projects to ${inheritedCap}.`] : [])] };
    if (isExternalCollaboratorRole(user, role)) {
      const level = String(project?.source || "").toLowerCase() === "external" ? "view" : "none";
      return { projectId: project?.id, level: getProjectPermissionLevel(user, role, project), source: inheritedCap ? "project-bundle-ceiling" : "external-collaborator-policy", reasons: [level === "view" ? "External collaborators may view externally sourced projects." : "External collaborators are denied implicit access to internal projects.", ...(inheritedCap ? [`Project bundle ceiling limits Projects to ${inheritedCap}.`] : [])] };
    }
    const membership = projectMembershipForUser(project, user?.id);
    if (membershipIsLead(membership)) return { projectId: project?.id, level: getProjectPermissionLevel(user, role, project), source: inheritedCap ? "project-bundle-ceiling" : "project-membership-lead", reasons: ["Normalized Project Membership marks this user as a project lead.", ...(inheritedCap ? [`Project bundle ceiling limits Projects to ${inheritedCap}.`] : [])] };
    if (membership) {
      const level = ["view", "contribute", "manage"].includes(String(membership.accessLevel)) ? String(membership.accessLevel) : "none";
      return { projectId: project?.id, level: getProjectPermissionLevel(user, role, project), source: inheritedCap ? "project-bundle-ceiling" : "project-membership", reasons: [`Normalized Project Membership grants ${level} access.`, ...(inheritedCap ? [`Project policy limits Projects to ${inheritedCap}.`] : [])] };
    }
    return { projectId: project?.id, level: getProjectPermissionLevel(user, role, project), source: inheritedCap ? "project-bundle-ceiling" : "workspace-project-default", reasons: ["Workspace members receive baseline project view access.", ...(inheritedCap ? [`Project policy limits Projects to ${inheritedCap}.`] : [])] };
  }

  function hasProjectPermission(user: any, role: string | null | undefined, project: any, min = "view") {
    return (PROJECT_PERMISSION_ORDER[getProjectPermissionLevel(user, role, project)] || 0) >= (PROJECT_PERMISSION_ORDER[min] || 0);
  }

  function hasProjectResourceAccess(user: any, role: string | null | undefined, project: any, rules: any[], min = "view") {
    if (isUserAccessInactive(user)) return false;
    if (["owner", "admin"].includes(String(role || ""))) return true;
    const base = getProjectPermissionLevel(user, role, project);
    const override = resolveAccessRuleLevel(user, role, "project", project.id, project.id, rules, base);
    const effective = capProjectLevelForTool(override ?? base, project, "projects");
    return (PROJECT_PERMISSION_ORDER[effective] || 0) >= (PROJECT_PERMISSION_ORDER[min] || 0);
  }

  function isProjectLead(user: any, project: any) {
    if (!user?.id) return false;
    const membership = projectMembershipForUser(project, user.id);
    if (membership) return membershipIsLead(membership);
    return false;
  }

  function canArchiveProject(user: any, role: string | null | undefined, decorated: any, project: any) {
    return Boolean((!isUserAccessInactive(user) && decorated?.isAdmin) || hasProjectPermission(user, role, project, "manage"));
  }

  function targetTool(targetKind: string) {
    return TARGET_TOOL[String(targetKind || "")] || null;
  }

  function accessSubjectMatchesUser(rule: any, user: any, role?: string | null) {
    if (isUserAccessInactive(user)) return false;
    if (rule.subjectKind === "all") return true;
    if (!user) return false;
    if (rule.subjectKind === "member") return rule.subjectId === user.id;
    if (rule.subjectKind === "team") {
      const subjectId = String(rule.subjectId || "").trim();
      if (!subjectId) return false;
      return (user?.studioTeamMemberships || []).some((membership: any) => {
        if (membership?.archived || membership?.team?.archived) return false;
        return String(membership?.teamId || membership?.team?.id || "").trim() === subjectId;
      });
    }
    if (rule.subjectKind === "external") return isExternalCollaboratorRole(user, role);
    return false;
  }

  function accessRulesForTarget(rules: any[], targetKind: string, targetId: string, projectId?: string | null) {
    const now = Date.now();
    return rules.filter((rule) => {
      if (rule.status !== "active") return false;
      if (rule.expiresAt && new Date(rule.expiresAt).getTime() <= now) return false;
      const direct = DIRECT_ACCESS_TARGET_KINDS.has(targetKind) && rule.targetKind === targetKind && rule.targetId === targetId;
      const projectRule = targetKind !== "project" && rule.targetKind === "project" && rule.targetId === projectId;
      return direct || projectRule;
    });
  }

  function resolveAccessRuleLevel(user: any, role: string | null | undefined, targetKind: string, targetId: string, projectId: string | null | undefined, rules: any[], baseLevel = "none") {
    const scoped = accessRulesForTarget(rules, targetKind, targetId, projectId);
    if (!scoped.length) return null;
    const matching = scoped.filter((rule) => accessSubjectMatchesUser(rule, user, role));
    if (matching.some((rule) => rule.effect === "deny")) return "none";
    const legacyAllows = matching.filter(isExclusiveAccessAllow);
    // Existing explicit allowlists remain exclusive: a new F10 grant is not a
    // shortcut around a deliberately restricted Project or its deny rules.
    if (!legacyAllows.length && scoped.some(isExclusiveAccessAllow)) return "none";
    const additiveAllows = matching.filter((rule) => rule.effect === "allow" && rule.governedGrantId);
    const allows = [...legacyAllows, ...additiveAllows];
    if (!allows.length) return null;
    const startingLevel = legacyAllows.length ? "none" : baseLevel;
    return allows.reduce((best, rule) => ((PROJECT_PERMISSION_ORDER[rule.level] || 0) > (PROJECT_PERMISSION_ORDER[best] || 0) ? rule.level : best), startingLevel);
  }

  function hasTargetAccess(user: any, role: string | null | undefined, targetKind: string, targetId: string, project: any | null | undefined, rules: any[], min = "view") {
    if (isUserAccessInactive(user)) return false;
    if (["owner", "admin"].includes(String(role || ""))) return true;

    const tool = targetTool(targetKind);
    let toolCap = tool ? toolLevelAsProjectLevel(getToolPermissionLevel(user, role, tool)) : "none";
    if (targetKind === "board" && String(project?.source || "").toLowerCase() === "system-tickets") {
      toolCap = lowerAccessLevel(toolCap, toolLevelAsProjectLevel(getToolPermissionLevel(user, role, "tickets")));
    }
    if (project) toolCap = capProjectLevelForTool(capProjectLevelForTool(toolCap, project, "projects"), project, tool || "projects");
    if ((PROJECT_PERMISSION_ORDER[toolCap] || 0) < (PROJECT_PERMISSION_ORDER[min] || 0)) return false;

    const resourceBase = project ? getProjectPermissionLevel(user, role, project) : toolCap;
    const override = resolveAccessRuleLevel(user, role, targetKind, targetId, project?.id || null, rules, resourceBase);
    const resourceLevel = override ?? resourceBase;
    const effective = lowerAccessLevel(resourceLevel, toolCap);
    return (PROJECT_PERMISSION_ORDER[effective] || 0) >= (PROJECT_PERMISSION_ORDER[min] || 0);
  }

  async function identityForRequest(request: FastifyRequest): Promise<RequestIdentity> {
    let cached = identityCache.get(request);
    if (!cached) {
      cached = (async () => {
        const user = await getCurrentUser(request);
        if (!user) return { user: null, decorated: null, role: null };
        const decorated = await decorateUserForClient(user);
        return { user, decorated, role: decorated?.workspaceRole || null };
      })();
      identityCache.set(request, cached);
    }
    return cached;
  }

  // An unavailable Access Rule store is NOT equivalent to an empty rule set.
  // In particular, falling back to [] would erase explicit deny rules and could
  // restore inherited view/edit permissions during a database outage.
  async function readActiveRules(clauses: any[]): Promise<any[]> {
    if (!clauses.length) return [];
    const rules = await prisma.accessRule.findMany({
      where: { status: "active", OR: clauses },
      select: AUTHORIZATION_RULE_SELECT,
    });
    if (!Array.isArray(rules)) throw new Error("Access Rule query returned an invalid response.");
    return rules;
  }

  async function activeRulesForTarget(request: FastifyRequest, targetKind: string, targetId: string, projectId?: string | null) {
    let requestRules = ruleCache.get(request);
    if (!requestRules) { requestRules = new Map(); ruleCache.set(request, requestRules); }
    const cacheKey = `${targetKind}:${targetId}:${projectId || ""}`;
    const existing = requestRules.get(cacheKey);
    if (existing) return existing;
    const or: any[] = DIRECT_ACCESS_TARGET_KINDS.has(targetKind) ? [{ targetKind, targetId }] : [];
    if (targetKind !== "project" && projectId) or.push({ targetKind: "project", targetId: projectId });
    const pending = readActiveRules(or);
    requestRules.set(cacheKey, pending);
    return pending;
  }

  async function actorIdentity(actor: FastifyRequest | AuthorizationActor | null | undefined): Promise<RequestIdentity> {
    if (actor && typeof actor === "object" && "raw" in actor && "url" in actor) return identityForRequest(actor as FastifyRequest);
    const supplied = actor as AuthorizationActor | null | undefined;
    if (!supplied?.user) return { user: null, decorated: null, role: null };
    const decorated = supplied.decorated ?? await decorateUserForClient(supplied.user);
    return { user: supplied.user, decorated, role: supplied.role ?? decorated?.workspaceRole ?? null };
  }

  async function rulesForDecision(actor: FastifyRequest | AuthorizationActor | null | undefined, targetKind: string, targetId: string, projectId?: string | null, supplied?: any[] | null) {
    if (supplied) return supplied;
    if (actor && typeof actor === "object" && "raw" in actor && "url" in actor) return activeRulesForTarget(actor as FastifyRequest, targetKind, targetId, projectId);
    const or: any[] = DIRECT_ACCESS_TARGET_KINDS.has(targetKind) ? [{ targetKind, targetId }] : [];
    if (targetKind !== "project" && projectId) or.push({ targetKind: "project", targetId: projectId });
    return readActiveRules(or);
  }

  function baseDecision(action: AuthorizationAction, resource: AuthorizationResource, context: AuthorizationContext, input: { allowed: boolean; code: string; reason: string; contributors?: AuthorizationDecision["contributors"] }): AuthorizationDecision {
    return {
      allowed: input.allowed,
      code: input.code,
      reason: input.reason,
      action,
      resource: decisionResource(resource),
      contributors: input.contributors || [],
      requiredElevationScope: context.requiredElevationScope || null,
      disclosure: context.disclosure || [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Canonical Cluster authorization decision authority.
   *
   * Feature code should ask this function whether an actor may perform an action
   * against a resource and should consume the returned disclosure/elevation
   * obligations rather than rebuilding role, tool, project, or access-rule logic.
   */
  async function authorize(actor: FastifyRequest | AuthorizationActor | null | undefined, action: AuthorizationAction, resource: AuthorizationResource, context: AuthorizationContext = {}): Promise<AuthorizationDecision> {
    const identity = await actorIdentity(actor);
    const minimum = String(context.minimum || minimumForAuthorizationAction(action));
    const contributors: AuthorizationDecision["contributors"] = [];

    if (!identity.user) {
      if (!authRequired) return baseDecision(action, resource, context, { allowed: true, code: "AUTH_DISABLED", reason: "Authentication is disabled for this deployment.", contributors: [{ source: "deployment", id: "auth-disabled", effect: "allow", detail: "The deployment authentication boundary is disabled." }] });
      return baseDecision(action, resource, context, { allowed: false, code: "AUTH_REQUIRED", reason: "Login required.", contributors: [{ source: "authentication", effect: "deny", detail: "No authenticated actor is present." }] });
    }

    const role = String(identity.role || "member");
    if (isUserAccessExpired(identity.user)) {
      return baseDecision(action, resource, context, { allowed: false, code: "ACCESS_EXPIRED", reason: "The actor access window has expired.", contributors: [{ source: "user-access-expiry", id: identity.user.id, effect: "deny", detail: "The user access expiration timestamp is in the past." }] });
    }

    if (isUserAccessInactive(identity.user)) {
      return baseDecision(action, resource, context, { allowed: false, code: "ACCOUNT_INACTIVE", reason: "This account cannot currently access Cluster resources.", contributors: [{ source: "account-lifecycle", effect: "deny", detail: "The account is disabled, suspended, archived or privacy-erased." }] });
    }

    if (identity.decorated?.isAdmin || ["owner", "admin"].includes(role)) {
      contributors.push({ source: "workspace-role", id: role, effect: "allow", detail: `Workspace role ${role} grants administrative access.` });
      return baseDecision(action, resource, context, { allowed: true, code: "ALLOW_ADMIN", reason: `Workspace role ${role} grants this action.`, contributors });
    }

    if (resource.kind === "workspace") {
      const allowed = action !== "admin" && action !== "manage";
      contributors.push({ source: "workspace-role", id: role, effect: allowed ? "allow" : "deny", detail: allowed ? `Workspace role ${role} is an authenticated workspace member.` : `Workspace role ${role} is not an administrator.` });
      return baseDecision(action, resource, context, { allowed, code: allowed ? "ALLOW_WORKSPACE_MEMBER" : "ADMIN_REQUIRED", reason: allowed ? "Authenticated workspace membership permits this action." : "Administrator role required.", contributors });
    }

    if (resource.kind === "tool") {
      const toolMinimum = minimum === "contribute" ? "edit" : minimum;
      const explanation = explainToolPermission(identity.user, identity.role, resource.tool as ClusterToolPermissionKey);
      const level = getToolPermissionLevel(identity.user, identity.role, resource.tool as ClusterToolPermissionKey);
      const allowed = (TOOL_PERMISSION_ORDER[level] || 0) >= (TOOL_PERMISSION_ORDER[toolMinimum] || 0);
      contributors.push(...(explanation?.reasons || []).map((detail: string) => ({ source: "tool-permission", id: String(resource.tool), effect: allowed ? "allow" as const : "deny" as const, detail })));
      return baseDecision(action, resource, context, { allowed, code: allowed ? "ALLOW_TOOL" : "TOOL_PERMISSION_DENIED", reason: allowed ? `${String(resource.tool)} ${toolMinimum} permission is satisfied.` : `${String(resource.tool)} ${toolMinimum} access required.`, contributors });
    }

    if (resource.kind === "project") {
      const project = resource.project;
      if (!project || project.archived) return baseDecision(action, resource, context, { allowed: false, code: "RESOURCE_NOT_FOUND", reason: "Project is unavailable.", contributors: [{ source: "resource-state", id: project?.id || null, effect: "deny", detail: "The project does not exist or is archived." }] });
      if (context.tool) {
        const toolMinimum = toolMinimumForProjectLevel(minimum);
        const unscopedLevel = getToolPermissionLevel(identity.user, identity.role, context.tool as ClusterToolPermissionKey);
        const scopedCap = projectToolCeiling(project, context.tool);
        const toolLevel = scopedCap && TOOL_PERMISSION_ORDER[scopedCap] < TOOL_PERMISSION_ORDER[unscopedLevel] ? scopedCap : unscopedLevel;
        const toolAllowed = (TOOL_PERMISSION_ORDER[toolLevel] || 0) >= (TOOL_PERMISSION_ORDER[toolMinimum] || 0);
        contributors.push({ source: "tool-permission", id: String(context.tool), effect: toolAllowed ? "allow" : "deny", detail: `${String(context.tool)} resolves to ${toolLevel}; ${toolMinimum} is required.` });
        if (!toolAllowed) return baseDecision(action, resource, context, { allowed: false, code: "TOOL_PERMISSION_DENIED", reason: `${String(context.tool)} ${toolMinimum} access required.`, contributors });
      }
      const rules = await rulesForDecision(actor, "project", String(project.id), String(project.id), context.rules);
      const baseLevel = getProjectPermissionLevel(identity.user, identity.role, project);
      const override = resolveAccessRuleLevel(identity.user, identity.role, "project", String(project.id), String(project.id), rules, baseLevel);
      const effective = capProjectLevelForTool(override ?? baseLevel, project, "projects");
      const allowed = (PROJECT_PERMISSION_ORDER[effective] || 0) >= (PROJECT_PERMISSION_ORDER[minimum] || 0);
      const ceiling = projectToolCeiling(project, "projects");
      if (ceiling) contributors.push({ source: "project-policy", id: String(project.id), effect: (PROJECT_PERMISSION_ORDER[effective] || 0) >= (PROJECT_PERMISSION_ORDER[minimum] || 0) ? "allow" : "deny", detail: `Project bundle ceiling for Projects is ${ceiling}; Access Rule allows cannot exceed it.` });
      contributors.push({ source: "project-permission", id: String(project.id), effect: allowed ? "allow" : "deny", detail: `Project base=${baseLevel}${override ? `, access-rule=${override}` : ""}, effective=${effective}, required=${minimum}.` });
      for (const rule of rules.filter((rule: any) => accessSubjectMatchesUser(rule, identity.user, identity.role))) contributors.push({ source: "access-rule", id: String(rule.id || ""), effect: rule.effect === "deny" ? "deny" : "allow", detail: `${rule.subjectKind}:${rule.subjectId || rule.subjectName || "all"} ${rule.effect} ${rule.level}.` });
      return baseDecision(action, resource, context, { allowed, code: allowed ? "ALLOW_PROJECT" : "PROJECT_PERMISSION_DENIED", reason: allowed ? `Project ${minimum} access is satisfied.` : `Project ${minimum} access required.`, contributors });
    }

    if (resource.kind === "target") {
      const tool = targetTool(resource.targetKind);
      let toolCap = tool ? toolLevelAsProjectLevel(getToolPermissionLevel(identity.user, identity.role, tool)) : "none";
      if (resource.targetKind === "board" && String(resource.project?.source || "").toLowerCase() === "system-tickets") {
        toolCap = lowerAccessLevel(toolCap, toolLevelAsProjectLevel(getToolPermissionLevel(identity.user, identity.role, "tickets")));
      }
      if (resource.project) toolCap = capProjectLevelForTool(capProjectLevelForTool(toolCap, resource.project, "projects"), resource.project, tool || "projects");
      const toolAllowed = (PROJECT_PERMISSION_ORDER[toolCap] || 0) >= (PROJECT_PERMISSION_ORDER[minimum] || 0);
      contributors.push({ source: "tool-cap", id: tool || resource.targetKind, effect: toolAllowed ? "allow" : "deny", detail: `Tool cap resolves to ${toolCap}; ${minimum} is required.` });
      if (!toolAllowed) return baseDecision(action, resource, context, { allowed: false, code: "TOOL_PERMISSION_DENIED", reason: `${resource.targetKind} ${minimum} access is blocked by the tool permission cap.`, contributors });
      const rules = await rulesForDecision(actor, resource.targetKind, resource.targetId, resource.project?.id || null, context.rules);
      const resourceBase = resource.project ? getProjectPermissionLevel(identity.user, identity.role, resource.project) : toolCap;
      const override = resolveAccessRuleLevel(identity.user, identity.role, resource.targetKind, resource.targetId, resource.project?.id || null, rules, resourceBase);
      const resourceLevel = override ?? resourceBase;
      const effective = lowerAccessLevel(resourceLevel, toolCap);
      const allowed = (PROJECT_PERMISSION_ORDER[effective] || 0) >= (PROJECT_PERMISSION_ORDER[minimum] || 0);
      const scopedCeiling = resource.project ? projectToolCeiling(resource.project, tool || "projects") : null;
      if (scopedCeiling) contributors.push({ source: "project-policy", id: String(resource.project?.id), effect: allowed ? "allow" : "deny", detail: `Project bundle ceiling for ${tool} is ${scopedCeiling}.` });
      contributors.push({ source: "resource-permission", id: resource.targetId, effect: allowed ? "allow" : "deny", detail: `Resource base=${resourceBase}${override ? `, access-rule=${override}` : ""}, tool-cap=${toolCap}, effective=${effective}, required=${minimum}.` });
      for (const rule of rules.filter((rule: any) => accessSubjectMatchesUser(rule, identity.user, identity.role))) contributors.push({ source: "access-rule", id: String(rule.id || ""), effect: rule.effect === "deny" ? "deny" : "allow", detail: `${rule.subjectKind}:${rule.subjectId || rule.subjectName || "all"} ${rule.effect} ${rule.level}.` });
      return baseDecision(action, resource, context, { allowed, code: allowed ? "ALLOW_TARGET" : "TARGET_PERMISSION_DENIED", reason: allowed ? `${resource.targetKind} ${minimum} access is satisfied.` : `${resource.targetKind} ${minimum} access required.`, contributors });
    }

    if (resource.kind === "user") {
      const ownerUserId = String(resource.ownerUserId || "");
      const isSelf = Boolean(ownerUserId && ownerUserId === identity.user.id);
      const toolMinimum = minimum === "contribute" ? "edit" : minimum;
      const selfAllowed = isSelf || (!ownerUserId && resource.allowUnowned);
      const selfToolAllowed = selfAllowed && hasToolPermission(identity.user, identity.role, resource.tool as ClusterToolPermissionKey, toolMinimum);
      const manageAllowed = hasToolPermission(identity.user, identity.role, resource.tool as ClusterToolPermissionKey, "manage");
      const allowed = action === "disclose-private" ? (isSelf || manageAllowed) : (selfToolAllowed || manageAllowed);
      contributors.push({ source: isSelf ? "resource-owner" : "tool-permission", id: ownerUserId || String(resource.tool), effect: allowed ? "allow" : "deny", detail: isSelf ? `Actor owns user-scoped resource ${ownerUserId}.` : `Another user's resource requires ${String(resource.tool)} manage permission.` });
      return baseDecision(action, resource, context, { allowed, code: allowed ? "ALLOW_USER_SCOPE" : "USER_SCOPE_DENIED", reason: allowed ? "User-scoped authorization is satisfied." : `${String(resource.tool)} access to another user's resource requires manage permission.`, contributors });
    }

    return baseDecision(action, resource, context, { allowed: false, code: "DENY_DEFAULT", reason: "No authorization rule permitted this action.", contributors: [{ source: "default", effect: "deny", detail: "Authorization is deny-by-default." }] });
  }

  function sendDecision(reply: FastifyReply, decision: AuthorizationDecision) {
    const status = decision.code === "AUTH_REQUIRED" ? 401 : decision.code === "RESOURCE_NOT_FOUND" ? 404 : 403;
    reply.code(status).send({ ok: false, code: decision.code, error: decision.reason });
  }

  async function requireTarget(request: FastifyRequest, reply: FastifyReply, targetKind: string, targetId: string, project: any | null | undefined, min = "view") {
    const decision = await authorize(request, min === "manage" ? "manage" : min === "contribute" ? "contribute" : "view", { kind: "target", targetKind, targetId, project }, { minimum: min });
    if (!decision.allowed) { sendDecision(reply, decision); return false; }
    return true;
  }

  async function requestCanTarget(request: FastifyRequest, targetKind: string, targetId: string, project: any | null | undefined, min = "view") {
    const decision = await authorize(request, min === "manage" ? "manage" : min === "contribute" ? "contribute" : "view", { kind: "target", targetKind, targetId, project }, { minimum: min });
    return decision.allowed;
  }

  async function filterTargetsForRequest(request: FastifyRequest, targets: any[], targetKind: string, project: any | null | undefined, min = "view", suppliedRules?: any[] | null) {
    if (!targets.length) return [];
    const identity = await identityForRequest(request);
    if (!identity.user) return authRequired ? [] : targets;
    if (identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || ""))) return targets;
    const targetIds = [...new Set(targets.map((target) => String(target?.id || "").trim()).filter(Boolean))];
    const or: any[] = targetIds.length && DIRECT_ACCESS_TARGET_KINDS.has(targetKind) ? [{ targetKind, targetId: { in: targetIds } }] : [];
    if (project?.id && targetKind !== "project") or.push({ targetKind: "project", targetId: project.id });
    const rules = suppliedRules || (or.length
      ? await readActiveRules(or)
      : []);
    return targets.filter((target) => hasTargetAccess(identity.user, identity.role, targetKind, String(target?.id || ""), project, rules, min));
  }

  async function filterCardsForRequest(request: FastifyRequest, cards: any[], project: any | null | undefined, min = "view", suppliedRules?: any[] | null) {
    if (!cards.length) return [];
    const identity = await identityForRequest(request);
    if (!identity.user) return authRequired ? [] : cards;
    if (identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || ""))) return cards;

    const boardIds = [...new Set(cards.map((card) => String(card?.list?.board?.id || card?.boardId || "").trim()).filter(Boolean))];
    const or: any[] = boardIds.length ? [{ targetKind: "board", targetId: { in: boardIds } }] : [];
    if (project?.id) or.push({ targetKind: "project", targetId: project.id });
    const rules = suppliedRules || (or.length
      ? await readActiveRules(or)
      : []);
    const ticketMinimum = toolMinimumForProjectLevel(min);
    return cards.filter((card) => {
      const boardId = String(card?.list?.board?.id || card?.boardId || "").trim();
      if (boardId && !hasTargetAccess(identity.user, identity.role, "board", boardId, project, rules, min)) return false;
      if (!boardId && !hasTargetAccess(identity.user, identity.role, "card", String(card?.id || ""), project, rules, min)) return false;
      return card.workItemKind !== "ticket" || hasToolPermission(identity.user, identity.role, "tickets", ticketMinimum);
    });
  }

  function activityTargetKindForEntityType(value: unknown) {
    const kind = String(value || "").trim().toLowerCase().replaceAll("-", "_");
    if (["project"].includes(kind)) return "project";
    if (["board"].includes(kind)) return "board";
    if (["card", "ticket"].includes(kind)) return "card";
    if (kind === "whiteboard") return "whiteboard";
    if (kind === "library") return "library";
    if (["file", "project_file", "asset"].includes(kind)) return "file";
    if (["review_asset", "review_comment", "review_version"].includes(kind)) return "review_asset";
    if (["timeline", "timeline_item"].includes(kind)) return "timeline";
    if (["calendar", "calendar_event"].includes(kind)) return "calendar";
    if (["schedule", "schedule_block", "scheduler", "scheduler_block"].includes(kind)) return "schedule";
    if (["build", "build_artifact"].includes(kind)) return "build";
    if (["release", "release_note"].includes(kind)) return "release";
    if (["qa", "qa_plan", "qa_session"].includes(kind)) return kind === "qa" ? "qa" : kind;
    if (["time", "time_entry"].includes(kind)) return "time";
    if (["meeting"].includes(kind)) return "meeting";
    if (["control", "project_control", "project_control_record"].includes(kind)) return "control";
    if (["user", "person", "profile"].includes(kind)) return "user";
    return null;
  }

  function activityEntityTargetKind(event: any) {
    return activityTargetKindForEntityType(event?.entityType);
  }

  function automationToolForEntityType(value: unknown) {
    const kind = String(value || "").trim().toLowerCase().replaceAll("-", "_");
    if (["ticket", "issue"].includes(kind)) return "tickets";
    const targetKind = activityTargetKindForEntityType(kind);
    if (targetKind) return targetTool(targetKind);
    return activityEntityTool({ entityType: kind });
  }

  function activityEntityTool(event: any) {
    const kind = String(event?.entityType || "").trim().toLowerCase().replaceAll("-", "_");
    if (["team", "team_membership"].includes(kind)) return "people";
    if (["settings", "studio_settings"].includes(kind)) return "settings";
    if (["packet", "packets"].includes(kind)) return "packets";
    if (["integration", "webhook"].includes(kind)) return "integrations";
    if (["notification", "notifications"].includes(kind)) return "inbox";
    return null;
  }

  async function authorizeActivityEvent(actor: FastifyRequest | AuthorizationActor | null | undefined, event: any, context: AuthorizationContext = {}): Promise<AuthorizationDecision> {
    const minimum = String(context.minimum || "view");
    const action: AuthorizationAction = minimum === "manage" ? "manage" : minimum === "contribute" ? "contribute" : "view";
    const project = event?.project || event?.card?.list?.board?.project || null;
    const boardId = String(event?.boardId || event?.card?.list?.board?.id || "").trim();
    const cardId = String(event?.cardId || (String(event?.entityType || "").toLowerCase() === "card" ? event?.entityId : "") || "").trim();
    const whiteboardId = String(event?.whiteboardId || "").trim();
    const entityId = String(event?.entityId || "").trim();
    const entityTargetKind = activityEntityTargetKind(event);
    const decisions: AuthorizationDecision[] = [];
    const decide = async (resource: AuthorizationResource, extra: AuthorizationContext = {}) => {
      const decision = await authorize(actor, action, resource, { ...context, ...extra, minimum });
      decisions.push(decision);
      return decision;
    };
    const finish = (decision: AuthorizationDecision) => ({
      ...decision,
      contributors: decisions.flatMap((item) => item.contributors),
      disclosure: decisions.flatMap((item) => item.disclosure),
    });

    if (cardId) {
      if (boardId) {
        const boardDecision = await decide({ kind: "target", targetKind: "board", targetId: boardId, project });
        if (!boardDecision.allowed) return finish(boardDecision);
      }
      const cardDecision = await decide({ kind: "target", targetKind: "card", targetId: cardId, project });
      if (!cardDecision.allowed) return finish(cardDecision);
      if (event?.card?.workItemKind === "ticket" || String(event?.entityType || "").toLowerCase() === "ticket") {
        const ticketDecision = await decide({ kind: "tool", tool: "tickets" }, { minimum: toolMinimumForProjectLevel(minimum) });
        if (!ticketDecision.allowed) return finish(ticketDecision);
      }
      return finish(cardDecision);
    }
    if (boardId) return finish(await decide({ kind: "target", targetKind: "board", targetId: boardId, project }));
    if (whiteboardId) return finish(await decide({ kind: "target", targetKind: "whiteboard", targetId: whiteboardId, project }));
    if (entityTargetKind === "calendar" && entityId) {
      const calendarEvent = await prisma.calendarEvent.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } }).catch(() => null);
      if (!calendarEvent) return baseDecision(action, { kind: "target", targetKind: "calendar", targetId: entityId, project }, context, { allowed: false, code: "RESOURCE_NOT_FOUND", reason: "Calendar event not found.", contributors: [{ source: "calendar-visibility", id: entityId, effect: "deny", detail: "The referenced Calendar event no longer exists." }] });
      const allowed = await canAccessCalendarEvent({ identityForRequest, hasToolPermission, requestCanTarget, requestCanUserScope } as any, actor, calendarEvent, minimum === "manage" ? "manage" : minimum === "contribute" ? "edit" : "view");
      if (!allowed) return baseDecision(action, { kind: "target", targetKind: "calendar", targetId: entityId, project: calendarEvent.project }, context, { allowed: false, code: "CALENDAR_VISIBILITY_DENIED", reason: "Calendar visibility does not permit access to this activity.", contributors: [{ source: "calendar-visibility", id: entityId, effect: "deny", detail: `Calendar event visibility is ${String(calendarEvent.visibility || "project")}.` }] });
      return finish(await decide({ kind: "target", targetKind: "calendar", targetId: entityId, project: calendarEvent.project }));
    }
    if (entityTargetKind && entityId) return finish(await decide({ kind: "target", targetKind: entityTargetKind, targetId: entityId, project }));
    const tool = activityEntityTool(event);
    if (tool) return finish(await decide({ kind: "tool", tool }, { minimum: toolMinimumForProjectLevel(minimum) }));
    if (project) return finish(await decide({ kind: "project", project }));
    return finish(await decide({ kind: "tool", tool: "activity" }, { minimum: toolMinimumForProjectLevel(minimum) }));
  }

  async function filterActivityEventsForUser(user: any, events: any[], min = "view", suppliedDecorated?: any) {
    if (!events.length || !user) return [];
    const decorated = suppliedDecorated ?? await decorateUserForClient(user);
    const role = decorated?.workspaceRole || null;
    if (decorated?.isAdmin || ["owner", "admin"].includes(String(role || ""))) return events;
    const ruleKeys = new Set<string>();
    const or: any[] = [];
    const addTarget = (targetKind: string, targetId: unknown) => {
      const id = String(targetId || "").trim();
      if (!id) return;
      const key = `${targetKind}:${id}`;
      if (ruleKeys.has(key)) return;
      ruleKeys.add(key);
      or.push({ targetKind, targetId: id });
    };
    for (const event of events) {
      const projectId = String(event?.projectId || event?.project?.id || event?.card?.list?.board?.project?.id || "").trim();
      if (projectId) addTarget("project", projectId);
      addTarget("board", event?.boardId || event?.card?.list?.board?.id);
      addTarget("card", event?.cardId);
      addTarget("whiteboard", event?.whiteboardId);
      const targetKind = activityEntityTargetKind(event);
      if (targetKind) addTarget(targetKind, event?.entityId);
    }
    const rules = or.length
      ? await readActiveRules(or)
      : [];
    const actor: AuthorizationActor = { user, decorated, role };
    const visible: any[] = [];
    for (const event of events) {
      const decision = await authorizeActivityEvent(actor, event, { minimum: min, rules, surface: "realtime" });
      if (decision.allowed) visible.push(event);
    }
    return visible;
  }

  async function filterActivityEventsForRequest(request: FastifyRequest, events: any[], min = "view") {
    if (!events.length) return [];
    const identity = await identityForRequest(request);
    if (!identity.user) return authRequired ? [] : events;
    return filterActivityEventsForUser(identity.user, events, min, identity.decorated);
  }

  async function requireProjectResource(request: FastifyRequest, reply: FastifyReply, project: any, tool: string, min = "view") {
    const decision = await authorize(request, min === "manage" ? "manage" : min === "contribute" ? "contribute" : "view", { kind: "project", project }, { minimum: min, tool });
    if (!decision.allowed) { sendDecision(reply, decision); return null; }
    return (await identityForRequest(request)).decorated || { isAdmin: true, workspaceRole: "owner" };
  }

  async function requireProject(request: FastifyRequest, reply: FastifyReply, projectId: string, min = "view") {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.archived) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
      return null;
    }
    if (!(await requireTarget(request, reply, "project", project.id, project, min))) return null;
    return project;
  }

  async function requireList(request: FastifyRequest, reply: FastifyReply, listId: string, min = "contribute") {
    const list = await prisma.boardList.findUnique({ where: { id: listId }, include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } });
    if (!list) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board list not found." });
      return null;
    }
    if (!(await requireTarget(request, reply, "board", list.board.id, list.board.project, min))) return null;
    return list;
  }

  async function requireCard(request: FastifyRequest, reply: FastifyReply, cardId: string, min = "contribute") {
    const card = await prisma.card.findUnique({ where: { id: cardId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
    if (!card) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
      return null;
    }
    const project = card.list.board.project;
    const identity = await identityForRequest(request);
    if (!(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")))) {
      const rules = await readActiveRules([
        { targetKind: "project", targetId: project.id },
        { targetKind: "board", targetId: card.list.board.id },
      ]);
      const action: AuthorizationAction = min === "manage" ? "manage" : min === "contribute" ? "contribute" : "view";
      const boardDecision = await authorize(request, action, { kind: "target", targetKind: "board", targetId: card.list.board.id, project }, { minimum: min, rules });
      if (!boardDecision.allowed) { sendDecision(reply, boardDecision); return null; }
    }
    if (card.workItemKind === "ticket" && !(await requireTool(request, reply, "tickets", toolMinimumForProjectLevel(min)))) return null;
    return card;
  }

  async function requestCanUserScope(request: FastifyRequest, requirement: UserScopedRequirement) {
    const minimum = requirement.minimum || "view";
    const decision = await authorize(request, minimum === "manage" ? "manage" : minimum === "edit" || minimum === "contribute" ? "contribute" : "view", { kind: "user", ownerUserId: requirement.ownerUserId, tool: requirement.tool, allowUnowned: requirement.allowUnowned }, { minimum });
    return decision.allowed;
  }

  async function requireUserScope(request: FastifyRequest, reply: FastifyReply, requirement: UserScopedRequirement) {
    const minimum = requirement.minimum || "view";
    const decision = await authorize(request, minimum === "manage" ? "manage" : minimum === "edit" || minimum === "contribute" ? "contribute" : "view", { kind: "user", ownerUserId: requirement.ownerUserId, tool: requirement.tool, allowUnowned: requirement.allowUnowned }, { minimum });
    if (!decision.allowed) { sendDecision(reply, decision); return null; }
    return (await identityForRequest(request)).decorated || { isAdmin: true, workspaceRole: "owner" };
  }

  async function requireTool(request: FastifyRequest, reply: FastifyReply, tool: string, min = "view") {
    const action: AuthorizationAction = min === "manage" ? "manage" : min === "edit" ? "contribute" : "view";
    const decision = await authorize(request, action, { kind: "tool", tool }, { minimum: min });
    if (!decision.allowed) { sendDecision(reply, decision); return null; }
    return (await identityForRequest(request)).decorated || { isAdmin: true, workspaceRole: "owner" };
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    const decision = await authorize(request, "admin", { kind: "workspace" }, { minimum: "manage" });
    if (!decision.allowed) { sendDecision(reply, decision); return null; }
    return (await identityForRequest(request)).decorated || { isAdmin: true, workspaceRole: "owner" };
  }

  return {
    isUserAccessExpired,
    isExternalCollaboratorRole,
    configuredToolPermissionsForRole,
    getToolPermissionLevel,
    explainToolPermission,
    previewToolPermissionMatrix,
    hasToolPermission,
    getProjectPermissionLevel,
    explainProjectPermission,
    hasProjectPermission,
    hasProjectResourceAccess,
    isProjectLead,
    canArchiveProject,
    targetTool,
    activityTargetKindForEntityType,
    automationToolForEntityType,
    accessSubjectMatchesUser,
    accessRulesForTarget,
    resolveAccessRuleLevel,
    hasTargetAccess,
    identityForRequest,
    authorize,
    sendDecision,
    requireTarget,
    requestCanTarget,
    filterTargetsForRequest,
    filterCardsForRequest,
    authorizeActivityEvent,
    filterActivityEventsForUser,
    filterActivityEventsForRequest,
    requireProjectResource,
    requireProject,
    requireList,
    requireCard,
    requestCanUserScope,
    requireUserScope,
    requireTool,
    requireAdmin,
  };
}

export type AuthorizationService = ReturnType<typeof createAuthorizationService>;
