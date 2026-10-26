import { createDepartmentService } from "./department-service.js";

export function registerDepartmentRoutes(deps: any) {
  const service = createDepartmentService(deps);
  deps.app.get("/api/departments", async (request: any, reply: any) => {
    if (!(await deps.authorization.requireTool(request, reply, "people", "view"))) return;
    return service.list();
  });
}
