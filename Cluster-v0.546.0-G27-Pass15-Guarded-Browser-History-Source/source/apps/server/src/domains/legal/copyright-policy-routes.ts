import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  COPYRIGHT_POLICY_KIND,
  normalizeCopyrightPolicyMarkdown,
  normalizeCopyrightPolicyVersion,
  serializeCopyrightPolicy,
  starterCopyrightPolicy,
  copyrightPolicyContentHash,
} from "../../core/copyright-policy.js";

const versionSchema = z.string().trim().min(1).max(48);
const titleSchema = z.string().trim().min(1).max(160);
const summarySchema = z.string().trim().max(600).optional().nullable();
const bodySchema = z.string().min(1).max(160_000);

function normalizeDraft(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const version = normalizeCopyrightPolicyVersion(input.version);
  const title = String(input.title || "Copyright & DMCA Policy").trim() || "Copyright & DMCA Policy";
  const summary = String(input.summary || "").trim() || null;
  const bodyMarkdown = normalizeCopyrightPolicyMarkdown(input.bodyMarkdown);
  return {
    version,
    title,
    summary,
    bodyMarkdown,
    contentHash: copyrightPolicyContentHash({ version, title, summary, bodyMarkdown }),
  };
}

async function currentPublished(prisma: any) {
  const now = new Date();
  return prisma.legalPolicyVersion.findFirst({
    where: {
      kind: COPYRIGHT_POLICY_KIND,
      status: "published",
      OR: [{ effectiveAt: null }, { effectiveAt: { lte: now } }],
    },
    orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export function registerCopyrightPolicyRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
}) {
  const { app, prisma, getCurrentUser, readSettings } = deps;

  app.get("/api/public/legal/copyright", async (_request, reply) => {
    const policy = await currentPublished(prisma);
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const studioName = String(settings.studioName || "Studio").trim() || "Studio";
    reply.header("Cache-Control", "public, max-age=60, must-revalidate");
    if (!policy) {
      return reply.code(404).send({
        ok: false,
        code: "COPYRIGHT_POLICY_NOT_PUBLISHED",
        error: "This Cluster server has not published a Copyright & DMCA Policy yet.",
        studioName,
        policyPath: "/legal/copyright",
      });
    }
    reply.header("ETag", `\"${policy.contentHash}\"`);
    return { ok: true, studioName, policyPath: "/legal/copyright", reportPath: "/legal/copyright/report", policy: serializeCopyrightPolicy(policy) };
  });

  app.get("/api/admin/legal/copyright", async () => {
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const [versions, published] = await Promise.all([
      prisma.legalPolicyVersion.findMany({ where: { kind: COPYRIGHT_POLICY_KIND }, orderBy: [{ createdAt: "desc" }], take: 100 }),
      currentPublished(prisma),
    ]);
    return {
      ok: true,
      current: published ? serializeCopyrightPolicy(published) : null,
      versions: versions.map(serializeCopyrightPolicy),
      starter: starterCopyrightPolicy(settings.studioName || "Studio"),
      constraints: {
        publishedVersionsImmutable: true,
        maximumVersionsReturned: 100,
        markdownOnly: true,
        acceptanceTrackingImplemented: false,
        intendedAudience: "public-users-and-rightsholders",
        reportingWorkflowImplemented: true,
        safeHarborEligibilityClaimed: false,
      },
    };
  });

  app.post("/api/admin/legal/copyright/versions", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema.default("Copyright & DMCA Policy"),
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
    }).parse(request.body || {});
    const normalized = normalizeDraft(parsed);
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: COPYRIGHT_POLICY_KIND, version: normalized.version } } });
    if (existing) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Copyright Policy ${normalized.version} already exist.` });
    const created = await prisma.legalPolicyVersion.create({
      data: {
        kind: COPYRIGHT_POLICY_KIND,
        ...normalized,
        status: "draft",
        effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null,
        createdById: actor?.id || null,
      },
    });
    reply.code(201);
    return { ok: true, policy: serializeCopyrightPolicy(created) };
  });

  app.patch("/api/admin/legal/copyright/versions/:policyId", async (request, reply) => {
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema,
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
    }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== COPYRIGHT_POLICY_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Copyright Policy version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_PUBLISHED_IMMUTABLE", error: "Published Copyright Policy versions are immutable. Create a new version instead." });
    const normalized = normalizeDraft(parsed);
    if (normalized.version !== existing.version) {
      const conflict = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: COPYRIGHT_POLICY_KIND, version: normalized.version } } });
      if (conflict) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Copyright Policy ${normalized.version} already exist.` });
    }
    const updated = await prisma.legalPolicyVersion.update({ where: { id: existing.id }, data: { ...normalized, effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null } });
    return { ok: true, policy: serializeCopyrightPolicy(updated) };
  });

  app.post("/api/admin/legal/copyright/versions/:policyId/publish", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const body = z.object({ effectiveAt: z.string().datetime({ offset: true }).optional().nullable() }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== COPYRIGHT_POLICY_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Copyright Policy version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_ALREADY_PUBLISHED", error: "Only draft Copyright Policy versions can be published." });
    const normalized = normalizeDraft(existing);
    const now = new Date();
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : existing.effectiveAt || now;
    const published = await prisma.legalPolicyVersion.update({
      where: { id: existing.id },
      data: { ...normalized, status: "published", effectiveAt, publishedAt: now, publishedById: actor?.id || null },
    });
    return { ok: true, policy: serializeCopyrightPolicy(published) };
  });
}
