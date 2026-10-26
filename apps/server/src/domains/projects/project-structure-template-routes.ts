import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createHttpError } from "../../core/http-errors.js";

const kindSchema = z.enum(["board", "whiteboard"]);
const templatePayloadLimit = 256_000;

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function templatePayload(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (serialized.length > templatePayloadLimit) throw createHttpError("PROJECT_TEMPLATE_TOO_LARGE", "This reusable structure is too large. Remove embedded images or card content and try again.", 400);
  return serialized;
}

function serializeTemplate(row: any) {
  const payload = parseJson<Record<string, any>>(row.payload, {});
  return {
    id: row.id,
    projectId: row.projectId,
    kind: payload.kind,
    title: row.title,
    sourceId: payload.sourceId || null,
    sourceLabel: payload.sourceLabel || null,
    includeCards: Boolean(payload.includeCards),
    itemCount: Number(payload.itemCount || 0),
    createdById: row.userId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

function remapWhiteboardStructure(payload: Record<string, any>) {
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const labels = Array.isArray(payload.labels) ? payload.labels : [];
  const categoryIds = new Map(categories.map((item: any) => [String(item.id), randomUUID()]));
  const labelIds = new Map(labels.map((item: any) => [String(item.id), randomUUID()]));
  const groupIds = new Map<string, string>();
  const elements = (Array.isArray(payload.elements) ? payload.elements : []).map((item: any) => {
    const next = { ...item, id: randomUUID() };
    if (item.categoryId) next.categoryId = categoryIds.get(String(item.categoryId)) || null;
    if (Array.isArray(item.labelIds)) next.labelIds = item.labelIds.map((id: any) => labelIds.get(String(id))).filter(Boolean);
    if (item.groupId) {
      const key = String(item.groupId);
      if (!groupIds.has(key)) groupIds.set(key, randomUUID());
      next.groupId = groupIds.get(key);
    }
    return next;
  });
  return {
    elements,
    categories: categories.map((item: any) => ({ ...item, id: categoryIds.get(String(item.id)) || randomUUID() })),
    labels: labels.map((item: any) => ({ ...item, id: labelIds.get(String(item.id)) || randomUUID() })),
  };
}

export function registerProjectStructureTemplateRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity }: Dependencies) {
  app.get("/api/projects/:projectId/structure-templates", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ kind: kindSchema.optional() }).parse(request.query || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const rows = await prisma.clusterPersistenceRecord.findMany({ where: { projectId: project.id, kind: "projectStructureTemplate", archived: false }, orderBy: { updatedAt: "desc" }, take: 100 });
    const templates = rows.map(serializeTemplate).filter((item: any) => !query.kind || item.kind === query.kind);
    return { projectId: project.id, templates };
  });

  app.post("/api/projects/:projectId/structure-templates/capture", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ kind: kindSchema, sourceId: z.string().min(1), title: z.string().trim().min(1).max(160).optional(), includeCards: z.boolean().default(false) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;

    let payload: Record<string, any>;
    let title: string;
    if (body.kind === "board") {
      const board = await prisma.board.findFirst({ where: { id: body.sourceId, projectId: project.id, archived: false }, include: { lists: { orderBy: { position: "asc" }, include: { cards: { where: { archived: false }, orderBy: { position: "asc" }, take: 100 } } } } });
      if (!board) throw createHttpError("BOARD_NOT_FOUND", "Board not found in this project.", 404);
      title = body.title || `${board.name} template`;
      payload = {
        kind: "board", sourceId: board.id, sourceLabel: board.name, includeCards: body.includeCards,
        structure: {
          description: board.description || null,
          backgroundColor: board.backgroundColor || null,
          backgroundStyle: board.backgroundStyle || "soft",
          labelDefinitions: parseJson(board.labelDefinitions, []),
          lists: board.lists.map((list: any) => ({
            title: list.title, description: list.description || null, color: list.color || null, wipLimit: list.wipLimit || null, isDone: Boolean(list.isDone), collapsed: Boolean(list.collapsed),
            cards: body.includeCards ? list.cards.map((card: any) => ({ title: card.title, description: card.description || null, priority: card.priority || "medium", labels: parseJson(card.labels, []), category: card.category || null, estimatePoints: card.estimatePoints || null })) : [],
          })),
        },
        itemCount: board.lists.length + (body.includeCards ? board.lists.reduce((sum: number, list: any) => sum + list.cards.length, 0) : 0),
      };
    } else {
      const whiteboard = await prisma.whiteboard.findFirst({ where: { id: body.sourceId, projectId: project.id } });
      if (!whiteboard) throw createHttpError("WHITEBOARD_NOT_FOUND", "Whiteboard not found in this project.", 404);
      title = body.title || `${whiteboard.name} template`;
      const elements = parseJson<any[]>(whiteboard.elements, []);
      payload = {
        kind: "whiteboard", sourceId: whiteboard.id, sourceLabel: whiteboard.name, includeCards: false,
        structure: { description: whiteboard.description || null, elements, categories: parseJson(whiteboard.categories, []), labels: parseJson(whiteboard.labels, []), backgroundColor: whiteboard.backgroundColor, gridColor: whiteboard.gridColor, gridStyle: whiteboard.gridStyle, canvasWidth: whiteboard.canvasWidth, canvasHeight: whiteboard.canvasHeight },
        itemCount: elements.length,
      };
    }

    const row = await prisma.clusterPersistenceRecord.create({ data: { kind: "projectStructureTemplate", title, projectId: project.id, entityType: body.kind, entityId: body.sourceId, userId: user?.id || null, ownerId: user?.id || null, status: "active", visibility: "internal", sourceKey: "project-structure-template", schemaVersion: 1, validationState: "valid", payload: templatePayload(payload) } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "template_captured", entityType: "project_structure_template", entityId: row.id, title: "Reusable project structure saved", message: `${title} · ${body.kind}` });
    return serializeTemplate(row);
  });

  app.post("/api/projects/:projectId/structure-templates/:templateId/apply", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), templateId: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(160).optional() }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const row = await prisma.clusterPersistenceRecord.findFirst({ where: { id: params.templateId, projectId: project.id, kind: "projectStructureTemplate", archived: false } });
    if (!row) throw createHttpError("PROJECT_TEMPLATE_NOT_FOUND", "Reusable project structure not found.", 404);
    const payload = parseJson<Record<string, any>>(row.payload, {});
    const structure = parseJson<Record<string, any>>(payload.structure, {});

    if (payload.kind === "board") {
      const lists = Array.isArray(structure.lists) ? structure.lists.slice(0, 20) : [];
      if (!lists.length) throw createHttpError("PROJECT_TEMPLATE_INVALID", "Board template has no columns.", 400);
      const board = await prisma.board.create({ data: { projectId: project.id, name: body.name || row.title.replace(/\s+template$/i, ""), description: structure.description || null, backgroundColor: structure.backgroundColor || null, backgroundStyle: structure.backgroundStyle || "soft", labelDefinitions: JSON.stringify(Array.isArray(structure.labelDefinitions) ? structure.labelDefinitions : []) } });
      for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
        const sourceList = lists[listIndex];
        const list = await prisma.boardList.create({ data: { boardId: board.id, title: String(sourceList.title || `Column ${listIndex + 1}`).slice(0, 80), description: sourceList.description || null, color: sourceList.color || null, wipLimit: sourceList.wipLimit || null, isDone: Boolean(sourceList.isDone), collapsed: Boolean(sourceList.collapsed), position: listIndex * 100 } });
        const cards = Array.isArray(sourceList.cards) ? sourceList.cards.slice(0, 100) : [];
        for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
          const card = cards[cardIndex];
          await prisma.card.create({ data: { listId: list.id, title: String(card.title || `Card ${cardIndex + 1}`).slice(0, 300), description: card.description || null, position: cardIndex * 100, priority: String(card.priority || "medium"), labels: JSON.stringify(Array.isArray(card.labels) ? card.labels : []), category: card.category || null, estimatePoints: card.estimatePoints || null } });
        }
      }
      await logActivity({ userId: user?.id, projectId: project.id, boardId: board.id, type: "template_applied", entityType: "board", entityId: board.id, title: "Board created from reusable structure", message: `${board.name} · ${row.title}` });
      return { ok: true, kind: "board", id: board.id, name: board.name };
    }

    if (payload.kind === "whiteboard") {
      const remapped = remapWhiteboardStructure(structure);
      const whiteboard = await prisma.whiteboard.create({ data: { projectId: project.id, name: body.name || row.title.replace(/\s+template$/i, ""), description: structure.description || null, elements: JSON.stringify(remapped.elements), categories: JSON.stringify(remapped.categories), labels: JSON.stringify(remapped.labels), productionLinks: "{}", backgroundColor: structure.backgroundColor || "#f8fafc", gridColor: structure.gridColor || "#cbd5e1", gridStyle: ["lines", "dots", "none"].includes(String(structure.gridStyle)) ? structure.gridStyle : "lines", canvasWidth: Math.max(600, Math.min(4000, Number(structure.canvasWidth || 1800))), canvasHeight: Math.max(400, Math.min(2400, Number(structure.canvasHeight || 950))) } });
      await logActivity({ userId: user?.id, projectId: project.id, whiteboardId: whiteboard.id, type: "template_applied", entityType: "whiteboard", entityId: whiteboard.id, title: "Whiteboard created from reusable structure", message: `${whiteboard.name} · ${row.title}` });
      return { ok: true, kind: "whiteboard", id: whiteboard.id, name: whiteboard.name };
    }
    throw createHttpError("PROJECT_TEMPLATE_INVALID", "Reusable project structure has an unsupported type.", 400);
  });

  app.delete("/api/projects/:projectId/structure-templates/:templateId", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), templateId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await prisma.clusterPersistenceRecord.updateMany({ where: { id: params.templateId, projectId: project.id, kind: "projectStructureTemplate", archived: false }, data: { archived: true, status: "archived", revision: { increment: 1 } } });
    if (!result.count) throw createHttpError("PROJECT_TEMPLATE_NOT_FOUND", "Reusable project structure not found.", 404);
    return { ok: true };
  });
}
