export const SECURITY_VERIFICATION_TTL_MS = 5 * 60 * 1000;
export const SECURITY_VERIFICATION_MAX_TTL_MS = 10 * 60 * 1000;

export type SecurityVerificationPurpose =
  | "security_export"
  | "privacy"
  | "session_management"
  | "mfa"
  | "server_configuration"
  | "studio_administration"
  | "context_export"
  | "context_secret_export"
  | "library_administration"
  | "personnel_records"
  | "vault_secret_reveal";

export type SecurityVerificationMethod = "password" | "pin" | "passkey" | "platform" | "security_key" | "totp";
export type SecurityVerificationStrength = "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed";

export type SecurityVerificationPolicy = {
  purpose: SecurityVerificationPurpose;
  ttlMs: number;
  singleUse: boolean;
  freshLoginSatisfies: boolean;
  minimumStrength: SecurityVerificationStrength;
  reasonMode: "none" | "optional" | "required";
};

const SECURITY_VERIFICATION_POLICIES: Readonly<Record<SecurityVerificationPurpose, SecurityVerificationPolicy>> = Object.freeze({
  security_export: { purpose: "security_export", ttlMs: 2 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "optional" },
  privacy: { purpose: "privacy", ttlMs: 3 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "optional" },
  session_management: { purpose: "session_management", ttlMs: 3 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "none" },
  mfa: { purpose: "mfa", ttlMs: 3 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "none" },
  server_configuration: { purpose: "server_configuration", ttlMs: SECURITY_VERIFICATION_TTL_MS, singleUse: false, freshLoginSatisfies: true, minimumStrength: "knowledge", reasonMode: "optional" },
  studio_administration: { purpose: "studio_administration", ttlMs: SECURITY_VERIFICATION_TTL_MS, singleUse: false, freshLoginSatisfies: true, minimumStrength: "knowledge", reasonMode: "optional" },
  context_export: { purpose: "context_export", ttlMs: 2 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "optional" },
  context_secret_export: { purpose: "context_secret_export", ttlMs: 2 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "phishing_resistant", reasonMode: "required" },
  library_administration: { purpose: "library_administration", ttlMs: 3 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "optional" },
  personnel_records: { purpose: "personnel_records", ttlMs: 2 * 60 * 1000, singleUse: false, freshLoginSatisfies: false, minimumStrength: "knowledge", reasonMode: "required" },
  vault_secret_reveal: { purpose: "vault_secret_reveal", ttlMs: 2 * 60 * 1000, singleUse: true, freshLoginSatisfies: false, minimumStrength: "mfa", reasonMode: "required" },
});

const STRENGTH_RANK: Readonly<Record<SecurityVerificationStrength, number>> = Object.freeze({
  knowledge: 1,
  mfa: 2,
  phishing_resistant: 3,
  hardware_backed: 4,
});

export function securityVerificationPolicy(purpose: SecurityVerificationPurpose): SecurityVerificationPolicy {
  return SECURITY_VERIFICATION_POLICIES[purpose];
}

export function verifierStrengthSatisfies(actual: SecurityVerificationStrength | string, minimum: SecurityVerificationStrength) {
  return (STRENGTH_RANK[actual as SecurityVerificationStrength] || 0) >= STRENGTH_RANK[minimum];
}

export function strongerVerificationStrength(a: SecurityVerificationStrength, b: SecurityVerificationStrength): SecurityVerificationStrength {
  return STRENGTH_RANK[a] >= STRENGTH_RANK[b] ? a : b;
}

export function highRiskSecurityVerificationPurpose(purpose: SecurityVerificationPurpose) {
  return ["security_export", "privacy", "session_management", "mfa", "context_export", "context_secret_export", "library_administration", "personnel_records", "vault_secret_reveal"].includes(purpose);
}

function boundedTtl(ttlMs?: number) {
  return Math.min(SECURITY_VERIFICATION_MAX_TTL_MS, Math.max(30_000, ttlMs ?? SECURITY_VERIFICATION_TTL_MS));
}

