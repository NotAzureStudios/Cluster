export function createRoleRepository(prisma: any) {
  return {
    async list(workspaceId: string) {
      const rows = await prisma.workspaceMember.groupBy({
        where: { workspaceId },
        by: ["role"],
        _count: { _all: true },
        orderBy: { role: "asc" },
      });
      return rows.map((row: any) => ({ name: row.role || "member", members: row._count._all }));
    },
  };
}
