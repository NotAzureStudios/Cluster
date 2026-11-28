import { z } from "zod";
import { CLUSTER_ACCOUNT_TYPE_INFO, CLUSTER_CONTRACTOR_PORTAL_FEATURES, clusterAccountType, normalizeExternalPortalSettings, normalizePortalHost, type ClusterPortalAudience } from "@cluster/shared";
import { expectedServerConfigFields } from "../../core/server-config-preconditions.js";
import { activeProjectMemberships } from "../projects/project-membership.js";
import { audiencesForRequest, isExternalAccount, readPortalSettings } from "./portal-boundary.js";

type Deps = {
  app: any; prisma: any; authorization: any;
  getCurrentUser: (request: any) => Promise<any>;
  readSettings: (force?: boolean) => Promise<any>;
  saveSettings: (payload: any, options: any) => Promise<void>;
  settingsForClient: (settings: any) => Record<string, unknown>;
  logActivity: (input: any) => Promise<unknown>;
};

const startOfWeek = () => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date; };

export function registerPortalRoutes(deps: Deps) {
  const { app, prisma, authorization, getCurrentUser, readSettings, saveSettings, settingsForClient, logActivity } = deps;

  /** Projects an external person is on the crew of, with their access level. */
  async function crewProjects(user: any) {
    const memberships = await prisma.projectMembership.findMany({ where: { userId: user.id, status: "active" }, select: { projectId: true } });
    const projects = memberships.length ? await prisma.project.findMany({
      where: { id: { in: memberships.map((row: any) => row.projectId) }, archived: false },
      include: { memberships: true },
      orderBy: { name: "asc" },
    }) : [];
    return projects
      .filter((project: any) => activeProjectMemberships(project).some((row) => row.userId === user.id))
      .map((project: any) => ({ project, level: authorization.getProjectPermissionLevel(user, null, project) as string }))
      .filter((entry: any) => entry.level !== "none");
  }

  async function portalUser(request: any, reply: any) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to use the portal." }); return null; }
    return user;
  }

  // Who this address and session are, and what the portal should show.
  app.get("/api/portal/context", async (request: any, reply: any) => {
    const settings = await readSettings();
    const portal = readPortalSettings(settings);
    const audiences = audiencesForRequest(request, portal);
    const user = await getCurrentUser(request).catch(() => null);
    const accountType = user ? clusterAccountType(user.accountType) : null;
    const info = accountType ? CLUSTER_ACCOUNT_TYPE_INFO[accountType] : null;
    const mainUrl = String(settings.publicWebUrl || "").replace(/\/+$/, "");
    const siteUrl = (key: ClusterPortalAudience) => portal[key].host ? `https://${portal[key].host}` : `${mainUrl}/portal`;
    reply.header("Cache-Control", "private, no-store");
    return {
      studioName: String(settings.studioName || settings.workspaceName || "Studio"),
      mainUrl,
      hostAudiences: audiences,
      portals: Object.fromEntries((["contractor", "client", "player"] as const).map((key) => [key, { enabled: portal[key].enabled, url: siteUrl(key), ownHost: Boolean(portal[key].host) }])),
      contractorFeatures: portal.contractor.features,
      user: user ? { id: user.id, name: user.preferredName || user.displayName || user.username, username: user.username, avatarUrl: user.avatarUrl || null, accountType, portal: info?.portal || null, readOnly: Boolean(info?.readOnly), accessExpiresAt: user.accessExpiresAt || null } : null,
    };
  });

  app.get("/api/admin/portal", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    return { ok: true, settings: readPortalSettings(await readSettings(true)) };
  });

  app.put("/api/admin/portal", async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const site = z.object({ enabled: z.boolean(), host: z.string().max(253) });
    const body = z.object({
      contractor: site.extend({ features: z.array(z.enum(CLUSTER_CONTRACTOR_PORTAL_FEATURES)).max(CLUSTER_CONTRACTOR_PORTAL_FEATURES.length) }),
      client: site, player: site,
    }).parse(request.body || {});
    for (const key of ["contractor", "client", "player"] as const) {
      if (body[key].host.trim() && !normalizePortalHost(body[key].host)) return reply.code(400).send({ ok: false, error: `The ${key} portal address isn't a valid host name.` });
    }
    const next = normalizeExternalPortalSettings(body);
    const settings = await readSettings(true);
    const mainHost = normalizePortalHost(settings.publicWebUrl);
    if (mainHost && (["contractor", "client", "player"] as const).some((key) => next[key].host === mainHost)) {
      return reply.code(400).send({ ok: false, error: "A portal can't use the main Cluster address. Leave it blank to serve the portal at /portal." });
    }
    const changes = { externalPortal: next };
    await saveSettings({}, { changedFields: changes, expectedSettings: expectedServerConfigFields(settingsForClient(settings), changes) });
    await logActivity({ userId: admin.id, type: "updated", entityType: "settings", entityId: "external-portal", title: "External portal settings updated" });
    return { ok: true, settings: next };
  });

  // Contractor home: their projects, assigned work, and this week's time.
  app.get("/api/portal/home", async (request: any, reply: any) => {
    const user = await portalUser(request, reply);
    if (!user) return;
    const crew = await crewProjects(user);
    const projectIds = crew.map((entry: any) => entry.project.id);
    const [cards, active, week] = await Promise.all([
      projectIds.length ? prisma.card.findMany({
        where: { assigneeId: user.id, archived: false, list: { archived: false, board: { archived: false, projectId: { in: projectIds } } } },
        include: { list: { select: { title: true, isDone: true, board: { select: { id: true, name: true, projectId: true } } } }, checklistItems: { select: { completed: true } } },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }], take: 200,
      }) : [],
      prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, orderBy: { startedAt: "desc" } }),
      prisma.timeEntry.findMany({ where: { userId: user.id, startedAt: { gte: startOfWeek() } }, select: { startedAt: true, endedAt: true, durationMinutes: true } }),
    ]);
    const projectName = new Map(crew.map((entry: any) => [entry.project.id, entry.project.name]));
    const minutes = week.reduce((sum: number, entry: any) => sum + (Number(entry.durationMinutes) || (entry.endedAt ? Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 60000) : 0)), 0);
    reply.header("Cache-Control", "private, no-store");
    return {
      projects: crew.map(({ project, level }: any) => ({ id: project.id, name: project.name, color: project.color || null, status: project.status, targetDate: project.targetDate || null, libraryFolderId: project.libraryFolderId || null, access: level })),
      work: cards.map((card: any) => ({
        id: card.id, title: card.title, description: card.description || "", kind: card.workItemKind || "task", priority: card.priority, dueDate: card.dueDate,
        projectId: card.list.board.projectId, projectName: projectName.get(card.list.board.projectId) || "", boardName: card.list.board.name, listTitle: card.list.title,
        done: Boolean(card.list.isDone), checklist: { done: card.checklistItems.filter((item: any) => item.completed).length, total: card.checklistItems.length },
      })),
      time: { active: active ? { id: active.id, title: active.title, startedAt: active.startedAt } : null, weekMinutes: minutes },
    };
  });

  // Mark assigned work done (or not): moves the card to the board's done list.
  app.post("/api/portal/work/:workId", async (request: any, reply: any) => {
    const user = await portalUser(request, reply);
    if (!user) return;
    if (CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user.accountType)].readOnly) return reply.code(403).send({ ok: false, error: "Guest access is view-only." });
    const { workId: cardId } = z.object({ workId: z.string().min(1) }).parse(request.params);
    const { done } = z.object({ done: z.boolean() }).parse(request.body || {});
    const card = await prisma.card.findUnique({ where: { id: cardId }, include: { list: { include: { board: { include: { lists: { where: { archived: false }, orderBy: { position: "asc" } } } } } } } });
    if (!card || card.archived || card.assigneeId !== user.id) return reply.code(404).send({ ok: false, error: "That work item isn't assigned to you." });
    const crew = await crewProjects(user);
    const access = crew.find((entry: any) => entry.project.id === card.list.board.projectId)?.level;
    if (!access || access === "view") return reply.code(403).send({ ok: false, error: "You can view this project but not change its work." });
    const target = card.list.board.lists.find((list: any) => Boolean(list.isDone) === done);
    if (!target) return reply.code(409).send({ ok: false, error: done ? "This board has no done list." : "This board has no open list." });
    if (target.id !== card.listId) {
      const last = await prisma.card.findFirst({ where: { listId: target.id }, orderBy: { position: "desc" }, select: { position: true } });
      await prisma.card.update({ where: { id: card.id }, data: { listId: target.id, position: (last?.position ?? -1) + 1, completedAt: done ? new Date() : null } });
      await logActivity({ userId: user.id, projectId: card.list.board.projectId, boardId: card.list.board.id, type: done ? "completed" : "reopened", entityType: "card", entityId: card.id, title: card.title, message: `Moved to ${target.title} from the contractor portal` });
    }
    return { ok: true, listTitle: target.title, done };
  });

  // Files in one of their projects' folders.
  app.get("/api/portal/files", async (request: any, reply: any) => {
    const user = await portalUser(request, reply);
    if (!user) return;
    const query = z.object({ projectId: z.string().min(1), folderId: z.string().optional() }).parse(request.query || {});
    const crew = await crewProjects(user);
    const entry = crew.find((row: any) => row.project.id === query.projectId);
    if (!entry || !entry.project.libraryFolderId) return reply.code(404).send({ ok: false, error: "Project not found." });
    const folderId = query.folderId || entry.project.libraryFolderId;
    if (folderId !== entry.project.libraryFolderId) {
      // Only folders inside this project's folder.
      let cursor = await prisma.libraryItem.findUnique({ where: { id: folderId }, select: { id: true, parentId: true, type: true } });
      if (!cursor || cursor.type !== "folder") return reply.code(404).send({ ok: false, error: "Folder not found." });
      for (let depth = 0; cursor && cursor.id !== entry.project.libraryFolderId && depth < 30; depth += 1) {
        cursor = cursor.parentId ? await prisma.libraryItem.findUnique({ where: { id: cursor.parentId }, select: { id: true, parentId: true, type: true } }) : null;
      }
      if (!cursor) return reply.code(404).send({ ok: false, error: "Folder not found." });
    }
    const [folder, items] = await Promise.all([
      prisma.libraryItem.findUnique({ where: { id: folderId }, select: { id: true, title: true, parentId: true } }),
      prisma.libraryItem.findMany({
        where: { parentId: folderId, deletedAt: null, status: { notIn: ["trashed", "archived"] } },
        select: { id: true, title: true, type: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, extension: true, externalUrl: true, updatedAt: true },
        orderBy: { title: "asc" }, take: 500,
      }),
    ]);
    reply.header("Cache-Control", "private, no-store");
    return {
      folder: { id: folder.id, title: folderId === entry.project.libraryFolderId ? entry.project.name : folder.title, parentId: folderId === entry.project.libraryFolderId ? null : folder.parentId, isRoot: folderId === entry.project.libraryFolderId },
      canUpload: entry.level !== "view" && !CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user.accountType)].readOnly,
      items: [...items].sort((a: any, b: any) => Number(b.type === "folder") - Number(a.type === "folder")).map((item: any) => ({ id: item.id, title: item.title, type: item.type, hasFile: Boolean(item.fileName), name: item.originalName || item.fileName || null, mimeType: item.mimeType || null, sizeBytes: item.sizeBytes ?? null, extension: item.extension || null, externalUrl: item.type === "link" ? item.externalUrl : null, updatedAt: item.updatedAt })),
    };
  });

  return { isExternalAccount };
}
