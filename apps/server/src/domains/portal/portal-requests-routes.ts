import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readPortalSettings } from "./portal-boundary.js";

/** Portal requests: bug reports, help requests and feedback from players
 *  (no account: a public code plus a secret key), applicants following their
 *  application, and requests from clients. Each one is a conversation the
 *  studio answers from Chat › Requests. */
type Deps = {
  app: any; prisma: any; authorization: any;
  getCurrentUser: (request: any) => Promise<any>;
  readSettings: (force?: boolean) => Promise<any>;
  logActivity: (input: any) => Promise<unknown>;
};

export const PORTAL_REQUEST_KINDS = ["bug", "help", "feedback", "request", "application"] as const;
export const PORTAL_REQUEST_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
const PUBLIC_KINDS = ["bug", "help", "feedback"] as const;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const hashKey = (key: string) => createHash("sha256").update(`portal-request:${key}`).digest("hex");
const newCode = () => { const bytes = randomBytes(8); let code = ""; for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]; return `${code.slice(0, 4)}-${code.slice(4)}`; };
const keyMatches = (stored: string, key: string) => { const a = Buffer.from(stored, "hex"); const b = Buffer.from(hashKey(key), "hex"); return a.length === b.length && timingSafeEqual(a, b); };

/** Applicant-facing stage for an application submission's status. */
export function applicationStage(status: string) {
  const value = String(status || "submitted").toLowerCase();
  if (["accepted", "approved", "offer"].includes(value)) return "Accepted";
  if (["converted", "joined", "onboarded"].includes(value)) return "Joined";
  if (["rejected", "declined", "withdrawn"].includes(value)) return "Closed";
  if (["reviewing", "in_review", "interview", "shortlisted"].includes(value)) return "In review";
  return "Received";
}

/** Create a request with its code and key. The key is only ever returned here. */
export async function createPortalRequest(prisma: any, data: { audience: string; kind: string; title: string; body: string; contactName?: string | null; contactEmail?: string | null; submissionId?: string | null; requesterUserId?: string | null; projectId?: string | null }) {
  const key = randomBytes(18).toString("base64url");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const row = await prisma.portalRequest.create({ data: { ...data, code: newCode(), keyHash: hashKey(key) } });
      return { request: row, key };
    } catch (error: any) { if (error?.code !== "P2002" || attempt === 4) throw error; }
  }
  throw new Error("Could not create a request code.");
}

