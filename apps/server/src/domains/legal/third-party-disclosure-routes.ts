import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  THIRD_PARTY_DISCLOSURE_SCHEMA_VERSION,
  detectThirdPartyCandidates,
  disclosureRecordData,
  serializeThirdPartyDisclosure,
  serializeThirdPartyDisclosureAdmin,
  thirdPartyDisclosureInputSchema,
} from "../../core/third-party-disclosure.js";

const updateSchema = thirdPartyDisclosureInputSchema.partial().extend({ reviewed: z.boolean().optional(), publicVisible: z.boolean().optional() });
const MATERIAL_FIELDS = new Set(["name", "category", "purpose", "dataCategories", "recipientRole", "feature", "consentCategory", "privacyUrl", "termsUrl", "regions", "retentionNote", "transferNote", "required", "status"]);

function cleanInput(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function registerThirdPartyDisclosureRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: () => Promise<object>;
}) {
  const { app, prisma, getCurrentUser, readSettings } = deps;

  app.get("/api/public/privacy/third-parties", async (_request, reply) => {
    const providers = await prisma.thirdPartyDisclosureProvider.findMany({
      where: { status: "active", publicVisible: true, reviewedAt: { not: null } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    reply.header("Cache-Control", "public, max-age=300, must-revalidate");
    return {
      ok: true,
      schemaVersion: THIRD_PARTY_DISCLOSURE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      notice: "This disclosure is generated from operator-reviewed Cluster configuration. Legal classifications depend on the operator's contracts, jurisdictions, and actual data flows.",
      providers: providers.map(serializeThirdPartyDisclosure),
    };
  });

  app.get("/api/admin/legal/third-parties", async (_request, reply) => {
    const [records, settings, sourceControlConnections] = await Promise.all([
      prisma.thirdPartyDisclosureProvider.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
      readSettings(),
      prisma.integrationConnection.count({ where: { category: "source-control", archived: false, status: { not: "disabled" } } }),
    ]);
    const settingsRecord = { ...settings, sourceControlConfigured: sourceControlConnections > 0 } as Record<string, unknown>;
    const candidates = detectThirdPartyCandidates(settingsRecord).map((candidate) => ({
      ...candidate,
      recordId: records.find((record: any) => record.sourceKey === candidate.sourceKey)?.id || null,
    }));
    reply.header("Cache-Control", "no-store");
    return { ok: true, schemaVersion: THIRD_PARTY_DISCLOSURE_SCHEMA_VERSION, providers: records.map(serializeThirdPartyDisclosureAdmin), detectedCandidates: candidates };
  });

  app.post("/api/admin/legal/third-parties", async (request, reply) => {
    const user = await getCurrentUser(request);
    const parsed = thirdPartyDisclosureInputSchema.parse(request.body || {});
    if (parsed.publicVisible && !parsed.reviewed) return reply.code(409).send({ ok: false, code: "THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED", error: "Review the disclosure before making it public." });
    const created = await prisma.thirdPartyDisclosureProvider.create({
      data: {
        ...disclosureRecordData(parsed),
        reviewedAt: parsed.reviewed ? new Date() : null,
        reviewedById: parsed.reviewed ? user?.id || null : null,
        createdById: user?.id || null,
      },
    });
    reply.code(201);
    return { ok: true, provider: serializeThirdPartyDisclosureAdmin(created) };
  });

  app.patch("/api/admin/legal/third-parties/:providerId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ providerId: z.string().trim().min(1).max(100) }).parse(request.params);
    const rawBody = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const parsed = updateSchema.parse(rawBody);
    const existing = await prisma.thirdPartyDisclosureProvider.findUnique({ where: { id: params.providerId } });
    if (!existing) return reply.code(404).send({ ok: false, code: "THIRD_PARTY_DISCLOSURE_NOT_FOUND", error: "Third-party disclosure record not found." });

    const current = serializeThirdPartyDisclosureAdmin(existing);
    const candidate = thirdPartyDisclosureInputSchema.parse({
      sourceKey: existing.sourceKey,
      name: parsed.name ?? current.name,
      category: parsed.category ?? current.category,
      purpose: parsed.purpose ?? current.purpose,
      dataCategories: parsed.dataCategories ?? current.dataCategories,
      recipientRole: parsed.recipientRole ?? current.recipientRole,
      feature: parsed.feature === undefined ? current.feature : parsed.feature,
      consentCategory: parsed.consentCategory === undefined ? current.consentCategory : parsed.consentCategory,
      privacyUrl: parsed.privacyUrl === undefined ? current.privacyUrl : parsed.privacyUrl,
      termsUrl: parsed.termsUrl === undefined ? current.termsUrl : parsed.termsUrl,
      regions: parsed.regions ?? current.regions,
      retentionNote: parsed.retentionNote === undefined ? current.retentionNote : parsed.retentionNote,
      transferNote: parsed.transferNote === undefined ? current.transferNote : parsed.transferNote,
      operatorNote: parsed.operatorNote === undefined ? current.operatorNote : parsed.operatorNote,
      required: parsed.required ?? current.required,
      status: parsed.status ?? current.status,
      publicVisible: parsed.publicVisible ?? current.publicVisible,
      reviewed: parsed.reviewed ?? current.reviewed,
    });
    const materialChanged = Object.keys(cleanInput(rawBody)).some((key) => MATERIAL_FIELDS.has(key));
    const explicitlyReviewed = parsed.reviewed === true;
    const reviewed = explicitlyReviewed ? true : parsed.reviewed === false ? false : materialChanged ? false : current.reviewed;
    const publicVisible = parsed.publicVisible === true ? true : parsed.publicVisible === false ? false : materialChanged ? false : current.publicVisible;
    if (publicVisible && !reviewed) return reply.code(409).send({ ok: false, code: "THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED", error: "Material changes invalidate review. Review the updated disclosure before publishing it." });

    const updated = await prisma.thirdPartyDisclosureProvider.update({
      where: { id: existing.id },
      data: {
        ...disclosureRecordData({ ...candidate, reviewed, publicVisible }),
        reviewedAt: reviewed ? (explicitlyReviewed || !existing.reviewedAt ? new Date() : existing.reviewedAt) : null,
        reviewedById: reviewed ? (explicitlyReviewed || !existing.reviewedAt ? user?.id || null : existing.reviewedById) : null,
      },
    });
    return { ok: true, provider: serializeThirdPartyDisclosureAdmin(updated), reviewInvalidated: materialChanged && !explicitlyReviewed };
  });
}
