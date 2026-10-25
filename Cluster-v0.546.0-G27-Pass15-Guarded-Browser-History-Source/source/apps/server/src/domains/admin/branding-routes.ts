import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

type BrandingRouteDependencies = {
  app: FastifyInstance;
  brandingRoot: string;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getWorkspaceRole: (userId: string) => Promise<string | null>;
  writeUpload: (
    projectId: string,
    kind: "review_asset" | "file" | "avatar" | "branding",
    originalName: string,
    dataUrl: string,
    clientMime?: string,
    destinationFolder?: string
  ) => Promise<{ storedName: string; actualSize: number; detectedMime: string }>;
  logActivity: (input: any) => Promise<any>;
};

export function registerBrandingRoutes({
  app,
  brandingRoot,
  getCurrentUser,
  getWorkspaceRole,
  writeUpload,
  logActivity
}: BrandingRouteDependencies) {
  app.post("/api/admin/branding/logo", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ error: "Authentication required" });
    const role = await getWorkspaceRole(actor.id);
    if (!["owner", "admin"].includes(String(role || ""))) return reply.code(403).send({ error: "Admin access required" });
    const body = z.object({
      originalName: z.string().min(1).max(160),
      mimeType: z.enum(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/gif"]),
      sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
      dataUrl: z.string().min(1)
    }).parse(request.body);
    const stored = await writeUpload("studio", "branding", body.originalName, body.dataUrl, body.mimeType);
    const logoUrl = `/api/branding/${encodeURIComponent(stored.storedName)}`;
    await logActivity({
      userId: actor.id,
      type: "uploaded",
      entityType: "studio-branding",
      entityId: stored.storedName,
      title: "Studio logo uploaded",
      message: body.originalName,
      metadata: { logoUrl, sizeBytes: stored.actualSize }
    });
    return { ok: true, logoUrl, mimeType: stored.detectedMime, sizeBytes: stored.actualSize };
  });

  app.get("/api/branding/:fileName", async (request, reply) => {
    const params = z.object({ fileName: z.string() }).parse(request.params);
    const safeName = path.basename(params.fileName);
    const fullPath = path.join(brandingRoot, safeName);
    if (!existsSync(fullPath)) return reply.code(404).send({ error: "Brand asset not found" });
    const ext = path.extname(safeName).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    reply.header("Content-Type", mimeType);
    reply.header("Cache-Control", "public, max-age=3600");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(createReadStream(fullPath));
  });
}
