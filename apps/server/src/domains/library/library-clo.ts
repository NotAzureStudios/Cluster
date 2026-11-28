import fs from "node:fs/promises";

/** .clo — Cluster Library Object. One JSON file that carries a Library item
 *  and everything needed to rebuild it: notes keep their text, links their
 *  URL, forms their questions and settings (not responses), boards their
 *  lists, cards and checklists, whiteboards their canvas, folders their
 *  children, and files their bytes (base64). */
export const CLO_FORMAT = "cluster-library-object";
export const CLO_VERSION = 1;
const MAX_EMBEDDED_BYTES = 64 * 1024 * 1024;

export type CloNode = {
  type: string; title: string; tags?: string[]; metadata?: Record<string, unknown>;
  body?: string | null; externalUrl?: string | null;
  file?: { name: string; mimeType: string; base64: string } | null;
  form?: { description: string | null; purpose: string; schema: unknown; settings: unknown } | null;
  board?: { description: string | null; backgroundColor: string | null; lists: Array<{ title: string; description: string | null; color: string | null; isDone: boolean; cards: Array<{ title: string; description: string | null; priority: string; dueDate: string | null; startDate: string | null; category: string | null; coverColor: string | null; estimatePoints: number | null; externalUrl: string | null; checklist: Array<{ text: string; completed: boolean }> }> }> } | null;
  whiteboard?: { description: string | null; backgroundColor: string; gridColor: string; gridStyle: string; canvasWidth: number; canvasHeight: number; elements: unknown; categories: unknown; labels: unknown } | null;
  children?: CloNode[];
};
export type CloDocument = { format: typeof CLO_FORMAT; version: number; exportedAt: string; item: CloNode };

const parse = (raw: string | null | undefined, fallback: any) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

