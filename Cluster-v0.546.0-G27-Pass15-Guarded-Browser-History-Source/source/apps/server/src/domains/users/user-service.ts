import { createUserRepository } from "./user-repository.js";

export function createUserService(deps: any) {
  const repository = createUserRepository(deps.prisma);
  return {
    listDirectory: repository.listDirectory,
    async teamDirectory() {
      const [users] = await repository.listTeamResources();
      const roles = new Map<string, number>();
      const departments = new Map<string, number>();
      for (const user of users) {
        const role = user.memberships[0]?.role || "member";
        roles.set(role, (roles.get(role) || 0) + 1);
        const department = String(user.employment?.department?.name || "Unassigned").trim() || "Unassigned";
        departments.set(department, (departments.get(department) || 0) + 1);
      }
      return {
        roles: Array.from(roles, ([name, members]) => ({ name, members })).sort((a, b) => a.name.localeCompare(b.name)),
        departments: Array.from(departments, ([name, members]) => ({ name, members })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    listTeamResources: repository.listTeamResources,
  };
}
