import { z } from "zod";
import { clusterStudioAutomationRuleSchema } from "@cluster/shared";
import { apiError } from "../../core/api-response.js";

const ruleSchema = clusterStudioAutomationRuleSchema;

export function registerStudioAutomationRoutes({ app, authorization, getCurrentUser, service }: { app: any; authorization: any; getCurrentUser: (request: any) => Promise<any>; service: any }) {
  app.get("/api/automation/rules", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "settings", "view"))) return;
    return { ok: true, ...(await service.readRules()) };
  });
  app.put("/api/automation/rules", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const body = z.object({ rules: z.array(ruleSchema).max(300), expectedRevision: z.number().int().min(0) }).parse(request.body || {});
    const result = await service.saveRules(body.rules, body.expectedRevision);
    if (result.conflict) return apiError(request, reply, 409, "REVISION_CONFLICT", "Automation rules changed on another device.");
    return { ok: true, ...result };
  });
  app.post("/api/automation/tickets/preview", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "tickets", "edit"))) return;
    const body = z.object({ type: z.string().max(180), severity: z.enum(["low", "medium", "high", "urgent"]), department: z.string().max(180).default(""), assigneeId: z.string().max(180).default(""), labels: z.string().max(8000).default(""), title: z.string().max(500).optional(), projectId: z.string().max(180).optional(), dueDate: z.string().max(80).optional(), customValues: z.record(z.union([z.string(), z.boolean()])).default({}) }).parse(request.body || {});
    return { ok: true, result: await service.previewTicket(body) };
  });
  app.post("/api/automation/tickets/:cardId/activate", async (request: any, reply: any) => {
    const params = z.object({ cardId: z.string().min(1).max(180) }).parse(request.params);
    if (!(await authorization.requireTool(request, reply, "tickets", "edit"))) return;
    if (!(await authorization.requireCard(request, reply, params.cardId, "contribute"))) return;
    const actor = await getCurrentUser(request);
    const body = z.object({ context: z.record(z.unknown()).default({}), actions: z.array(z.object({ ruleId: z.string().min(1).max(180), actionId: z.string().min(1).max(180) })).max(200).default([]) }).parse(request.body || {});
    return { ok: true, outcomes: await service.activateTicket(params.cardId, body.context, body.actions, actor?.id || null) };
  });
  app.get("/api/automation/runs", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query || {});
    return { ok: true, runs: await service.listRuns(query.limit) };
  });
  app.get("/api/automation/jobs", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query || {});
    return { ok: true, jobs: await service.listJobs(query.limit) };
  });
  app.post("/api/automation/jobs/run", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const body = z.object({ force: z.boolean().default(false), jobId: z.string().max(180).optional() }).parse(request.body || {});
    return { ok: true, jobs: await service.processDue(body.force, body.jobId) };
  });
  app.post("/api/automation/jobs/:jobId/cancel", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const params = z.object({ jobId: z.string().min(1).max(180) }).parse(request.params);
    const record = await service.cancelJob(params.jobId);
    if (!record) return apiError(request, reply, 404, "RESOURCE_NOT_FOUND", "Automation job not found.");
    return { ok: true };
  });
  app.delete("/api/automation/jobs/completed", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    return { ok: true, removed: await service.clearCompleted() };
  });
}