export function registerPortalRequestRoutes(deps: Deps) {
  const { app, prisma, authorization, getCurrentUser, readSettings, logActivity } = deps;
  const recent = new Map<string, number[]>();
  const limited = (ip: string, max: number) => {
    const now = Date.now(); const list = (recent.get(ip) || []).filter((at) => now - at < 15 * 60_000);
    list.push(now); recent.set(ip, list);
    if (recent.size > 5000) for (const [key, value] of recent) if (!value.some((at) => now - at < 15 * 60_000)) recent.delete(key);
    return list.length > max;
  };
  const playerPortalOn = async () => readPortalSettings(await readSettings()).player.enabled;
  const notFound = (reply: any) => reply.code(404).send({ ok: false, code: "NOT_FOUND", error: "Not found." });

  async function managers() {
    const rows = await prisma.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false } }, select: { userId: true } });
    return [...new Set(rows.map((row: any) => String(row.userId)))];
  }
  async function notifyStudio(title: string, message: string, requestId: string) {
    const userIds = await managers();
    if (userIds.length) await logActivity({ type: "created", entityType: "portal_request", entityId: requestId, title, message, metadata: { userIds, notifyInbox: true, notificationSignal: "assigned", requiresAction: true } }).catch(() => undefined);
  }
  const publicView = (row: any, messages: any[]) => ({
    code: row.code, kind: row.kind, title: row.title, body: row.body, status: row.status, createdAt: row.createdAt, lastActivityAt: row.lastActivityAt,
    messages: messages.map((message) => ({ id: message.id, from: message.authorKind === "studio" ? "studio" : "you", body: message.body, createdAt: message.createdAt })),
  });

  // ---- Player portal (public) ---------------------------------------------

  app.get("/api/portal/public/home", async (_request: any, reply: any) => {
    if (!(await playerPortalOn())) return notFound(reply);
    const settings = await readSettings();
    const announcements = await prisma.studioAnnouncement.findMany({
      where: { status: "published", channels: { contains: "player" } }, orderBy: { publishedAt: "desc" }, take: 10,
      select: { id: true, title: true, body: true, priority: true, publishedAt: true },
    });
    reply.header("Cache-Control", "no-store");
    return { studioName: String(settings.studioName || settings.workspaceName || "Studio"), announcements };
  });

  app.post("/api/portal/public/requests", async (request: any, reply: any) => {
    if (!(await playerPortalOn())) return notFound(reply);
    const body = z.object({
      kind: z.enum(PUBLIC_KINDS), title: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(8000),
      contactName: z.string().trim().max(120).optional(), contactEmail: z.string().trim().email().max(200).optional().or(z.literal("")), website: z.string().optional(),
    }).parse(request.body || {});
    if (body.website) return reply.code(201).send({ ok: true, code: "SENT", key: "" });
    if (limited(String(request.ip || "local"), 5)) return reply.code(429).send({ ok: false, error: "Too many requests. Try again in a few minutes." });
    const { request: row, key } = await createPortalRequest(prisma, { audience: "player", kind: body.kind, title: body.title, body: body.body, contactName: body.contactName || null, contactEmail: body.contactEmail || null });
    await notifyStudio(body.kind === "bug" ? "Bug report from a player" : body.kind === "help" ? "Help request from a player" : "Player feedback", body.title, row.id);
    return reply.code(201).send({ ok: true, code: row.code, key });
  });

  app.get("/api/portal/public/requests/:code", async (request: any, reply: any) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().max(20) }).parse(request.params);
    const { key } = z.object({ key: z.string().max(100).default("") }).parse(request.query || {});
    const row = await prisma.portalRequest.findUnique({ where: { code } });
    if (!row || !key || row.audience === "client" || !keyMatches(row.keyHash, key)) return notFound(reply);
    const messages = await prisma.portalRequestMessage.findMany({ where: { requestId: row.id }, orderBy: { createdAt: "asc" }, take: 500 });
    let stage: string | null = null;
    if (row.kind === "application" && row.submissionId) {
      const submission = await prisma.studioFormSubmission.findUnique({ where: { id: row.submissionId }, select: { status: true } });
      stage = applicationStage(submission?.status || "submitted");
    }
    reply.header("Cache-Control", "no-store");
    return { ...publicView(row, messages), stage };
  });

  app.post("/api/portal/public/requests/:code/messages", async (request: any, reply: any) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().max(20) }).parse(request.params);
    const body = z.object({ key: z.string().max(100), body: z.string().trim().min(1).max(8000) }).parse(request.body || {});
    if (limited(`msg:${String(request.ip || "local")}`, 30)) return reply.code(429).send({ ok: false, error: "Slow down a little and try again." });
    const row = await prisma.portalRequest.findUnique({ where: { code } });
    if (!row || row.audience === "client" || !keyMatches(row.keyHash, body.key)) return notFound(reply);
    if (row.status === "closed") return reply.code(409).send({ ok: false, error: "This conversation is closed. Start a new request if you still need help." });
    await prisma.$transaction([
      prisma.portalRequestMessage.create({ data: { requestId: row.id, authorKind: "requester", body: body.body } }),
      prisma.portalRequest.update({ where: { id: row.id }, data: { lastActivityAt: new Date(), status: row.status === "resolved" || row.status === "waiting" ? "open" : row.status } }),
    ]);
    await notifyStudio("New reply on a portal request", `${row.code} · ${row.title}`, row.id);
    return { ok: true };
  });

  // ---- Studio side: Chat › Requests ----------------------------------------

  async function requireManager(request: any, reply: any) {
    const identity = await authorization.identityForRequest(request);
    if (!identity?.user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in first." }); return null; }
    const manager = Boolean(identity.decorated?.isAdmin) || authorization.hasToolPermission(identity.user, identity.role, "settings", "edit");
    if (!manager) { reply.code(403).send({ ok: false, code: "FORBIDDEN", error: "Only studio managers handle portal requests." }); return null; }
    return identity.user;
  }

  app.get("/api/studio/portal-requests", async (request: any, reply: any) => {
    if (!(await requireManager(request, reply))) return;
    const query = z.object({ status: z.enum(["active", "all", ...PORTAL_REQUEST_STATUSES]).default("active"), audience: z.enum(["all", "player", "client"]).default("all") }).parse(request.query || {});
    const rows = await prisma.portalRequest.findMany({
      where: {
        ...(query.status === "active" ? { status: { in: ["open", "in_progress", "waiting"] } } : query.status === "all" ? {} : { status: query.status }),
        ...(query.audience === "all" ? {} : { audience: query.audience }),
      },
      orderBy: { lastActivityAt: "desc" }, take: 200,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { authorKind: true, body: true, createdAt: true } } },
    });
    reply.header("Cache-Control", "private, no-store");
    return { requests: rows.map((row: any) => ({ id: row.id, code: row.code, audience: row.audience, kind: row.kind, title: row.title, status: row.status, contactName: row.contactName, lastActivityAt: row.lastActivityAt, awaitingStudio: (row.messages[0]?.authorKind || "requester") !== "studio", preview: (row.messages[0]?.body || row.body).slice(0, 140) })) };
  });

  app.get("/api/studio/portal-requests/:id", async (request: any, reply: any) => {
    if (!(await requireManager(request, reply))) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const row = await prisma.portalRequest.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 500 } } });
    if (!row) return notFound(reply);
    const authorIds = [...new Set(row.messages.map((message: any) => message.authorUserId).filter(Boolean))];
    const authors = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true, username: true } }) : [];
    const name = new Map(authors.map((user: any) => [user.id, user.displayName || user.username]));
    const requester = row.requesterUserId ? await prisma.user.findUnique({ where: { id: row.requesterUserId }, select: { displayName: true, username: true } }) : null;
    const submission = row.submissionId ? await prisma.studioFormSubmission.findUnique({ where: { id: row.submissionId }, select: { status: true } }) : null;
    reply.header("Cache-Control", "private, no-store");
    return {
      id: row.id, code: row.code, audience: row.audience, kind: row.kind, title: row.title, body: row.body, status: row.status,
      contactName: row.contactName || requester?.displayName || requester?.username || null, contactEmail: row.contactEmail, projectId: row.projectId, cardId: row.cardId,
      submissionId: row.submissionId, stage: submission ? applicationStage(submission.status) : null, createdAt: row.createdAt,
      messages: row.messages.map((message: any) => ({ id: message.id, authorKind: message.authorKind, author: message.authorUserId ? name.get(message.authorUserId) || "Studio" : null, body: message.body, createdAt: message.createdAt })),
    };
  });

  app.post("/api/studio/portal-requests/:id/messages", async (request: any, reply: any) => {
    const user = await requireManager(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ body: z.string().trim().min(1).max(8000), status: z.enum(PORTAL_REQUEST_STATUSES).optional() }).parse(request.body || {});
    const row = await prisma.portalRequest.findUnique({ where: { id } });
    if (!row) return notFound(reply);
    await prisma.$transaction([
      prisma.portalRequestMessage.create({ data: { requestId: row.id, authorKind: "studio", authorUserId: user.id, body: body.body } }),
      prisma.portalRequest.update({ where: { id: row.id }, data: { lastActivityAt: new Date(), status: body.status || (row.status === "open" ? "waiting" : row.status) } }),
    ]);
    if (row.requesterUserId) await logActivity({ userId: user.id, type: "commented", entityType: "portal_request", entityId: row.id, title: "The studio replied to your request", message: row.title, metadata: { userIds: [row.requesterUserId], notifyInbox: true } }).catch(() => undefined);
    return { ok: true };
  });

  app.patch("/api/studio/portal-requests/:id", async (request: any, reply: any) => {
    const user = await requireManager(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ status: z.enum(PORTAL_REQUEST_STATUSES) }).parse(request.body || {});
    const row = await prisma.portalRequest.update({ where: { id }, data: { status: body.status, lastActivityAt: new Date() } }).catch(() => null);
    if (!row) return notFound(reply);
    return { ok: true, status: row.status };
  });

  // Turn a request into a ticket on a project's board, linked both ways.
  app.post("/api/studio/portal-requests/:id/ticket", async (request: any, reply: any) => {
    const user = await requireManager(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.body || {});
    const row = await prisma.portalRequest.findUnique({ where: { id } });
    if (!row) return notFound(reply);
    if (row.cardId) return reply.code(409).send({ ok: false, error: "This request already has a ticket." });
    const board = await prisma.board.findFirst({ where: { projectId, archived: false }, orderBy: { createdAt: "asc" }, include: { lists: { where: { archived: false, isDone: false }, orderBy: { position: "asc" }, take: 1 } } });
    const list = board?.lists?.[0];
    if (!board || !list) return reply.code(409).send({ ok: false, error: "That project has no board with an open list." });
    const last = await prisma.card.findFirst({ where: { listId: list.id }, orderBy: { position: "desc" }, select: { position: true } });
    const card = await prisma.card.create({ data: {
      listId: list.id, title: row.title.slice(0, 200), workItemKind: "ticket", priority: row.kind === "bug" ? "high" : "medium", position: (last?.position ?? -1) + 1,
      description: `${row.body}\n\n— ${row.audience === "player" ? "Player" : "Client"} ${row.kind} ${row.code}${row.contactName ? ` from ${row.contactName}` : ""}`,
    } });
    await prisma.portalRequest.update({ where: { id: row.id }, data: { cardId: card.id, projectId, status: row.status === "open" ? "in_progress" : row.status } });
    await logActivity({ userId: user.id, projectId, boardId: board.id, type: "created", entityType: "card", entityId: card.id, title: card.title, message: `Ticket from portal request ${row.code}` });
    return { ok: true, cardId: card.id, boardId: board.id };
  });
}
