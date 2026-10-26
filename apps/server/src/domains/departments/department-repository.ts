export function createDepartmentRepository(prisma: any) {
  return {
    async list() {
      const rows = await prisma.department.findMany({
        where: { archived: false },
        include: { _count: { select: { employments: true, teams: true } } },
        orderBy: { name: "asc" },
        take: 1000,
      });
      return rows.map((row: any) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        members: Number(row._count?.employments || 0),
        teams: Number(row._count?.teams || 0),
        parentId: row.parentId || null,
        leadUserId: row.leadUserId || null,
        color: row.color || null,
      }));
    },
  };
}
