import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
import { PeopleGovernanceError } from "./people-governance.js";

export type AssignableStudioRole = {
  id: string;
  label: string;
  enabled: boolean;
  privileged: boolean;
};

const DEFAULT_STUDIO_ROLES = [
  ["owner", "Owner"], ["admin", "Admin"], ["producer", "Producer"],
  ["lead", "Lead"], ["member", "Member"], ["developer", "Developer"],
  ["artist", "Artist"], ["qa_lead", "QA Lead"], ["qa", "QA"],
  ["reviewer", "Reviewer"], ["viewer", "Viewer"],
] as const;

const canonicalRoleId = (value: unknown) => String(value || "").trim().toLowerCase();

/**
 * Server-side role policy; names and memberships are not interchangeable.
 * Role keys are immutable and drawn from built-ins or configured definitions.
 * Disabled roles remain visible as historical data, but are not assignable.
 */
export function assignableStudioRoles(settings: Record<string, unknown>): AssignableStudioRole[] {
  const roles = new Map<string, AssignableStudioRole>(
    DEFAULT_STUDIO_ROLES.map(([id, label]) => [id, { id, label, enabled: true, privileged: id === "owner" || id === "admin" }]),
  );
  const overrides = Array.isArray(settings.studioRoleDefinitions) ? settings.studioRoleDefinitions : [];
  for (const candidate of overrides) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Record<string, unknown>;
    const id = canonicalRoleId(raw.id);
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(id)) continue;
    const fallback = roles.get(id);
    roles.set(id, {
      id,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 120) : fallback?.label || id.replace(/_/g, " "),
      enabled: raw.enabled !== false,
      privileged: id === "owner" || id === "admin",
    });
  }
  return [...roles.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function requireAssignableStudioRole(settings: Record<string, unknown>, rawRole: string) {
  const id = canonicalRoleId(rawRole);
  if (id !== rawRole || !/^[a-z][a-z0-9_]{0,47}$/.test(id)) {
    throw new PeopleGovernanceError("ROLE_KEY_INVALID", "Choose an existing Studio role by its immutable key.", 400);
  }
  const role = assignableStudioRoles(settings).find((candidate) => candidate.id === id);
  if (!role || !role.enabled) {
    throw new PeopleGovernanceError("ROLE_NOT_ASSIGNABLE", "That role does not exist or has been disabled.", 409);
  }
  return role;
}

/**
 * Only an existing workspace member can have their role reassigned. All
 * sensitive checks run under one workspace-scoped transaction lock, ensuring
 * two concurrent owner demotions cannot independently remove the last owner.
 */
export async function assignWorkspaceRole(tx: any, input: {
  actorId: string;
  targetUserId: string;
  requestedRole: string;
  settings: Record<string, unknown>;
}) {
  if (input.actorId === input.targetUserId) {
    throw new PeopleGovernanceError("ROLE_SELF_CHANGE_DENIED", "An administrator cannot change their own workspace role.", 403);
  }
  const nextRole = requireAssignableStudioRole(input.settings, input.requestedRole);
  const actorMembership = await tx.workspaceMember.findFirst({
    where: { userId: input.actorId }, orderBy: { workspaceId: "asc" },
    select: { workspaceId: true, role: true },
  });
  if (!actorMembership || !["owner", "admin"].includes(actorMembership.role)) {
    throw new PeopleGovernanceError("ROLE_ADMIN_REQUIRED", "Managing workspace roles requires a Studio administrator.", 403);
  }
  await acquireTransactionAdvisoryLock(tx, `cluster-workspace-role:${actorMembership.workspaceId}`);
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actorMembership.workspaceId, userId: input.targetUserId } },
    select: { workspaceId: true, userId: true, role: true },
  });
  if (!membership) {
    throw new PeopleGovernanceError("ROLE_TARGET_NOT_IN_WORKSPACE", "This account is not a member of your workspace.", 404);
  }
  const previousRole = canonicalRoleId(membership.role);
  if ((previousRole === "owner" || previousRole === "admin" || nextRole.privileged) && actorMembership.role !== "owner") {
    throw new PeopleGovernanceError("ROLE_OWNER_REQUIRED", "Only a workspace owner can assign or remove owner/admin roles.", 403);
  }
  if (previousRole === "owner" && nextRole.id !== "owner") {
    const remainingOwners = await tx.workspaceMember.count({
      where: { workspaceId: actorMembership.workspaceId, role: "owner", userId: { not: input.targetUserId } },
    });
    if (!remainingOwners) {
      throw new PeopleGovernanceError("ROLE_LAST_OWNER", "The last workspace owner cannot be demoted.", 409);
    }
  }
  if (previousRole === nextRole.id) return { changed: false, from: previousRole, to: previousRole, workspaceId: actorMembership.workspaceId };
  await tx.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: actorMembership.workspaceId, userId: input.targetUserId } },
    data: { role: nextRole.id },
  });
  return { changed: true, from: previousRole, to: nextRole.id, workspaceId: actorMembership.workspaceId };
}
