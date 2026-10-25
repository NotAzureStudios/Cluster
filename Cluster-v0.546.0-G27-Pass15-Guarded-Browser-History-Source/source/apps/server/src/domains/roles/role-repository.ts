export function createRoleRepository(prisma: any) {
  return {
    async list() {
      const rows = await prisma.workspaceMember.groupBy({
        by: ["role"],
        _count: { _all: true },
        orderBy: { role: "asc" },
      });
      return rows.map((row: any) => ({ name: row.role || "member", members: row._count._all }));
    },
  };
}
