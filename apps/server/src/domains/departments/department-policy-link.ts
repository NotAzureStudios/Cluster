export class DepartmentPolicyLinkError extends Error {
  readonly code = "DEPARTMENT_POLICY_LINK_INVALID";
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "DepartmentPolicyLinkError";
  }
}

/**
 * Studio access templates are not organizational units. An optional
 * workforceDepartmentId is a reference to one existing, active, workspace-
 * owned Department. It never acts as an implicit permission grant.
 */
export async function validateStudioDepartmentPolicyLinks(
  prisma: any,
  actorId: string,
  definitions: unknown,
) {
  if (!Array.isArray(definitions) || definitions.length > 256) {
    throw new DepartmentPolicyLinkError("Department access templates must be a bounded array.");
  }
  const ids: string[] = [];
  for (const candidate of definitions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new DepartmentPolicyLinkError("Department access templates must be objects.");
    }
    const id: unknown = (candidate as Record<string, unknown>).workforceDepartmentId;
    if (id === null || id === undefined) continue;
    if (typeof id !== "string" || !id.trim() || id.trim() !== id || id.length > 128) {
      throw new DepartmentPolicyLinkError("A linked Workforce Department must use an existing immutable ID.");
    }
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) {
    throw new DepartmentPolicyLinkError("Only one permission template may link to each Workforce Department.");
  }
  if (!ids.length) return [];
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: actorId }, orderBy: { workspaceId: "asc" }, select: { workspaceId: true },
  });
  if (!membership) throw new DepartmentPolicyLinkError("The administrator has no active workspace.");
  const rows = await prisma.department.findMany({
    where: { id: { in: ids }, workspaceId: membership.workspaceId, archived: false },
    select: { id: true },
  });
  if (rows.length !== ids.length) {
    throw new DepartmentPolicyLinkError("Linked departments must be active and belong to the administrator's workspace.");
  }
  return ids;
}
