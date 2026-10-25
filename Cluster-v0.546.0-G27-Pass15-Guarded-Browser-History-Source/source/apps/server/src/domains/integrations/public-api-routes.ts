import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliveryExecutorBuildInputSchema } from "@cluster/shared";
import { createProjectDeliveryService } from "../projects/project-delivery-service.js";
import type { createServiceCredentialService } from "../auth/service-credential-service.js";

type CredentialService = ReturnType<typeof createServiceCredentialService>;

type ApiCredentialRequest = FastifyRequest & { clusterApiCredential?: { credential: any; scopes: string[] } };

const queryBoolean = z.preprocess(
  (value) => typeof value === "boolean" ? String(value) : value,
  z.enum(["true", "false"]).default("false"),
).transform((value) => value === "true");

function bearerToken(request: FastifyRequest) {
  const raw = String(request.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || "";
}

function parseJson(value: unknown, fallback: unknown = null) {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
}

function encodeCursor(row: { updatedAt: Date | string; id: string }) {
  return Buffer.from(JSON.stringify({ updatedAt: new Date(row.updatedAt).toISOString(), id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(value: unknown) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const updatedAt = new Date(parsed.updatedAt);
    const id = String(parsed.id || "");
    if (!id || !Number.isFinite(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch { return null; }
}

function pageWhere(cursor: { updatedAt: Date; id: string } | null) {
  if (!cursor) return {};
  return { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] };
}

function serializeProject(row: any) {
  return {
    id: row.id, workspaceId: row.workspaceId, name: row.name, description: row.description || null,
    objective: row.objective || null, clientName: row.clientName || null, startDate: row.startDate || null,
    targetDate: row.targetDate || null, priority: row.priority, tags: parseJson(row.tags, []), color: row.color || null,
    projectType: row.projectType, status: row.status, productionTracks: parseJson(row.productionTracks, []),
    source: row.source, archived: Boolean(row.archived), revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function serializeTicket(row: any) {
  return {
    id: row.id, projectId: row.list?.board?.projectId || null, boardId: row.list?.boardId || null, listId: row.listId,
    title: row.title, description: row.description || null, priority: row.priority, dueDate: row.dueDate || null,
    labels: parseJson(row.labels, []), assigneeId: row.assigneeId || null, archived: Boolean(row.archived),
    revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function serializeProjectFile(row: any) {
  return {
    id: row.id, projectId: row.projectId, title: row.title, description: row.description || null,
    category: row.category, assetRole: row.assetRole, status: row.status, tags: parseJson(row.tags, []), metadata: parseJson(row.metadata, {}),
    versionGroupId: row.versionGroupId || null, versionNumber: row.versionNumber, versionLabel: row.versionLabel || null,
    checksumSha256: row.checksumSha256 || null, fileName: row.fileName, originalName: row.originalName, mimeType: row.mimeType,
    sizeBytes: String(row.sizeBytes ?? 0), archived: Boolean(row.archived), revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function icsEscape(value: unknown) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value: Date | string, allDay = false) {
  const date = new Date(value);
  if (allDay) return date.toISOString().slice(0, 10).replace(/-/g, "");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function serializeIcs(events: any[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cluster//Public API Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(event.id)}@cluster`, `DTSTAMP:${icsDate(event.updatedAt || event.createdAt || new Date())}`);
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${icsDate(event.startsAt, true)}` : `DTSTART:${icsDate(event.startsAt)}`);
    if (event.endsAt) lines.push(event.allDay ? `DTEND;VALUE=DATE:${icsDate(event.endsAt, true)}` : `DTEND:${icsDate(event.endsAt)}`);
    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
    if (event.externalUrl) lines.push(`URL:${icsEscape(event.externalUrl)}`);
    if (event.recurrenceRule) lines.push(`RRULE:${String(event.recurrenceRule).replace(/^RRULE:/i, "").replace(/[\r\n]/g, "")}`);
    lines.push(`STATUS:${String(event.status || "scheduled").toLowerCase() === "cancelled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function registerPublicApiRoutes(input: { app: FastifyInstance; prisma: any; credentials: CredentialService }) {
  const { app, prisma, credentials } = input;
  const delivery = createProjectDeliveryService(prisma);

  async function requireScopes(request: FastifyRequest, reply: FastifyReply, scopes: string[]) {
    const token = bearerToken(request);
    const verified = token ? await credentials.verifyBearer(token, scopes) : null;
    if (!verified) {
      reply.header("WWW-Authenticate", 'Bearer realm="Cluster Public API"');
      reply.code(401).send({ ok: false, code: "API_CREDENTIAL_INVALID", error: "A valid scoped Cluster API credential is required." });
      return null;
    }
    (request as ApiCredentialRequest).clusterApiCredential = verified;
    reply.header("Cache-Control", "no-store");
    return verified;
  }

  app.get("/api/public/v1/credential", async (request, reply) => {
    const verified = await requireScopes(request, reply, []);
    if (!verified) return;
    return { ok: true, contractVersion: 1, credential: verified.credential, scopes: verified.scopes };
  });

  app.get("/api/public/v1/projects", async (request, reply) => {
    if (!(await requireScopes(request, reply, ["projects.read"]))) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional(), includeArchived: queryBoolean }).parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) return reply.code(400).send({ ok: false, code: "CURSOR_INVALID", error: "The pagination cursor is invalid." });
    const rows = await prisma.project.findMany({
      where: { ...(query.includeArchived ? {} : { archived: false }), ...pageWhere(cursor) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { ok: true, contractVersion: 1, items: items.map(serializeProject), nextCursor: more && items.length ? encodeCursor(items[items.length - 1]) : null };
  });

  app.get("/api/public/v1/projects/:projectId", async (request, reply) => {
    if (!(await requireScopes(request, reply, ["projects.read"]))) return;
    const { projectId } = z.object({ projectId: z.string().min(1).max(200) }).parse(request.params);
    const row = await prisma.project.findUnique({ where: { id: projectId } });
    if (!row) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    return { ok: true, project: serializeProject(row) };
  });

  async function deliveryPage(request: FastifyRequest, reply: FastifyReply, requiredScope: string, mode: "builds" | "qa") {
    if (!(await requireScopes(request, reply, [requiredScope]))) return null;
    const { projectId } = z.object({ projectId: z.string().min(1).max(200) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional() }).parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) { reply.code(400).send({ ok: false, code: "CURSOR_INVALID", error: "The pagination cursor is invalid." }); return null; }
    const project = await prisma.project.findFirst({ where: { id: projectId, archived: false }, select: { id: true } });
    if (!project) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    let items: any[] = [];
    if (mode === "builds") {
      const rows = await prisma.deliveryBuild.findMany({ where: { projectId, archived: false, ...pageWhere(cursor) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
      items = rows.map((row: any) => delivery.serializeBuild(row));
    } else {
      const [plans, sessions] = await Promise.all([
        prisma.deliveryQaPlan.findMany({ where: { projectId, archived: false, ...pageWhere(cursor) }, include: { build: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1 }),
        prisma.deliveryQaSession.findMany({ where: { projectId, archived: false, ...pageWhere(cursor) }, include: { build: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1 }),
      ]);
      items = [
        ...plans.map((row: any) => ({ deliveryKind: "qa-plan", ...delivery.serializeQaPlan(row) })),
        ...sessions.map((row: any) => ({ deliveryKind: "qa-session", ...delivery.serializeQaSession(row) })),
      ].sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || String(b.id).localeCompare(String(a.id)));
    }
    const more = items.length > query.limit;
    const page = items.slice(0, query.limit);
    return { ok: true, contractVersion: 2, items: page, nextCursor: more && page.length ? encodeCursor(page[page.length - 1]) : null };
  }

  app.get("/api/public/v1/projects/:projectId/builds", async (request, reply) => deliveryPage(request, reply, "builds.read", "builds"));
  app.get("/api/public/v1/projects/:projectId/qa", async (request, reply) => deliveryPage(request, reply, "qa.read", "qa"));


  app.get("/api/public/v1/projects/:projectId/files", async (request, reply) => {
    if (!(await requireScopes(request, reply, ["files.read"]))) return;
    const { projectId } = z.object({ projectId: z.string().min(1).max(200) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional(), includeArchived: queryBoolean }).parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) return reply.code(400).send({ ok: false, code: "CURSOR_INVALID", error: "The pagination cursor is invalid." });
    const rows = await prisma.projectFile.findMany({
      where: { projectId, ...(query.includeArchived ? {} : { archived: false }), ...pageWhere(cursor) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { ok: true, contractVersion: 1, items: items.map(serializeProjectFile), nextCursor: more && items.length ? encodeCursor(items[items.length - 1]) : null };
  });

  app.get("/api/public/v1/calendar.ics", async (request, reply) => {
    if (!(await requireScopes(request, reply, ["calendar.read"]))) return;
    const query = z.object({
      projectId: z.string().min(1).max(200).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(2000),
    }).parse(request.query || {});
    const from = query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (to.getTime() <= from.getTime()) return reply.code(400).send({ ok: false, code: "CALENDAR_RANGE_INVALID", error: "Calendar feed end must be after start." });
    if (to.getTime() - from.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) return reply.code(400).send({ ok: false, code: "CALENDAR_RANGE_TOO_LARGE", error: "Calendar feed ranges are limited to two years." });
    const rows = await prisma.calendarEvent.findMany({
      where: { ...(query.projectId ? { projectId: query.projectId } : {}), startsAt: { gte: from, lte: to } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: query.limit,
    });
    reply.header("Content-Type", "text/calendar; charset=utf-8");
    reply.header("Content-Disposition", 'inline; filename="cluster-calendar.ics"');
    return reply.send(serializeIcs(rows));
  });

  app.post("/api/public/v1/projects/:projectId/builds", async (request, reply) => {
    const verified = await requireScopes(request, reply, ["builds.write"]);
    if (!verified) return;
    const { projectId } = z.object({ projectId: z.string().min(1).max(200) }).parse(request.params);
    const body = deliveryExecutorBuildInputSchema.parse(request.body || {});
    const project = await prisma.project.findFirst({ where: { id: projectId, archived: false }, select: { id: true } });
    if (!project) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    const existing = await prisma.deliveryBuild.findFirst({ where: { id: body.externalId, projectId, archived: false } });
    if (existing && (existing.sourceRepositoryId !== body.sourceRepositoryId || existing.sourceRevision !== body.sourceRevision || existing.sourceBranch !== body.sourceBranch || (existing.sourceReviewId || null) !== (body.sourceReviewId || null))) {
      return reply.code(409).send({ ok: false, code: "BUILD_PROVENANCE_IMMUTABLE", error: "An existing build cannot be reassigned to different source provenance. Submit a new externalId for a new build execution." });
    }
    const payload = {
      title: body.title,
      version: body.version,
      lane: body.lane,
      platform: body.platform,
      sourceRepositoryId: body.sourceRepositoryId,
      sourceRevision: body.sourceRevision,
      sourceBranch: body.sourceBranch,
      sourceReviewId: body.sourceReviewId || null,
      artifactUrl: body.artifactUrl,
      changelog: body.changelog,
      channel: body.channel,
      buildNumber: body.buildNumber,
      fileSize: body.fileSize,
      checksum: body.checksum,
      signed: body.signed,
      testedPlatforms: body.testedPlatforms,
      expiresAt: body.expiresAt || null,
      platformKey: body.platformKey,
      metadata: { ...body.metadata, executorCredentialId: String(verified.credential.id), executor: "public-api" },
      approval: existing?.approval || "draft",
      createdBy: existing?.createdBy || "CI / Public API",
      ownerId: existing?.ownerId || null,
      reviewerIds: existing ? parseJson(existing.reviewerIds, []) : [],
      pinned: Boolean(existing?.pinned),
      promotedAt: existing?.promotedAt?.toISOString?.() || existing?.promotedAt || null,
    };
    const build = await delivery.put(projectId, "build", body.externalId, payload, existing?.revision, null);
    reply.code(existing ? 200 : 201);
    return { ok: true, contractVersion: 2, created: !existing, build };
  });


  app.get("/api/public/v1/tickets", async (request, reply) => {
    if (!(await requireScopes(request, reply, ["tickets.read"]))) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional(), projectId: z.string().max(200).optional() }).parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) return reply.code(400).send({ ok: false, code: "CURSOR_INVALID", error: "The pagination cursor is invalid." });
    const rows = await prisma.card.findMany({
      where: {
        archived: false,
        workItemKind: "ticket",
        ...(query.projectId ? { list: { board: { projectId: query.projectId } } } : {}),
        ...pageWhere(cursor),
      },
      include: { list: { include: { board: { select: { id: true, projectId: true } } } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { ok: true, contractVersion: 1, items: items.map(serializeTicket), nextCursor: more && items.length ? encodeCursor(items[items.length - 1]) : null };
  });
}
