import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { acceptanceEvidenceHash, ensureSessionPolicyAcceptance, policyAcceptanceStatus, verifyPolicyAcceptanceEvidence } from "../../core/policy-acceptance.js";

const acceptanceItemSchema = z.object({ policyId: z.string().trim().min(1).max(100), contentHash: z.string().regex(/^[a-f0-9]{64}$/i), attestation: z.literal(true) });

function sourceForRequest(request: FastifyRequest) {
  const supplied = String(request.headers["x-cluster-client"] || "").trim().toLowerCase();
  if (["desktop", "web"].includes(supplied)) return supplied;
  return String(request.headers["user-agent"] || "").toLowerCase().includes("clusterdesktop") ? "desktop" : "web";
}

export function registerPolicyAcceptanceRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  logSecurityEvent: (input: any) => Promise<unknown>;
}) {
  const { app, prisma, getCurrentSession, decorateUserForClient, logSecurityEvent } = deps;

  app.get("/api/legal/acceptance/status", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const decorated = await decorateUserForClient(session.user);
    reply.header("Cache-Control", "no-store");
    return { ok: true, acceptance: await policyAcceptanceStatus(prisma, session.user, Boolean(decorated?.isAdmin)) };
  });

  app.get("/api/legal/acceptance/history", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const records = await prisma.policyAcceptance.findMany({ where: { userId: session.userId }, orderBy: { acceptedAt: "desc" }, take: 100 });
    reply.header("Cache-Control", "no-store");
    return { ok: true, records: records.map((record: any) => ({ ...record, evidenceValid: verifyPolicyAcceptanceEvidence(record) })) };
  });

  app.post("/api/legal/acceptance", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const decorated = await decorateUserForClient(session.user);
    const status = await policyAcceptanceStatus(prisma, session.user, Boolean(decorated?.isAdmin));
    const parsed = z.object({ acceptances: z.array(acceptanceItemSchema).min(1).max(5) }).parse(request.body || {});
    const pendingById = new Map(status.pending.map((item: any) => [item.policyId, item]));
    const seen = new Set<string>();
    for (const item of parsed.acceptances) {
      if (seen.has(item.policyId)) return reply.code(400).send({ ok: false, code: "POLICY_ACCEPTANCE_INVALID", error: "A policy can only be accepted once per request." });
      seen.add(item.policyId);
      const requirement = pendingById.get(item.policyId) as any;
      if (!requirement || requirement.contentHash !== item.contentHash) return reply.code(409).send({ ok: false, code: "POLICY_ACCEPTANCE_STALE", error: "The policy acceptance request is stale. Review the current policy version and try again." });
    }
    const acceptedAt = new Date();
    const source = sourceForRequest(request);
    const created: any[] = [];
    for (const item of parsed.acceptances) {
      const requirement = pendingById.get(item.policyId) as any;
      const subjectPolicyKey = `${session.userId}:${item.policyId}`;
      const existing = await prisma.policyAcceptance.findUnique({ where: { subjectPolicyKey } }).catch(() => null);
      if (existing) { created.push(existing); continue; }
      const evidenceHash = acceptanceEvidenceHash({ userId: session.userId, policyId: requirement.policyId, policyKind: requirement.kind, policyVersion: requirement.version, policyContentHash: requirement.contentHash, acceptanceMode: requirement.acceptanceMode, acceptanceAudience: requirement.acceptanceAudience, requirementHash: requirement.requirementHash, acceptedAt, sessionId: session.id, source });
      let record: any;
      let newlyCreated = false;
      try {
        record = await prisma.policyAcceptance.create({ data: {
          userId: session.userId,
          subjectUsername: String(session.user.username || "").slice(0, 120),
          subjectPolicyKey,
          policyId: requirement.policyId,
          policyKind: requirement.kind,
          policyVersion: requirement.version,
          policyContentHash: requirement.contentHash,
          acceptanceMode: requirement.acceptanceMode,
          acceptanceAudience: requirement.acceptanceAudience,
          requirementHash: requirement.requirementHash,
          acceptedAt,
          sessionId: session.id,
          authMethod: String(session.authMethod || "unknown").slice(0, 32),
          ipAddress: String(request.ip || session.ipAddress || "unknown").slice(0, 96),
          userAgent: String(request.headers["user-agent"] || session.userAgent || "Unknown client").slice(0, 500),
          source,
          requestId: String(request.id || "").slice(0, 120) || null,
          evidenceHash,
        } });
        newlyCreated = true;
      } catch (error: any) {
        if (String(error?.code || "") !== "P2002") throw error;
        record = await prisma.policyAcceptance.findUnique({ where: { subjectPolicyKey } });
        if (!record) throw error;
      }
      created.push(record);
      if (newlyCreated) await logSecurityEvent({ event: "legal.policy_accepted", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: requirement.acceptanceMode === "acknowledge" ? "POLICY_ACKNOWLEDGED" : "POLICY_ACCEPTED", request, metadata: { policyId: requirement.policyId, policyKind: requirement.kind, policyVersion: requirement.version, contentHash: requirement.contentHash, evidenceHash } });
    }
    const next = await ensureSessionPolicyAcceptance(prisma, session, Boolean(decorated?.isAdmin));
    if (!next.complete) return reply.code(409).send({ ok: false, code: "POLICY_ACCEPTANCE_INCOMPLETE", error: "Additional current policy versions still require review.", acceptance: next });
    return { ok: true, accepted: created.map((record) => ({ id: record.id, policyId: record.policyId, acceptedAt: record.acceptedAt, evidenceHash: record.evidenceHash })), acceptance: next };
  });

  app.get("/api/admin/legal/acceptances", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200), userId: z.string().trim().min(1).optional(), policyId: z.string().trim().min(1).optional() }).parse(request.query || {});
    const where: any = {};
    if (query.userId) where.userId = query.userId;
    if (query.policyId) where.policyId = query.policyId;
    const records = await prisma.policyAcceptance.findMany({ where, orderBy: { acceptedAt: "desc" }, take: query.limit, include: { user: { select: { id: true, username: true, displayName: true } } } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, records: records.map((record: any) => ({ ...record, evidenceValid: verifyPolicyAcceptanceEvidence(record) })) };
  });
}
