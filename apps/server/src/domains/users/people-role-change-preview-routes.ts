import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PeopleGovernanceError } from "./people-governance.js";
import { assignableStudioRoles, requireAssignableStudioRole } from "./people-role-governance.js";

const paramsSchema = z.object({ userId: z.string().min(1).max(160) });
const bodySchema = z.object({ role: z.string().trim().min(1).max(80) }).strict();

/** Advisory comparison only. The actual role PATCH holds a workspace-scoped
 * transaction lock and rechecks the last-owner/profile-revision invariants. */
export function registerPeopleRoleChangePreviewRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: () => Promise<Record<string, unknown>>;
  authorization: {
    configuredToolPermissionsForRole: (role: string, user?: unknown) => Record<string, string>;
  };
}) {
  const { app, prisma, getCurrentUser, readSettings, authorization } = deps;
  app.post("/api/admin/users/:userId/role-change-preview", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!membership || !["owner", "admin"].includes(membership.role))
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });

    const params = paramsSchema.safeParse(request.params || {});
    const input = bodySchema.safeParse(request.body || {});
    if (!params.success || !input.success)
      return reply.code(400).send({ ok: false, code: "ROLE_PREVIEW_INVALID", error: "Choose a valid account and workspace role." });

    const userId = params.data.userId;
    const target = await prisma.user.findFirst({
      where: { id: userId, memberships: { some: { workspaceId: membership.workspaceId } } },
      select: {
        id: true, username: true, displayName: true, accountType: true,
        archived: true, accountState: true, profileRevision: true,
        memberships: { where: { workspaceId: membership.workspaceId }, select: { role: true }, take: 1 },
      },
    });
    if (!target || !target.memberships.length)
      return reply.code(404).send({ ok: false, code: "ROLE_TARGET_NOT_IN_WORKSPACE", error: "Account not found in this workspace." });

    const previousRole = String(target.memberships[0].role || "member");
    const roleSettings = await readSettings();
    const oldChoice = assignableStudioRoles(roleSettings).find((item) => item.id === previousRole);
    const blockers: Array<{ code: string; message: string }> = [];
    let nextRole: { id: string; label: string; privileged: boolean } | null = null;
    try {
      nextRole = requireAssignableStudioRole(roleSettings, input.data.role);
    } catch (error) {
      if (error instanceof PeopleGovernanceError) blockers.push({ code: error.code, message: error.message });
      else throw error;
    }
    if (actor.id === userId)
      blockers.push({ code: "ROLE_SELF_CHANGE_DENIED", message: "You cannot change your own workspace role." });
    if (target.archived || target.accountState === "PRIVACY_ERASED")
      blockers.push({ code: "PEOPLE_LIFECYCLE_GOVERNED", message: "Archived or erased identities require a governed lifecycle process." });
    if (nextRole && previousRole === nextRole.id)
      blockers.push({ code: "ROLE_NO_CHANGE", message: "This person already has the selected role." });
    if (nextRole && (["owner", "admin"].includes(previousRole) || nextRole.privileged) && membership.role !== "owner")
      blockers.push({ code: "ROLE_OWNER_REQUIRED", message: "Only a workspace owner may change owner or administrator roles." });
    if (nextRole && previousRole === "owner" && nextRole.id !== "owner") {
      const otherOwners = await prisma.workspaceMember.count({
        where: { workspaceId: membership.workspaceId, role: "owner", userId: { not: userId } },
      });
      if (!otherOwners)
        blockers.push({ code: "ROLE_LAST_OWNER", message: "The last workspace owner cannot be demoted." });
    }

    const projectionUser = { accountType: target.accountType, studioTeamMemberships: [], toolPermissions: {} };
    const previousTools = authorization.configuredToolPermissionsForRole(previousRole, projectionUser);
    const proposedTools = nextRole && !blockers.some((x) => x.code === "ROLE_OWNER_REQUIRED" || x.code === "ROLE_NOT_ASSIGNABLE")
      ? authorization.configuredToolPermissionsForRole(nextRole.id, projectionUser)
      : {};
    const tools = [...new Set([...Object.keys(previousTools), ...Object.keys(proposedTools)])].sort()
      .map((tool) => ({
        tool,
        before: String(previousTools[tool] || "none"),
        after: String(proposedTools[tool] || "none"),
      }));
    return {
      ok: true,
      canApply: blockers.length === 0,
      blockers,
      targetUserId: userId,
      profileRevision: Number(target.profileRevision || 1),
      from: { id: previousRole, label: oldChoice?.label || previousRole },
      to: nextRole ? { id: nextRole.id, label: nextRole.label } : null,
      roleTools: tools,
      changedToolCount: tools.filter((item) => item.before !== item.after).length,
      reviewedAt: new Date().toISOString(),
      warning: "Role-based tool levels are a policy comparison, not a guarantee of effective access. Team, department, individual, project, resource and current account-state restrictions may differ.",
      commitPolicy: "The actual role change rechecks actor authority, active role policy, last-owner protection and profile revision under a transaction lock.",
    };
  });
}
