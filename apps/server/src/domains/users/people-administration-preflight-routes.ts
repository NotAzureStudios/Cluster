import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { provisioningPreviewInput, buildPeopleProvisioningPreview } from "./people-provisioning-preview.js";
import { evaluateRoleTransition } from "./people-role-transition-preview.js";

/** Both read-only People preflights are admin-only and workspace-scoped.
 * Actual role assignment and user creation repeat all checks at commit time.
 */
export function registerPeopleAdministrationPreflightRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: () => Promise<Record<string, unknown>>;
}) {
  const { app, prisma, getCurrentUser, readSettings } = deps;
  app.post("/api/admin/users/provisioning-preview", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
    }
    const parsed = provisioningPreviewInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({
      ok: false, code: "PROVISIONING_PREVIEW_INVALID",
      error: "Choose a valid account type, role, and access expiry to review.",
    });
    // Preflight is not an authorization token. The create endpoint always
    // rechecks actor authority, role, expiry, and identity independently.
    return buildPeopleProvisioningPreview(parsed.data, membership.role, await readSettings());
  });
  app.post("/api/admin/users/:userId/role-preview", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const actorMembership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!actorMembership || !["owner", "admin"].includes(actorMembership.role))
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
    const params = z.object({ userId: z.string().min(1).max(100) }).safeParse(request.params);
    const body = z.object({
      role: z.string().min(1).max(80),
      expectedProfileRevision: z.number().int().min(1),
    }).strict().safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ ok: false, code: "ROLE_PREVIEW_INVALID", error: "Choose a valid role and refresh the profile." });
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: actorMembership.workspaceId, userId: params.data.userId } },
      select: { userId: true, role: true, user: { select: { profileRevision: true, archived: true, accountState: true } } },
    });
    if (!target || target.user.archived || target.user.accountState === "PRIVACY_ERASED")
      return reply.code(404).send({ ok: false, code: "ROLE_TARGET_UNAVAILABLE" });
    const otherOwnerCount = target.role === "owner"
      ? await prisma.workspaceMember.count({ where: { workspaceId: actorMembership.workspaceId, role: "owner", userId: { not: params.data.userId } } })
      : 1;
    return evaluateRoleTransition({
      actorId: actor.id, actorRole: actorMembership.role, targetUserId: target.userId,
      currentRole: target.role, requestedRole: body.data.role,
      expectedProfileRevision: body.data.expectedProfileRevision,
      currentProfileRevision: target.user.profileRevision || 1,
      otherOwnerCount, settings: await readSettings(),
    });
  });
  
}
