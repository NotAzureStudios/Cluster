import type { FastifyInstance } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";
import { legalComplianceEvidenceExport, legalComplianceSnapshot } from "../../core/legal-compliance.js";

export function registerLegalComplianceRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  readSettings: () => Promise<object>;
  authorization: AuthorizationService;
  logSecurityEvent: (input: any) => Promise<unknown>;
}) {
  const { app, prisma, readSettings, authorization, logSecurityEvent } = deps;
  app.get("/api/admin/legal/compliance", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, compliance: await legalComplianceSnapshot(prisma, new Date(), { ...(await readSettings()) } as Record<string, unknown>) };
  });

  app.post("/api/admin/legal/compliance/evidence", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const evidence = await legalComplianceEvidenceExport(prisma, new Date(), { ...(await readSettings()) } as Record<string, unknown>);
    await logSecurityEvent({
      event: "legal.compliance_evidence_exported",
      actorUserId: admin.id,
      targetUserId: admin.id,
      result: "SUCCESS",
      reasonCode: "ADMIN_EVIDENCE_EXPORT",
      request,
      metadata: { evidenceHash: evidence.evidenceHash, roadmapSteps: evidence.roadmap.completedSteps },
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, filename: `cluster-legal-compliance-evidence-${evidence.generatedAt.slice(0, 10)}.json`, evidence };
  });
}
