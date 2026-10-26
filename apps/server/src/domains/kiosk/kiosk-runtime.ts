import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { normalizeClusterKioskProfiles, type ClusterKioskProfile } from "@cluster/shared";
import { normalizeHttpMethod, requestCapabilityForPath } from "../access/request-policy.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KIOSK_READ_ONLY_MUTATION_BYPASS = new Set([
  "/api/kiosk/session/end",
  "/api/kiosk/session/recover",
  "/api/me/pin/verify",
  "/api/me/heartbeat",
  "/api/security/client-incidents",
  "/api/auth/logout",
]);

const TOOL_SCREENS: Record<string, string[]> = {
  projects: ["projects", "project"],
  boards: ["board"],
  whiteboards: ["whiteboard"],
  builds: ["builds"],
  qa: ["qa"],
  tickets: ["tickets"],
  activity: ["activity"],
  inbox: ["inbox"],
  people: ["people"],
  library: ["library", "project"],
  timeline: ["timeline"],
  mywork: ["mywork"],
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function directProjectIdsForRequest(request: FastifyRequest) {
  const params = (request.params || {}) as Record<string, unknown>;
  const query = (request.query || {}) as Record<string, unknown>;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const pathname = request.url.split("?")[0] || "/";
  const routeMatch = pathname.match(/^\/api\/projects\/([^/]+)/);
  const ids = new Set<string>();
  const one = String(params.projectId || query.projectId || body.projectId || routeMatch?.[1] || "").trim();
  if (one) ids.add(one);
  const many = query.projectIds ?? body.projectIds;
  if (Array.isArray(many)) many.map(String).map((value) => value.trim()).filter(Boolean).forEach((value) => ids.add(value));
  else String(many || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => ids.add(value));
  return Array.from(ids).slice(0, 128);
}

async function resourceProjectIds(prisma: any, request: FastifyRequest) {
  const direct = directProjectIdsForRequest(request);
  if (direct.length) return direct;
  const pathname = request.url.split("?")[0] || "/";
  const params = (request.params || {}) as Record<string, unknown>;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const boardId = String(params.boardId || body.boardId || pathname.match(/^\/api\/boards\/([^/]+)/)?.[1] || "").trim();
  if (boardId) { const id = (await prisma.board.findUnique({ where: { id: boardId }, select: { projectId: true } }))?.projectId; return id ? [id] : []; }
  const whiteboardId = String(params.whiteboardId || body.whiteboardId || pathname.match(/^\/api\/whiteboards\/([^/]+)/)?.[1] || "").trim();
  if (whiteboardId) { const id = (await prisma.whiteboard.findUnique({ where: { id: whiteboardId }, select: { projectId: true } }))?.projectId; return id ? [id] : []; }
  const listId = String(params.listId || body.listId || pathname.match(/^\/api\/lists\/([^/]+)/)?.[1] || "").trim();
  if (listId) { const id = (await prisma.boardList.findUnique({ where: { id: listId }, select: { board: { select: { projectId: true } } } }))?.board?.projectId; return id ? [id] : []; }
  const cardId = String(params.cardId || body.cardId || pathname.match(/^\/api\/cards\/([^/]+)/)?.[1] || "").trim();
  if (cardId) { const id = (await prisma.card.findUnique({ where: { id: cardId }, select: { list: { select: { board: { select: { projectId: true } } } } } }))?.list?.board?.projectId; return id ? [id] : []; }
  const checklistId = String(params.itemId || pathname.match(/^\/api\/checklist\/([^/]+)/)?.[1] || "").trim();
  if (checklistId) { const id = (await prisma.checklistItem.findUnique({ where: { id: checklistId }, select: { card: { select: { list: { select: { board: { select: { projectId: true } } } } } } } }))?.card?.list?.board?.projectId; return id ? [id] : []; }
  const fileId = String(params.fileId || pathname.match(/^\/api\/project-files\/([^/]+)/)?.[1] || "").trim();
  if (fileId) { const id = (await prisma.projectFile.findUnique({ where: { id: fileId }, select: { projectId: true } }))?.projectId; return id ? [id] : []; }
  const assetId = String(params.assetId || body.reviewAssetId || pathname.match(/^\/api\/review-assets\/([^/]+)/)?.[1] || "").trim();
  if (assetId) { const id = (await prisma.reviewAsset.findUnique({ where: { id: assetId }, select: { projectId: true } }))?.projectId; return id ? [id] : []; }
  const commentId = String(params.commentId || pathname.match(/^\/api\/video-comments\/([^/]+)/)?.[1] || "").trim();
  if (commentId) { const id = (await prisma.reviewComment.findUnique({ where: { id: commentId }, select: { reviewAsset: { select: { projectId: true } } } }))?.reviewAsset?.projectId; return id ? [id] : []; }
  return [];
}

export type ClusterKioskRuntime = ReturnType<typeof createClusterKioskRuntime>;

export function createClusterKioskRuntime(input: {
  authSecret: string;
  sessionSecure: boolean;
  readSettings: () => Promise<Record<string, any>>;
  prisma: any;
}) {
  const cookieName = input.sessionSecure ? "__Host-cluster_kiosk" : "cluster_kiosk";
  const cookieOptions = { path: "/", httpOnly: true, sameSite: "strict" as const, secure: input.sessionSecure, priority: "high" as const };

  function signature(sessionId: string, profileId: string) {
    return crypto.createHmac("sha256", input.authSecret).update(`cluster-kiosk\0${sessionId}\0${profileId}`, "utf8").digest("base64url");
  }

  function setSession(reply: FastifyReply, sessionId: string, profileId: string) {
    reply.setCookie(cookieName, `${profileId}.${signature(sessionId, profileId)}`, cookieOptions);
  }

  function clearSession(reply: FastifyReply) {
    reply.clearCookie(cookieName, cookieOptions);
    if (cookieName !== "cluster_kiosk") reply.clearCookie("cluster_kiosk", { ...cookieOptions, secure: false });
  }

  async function resolve(request: FastifyRequest, sessionId: string): Promise<ClusterKioskProfile | null> {
    const raw = String(request.cookies?.[cookieName] || "");
    const splitAt = raw.lastIndexOf(".");
    if (splitAt <= 0) return null;
    const profileId = raw.slice(0, splitAt);
    const supplied = raw.slice(splitAt + 1);
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(profileId) || !safeEqual(supplied, signature(sessionId, profileId))) return null;
    const settings = await input.readSettings();
    const profiles = normalizeClusterKioskProfiles(settings.desktopKioskProfiles);
    return profiles.find((profile) => profile.id === profileId && profile.enabled && profile.sessionMode === "signed-in") || null;
  }

  async function enforce(profile: ClusterKioskProfile, request: FastifyRequest) {
    const pathname = request.url.split("?")[0] || "/";
    const method = normalizeHttpMethod(request.method);
    if (profile.readOnly && UNSAFE_METHODS.has(method) && !KIOSK_READ_ONLY_MUTATION_BYPASS.has(pathname)) {
      return { ok: false as const, code: "KIOSK_READ_ONLY", message: "This kiosk profile is read-only. Exit kiosk mode before changing Cluster data." };
    }

    const routedTool = requestCapabilityForPath(pathname);
    if (["serverConfig", "integrations", "settings"].includes(String(routedTool)) || pathname.startsWith("/api/settings") || pathname.startsWith("/api/admin/")) {
      return { ok: false as const, code: "KIOSK_TOOL_BLOCKED", message: "This administrative area is unavailable while the managed kiosk profile is active." };
    }
    if (routedTool) {
      const screens = TOOL_SCREENS[routedTool];
      if (!screens?.length || !screens.some((screen) => profile.allowedScreens.includes(screen as any))) {
        return { ok: false as const, code: "KIOSK_TOOL_BLOCKED", message: "This Cluster tool is outside the active kiosk profile." };
      }
    }

    if (profile.allowedProjectIds.length) {
      const projectIds = await resourceProjectIds(input.prisma, request);
      if (projectIds.some((projectId) => !profile.allowedProjectIds.includes(projectId))) {
        return { ok: false as const, code: "KIOSK_PROJECT_BLOCKED", message: "One or more requested projects are outside the active kiosk profile." };
      }
    }
    return { ok: true as const };
  }

  return { cookieName, setSession, clearSession, resolve, enforce };
}
