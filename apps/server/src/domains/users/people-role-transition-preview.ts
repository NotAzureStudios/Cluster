import { assignableStudioRoles } from "./people-role-governance.js";

/** Advisory role-transition check. The real update uses workspace transaction
 * locking and repeats every check; this object never conveys permission. */
export function evaluateRoleTransition(input: {
  actorId: string;
  actorRole: string;
  targetUserId: string;
  currentRole: string;
  requestedRole: string;
  expectedProfileRevision: number;
  currentProfileRevision: number;
  otherOwnerCount: number;
  settings: Record<string, unknown>;
}) {
  const role = assignableStudioRoles(input.settings).find((item) => item.id === input.requestedRole);
  const blocked: string[] = [];
  if (!role || !role.enabled) blocked.push("That workspace role is unavailable or disabled.");
  if (input.actorId === input.targetUserId) blocked.push("You cannot change your own workspace role.");
  if (input.currentProfileRevision !== input.expectedProfileRevision) blocked.push("The profile changed. Refresh before changing its role.");
  if (input.currentRole === input.requestedRole) blocked.push("This person already has the selected role.");
  if ((["owner","admin"].includes(input.currentRole) || role?.privileged) && input.actorRole !== "owner") {
    blocked.push("Only a workspace owner can change administrator or owner roles.");
  }
  if (input.currentRole === "owner" && input.requestedRole !== "owner" && input.otherOwnerCount < 1) {
    blocked.push("This is the last workspace owner. Assign another owner before changing this role.");
  }
  return {
    ready: blocked.length === 0,
    blockers: blocked,
    from: input.currentRole,
    to: role ? { id: role.id, label: role.label, privileged: role.privileged } : null,
    expectedProfileRevision: input.expectedProfileRevision,
    workspaceRoleOnly: true as const,
    notice: "Role changes are checked again under a workspace transaction lock. Scoped Project grants, bundles, tool overrides and object permissions can also affect access.",
  };
}
