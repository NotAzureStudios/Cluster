import { createRoleRepository } from "./role-repository.js";

export function createRoleService(deps: any) {
  const repository = createRoleRepository(deps.prisma);
  return {
    async list() {
      const roles = await repository.list();
      return roles.map((role: any) => ({
        ...role,
        toolPermissions: deps.authorization.configuredToolPermissionsForRole(role.name),
      }));
    },
  };
}
