import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";
import { createServiceCredentialService, serializeServiceCredential } from "./service-credential-service.js";
import { credentialExpiryForPolicy, credentialRotationDue, credentialScopesAllowed, normalizeStudioSecurityPolicy } from "../../core/studio-security-policy.js";

const credentialType = z.enum(["api_token", "webhook_signing", "extension_token"]);
const scopeSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9_.:-]+$/i);

export function registerServiceCredentialRoutes(deps: AuthRouteDependencies) {
  const { app, prisma, authorization, requireConfirmation, logSecurityEvent, readSettings } = deps;

  async function credentialPolicy() {
    const settings = await readSettings();
    return normalizeStudioSecurityPolicy(settings, {
      sessionDays: Number(settings.sessionDays || 7),
      sessionIdleHours: Number(settings.sessionIdleHours || 168),
      sessionMaxPerUser: Number(settings.sessionMaxPerUser || 10),
    });
  }

  const service = createServiceCredentialService(prisma, { getPolicy: credentialPolicy });

  app.get("/api/admin/security/credentials", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const [rows, policy] = await Promise.all([prisma.serviceCredential.findMany({ orderBy: { createdAt: "desc" }, take: 500 }), credentialPolicy()]);
    return { ok: true, credentials: rows.map((row: any) => {
      const serialized = serializeServiceCredential(row);
      return { ...serialized, rotationDue: !row.revokedAt && credentialRotationDue(policy, row.updatedAt || row.createdAt), scopePolicyCompliant: credentialScopesAllowed(policy, serialized.scopes) };
    }), policy };
  });

  app.post("/api/admin/security/credentials", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      credentialType,
      scopes: z.array(scopeSchema).max(64).default([]),
      expiresAt: z.string().datetime().nullable().optional(),
    }).parse(request.body || {});
    const policy = await credentialPolicy();
    const requestedExpiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (!credentialScopesAllowed(policy, body.scopes)) return reply.code(400).send({ ok: false, code: "CREDENTIAL_SCOPE_POLICY", error: "One or more requested scopes are not allowed by Studio security policy.", allowedScopes: policy.credentialAllowedScopes });
    let expiresAt: Date | null = null;
    try { expiresAt = credentialExpiryForPolicy(policy, requestedExpiresAt); } catch (error) { return reply.code(400).send({ ok: false, code: "CREDENTIAL_EXPIRY_POLICY", error: error instanceof Error ? error.message : "Credential expiry is not allowed by Studio policy." }); }
    const created = await service.create({ ...body, expiresAt, createdById: admin.id });
    await logSecurityEvent({ event: "credential.created", actorUserId: admin.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_SERVICE_CREDENTIAL", request, metadata: { credentialId: created.row.id, credentialType: created.row.credentialType, scopes: body.scopes } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, credential: serializeServiceCredential(created.row), secret: created.secret, copyOnce: true };
  });

  app.post("/api/admin/security/credentials/:credentialId/rotate", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "ROTATE CREDENTIAL")) return;
    const { credentialId } = z.object({ credentialId: z.string() }).parse(request.params);
    const row = await prisma.serviceCredential.findUnique({ where: { id: credentialId } });
    if (!row || row.revokedAt) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Active credential not found." });
    const policy = await credentialPolicy();
    const serialized = serializeServiceCredential(row);
    if (!credentialScopesAllowed(policy, serialized.scopes)) return reply.code(409).send({ ok: false, code: "CREDENTIAL_SCOPE_POLICY", error: "This credential contains scopes no longer allowed by Studio security policy. Create a replacement credential with approved scopes instead.", allowedScopes: policy.credentialAllowedScopes });
    const rotated = await service.rotate(row);
    const existingExpiry = row.expiresAt && new Date(row.expiresAt).getTime() > Date.now() ? new Date(row.expiresAt) : null;
    let policyExpiry: Date | null = null;
    try { policyExpiry = credentialExpiryForPolicy(policy, existingExpiry); }
    catch { policyExpiry = credentialExpiryForPolicy(policy, null); }
    if ((policyExpiry?.toISOString() || null) !== (rotated.row.expiresAt?.toISOString?.() || (rotated.row.expiresAt ? new Date(rotated.row.expiresAt).toISOString() : null))) {
      rotated.row = await prisma.serviceCredential.update({ where: { id: credentialId }, data: { expiresAt: policyExpiry } });
    }
    await logSecurityEvent({ event: "credential.rotated", actorUserId: admin.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_ROTATE_SERVICE_CREDENTIAL", request, metadata: { credentialId, credentialType: row.credentialType } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, credential: serializeServiceCredential(rotated.row), secret: rotated.secret, copyOnce: true };
  });

  app.delete("/api/admin/security/credentials/:credentialId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "REVOKE CREDENTIAL")) return;
    const { credentialId } = z.object({ credentialId: z.string() }).parse(request.params);
    const row = await prisma.serviceCredential.findUnique({ where: { id: credentialId } });
    if (!row) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Credential not found." });
    await prisma.serviceCredential.update({ where: { id: credentialId }, data: { revokedAt: new Date() } });
    await logSecurityEvent({ event: "credential.revoked", actorUserId: admin.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_REVOKE_SERVICE_CREDENTIAL", request, metadata: { credentialId, credentialType: row.credentialType } });
    return { ok: true };
  });
}
