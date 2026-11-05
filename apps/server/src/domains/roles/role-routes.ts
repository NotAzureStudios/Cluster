import { createRoleService } from "./role-service.js";

export function registerRoleRoutes(deps: any) {
  const service = createRoleService(deps);
  deps.app.get("/api/roles", async (request: any, reply: any) => {
    if (!(await deps.authorization.requireTool(request, reply, "people", "view"))) return;
    const identity = await deps.authorization.identityForRequest(request);
    if (!identity?.user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const membership = await deps.prisma.workspaceMember.findFirst({
      where: { userId: identity.user.id },
      select: { workspaceId: true },
      orderBy: { workspaceId: "asc" },
    });
    if (!membership) return [];
    return service.list(membership.workspaceId);
  });
}
