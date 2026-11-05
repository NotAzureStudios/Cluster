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

  // A narrow, one-request roster for the Department lead picker. Keep people
  // choices scoped to the exact workspace used by the department directory.
  deps.app.get("/api/departments/lead-options", async (request: any, reply: any) => {
    if (!(await deps.authorization.requireTool(request, reply, "people", "view"))) return;
    const identity = await deps.authorization.identityForRequest(request);
    if (!identity?.user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const membership = await deps.prisma.workspaceMember.findFirst({
      where: { userId: identity.user.id }, orderBy: { workspaceId: "asc" }, select: { workspaceId: true },
    });
    if (!membership) return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED" });
    const people = await deps.prisma.user.findMany({
      where: { archived: false, memberships: { some: { workspaceId: membership.workspaceId } } },
      select: { id: true, username: true, displayName: true, preferredName: true },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      take: 2001,
    });
    // Never pretend that a truncated roster contains every assignable person.
    if (people.length > 2000) return reply.code(409).send({ ok: false, code: "DEPARTMENT_LEAD_DIRECTORY_LIMIT" });
    return {
      workspaceId: membership.workspaceId,
      people: people.map((person: any) => ({
        id: person.id,
        label: person.preferredName || person.displayName || person.username,
        username: person.username,
      })),
    };
  });

}
