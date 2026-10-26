import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthorizationService } from "../access/authorization.js";
import {
  CONFIGURABLE_RETENTION_POLICIES,
  applyRetentionPolicies,
  dataInventorySnapshot,
  readRetentionPolicies,
  retentionPreview,
  updateRetentionPolicies,
} from "../../core/data-retention.js";

const policyUpdateSchema = z.object({
  policies: z.array(z.object({
    category: z.string().min(1).max(100),
    enabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(3650),
  })).min(1).max(CONFIGURABLE_RETENTION_POLICIES.length),
});

export function registerDataRetentionRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  authorization: AuthorizationService;
  readSettings: () => Promise<any>;
  requireConfirmation: (request: FastifyRequest, reply: any, expected: string) => boolean;
  logSecurityEvent: (input: any) => Promise<unknown>;
}) {
  const { app, prisma, authorization, readSettings, requireConfirmation, logSecurityEvent } = deps;

  app.get("/api/admin/privacy/data-inventory", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const settings = await readSettings();
    reply.header("Cache-Control", "no-store");
    return { ok: true, inventory: await dataInventorySnapshot(prisma, settings) };
  });

  app.get("/api/admin/privacy/retention-policies", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, policies: await readRetentionPolicies(prisma) };
  });

  app.put("/api/admin/privacy/retention-policies", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "UPDATE RETENTION POLICY")) return;
    const body = policyUpdateSchema.parse(request.body || {});
    await updateRetentionPolicies(prisma, body.policies, admin.id);
    const policies = await readRetentionPolicies(prisma);
    await logSecurityEvent({
      event: "privacy.retention_policy_updated",
      actorUserId: admin.id,
      result: "SUCCESS",
      reasonCode: "ADMIN_POLICY_CHANGE",
      request,
      metadata: { policies: policies.map((policy) => ({ category: policy.key, enabled: policy.enabled, retentionDays: policy.retentionDays })) },
    });
    return { ok: true, policies };
  });

  app.get("/api/admin/privacy/retention-preview", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const rows = await retentionPreview(prisma);
    return { ok: true, generatedAt: new Date().toISOString(), rows, totalWouldDelete: rows.reduce((sum, row) => sum + Number(row.wouldDelete || 0), 0) };
  });

  app.post("/api/admin/privacy/retention-apply", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "APPLY DATA RETENTION")) return;
    const result = await applyRetentionPolicies(prisma, { actorUserId: admin.id, trigger: "admin" });
    await logSecurityEvent({
      event: "privacy.data_retention_applied",
      actorUserId: admin.id,
      result: "SUCCESS",
      reasonCode: "ADMIN_RETENTION_RUN",
      request,
      metadata: { runId: result.runId, totalDeleted: result.totalDeleted, deletedByCategory: result.deletedByCategory },
    });
    return { ok: true, ...result };
  });

  app.get("/api/admin/privacy/retention-runs", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    const runs = await prisma.dataRetentionRun.findMany({ orderBy: { createdAt: "desc" }, take: query.limit });
    return { ok: true, runs: runs.map((run: any) => ({ ...run, result: (() => { try { return JSON.parse(run.resultJson || "{}"); } catch { return {}; } })(), resultJson: undefined })) };
  });
}
