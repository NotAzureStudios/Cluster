import { decidePendingAvatarAudit } from "./avatar-approval.js";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";

type UserAvatarRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getWorkspaceRole: (userId: string) => Promise<string | null | undefined>;
  writeUpload: (...args: any[]) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  resolveAvatarStoredFile: (...args: any[]) => any;
  serializeUserLite: (user: any) => any;
};

export function registerUserAvatarRoutes(deps: UserAvatarRouteDependencies) {
  const { app, prisma, getCurrentUser, getWorkspaceRole, writeUpload, logActivity, resolveAvatarStoredFile, serializeUserLite } = deps;
app.post("/api/me/avatar", async (request, reply) => {
  const user = await getCurrentUser(request);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  const body = z
    .object({
      originalName: z.string().min(1).max(160),
      mimeType: z.enum(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/gif"]),
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(5 * 1024 * 1024),
      dataUrl: z.string().min(1),
    })
    .parse(request.body);
  const stored = await writeUpload(user.id, "avatar", body.originalName, body.dataUrl, body.mimeType);
  const avatarUrl = `/api/users/${user.id}/avatar/${encodeURIComponent(stored.storedName)}`;
  const previousUrl = user.avatarUrl || null;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });
  const audit = await prisma.avatarAudit.create({
    data: {
      userId: user.id,
      actorUserId: user.id,
      previousUrl,
      newUrl: avatarUrl,
      originalName: body.originalName,
      mimeType: stored.detectedMime,
      sizeBytes: stored.actualSize,
      status: "pending",
    },
  });
  await logActivity({
    userId: user.id,
    type: "uploaded",
    entityType: "user-avatar",
    entityId: audit.id,
    title: "Profile icon uploaded",
    message: updated.displayName || updated.username,
    metadata: { auditId: audit.id, status: "pending" },
  });
  return { user: serializeUserLite(updated), audit };
});
app.get("/api/users/:userId/avatar/:fileName", async (request, reply) => {
  const params = z.object({ userId: z.string(), fileName: z.string() }).parse(request.params);
  const safeName = path.basename(params.fileName);
  const fullPath = await resolveAvatarStoredFile(params.userId, safeName);
  if (!existsSync(fullPath)) return reply.code(404).send({ error: "Avatar not found" });
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  reply.header("Content-Type", mimeType);
  reply.header("Cache-Control", "private, no-cache");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(createReadStream(fullPath));
});
app.post("/api/admin/users/:userId/avatar", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) return reply.code(401).send({ error: "Authentication required" });
  const role = await getWorkspaceRole(actor.id);
  if (!["owner", "admin"].includes(String(role || ""))) return reply.code(403).send({ error: "Admin access required" });
  const params = z.object({ userId: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      originalName: z.string().min(1).max(160),
      mimeType: z.enum(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/gif"]),
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(5 * 1024 * 1024),
      dataUrl: z.string().min(1),
    })
    .parse(request.body);
  const target = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!target) return reply.code(404).send({ error: "User not found" });
  const stored = await writeUpload(target.id, "avatar", body.originalName, body.dataUrl, body.mimeType);
  const avatarUrl = `/api/users/${target.id}/avatar/${encodeURIComponent(stored.storedName)}`;
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { avatarUrl },
  });
  const audit = await prisma.avatarAudit.create({
    data: {
      userId: target.id,
      actorUserId: actor.id,
      previousUrl: target.avatarUrl || null,
      newUrl: avatarUrl,
      originalName: body.originalName,
      mimeType: stored.detectedMime,
      sizeBytes: stored.actualSize,
      status: "approved",
      reviewedById: actor.id,
      reviewedAt: new Date(),
      reviewNote: "Uploaded by administrator",
    },
  });
  await logActivity({
    userId: actor.id,
    type: "updated",
    entityType: "user-avatar",
    entityId: audit.id,
    title: "Profile icon updated",
    message: updated.displayName || updated.username,
    metadata: {
      auditId: audit.id,
      status: "approved",
      targetUserId: target.id,
    },
  });
  return { user: serializeUserLite(updated), audit };
});
app.get("/api/admin/avatar-audits", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) return reply.code(401).send({ error: "Authentication required" });
  const role = await getWorkspaceRole(actor.id);
  if (!["owner", "admin"].includes(String(role || ""))) return reply.code(403).send({ error: "Admin access required" });
  const query = z.object({
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(250).optional().default(100),
    cursor: z.string().max(500).optional(),
  }).parse(request.query || {});
  const rows = await prisma.avatarAudit.findMany({
    where: {
      status: query.status && query.status !== "all" ? query.status : undefined,
      ...(cursorWhere(decodeCursor(query.cursor), "createdAt", "desc") || {}),
    },
    include: { user: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = buildCursorPage(rows, query.limit, "createdAt");
  const items = page.items.map((row: any) => ({ ...row, user: serializeUserLite(row.user) }));
  if (!query.cursor) { if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor); return items; }
  return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
});
app.patch("/api/admin/avatar-audits/:auditId", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) return reply.code(401).send({ error: "Authentication required" });
  const role = await getWorkspaceRole(actor.id);
  if (!["owner", "admin"].includes(String(role || ""))) return reply.code(403).send({ error: "Admin access required" });
  const params = z.object({ auditId: z.string() }).parse(request.params);
  const body = z
    .object({
      status: z.enum(["approved", "rejected"]),
      reviewNote: z.string().max(500).optional().nullable(),
    })
    .parse(request.body);
  const audit = await prisma.avatarAudit.findUniqueOrThrow({
    where: { id: params.auditId },
    include: { user: true },
  });
  const updated = await decidePendingAvatarAudit(prisma, audit, actor.id, body.status, body.reviewNote || null);
  if (!updated) return reply.code(409).send({ ok: false, code: "APPROVAL_ALREADY_REVIEWED", error: "This avatar request has already been reviewed." });
  await logActivity({
    userId: actor.id,
    type: "updated",
    entityType: "user-avatar",
    entityId: audit.id,
    title: `Profile icon ${body.status}`,
    message: audit.user.displayName || audit.user.username,
    metadata: { auditId: audit.id, status: body.status },
  });
  return { ...updated, user: serializeUserLite(updated.user) };
});
}
