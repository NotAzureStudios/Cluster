import crypto from "node:crypto";
import { decryptSecuritySecret, encryptSecuritySecret } from "../../core/setting-crypto.js";
import { clusterSecretFingerprint } from "../../core/crypto-service.js";
import { storedHashFingerprint } from "../../core/secret-store.js";
import { credentialScopesAllowed, type StudioSecurityPolicy } from "../../core/studio-security-policy.js";

export type ServiceCredentialType = "api_token" | "webhook_signing" | "extension_token";

function tokenHash(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function generateBearerToken() {
  return `clu_${crypto.randomBytes(32).toString("base64url")}`;
}

function generateSigningSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

export function serializeServiceCredential(row: any) {
  return {
    id: row.id,
    name: row.name,
    credentialType: row.credentialType,
    scopes: (() => { try { const parsed = JSON.parse(row.scopes || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } })(),
    tokenPrefix: row.tokenPrefix || null,
    secretFingerprint: row.secretFingerprint || storedHashFingerprint(row.tokenHash, "service-credential"),
    expiresAt: row.expiresAt || null,
    lastUsedAt: row.lastUsedAt || null,
    revokedAt: row.revokedAt || null,
    createdById: row.createdById || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    secretStored: Boolean(row.tokenHash || row.encryptedSecret),
  };
}

export function createServiceCredentialService(prisma: any, options: { getPolicy?: () => Promise<StudioSecurityPolicy> } = {}) {
  async function create(input: { name: string; credentialType: ServiceCredentialType; scopes: string[]; expiresAt?: Date | null; createdById?: string | null }) {
    const common = {
      name: input.name.slice(0, 120),
      credentialType: input.credentialType,
      scopes: JSON.stringify([...new Set(input.scopes)].sort()),
      expiresAt: input.expiresAt || null,
      createdById: input.createdById || null,
    };
    if (input.credentialType === "webhook_signing") {
      const secret = generateSigningSecret();
      const row = await prisma.serviceCredential.create({ data: { ...common, secretFingerprint: clusterSecretFingerprint(secret, "service-credential:webhook"), encryptedSecret: encryptSecuritySecret("service-credential:webhook", secret) } });
      return { row, secret };
    }
    const token = generateBearerToken();
    const digest = tokenHash(token);
    const row = await prisma.serviceCredential.create({ data: { ...common, tokenHash: digest, tokenPrefix: token.slice(0, 12), secretFingerprint: storedHashFingerprint(digest, "service-credential") } });
    return { row, secret: token };
  }

  async function rotate(row: any) {
    if (row.credentialType === "webhook_signing") {
      const secret = generateSigningSecret();
      const updated = await prisma.serviceCredential.update({ where: { id: row.id }, data: { secretFingerprint: clusterSecretFingerprint(secret, "service-credential:webhook"), encryptedSecret: encryptSecuritySecret("service-credential:webhook", secret), lastUsedAt: null } });
      return { row: updated, secret };
    }
    const token = generateBearerToken();
    const digest = tokenHash(token);
    const updated = await prisma.serviceCredential.update({ where: { id: row.id }, data: { tokenHash: digest, tokenPrefix: token.slice(0, 12), secretFingerprint: storedHashFingerprint(digest, "service-credential"), lastUsedAt: null } });
    return { row: updated, secret: token };
  }

  async function policyAllowsRow(row: any) {
    if (!options.getPolicy) return true;
    const policy = await options.getPolicy();
    if (!credentialScopesAllowed(policy, serializeServiceCredential(row).scopes)) return false;
    if (policy.credentialRequireExpiry && !row.expiresAt) return false;
    const createdAt = new Date(row.createdAt).getTime();
    const maximumLifetimeAt = createdAt + policy.credentialMaxLifetimeDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(createdAt) && Date.now() >= maximumLifetimeAt) return false;
    return true;
  }

  async function verifyBearer(token: string, requiredScopes: string[] = []) {
    if (!/^clu_[A-Za-z0-9_-]{32,128}$/.test(String(token || ""))) return null;
    const row = await prisma.serviceCredential.findUnique({ where: { tokenHash: tokenHash(token) } }).catch(() => null);
    if (!row || row.revokedAt || (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())) return null;
    if (!["api_token", "extension_token"].includes(String(row.credentialType))) return null;
    const scopes = serializeServiceCredential(row).scopes;
    if (!(await policyAllowsRow(row))) return null;
    const normalizedScopes = scopes.map((scope) => String(scope).toLowerCase());
    if (requiredScopes.some((scope) => !normalizedScopes.includes(String(scope).toLowerCase()))) return null;
    await prisma.serviceCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { credential: serializeServiceCredential(row), scopes };
  }

  async function webhookSecret(id: string) {
    const row = await prisma.serviceCredential.findUnique({ where: { id } }).catch(() => null);
    if (!row || row.credentialType !== "webhook_signing" || row.revokedAt || (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) || !row.encryptedSecret) return null;
    if (!(await policyAllowsRow(row))) return null;
    return decryptSecuritySecret("service-credential:webhook", row.encryptedSecret);
  }

  return { create, rotate, verifyBearer, webhookSecret };
}