export function createCloService(deps: { prisma: any; resolveStoredLibraryFile: (item: any) => Promise<{ fullPath: string } | null> }) {
  const { prisma, resolveStoredLibraryFile } = deps;

  async function nodeFor(item: any, budget: { bytes: number }, depth = 0): Promise<CloNode> {
    const node: CloNode = { type: item.type, title: item.title, tags: parse(item.tags, []), metadata: parse(item.metadata, {}), body: item.body ?? null, externalUrl: item.externalUrl ?? null };
    if (item.fileName) {
      const resolved = await resolveStoredLibraryFile(item);
      if (resolved) {
        const bytes = await fs.readFile(resolved.fullPath);
        budget.bytes += bytes.length;
        if (budget.bytes > MAX_EMBEDDED_BYTES) throw Object.assign(new Error("This export is larger than 64 MB. Download the files directly instead."), { statusCode: 413 });
        node.file = { name: item.originalName || item.fileName, mimeType: item.mimeType || "application/octet-stream", base64: bytes.toString("base64") };
      }
    }
    if (item.originKind === "studio-form" && item.originRef) {
      const form = await prisma.studioForm.findUnique({ where: { id: item.originRef }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      const latest = form?.versions?.[0];
      if (form) node.form = { description: form.description, purpose: form.purpose, schema: parse(latest?.schemaJson, { fields: [] }), settings: parse(latest?.settingsJson, {}) };
    }
    if (item.originKind === "board" && item.originRef) {
      const board = await prisma.board.findUnique({ where: { id: item.originRef }, include: { lists: { where: { archived: false }, orderBy: { position: "asc" }, include: { cards: { where: { archived: false }, orderBy: { position: "asc" }, include: { checklistItems: { orderBy: { position: "asc" } } } } } } } });
      if (board) node.board = { description: board.description, backgroundColor: board.backgroundColor, lists: board.lists.map((list: any) => ({
        title: list.title, description: list.description, color: list.color, isDone: list.isDone,
        cards: list.cards.map((card: any) => ({ title: card.title, description: card.description, priority: card.priority, dueDate: card.dueDate?.toISOString() || null, startDate: card.startDate?.toISOString() || null, category: card.category, coverColor: card.coverColor, estimatePoints: card.estimatePoints, externalUrl: card.externalUrl, checklist: (card.checklistItems || []).map((entry: any) => ({ text: entry.text, completed: entry.completed })) })),
      })) };
    }
    if (item.originKind === "whiteboard" && item.originRef) {
      const board = await prisma.whiteboard.findUnique({ where: { id: item.originRef } });
      if (board) node.whiteboard = { description: board.description, backgroundColor: board.backgroundColor, gridColor: board.gridColor, gridStyle: board.gridStyle, canvasWidth: board.canvasWidth, canvasHeight: board.canvasHeight, elements: parse(board.elements, []), categories: parse(board.categories, []), labels: parse(board.labels, []) };
    }
    if (item.type === "folder" && depth < 12) {
      const children = await prisma.libraryItem.findMany({ where: { parentId: item.id, status: { not: "trashed" }, deletedAt: null }, orderBy: [{ manualOrder: "asc" }, { title: "asc" }] });
      node.children = [];
      for (const child of children) node.children.push(await nodeFor(child, budget, depth + 1));
    }
    return node;
  }

  async function exportItem(item: any): Promise<CloDocument> {
    return { format: CLO_FORMAT, version: CLO_VERSION, exportedAt: new Date().toISOString(), item: await nodeFor(item, { bytes: 0 }) };
  }

  /** Rebuild a node under parentId. Files are returned for the caller to
   *  upload through the normal upload path; everything else is created here. */
  async function importNode(node: CloNode, context: { userId: string; parentId: string | null; projectId: string | null }, pendingFiles: Array<{ parentId: string | null; path: number[] }>, path: number[] = []): Promise<string | null> {
    const base = { parentId: context.parentId, projectId: context.projectId, ownerId: context.userId, creatorId: context.userId, lastEditorId: context.userId, title: String(node.title || "Untitled").slice(0, 300), tags: JSON.stringify(Array.isArray(node.tags) ? node.tags : []), metadata: JSON.stringify(Object.fromEntries(Object.entries(node.metadata && typeof node.metadata === "object" ? node.metadata : {}).filter(([key]) => !["packetRoot", "projectFolder", "projectMedia"].includes(key)))), originKind: "manual", source: "import" };
    if (node.file) { pendingFiles.push({ parentId: context.parentId, path }); return null; }
    if (node.type === "folder") {
      const folder = await prisma.libraryItem.create({ data: { ...base, type: "folder" } });
      for (const [index, child] of (node.children || []).entries()) await importNode(child, { ...context, parentId: folder.id }, pendingFiles, [...path, index]);
      return folder.id;
    }
    if (node.type === "note") return (await prisma.libraryItem.create({ data: { ...base, type: "note", body: node.body || "" } })).id;
    if (["link", "youtube-video", "youtube-playlist"].includes(node.type) && node.externalUrl && /^https?:\/\//i.test(node.externalUrl)) return (await prisma.libraryItem.create({ data: { ...base, type: node.type, externalUrl: node.externalUrl, source: node.type === "link" ? "link" : "youtube" } })).id;
    if (node.type === "form" && node.form) {
      const slug = base.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
      const form = await prisma.studioForm.create({ data: { key: `${slug}-${Date.now().toString(36)}`, title: base.title, description: node.form.description || null, purpose: node.form.purpose === "application" ? "application" : "general" } });
      await prisma.studioFormVersion.create({ data: { formId: form.id, version: 1, schemaJson: JSON.stringify(node.form.schema || { fields: [] }), settingsJson: JSON.stringify(node.form.settings || {}), status: "draft" } });
      return (await prisma.libraryItem.create({ data: { ...base, type: "form", originKind: "studio-form", originRef: form.id, source: "form" } })).id;
    }
    if (node.type === "board" && node.board) {
      if (!context.projectId) throw Object.assign(new Error("Boards belong to a project. Import this .clo into a project's folder."), { statusCode: 400 });
      const board = await prisma.board.create({ data: { projectId: context.projectId, name: base.title, description: node.board.description || null, backgroundColor: node.board.backgroundColor || null } });
      for (const [listIndex, list] of (node.board.lists || []).entries()) {
        const created = await prisma.boardList.create({ data: { boardId: board.id, title: String(list.title || "List"), description: list.description || null, color: list.color || null, isDone: Boolean(list.isDone), position: listIndex } });
        for (const [cardIndex, card] of (list.cards || []).entries()) {
          const madeCard = await prisma.card.create({ data: { listId: created.id, title: String(card.title || "Card"), description: card.description || null, priority: card.priority || "medium", dueDate: card.dueDate ? new Date(card.dueDate) : null, startDate: card.startDate ? new Date(card.startDate) : null, category: card.category || null, coverColor: card.coverColor || null, estimatePoints: card.estimatePoints ?? null, externalUrl: card.externalUrl || null, position: cardIndex } });
          for (const [entryIndex, entry] of (card.checklist || []).entries()) await prisma.checklistItem.create({ data: { cardId: madeCard.id, text: String(entry.text || ""), completed: Boolean(entry.completed), position: entryIndex } });
        }
      }
      return (await prisma.libraryItem.create({ data: { ...base, type: "board", originKind: "board", originRef: board.id, source: "board" } })).id;
    }
    if (node.type === "whiteboard" && node.whiteboard) {
      const value = node.whiteboard;
      const whiteboard = await prisma.whiteboard.create({ data: { projectId: context.projectId, name: base.title, description: value.description || null, backgroundColor: value.backgroundColor || "#f8fafc", gridColor: value.gridColor || "#cbd5e1", gridStyle: value.gridStyle || "lines", canvasWidth: Number(value.canvasWidth) || 1800, canvasHeight: Number(value.canvasHeight) || 950, elements: JSON.stringify(value.elements || []), categories: JSON.stringify(value.categories || []), labels: JSON.stringify(value.labels || []) } });
      return (await prisma.libraryItem.create({ data: { ...base, type: "whiteboard", originKind: "whiteboard", originRef: whiteboard.id, source: "whiteboard" } })).id;
    }
    throw Object.assign(new Error(`This .clo holds a ${node.type} item that Cluster can't rebuild.`), { statusCode: 400 });
  }

  return { exportItem, importNode };
}