function verificationGeneration(user: any) {
  const value = Number(user?.verificationGeneration ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export async function issueSecurityVerification(prisma: any, input: {
  sessionId: string;
  userId: string;
  user: any;
  purpose: SecurityVerificationPurpose;
  method: SecurityVerificationMethod;
  verifierStrength?: SecurityVerificationStrength;
  ttlMs?: number;
  singleUse?: boolean;
  requiredReason?: string | null;
  auditCorrelationId?: string | null;
  now?: number;
}) {
  const nowMs = input.now ?? Date.now();
  const issuedAt = new Date(nowMs);
  const expiresAt = new Date(nowMs + boundedTtl(input.ttlMs));
  const grant = await prisma.securityVerificationGrant.upsert({
    where: { sessionId_purpose: { sessionId: input.sessionId, purpose: input.purpose } },
    create: {
      sessionId: input.sessionId,
      userId: input.userId,
      purpose: input.purpose,
      method: input.method,
      verifierStrength: input.verifierStrength || "knowledge",
      verificationGeneration: verificationGeneration(input.user),
      issuedAt,
      expiresAt,
      singleUse: Boolean(input.singleUse),
      consumedAt: null,
      revokedAt: null,
      requiredReason: input.requiredReason || null,
      auditCorrelationId: input.auditCorrelationId || null,
    },
    update: {
      userId: input.userId,
      method: input.method,
      verifierStrength: input.verifierStrength || "knowledge",
      verificationGeneration: verificationGeneration(input.user),
      issuedAt,
      expiresAt,
      singleUse: Boolean(input.singleUse),
      consumedAt: null,
      revokedAt: null,
      requiredReason: input.requiredReason || null,
      auditCorrelationId: input.auditCorrelationId || null,
    },
  });
  return { purpose: grant.purpose as SecurityVerificationPurpose, method: grant.method as SecurityVerificationMethod, issuedAt: grant.issuedAt.getTime(), expiresAt: grant.expiresAt.getTime(), singleUse: Boolean(grant.singleUse) };
}

export async function hasValidSecurityVerification(prisma: any, input: {
  sessionId: string;
  userId: string;
  user: any;
  purpose: SecurityVerificationPurpose;
  now?: number;
  consume?: boolean;
  minimumStrength?: SecurityVerificationStrength;
}) {
  const now = new Date(input.now ?? Date.now());
  const grant = await prisma.securityVerificationGrant.findUnique({
    where: { sessionId_purpose: { sessionId: input.sessionId, purpose: input.purpose } },
  }).catch(() => null);
  if (!grant || grant.userId !== input.userId || grant.revokedAt || grant.consumedAt || grant.expiresAt <= now) return false;
  if (input.minimumStrength && !verifierStrengthSatisfies(String(grant.verifierStrength || "knowledge"), input.minimumStrength)) return false;
  if (Number(grant.verificationGeneration) !== verificationGeneration(input.user)) {
    await prisma.securityVerificationGrant.updateMany({ where: { id: grant.id, revokedAt: null }, data: { revokedAt: now } }).catch(() => undefined);
    return false;
  }
  if (input.consume || grant.singleUse) {
    const consumed = await prisma.securityVerificationGrant.updateMany({
      where: { id: grant.id, revokedAt: null, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return consumed.count === 1;
  }
  return true;
}

export async function revokeSessionSecurityVerifications(prisma: any, sessionId: string, now = new Date()) {
  return prisma.securityVerificationGrant.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: now } }).catch(() => ({ count: 0 }));
}

export async function revokeUserSecurityVerifications(prisma: any, userId: string, exceptSessionId?: string | null, now = new Date()) {
  return prisma.securityVerificationGrant.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}) },
    data: { revokedAt: now },
  }).catch(() => ({ count: 0 }));
}

export function nextAuthenticationGeneration(user: any) {
  return Math.max(1, Number(user?.authenticationGeneration || 1)) + 1;
}

export function nextVerificationGeneration(user: any) {
  return Math.max(1, Number(user?.verificationGeneration || 1)) + 1;
}
