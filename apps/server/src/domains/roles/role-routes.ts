import { createRoleService } from "./role-service.js";

export function registerRoleRoutes(deps: any) {
  const service = createRoleService(deps);
  deps.app.get("/api/roles", async (request: any, reply: any) => {
    if (!(await deps.authorization.requireTool(request, reply, "people", "view"))) return;
    return service.list();
  });
}
