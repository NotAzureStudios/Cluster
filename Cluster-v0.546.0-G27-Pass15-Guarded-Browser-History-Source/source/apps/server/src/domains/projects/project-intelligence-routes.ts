import { z } from "zod";
import { createHttpError } from "../../core/http-errors.js";
import { createProjectIntelligenceService } from "./project-intelligence-service.js";

export function registerProjectIntelligenceRoutes({ app, prisma, enforceTargetAccess, authorization, projectReadModels }: { app: any; prisma: any; enforceTargetAccess: (...args: any[]) => Promise<any>; authorization: any; projectReadModels?: any }) {
  const service = createProjectIntelligenceService(prisma, projectReadModels);
  app.get("/api/projects/:projectId/intelligence", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const project = await prisma.project.findFirst({ where: { id: projectId, archived: false } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "view"))) return;
    const snapshot = await service.snapshot(projectId, { request, authorization });
    if (!snapshot) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    return snapshot;
  });
}
