export function createDepartmentRepository(prisma: any) {
  return {
    async list(workspaceId: string) {
      const rows = await prisma.department.findMany({
        where: { workspaceId, archived: false },
        include: { _count: { select: { employments: true, teams: true } } },
        orderBy: { name: "asc" },
        take: 1000,
      });
      return rows.map((row: any) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        description: row.description || null,
        revision: Number(row.revision || 1),
        members: Number(row._count?.employments || 0),
        teams: Number(row._count?.teams || 0),
        parentId: row.parentId || null,
        leadUserId: row.leadUserId || null,
        color: row.color || null,
        iconId: row.iconId || null,
      }));
    },
  };
}
