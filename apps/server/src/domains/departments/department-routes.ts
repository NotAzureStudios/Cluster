import { createDepartmentService } from "./department-service.js";

export function registerDepartmentRoutes(deps: any) {
  const service = createDepartmentService(deps);
  deps.app.get("/api/departments", async (request: any, reply: any) => {
    if (!(await deps.authorization.requireTool(request, reply, "people", "view"))) return;
    const identity = await deps.authorization.identityForRequest(request);
    if (!identity?.user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    // A People permission does not authorize another workspace's directory.
    const membership = await deps.prisma.workspaceMember.findFirst({
      where: { userId: identity.user.id }, orderBy: { workspaceId: "asc" }, select: { workspaceId: true },
    });
    if (!membership) return [];
    return service.list(membership.workspaceId);
  });
}
