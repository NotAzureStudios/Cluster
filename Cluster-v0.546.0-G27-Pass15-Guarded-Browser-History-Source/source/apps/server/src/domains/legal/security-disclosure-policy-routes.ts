import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SECURITY_DISCLOSURE_POLICY_KIND,
  normalizeSecurityDisclosureMarkdown,
  normalizeSecurityDisclosureMetadata,
  normalizeSecurityDisclosureVersion,
  securityDisclosureContentHash,
  securityDisclosureMetadataJson,
  securityTxtFromPolicy,
  serializeSecurityDisclosurePolicy,
  starterSecurityDisclosurePolicy,
} from "../../core/security-disclosure-policy.js";

const versionSchema = z.string().trim().min(1).max(48);
const titleSchema = z.string().trim().min(1).max(160);
const summarySchema = z.string().trim().max(600).optional().nullable();
const bodySchema = z.string().min(1).max(160_000);
const metadataSchema = z.object({
  contacts: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  expires: z.string().trim().min(1).max(80),
  preferredLanguages: z.array(z.string().trim().min(1).max(32)).min(1).max(12).default(["en"]),
  encryption: z.string().trim().max(1000).optional().nullable(),
  acknowledgments: z.string().trim().max(1000).optional().nullable(),
});

function normalizeDraft(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string; metadata: unknown; effectiveAt?: string | Date | null }, requireCurrent = false) {
  const version = normalizeSecurityDisclosureVersion(input.version);
  const title = String(input.title || "Security & Vulnerability Disclosure Policy").trim() || "Security & Vulnerability Disclosure Policy";
  const summary = String(input.summary || "").trim() || null;
  const bodyMarkdown = normalizeSecurityDisclosureMarkdown(input.bodyMarkdown);
  const metadata = normalizeSecurityDisclosureMetadata(input.metadata, { requireCurrent, effectiveAt: input.effectiveAt || null });
  return {
    version,
    title,
    summary,
    bodyMarkdown,
    metadata,
    metadataJson: securityDisclosureMetadataJson(metadata),
    contentHash: securityDisclosureContentHash({ version, title, summary, bodyMarkdown, metadata }),
  };
}

