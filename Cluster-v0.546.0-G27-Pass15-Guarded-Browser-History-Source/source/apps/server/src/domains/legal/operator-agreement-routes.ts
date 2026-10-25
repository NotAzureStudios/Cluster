import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { invalidatePolicyAcceptanceRequirementCache, normalizePolicyAcceptanceAudience, normalizePolicyAcceptanceMode } from "../../core/policy-acceptance.js";
import {
  OPERATOR_AGREEMENT_KIND,
  normalizeOperatorAgreementMarkdown,
  normalizeOperatorAgreementVersion,
  serializeOperatorAgreement,
  starterOperatorAgreement,
  operatorAgreementContentHash,
} from "../../core/operator-agreement.js";

const versionSchema = z.string().trim().min(1).max(48);
const titleSchema = z.string().trim().min(1).max(160);
const summarySchema = z.string().trim().max(600).optional().nullable();
const bodySchema = z.string().min(1).max(160_000);

function normalizeDraft(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const version = normalizeOperatorAgreementVersion(input.version);
  const title = String(input.title || "Server Operator Agreement").trim() || "Server Operator Agreement";
  const summary = String(input.summary || "").trim() || null;
  const bodyMarkdown = normalizeOperatorAgreementMarkdown(input.bodyMarkdown);
  return {
    version,
    title,
    summary,
    bodyMarkdown,
    contentHash: operatorAgreementContentHash({ version, title, summary, bodyMarkdown }),
  };
}

async function currentPublished(prisma: any) {
  const now = new Date();
  return prisma.legalPolicyVersion.findFirst({
    where: {
      kind: OPERATOR_AGREEMENT_KIND,
      status: "published",
      OR: [{ effectiveAt: null }, { effectiveAt: { lte: now } }],
    },
    orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export function registerOperatorAgreementRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
}) {
  const { app, prisma, getCurrentUser, readSettings } = deps;

  app.get("/api/public/legal/operator-agreement", async (_request, reply) => {
    const policy = await currentPublished(prisma);
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const studioName = String(settings.studioName || "Studio").trim() || "Studio";
    reply.header("Cache-Control", "public, max-age=60, must-revalidate");
    if (!policy) {
      return reply.code(404).send({
        ok: false,
        code: "OPERATOR_AGREEMENT_NOT_PUBLISHED",
        error: "This Cluster server has not published Server Operator Agreement yet.",
        studioName,
        policyPath: "/legal/operator-agreement",
      });
    }
    reply.header("ETag", `\"${policy.contentHash}\"`);
    return { ok: true, studioName, policyPath: "/legal/operator-agreement", policy: serializeOperatorAgreement(policy) };
  });

  app.get("/api/admin/legal/operator-agreement", async () => {
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const [versions, published] = await Promise.all([
      prisma.legalPolicyVersion.findMany({ where: { kind: OPERATOR_AGREEMENT_KIND }, orderBy: [{ createdAt: "desc" }], take: 100 }),
      currentPublished(prisma),
    ]);
    return {
      ok: true,
      current: published ? serializeOperatorAgreement(published) : null,
      versions: versions.map(serializeOperatorAgreement),
      starter: starterOperatorAgreement(settings.studioName || "Studio"),
      constraints: {
        publishedVersionsImmutable: true,
        maximumVersionsReturned: 100,
        markdownOnly: true,
        acceptanceTrackingImplemented: true,
        intendedAudience: "server-operator",
      },
    };
  });

  app.post("/api/admin/legal/operator-agreement/versions", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema.default("Server Operator Agreement"),
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
      acceptanceMode: z.enum(["none", "acknowledge", "accept"]).optional().default("none"),
      acceptanceAudience: z.enum(["all_users", "admins"]).optional().default("all_users"),
    }).parse(request.body || {});
    const normalized = normalizeDraft(parsed);
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: OPERATOR_AGREEMENT_KIND, version: normalized.version } } });
    if (existing) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Operator Agreement ${normalized.version} already exist.` });
    const created = await prisma.legalPolicyVersion.create({
      data: {
        kind: OPERATOR_AGREEMENT_KIND,
        ...normalized,
        status: "draft",
        effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null,
        acceptanceMode: normalizePolicyAcceptanceMode(parsed.acceptanceMode),
        acceptanceAudience: normalizePolicyAcceptanceAudience(parsed.acceptanceAudience),
        createdById: actor?.id || null,
      },
    });
    reply.code(201);
    return { ok: true, policy: serializeOperatorAgreement(created) };
  });

  app.patch("/api/admin/legal/operator-agreement/versions/:policyId", async (request, reply) => {
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema,
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
      acceptanceMode: z.enum(["none", "acknowledge", "accept"]).optional(),
      acceptanceAudience: z.enum(["all_users", "admins"]).optional(),
    }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== OPERATOR_AGREEMENT_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Operator Agreement version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_PUBLISHED_IMMUTABLE", error: "Published Operator Agreement versions are immutable. Create a new version instead." });
    const normalized = normalizeDraft(parsed);
    if (normalized.version !== existing.version) {
      const conflict = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: OPERATOR_AGREEMENT_KIND, version: normalized.version } } });
      if (conflict) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Operator Agreement ${normalized.version} already exist.` });
    }
    const updated = await prisma.legalPolicyVersion.update({ where: { id: existing.id }, data: { ...normalized, effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null, acceptanceMode: parsed.acceptanceMode === undefined ? existing.acceptanceMode : normalizePolicyAcceptanceMode(parsed.acceptanceMode), acceptanceAudience: parsed.acceptanceAudience === undefined ? existing.acceptanceAudience : normalizePolicyAcceptanceAudience(parsed.acceptanceAudience) } });
    return { ok: true, policy: serializeOperatorAgreement(updated) };
  });

  app.post("/api/admin/legal/operator-agreement/versions/:policyId/publish", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const body = z.object({ effectiveAt: z.string().datetime({ offset: true }).optional().nullable() }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== OPERATOR_AGREEMENT_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Operator Agreement version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_ALREADY_PUBLISHED", error: "Only draft Operator Agreement can be published." });
    const normalized = normalizeDraft(existing);
    const now = new Date();
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : existing.effectiveAt || now;
    const published = await prisma.legalPolicyVersion.update({
      where: { id: existing.id },
      data: { ...normalized, status: "published", effectiveAt, publishedAt: now, publishedById: actor?.id || null },
    });
    invalidatePolicyAcceptanceRequirementCache();
    return { ok: true, policy: serializeOperatorAgreement(published) };
  });
}
