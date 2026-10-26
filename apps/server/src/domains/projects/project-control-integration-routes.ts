import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createHttpError } from "../../core/http-errors.js";
import { listProjectControlLinkCandidates, reconcileProjectControlLinks } from "./project-control-link-service.js";
import { serializeProjectControlRecord } from "./project-control-service.js";
import type { SourceProviderService } from "../source-control/source-provider-service.js";

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  readSettings: () => Promise<Record<string, any>>;
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number, policy?: Record<string, unknown>) => Promise<Response>;
  sourceProvider: SourceProviderService;
};


function connectionResult(status: "connected" | "warning" | "failed" | "not_configured", message: string, detail: Record<string, unknown> = {}) {
  return { status, message, ...detail };
}

function discordCoordinates(value: string) {
  const url = new URL(value);
  if (!["discord.com", "www.discord.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/channels\/(\d+)\/(\d+)/);
  return match ? { guildId: match[1], channelId: match[2] } : null;
}

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      sourceBindings: {
        where: { archived: false },
        include: { repository: { include: { connection: true } } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      integrationBindings: {
        where: { archived: false },
        include: { connection: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

async function ensureRecord(prisma: any, projectId: string, recordId: string) {
  const record = await prisma.projectControlRecord.findFirst({ where: { id: recordId, projectId, archived: false } });
  if (!record) throw createHttpError("PROJECT_CONTROL_RECORD_NOT_FOUND", "Project control record not found.", 404);
  return record;
}

function markdownReport(project: any, report: any) {
  const payload = typeof report.payload === "string" ? (() => { try { return JSON.parse(report.payload); } catch { return {}; } })() : report.payload || {};
  const lines = [
    `# ${report.title}`,
    "",
    `**Project:** ${project.name}`,
    `**Status:** ${report.status}`,
    `**Generated:** ${new Date(report.createdAt).toISOString()}`,
    "",
    "## Executive summary",
    "",
    report.description || payload.executiveSummary || "No summary recorded.",
    "",
    "## Health",
    "",
    ...Object.entries(payload.health || {}).map(([key, value]) => `- ${key}: ${value}%`),
    "",
    "## Current work",
    "",
    ...(Array.isArray(payload.current) && payload.current.length ? payload.current.map((item: any) => `- ${item.title}${item.progress !== undefined ? ` (${item.progress}%)` : ""}`) : ["- No current work captured."]),
    "",
    "## Risks",
    "",
    ...(Array.isArray(payload.risks) && payload.risks.length ? payload.risks.map((item: any) => `- ${item.title}${item.score ? ` · ${item.score}/25` : ""}`) : ["- No active risks captured."]),
    "",
    "## Decisions needed",
    "",
    ...(Array.isArray(payload.decisionsNeeded) && payload.decisionsNeeded.length ? payload.decisionsNeeded.map((item: any) => `- ${item.title}`) : ["- No decisions pending."]),
  ];
  return lines.join("\n");
}

export function registerProjectControlIntegrationRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity, readSettings, fetchWithTimeout, sourceProvider }: Dependencies) {

  app.get("/api/projects/:projectId/connections/catalog", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const [repositories, discordConnections] = await Promise.all([
      prisma.sourceRepository.findMany({
        where: { workspaceId: project.workspaceId, archived: false },
        include: { connection: true },
        orderBy: { name: "asc" },
      }),
      prisma.integrationConnection.findMany({
        where: { workspaceId: project.workspaceId, providerId: "communication.discord", archived: false, status: { not: "disabled" } },
        orderBy: { displayName: "asc" },
      }),
    ]);
    const sourceBinding = project.sourceBindings[0] || null;
    const discordBinding = project.integrationBindings.find((binding: any) => binding.connection?.providerId === "communication.discord" && binding.resourceType === "project")
      || project.integrationBindings.find((binding: any) => binding.connection?.providerId === "communication.discord")
      || null;
    return {
      projectId: project.id,
      revision: project.revision,
      sourceBinding,
      discordBinding,
      repositories,
      discordConnections,
    };
  });

  app.put("/api/projects/:projectId/connections", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({
      repositoryId: z.string().min(1).optional().nullable(),
      discordConnectionId: z.string().min(1).optional().nullable(),
      expectedRevision: z.number().int().positive().optional(),
    }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== project.revision) {
      return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Project connections changed since this page was loaded. Reload the project and try again.", currentRevision: project.revision });
    }
    const repository = body.repositoryId
      ? await prisma.sourceRepository.findFirst({ where: { id: body.repositoryId, workspaceId: project.workspaceId, archived: false }, include: { connection: true } })
      : null;
    if (body.repositoryId && !repository) throw createHttpError("SOURCE_REPOSITORY_NOT_FOUND", "Choose an active repository from this studio.", 400);
    const discordConnection = body.discordConnectionId
      ? await prisma.integrationConnection.findFirst({ where: { id: body.discordConnectionId, workspaceId: project.workspaceId, providerId: "communication.discord", archived: false, status: { not: "disabled" } } })
      : null;
    if (body.discordConnectionId && !discordConnection) throw createHttpError("DISCORD_CONNECTION_NOT_FOUND", "Choose an active Discord connection from this studio.", 400);
    const discordConnectionIds = (await prisma.integrationConnection.findMany({
      where: { workspaceId: project.workspaceId, providerId: "communication.discord" },
      select: { id: true },
    })).map((row: any) => row.id);

    await prisma.$transaction(async (tx: any) => {
      const revision = await tx.project.updateMany({
        where: { id: project.id, revision: project.revision },
        data: { revision: { increment: 1 } },
      });
      if (!revision.count) throw createHttpError("REVISION_CONFLICT", "Project connections changed while saving. Reload the project and try again.", 409);
      await tx.projectSourceBinding.deleteMany({ where: { projectId: project.id, role: "primary" } });
      await tx.projectSourceBinding.updateMany({ where: { projectId: project.id, archived: false }, data: { isPrimary: false } });
      if (repository) {
        await tx.projectSourceBinding.create({
          data: {
            projectId: project.id,
            repositoryId: repository.id,
            role: "primary",
            branchRole: "development",
            defaultBranch: repository.defaultBranch,
            isPrimary: true,
          },
        });
      }
      if (discordConnectionIds.length) {
        const retiredDiscordConnectionIds = discordConnectionIds.filter((connectionId: string) => connectionId !== discordConnection?.id);
        if (retiredDiscordConnectionIds.length) {
          await tx.projectIntegrationBinding.updateMany({
            where: { projectId: project.id, connectionId: { in: retiredDiscordConnectionIds }, resourceType: "discord_route", archived: false },
            data: { archived: true },
          });
        }
        await tx.projectIntegrationBinding.deleteMany({
          where: { projectId: project.id, connectionId: { in: discordConnectionIds }, resourceType: "project" },
        });
      }
      if (discordConnection) {
        await tx.projectIntegrationBinding.create({
          data: {
            projectId: project.id,
            connectionId: discordConnection.id,
            resourceType: "project",
            displayName: discordConnection.displayName,
            isPrimary: true,
          },
        });
      }
    });
    await logActivity({
      userId: user?.id,
      projectId: project.id,
      type: "updated",
      entityType: "project_connections",
      entityId: project.id,
      title: "Project connections updated",
      message: [repository?.name, discordConnection?.displayName].filter(Boolean).join(" · ") || "Connections cleared",
    });
    const updated = await ensureProject(prisma, project.id);
    return { ok: true, projectId: project.id, revision: updated.revision, sourceBinding: updated.sourceBindings[0] || null, discordBinding: updated.integrationBindings.find((binding: any) => binding.connection?.providerId === "communication.discord") || null };
  });

  app.get("/api/projects/:projectId/connections/health", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const settings = await readSettings();
    const sourceBinding = project.sourceBindings[0] || null;
    const repository = sourceBinding?.repository || null;
    let git = connectionResult("not_configured", "No repository linked.");
    if (repository) {
      const remoteUrl = repository.remoteUrl || repository.cloneUrl || null;
      const providerId = repository.connection?.providerId || null;
      if (repository.connection) {
        try {
          const snapshot = await sourceProvider.repositorySnapshot(repository);
          git = connectionResult("connected", "Repository verified.", { repositoryId: repository.id, providerId: snapshot.providerId, defaultBranch: snapshot.defaultBranch });
        } catch (error) {
          git = connectionResult("failed", error instanceof Error ? error.message : "Repository check failed.", { repositoryId: repository.id, providerId });
        }
      } else {
        git = connectionResult("warning", remoteUrl ? "Repository is linked but has no active Source Control connection." : "Cluster repository is linked without a provider connection.", { repositoryId: repository.id, providerId });
      }
    }

    const discordBinding = project.integrationBindings.find((binding: any) => binding.connection?.providerId === "communication.discord" && binding.resourceType !== "project")
      || project.integrationBindings.find((binding: any) => binding.connection?.providerId === "communication.discord")
      || null;
    let discord = connectionResult("not_configured", "No Discord connection linked.");
    if (discordBinding) {
      const connection = discordBinding.connection;
      if (connection?.status === "error") discord = connectionResult("failed", connection.healthMessage || "The Discord connection is reporting an error.");
      else if (discordBinding.externalUrl) {
        try {
          const coordinates = discordCoordinates(discordBinding.externalUrl);
          if (!coordinates) discord = connectionResult("warning", "The linked Discord resource URL is invalid.");
          else if (!settings.discordBotToken) discord = connectionResult("warning", "Discord resource linked. Bot access has not been verified.", coordinates);
          else {
            const token = String(settings.discordBotToken).startsWith("Bot ") ? String(settings.discordBotToken) : `Bot ${settings.discordBotToken}`;
            const response = await fetchWithTimeout(`https://discord.com/api/v10/channels/${encodeURIComponent(coordinates.channelId)}`, { headers: { Authorization: token, Accept: "application/json" } }, undefined, { purpose: "Discord API", requireHttps: true, allowedHosts: ["discord.com"], maxResponseBytes: 8 * 1024 * 1024 });
            discord = response.ok ? connectionResult("connected", "Discord resource verified.", coordinates) : connectionResult("failed", `Discord access check failed with HTTP ${response.status}.`, coordinates);
          }
        } catch (error) { discord = connectionResult("failed", error instanceof Error ? error.message : "Discord check failed."); }
      } else {
        discord = connectionResult("connected", "Discord connection linked. Project channel and thread routing are managed by the Discord integration.", { connectionId: connection?.id || null });
      }
    }
    return { projectId: project.id, checkedAt: new Date().toISOString(), git, discord };
  });

  app.get("/api/projects/:projectId/control-links", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    return { projectId: project.id, candidates: await listProjectControlLinkCandidates(prisma, project.id) };
  });

  app.post("/api/projects/:projectId/control-center/reconcile", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await reconcileProjectControlLinks(prisma, project.id);
    await logActivity({ userId: user?.id, projectId: project.id, type: "reconciled", entityType: "project_control_center", entityId: project.id, title: "Linked project records reconciled", message: `${result.updated}/${result.checked} linked records updated` });
    return { ok: true, ...result };
  });

  app.post("/api/projects/:projectId/control-center/reorder", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ orderedIds: z.array(z.string()).min(1).max(1000), parentId: z.string().optional().nullable() }).parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const rows = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, id: { in: body.orderedIds }, archived: false }, select: { id: true } });
    if (rows.length !== new Set(body.orderedIds).size) throw createHttpError("VALIDATION_FAILED", "One or more reordered records do not belong to this project.", 400);
    await prisma.$transaction(body.orderedIds.map((id, index) => prisma.projectControlRecord.update({ where: { id }, data: { sortOrder: index * 100, parentId: body.parentId === undefined ? undefined : body.parentId || null, revision: { increment: 1 } } })));
    await logActivity({ userId: user?.id, projectId: project.id, type: "reordered", entityType: "project_control_center", entityId: project.id, title: "Project roadmap reordered", message: `${body.orderedIds.length} records reordered` });
    return { ok: true, updated: body.orderedIds.length };
  });

  app.post("/api/projects/:projectId/control-records/:recordId/materialize", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const body = z.object({ target: z.enum(["ticket", "timeline"]), attach: z.boolean().default(true), destinationBoardId: z.string().optional(), destinationListId: z.string().optional() }).parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const record = await ensureRecord(prisma, project.id, params.recordId);
    if (body.target === "timeline") {
      const externalUrl = `cluster://project-control/${record.id}`;
      const startsAt = record.startDate || record.dueDate || new Date();
      const endsAt = record.dueDate || record.startDate || null;
      const existing = await prisma.timelineItem.findFirst({ where: { projectId: project.id, source: "project-control", externalUrl } });
      const timeline = existing
        ? await prisma.timelineItem.update({ where: { id: existing.id }, data: { title: record.title, description: record.description, startsAt, endsAt, type: record.kind, revision: { increment: 1 } } })
        : await prisma.timelineItem.create({ data: { projectId: project.id, userId: record.ownerId, title: record.title, description: record.description, startsAt, endsAt, type: record.kind, source: "project-control", externalUrl } });
      if (body.attach) await prisma.projectControlRecord.update({ where: { id: record.id }, data: { linkedEntityType: "timeline", linkedEntityId: timeline.id, revision: { increment: 1 } } });
      await logActivity({ userId: user?.id, projectId: project.id, type: existing ? "updated" : "created", entityType: "timeline", entityId: timeline.id, title: existing ? "Timeline projection updated" : "Timeline projection created", message: record.title, metadata: { projectControlRecordId: record.id } });
      return { ok: true, target: "timeline", entity: timeline };
    }
    // Project Control may materialize a Ticket but cannot provision or select a
    // Board implicitly. Resolve selected destination against current authority.
    if (!body.destinationBoardId || !body.destinationListId) throw createHttpError("PROJECT_TICKET_DESTINATION_REQUIRED", "Choose a Project Board and active List before creating a Ticket.", 409);
    const board = await prisma.board.findFirst({ where: { id: body.destinationBoardId, projectId: project.id, archived: false }, include: { lists: { where: { archived: false }, orderBy: { position: "asc" } } } });
    if (!board) throw createHttpError("PROJECT_TICKET_BOARD_UNAVAILABLE", "Selected Project Board is unavailable.", 409);
    if (!(await enforceTargetAccess(request, reply, "board", board.id, project, "contribute"))) return;
    const list = board.lists.find((item: any) => item.id === body.destinationListId && !item.isDone);
    if (!list) throw createHttpError("PROJECT_TICKET_LIST_UNAVAILABLE", "Selected List is archived, completed or belongs to a different Board.", 409);
    const externalUrl = `cluster://project-control/${record.id}`;
    const existing = await prisma.card.findFirst({ where: { externalUrl, archived: false, list: { board: { projectId: project.id } } } });
    if (existing && existing.listId !== list.id) throw createHttpError("PROJECT_TICKET_ALREADY_LINKED", "This record already has a Ticket in another List. Open the existing Ticket rather than creating a duplicate.", 409);
    const duplicate = existing;
    const last = await prisma.card.findFirst({ where: { listId: list.id, archived: false }, orderBy: { position: "desc" } });
    const ticket = duplicate || await prisma.card.create({ data: { listId: list.id, title: record.title, workItemKind: "ticket", ticketStage: "new", description: record.description, priority: ["low", "medium", "high", "urgent"].includes(record.priority) ? record.priority : "medium", dueDate: record.dueDate, startDate: record.startDate, labels: JSON.stringify(["ticket", "project-control", record.kind]), assigneeId: record.ownerId, externalUrl: `cluster://project-control/${record.id}`, position: last ? last.position + 1 : 0 } });
    await prisma.projectRelationship.upsert({ where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: "control", sourceId: record.id, targetType: "ticket", targetId: ticket.id, relationship: "implements" } }, update: { description: "Ticket materialized from Project Control.", createdById: user?.id || null }, create: { projectId: project.id, sourceType: "control", sourceId: record.id, targetType: "ticket", targetId: ticket.id, relationship: "implements", description: "Ticket materialized from Project Control.", createdById: user?.id || null } });
    if (body.attach) await prisma.projectControlRecord.update({ where: { id: record.id }, data: { linkedEntityType: "ticket", linkedEntityId: ticket.id, revision: { increment: 1 } } });
    await logActivity({ userId: user?.id, projectId: project.id, boardId: board.id, cardId: ticket.id, type: duplicate ? "linked" : "created", entityType: "ticket", entityId: ticket.id, title: duplicate ? "Existing ticket linked" : "Ticket created from Project Control", message: record.title, metadata: { projectControlRecordId: record.id } });
    return { ok: true, target: "ticket", entity: { ...ticket, boardId: board.id, listId: list.id } };
  });

  app.post("/api/projects/:projectId/control-center/sync-timeline", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const records = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, kind: { in: ["phase", "milestone", "deliverable"] }, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] } });
    let created = 0;
    let updated = 0;
    for (const record of records) {
      const externalUrl = `cluster://project-control/${record.id}`;
      const existing = await prisma.timelineItem.findFirst({ where: { projectId: project.id, source: "project-control", externalUrl } });
      const data = { title: record.title, description: record.description, startsAt: record.startDate || record.dueDate || new Date(), endsAt: record.dueDate || record.startDate || null, type: record.kind, userId: record.ownerId };
      const item = existing ? await prisma.timelineItem.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } }) : await prisma.timelineItem.create({ data: { projectId: project.id, source: "project-control", externalUrl, ...data } });
      await prisma.projectControlRecord.update({ where: { id: record.id }, data: { linkedEntityType: "timeline", linkedEntityId: item.id, revision: { increment: 1 } } });
      if (existing) updated += 1; else created += 1;
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: "synced", entityType: "timeline", entityId: project.id, title: "Project roadmap synced to Timeline", message: `${created} created · ${updated} updated` });
    return { ok: true, created, updated, total: records.length };
  });

  app.get("/api/projects/:projectId/status-reports/:reportId/export", async (request, reply: FastifyReply) => {
    const params = z.object({ projectId: z.string(), reportId: z.string() }).parse(request.params);
    const query = z.object({ format: z.enum(["markdown", "json"]).default("markdown") }).parse(request.query || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const report = await prisma.projectControlRecord.findFirst({ where: { id: params.reportId, projectId: project.id, kind: "status_report", archived: false } });
    if (!report) throw createHttpError("PROJECT_CONTROL_RECORD_NOT_FOUND", "Status report not found.", 404);
    if (query.format === "json") return serializeProjectControlRecord(report);
    reply.type("text/markdown; charset=utf-8");
    return markdownReport(project, report);
  });
}