async function currentPublished(prisma: any) {
  const now = new Date();
  return prisma.legalPolicyVersion.findFirst({
    where: {
      kind: SECURITY_DISCLOSURE_POLICY_KIND,
      status: "published",
      OR: [{ effectiveAt: null }, { effectiveAt: { lte: now } }],
    },
    orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export function registerSecurityDisclosurePolicyRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
  webOrigin: string;
}) {
  const { app, prisma, getCurrentUser, readSettings, webOrigin } = deps;

  app.get("/api/public/legal/security", async (_request, reply) => {
    const policy = await currentPublished(prisma);
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const studioName = String(settings.studioName || "Studio").trim() || "Studio";
    reply.header("Cache-Control", "public, max-age=60, must-revalidate");
    if (!policy) {
      return reply.code(404).send({
        ok: false,
        code: "SECURITY_POLICY_NOT_PUBLISHED",
        error: "This Cluster server has not published a Security & Vulnerability Disclosure Policy yet.",
        studioName,
        policyPath: "/legal/security",
        securityTxtPath: "/.well-known/security.txt",
      });
    }
    reply.header("ETag", `\"${policy.contentHash}\"`);
    return { ok: true, studioName, policyPath: "/legal/security", securityTxtPath: "/.well-known/security.txt", policy: serializeSecurityDisclosurePolicy(policy) };
  });

  const securityTxtHandler = async (_request: FastifyRequest, reply: any) => {
    const policy = await currentPublished(prisma);
    if (!policy) {
      reply.header("Cache-Control", "no-store");
      reply.type("text/plain; charset=utf-8");
      return reply.code(404).send("Security disclosure policy is not published.\n");
    }
    try {
      const body = securityTxtFromPolicy(policy, webOrigin);
      reply.header("Cache-Control", "public, max-age=300, must-revalidate");
      reply.header("ETag", `\"security-txt-${policy.contentHash}\"`);
      reply.type("text/plain; charset=utf-8");
      return reply.send(body);
    } catch {
      reply.header("Cache-Control", "no-store");
      reply.type("text/plain; charset=utf-8");
      return reply.code(503).send("Security contact information is temporarily unavailable.\n");
    }
  };
  app.get("/.well-known/security.txt", securityTxtHandler);

  app.get("/api/admin/legal/security", async () => {
    const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));
    const [versions, published] = await Promise.all([
      prisma.legalPolicyVersion.findMany({ where: { kind: SECURITY_DISCLOSURE_POLICY_KIND }, orderBy: [{ createdAt: "desc" }], take: 100 }),
      currentPublished(prisma),
    ]);
    return {
      ok: true,
      current: published ? serializeSecurityDisclosurePolicy(published) : null,
      versions: versions.map(serializeSecurityDisclosurePolicy),
      starter: starterSecurityDisclosurePolicy(settings.studioName || "Studio"),
      securityTxt: { path: "/.well-known/security.txt", publicOrigin: webOrigin },
      constraints: {
        publishedVersionsImmutable: true,
        maximumVersionsReturned: 100,
        markdownOnly: true,
        securityTxtRequiredFields: ["Contact", "Expires"],
        maximumSecurityTxtValidityDays: 366,
        bugBountyImplemented: false,
      },
    };
  });

  app.post("/api/admin/legal/security/versions", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema.default("Security & Vulnerability Disclosure Policy"),
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      metadata: metadataSchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
    }).parse(request.body || {});
    const normalized = normalizeDraft(parsed, false);
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: SECURITY_DISCLOSURE_POLICY_KIND, version: normalized.version } } });
    if (existing) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Security disclosure policy ${normalized.version} already exists.` });
    const created = await prisma.legalPolicyVersion.create({
      data: {
        kind: SECURITY_DISCLOSURE_POLICY_KIND,
        version: normalized.version,
        title: normalized.title,
        summary: normalized.summary,
        bodyMarkdown: normalized.bodyMarkdown,
        metadataJson: normalized.metadataJson,
        contentHash: normalized.contentHash,
        status: "draft",
        effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null,
        createdById: actor?.id || null,
      },
    });
    reply.code(201);
    return { ok: true, policy: serializeSecurityDisclosurePolicy(created) };
  });

  app.patch("/api/admin/legal/security/versions/:policyId", async (request, reply) => {
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const parsed = z.object({
      version: versionSchema,
      title: titleSchema,
      summary: summarySchema,
      bodyMarkdown: bodySchema,
      metadata: metadataSchema,
      effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
    }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== SECURITY_DISCLOSURE_POLICY_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Security disclosure policy version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_PUBLISHED_IMMUTABLE", error: "Published security disclosure policy versions are immutable. Create a new version instead." });
    const normalized = normalizeDraft(parsed, false);
    if (normalized.version !== existing.version) {
      const conflict = await prisma.legalPolicyVersion.findUnique({ where: { kind_version: { kind: SECURITY_DISCLOSURE_POLICY_KIND, version: normalized.version } } });
      if (conflict) return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_VERSION_EXISTS", error: `Security disclosure policy ${normalized.version} already exists.` });
    }
    const updated = await prisma.legalPolicyVersion.update({
      where: { id: existing.id },
      data: {
        version: normalized.version,
        title: normalized.title,
        summary: normalized.summary,
        bodyMarkdown: normalized.bodyMarkdown,
        metadataJson: normalized.metadataJson,
        contentHash: normalized.contentHash,
        effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null,
      },
    });
    return { ok: true, policy: serializeSecurityDisclosurePolicy(updated) };
  });

  app.post("/api/admin/legal/security/versions/:policyId/publish", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ policyId: z.string().trim().min(1).max(80) }).parse(request.params);
    const body = z.object({ effectiveAt: z.string().datetime({ offset: true }).optional().nullable() }).parse(request.body || {});
    const existing = await prisma.legalPolicyVersion.findUnique({ where: { id: params.policyId } });
    if (!existing || existing.kind !== SECURITY_DISCLOSURE_POLICY_KIND) return reply.code(404).send({ ok: false, code: "LEGAL_POLICY_NOT_FOUND", error: "Security disclosure policy version not found." });
    if (existing.status !== "draft") return reply.code(409).send({ ok: false, code: "LEGAL_POLICY_ALREADY_PUBLISHED", error: "Only draft security disclosure policy versions can be published." });
    const now = new Date();
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : existing.effectiveAt || now;
    const metadata = existing.metadataJson ? JSON.parse(existing.metadataJson) : null;
    const normalized = normalizeDraft({ ...existing, metadata, effectiveAt }, true);
    const published = await prisma.legalPolicyVersion.update({
      where: { id: existing.id },
      data: {
        version: normalized.version,
        title: normalized.title,
        summary: normalized.summary,
        bodyMarkdown: normalized.bodyMarkdown,
        metadataJson: normalized.metadataJson,
        contentHash: normalized.contentHash,
        status: "published",
        effectiveAt,
        publishedAt: now,
        publishedById: actor?.id || null,
      },
    });
    return { ok: true, policy: serializeSecurityDisclosurePolicy(published) };
  });
}
