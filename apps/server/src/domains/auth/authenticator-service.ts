import crypto from "node:crypto";
import { decryptSecuritySecret, encryptSecuritySecret } from "../../core/setting-crypto.js";
import { generateRecoveryCodes, generateTotpSecret, totpEnrollmentUri, verifyTotp } from "./totp.js";

export const AUTHENTICATOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const AUTHENTICATOR_KINDS = ["totp", "webauthn"] as const;
export type AuthenticatorKind = (typeof AUTHENTICATOR_KINDS)[number];
export type AuthenticatorState = "pending" | "active" | "revoked" | "compromised";
export type AuthenticatorStrength = "mfa" | "phishing_resistant" | "hardware_backed";

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedRecoveryCode(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function recoveryHash(userId: string, value: string) {
  return sha256(`cluster-authenticator-recovery\0${userId}\0${normalizedRecoveryCode(value)}`);
}

function safeJsonArray(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean).slice(0, 16) : [];
  } catch {
    return [];
  }
}

function decryptTotpSecret(userId: string, encryptedSecret: string) {
  return decryptSecuritySecret(`authenticator:totp:${userId}`, encryptedSecret);
}

function publicAuthenticator(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label || null,
    state: row.state,
    strength: row.strength,
    credentialId: row.credentialId || null,
    transports: safeJsonArray(row.transports),
    attachment: row.attachment || null,
    discoverable: Boolean(row.discoverable),
    backupEligible: Boolean(row.backupEligible),
    backupState: Boolean(row.backupState),
    userVerification: row.userVerification || null,
    enrolledAt: row.enrolledAt || null,
    lastUsedAt: row.lastUsedAt || null,
    revokedAt: row.revokedAt || null,
    compromisedAt: row.compromisedAt || null,
    createdAt: row.createdAt,
  };
}

export function createAuthenticatorService(deps: { prisma: any; logSecurityEvent: (input: any) => Promise<any> }) {
  const { prisma, logSecurityEvent } = deps;

  async function list(userId: string) {
    const [authenticators, remaining] = await Promise.all([
      prisma.authenticator.findMany({ where: { userId }, orderBy: [{ state: "asc" }, { createdAt: "asc" }] }).catch(() => []),
      prisma.authenticatorRecoveryCode.count({ where: { userId, consumedAt: null } }).catch(() => 0),
    ]);
    const active = authenticators.filter((row: any) => row.state === "active" && !row.revokedAt && !row.compromisedAt);
    return {
      enabled: active.length > 0,
      factors: authenticators.map(publicAuthenticator),
      activeFactorCount: active.length,
      phishingResistantFactorCount: active.filter((row: any) => row.strength === "phishing_resistant" || row.strength === "hardware_backed").length,
      recoveryCodesRemaining: Number(remaining || 0),
    };
  }

  async function status(userId: string) {
    const state = await list(userId);
    const mostRecent = state.factors
      .filter((factor: any) => factor.state === "active")
      .sort((a: any, b: any) => new Date(b.lastUsedAt || b.enrolledAt || 0).getTime() - new Date(a.lastUsedAt || a.enrolledAt || 0).getTime())[0];
    return {
      ...state,
      enrolledAt: mostRecent?.enrolledAt || null,
      lastUsedAt: mostRecent?.lastUsedAt || null,
    };
  }

  async function activeFactors(userId: string) {
    return prisma.authenticator.findMany({ where: { userId, state: "active", revokedAt: null, compromisedAt: null }, orderBy: { createdAt: "asc" } });
  }

  async function hasActiveFactor(userId: string) {
    return (await prisma.authenticator.count({ where: { userId, state: "active", revokedAt: null, compromisedAt: null } }).catch(() => 0)) > 0;
  }

  async function beginTotpEnrollment(user: any) {
    const existing = await prisma.authenticator.findFirst({ where: { userId: user.id, kind: "totp", state: { in: ["pending", "active"] }, revokedAt: null } }).catch(() => null);
    if (existing?.state === "active") return { ok: false as const, code: "MFA_ALREADY_ENABLED" };
    const secret = generateTotpSecret();
    const encryptedSecret = encryptSecuritySecret(`authenticator:totp:${user.id}`, secret);
    const factor = existing
      ? await prisma.authenticator.update({ where: { id: existing.id }, data: { encryptedSecret, state: "pending", strength: "mfa", enrolledAt: null, lastUsedAt: null, compromisedAt: null, revokedAt: null } })
      : await prisma.authenticator.create({ data: { userId: user.id, kind: "totp", label: "Authenticator app", state: "pending", strength: "mfa", encryptedSecret } });
    return { ok: true as const, factorId: factor.id, secret, uri: totpEnrollmentUri({ secret, accountName: user.email || user.username || user.id, issuer: "Cluster" }) };
  }

  async function verifyTotpEnrollment(userId: string, code: string) {
    const factor = await prisma.authenticator.findFirst({ where: { userId, kind: "totp", state: "pending", revokedAt: null }, orderBy: { createdAt: "desc" } });
    if (!factor?.encryptedSecret) return { ok: false as const, code: "MFA_ENROLLMENT_NOT_PENDING" };
    const secret = decryptTotpSecret(userId, factor.encryptedSecret);
    if (!verifyTotp(secret, code)) return { ok: false as const, code: "MFA_CODE_INVALID" };
    const recoveryCodes = generateRecoveryCodes();
    const now = new Date();
    await prisma.$transaction([
      prisma.authenticator.update({ where: { id: factor.id }, data: { state: "active", enrolledAt: now, lastUsedAt: now } }),
      prisma.authenticatorRecoveryCode.deleteMany({ where: { userId } }),
      prisma.authenticatorRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ userId, codeHash: recoveryHash(userId, value) })) }),
    ]);
    return { ok: true as const, factorId: factor.id, recoveryCodes };
  }

  async function verifyTotpForUser(userId: string, code: string) {
    const factors = await prisma.authenticator.findMany({ where: { userId, kind: "totp", state: "active", revokedAt: null, compromisedAt: null } });
    for (const factor of factors) {
      if (!factor.encryptedSecret) continue;
      const secret = decryptTotpSecret(userId, factor.encryptedSecret);
      if (!verifyTotp(secret, code)) continue;
      await prisma.authenticator.update({ where: { id: factor.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      return { ok: true as const, factor: publicAuthenticator(factor), strength: "mfa" as const };
    }
    return { ok: false as const, code: "MFA_CODE_INVALID" };
  }

  async function issueInitialRecoveryCodes(userId: string) {
    // Never invalidate established recovery codes during another passkey enrollment.
    const existing = await prisma.authenticatorRecoveryCode.count({ where: { userId } });
    if (existing > 0) return [];
    const codes = generateRecoveryCodes();
    await prisma.authenticatorRecoveryCode.createMany({
      data: codes.map((value) => ({ userId, codeHash: recoveryHash(userId, value) })),
      skipDuplicates: true,
    });
    return codes;
  }

  async function consumeRecoveryCode(userId: string, code: string) {
    const codeHash = recoveryHash(userId, code);
    const record = await prisma.authenticatorRecoveryCode.findUnique({ where: { codeHash } }).catch(() => null);
    if (!record || record.userId !== userId || record.consumedAt) return false;
    const consumed = await prisma.authenticatorRecoveryCode.updateMany({ where: { id: record.id, userId, consumedAt: null }, data: { consumedAt: new Date() } });
    return consumed.count === 1;
  }

  async function regenerateRecoveryCodes(userId: string, proof: { code?: string }) {
    if (!proof.code) return { ok: false as const, code: "MFA_FACTOR_REQUIRED" };
    const verification = await verifyTotpForUser(userId, proof.code);
    if (!verification.ok) return { ok: false as const, code: verification.code };
    const recoveryCodes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.authenticatorRecoveryCode.deleteMany({ where: { userId } }),
      prisma.authenticatorRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ userId, codeHash: recoveryHash(userId, value) })) }),
    ]);
    return { ok: true as const, recoveryCodes };
  }

  async function revokeFactor(userId: string, factorId: string, options: { minimumStrength?: AuthenticatorStrength } = {}) {
    const factor = await prisma.authenticator.findFirst({ where: { id: factorId, userId, revokedAt: null } });
    if (!factor) return { ok: false as const, code: "MFA_FACTOR_NOT_FOUND" };
    const activeFactors = await prisma.authenticator.findMany({ where: { userId, state: "active", revokedAt: null, compromisedAt: null } });
    if (factor.state === "active" && activeFactors.length <= 1) return { ok: false as const, code: "MFA_LAST_FACTOR" };
    if (factor.state === "active" && options.minimumStrength) {
      const rank: Record<string, number> = { mfa: 1, phishing_resistant: 2, hardware_backed: 3 };
      const remainingCompliant = activeFactors.some((candidate: any) => candidate.id !== factor.id && (rank[String(candidate.strength)] || 0) >= (rank[options.minimumStrength!] || 0));
      if (!remainingCompliant) return { ok: false as const, code: "MFA_POLICY_FACTOR_REQUIRED" };
    }
    const now = new Date();
    await prisma.authenticator.update({ where: { id: factor.id }, data: { state: "revoked", revokedAt: now } });
    await prisma.authenticatorChallenge.deleteMany({ where: { authenticatorId: factor.id } }).catch(() => undefined);
    return { ok: true as const };
  }

  async function disableAll(userId: string, proof: { code?: string; recoveryCode?: string }) {
    const valid = proof.code
      ? (await verifyTotpForUser(userId, proof.code)).ok
      : proof.recoveryCode
        ? await consumeRecoveryCode(userId, proof.recoveryCode)
        : false;
    if (!valid) return { ok: false as const, code: "MFA_CODE_INVALID" };
    const now = new Date();
    await prisma.$transaction([
      prisma.authenticatorRecoveryCode.deleteMany({ where: { userId } }),
      prisma.authenticatorChallenge.deleteMany({ where: { userId } }),
      prisma.authenticator.updateMany({ where: { userId, revokedAt: null }, data: { state: "revoked", revokedAt: now } }),
    ]);
    return { ok: true as const };
  }

  async function createLoginChallenge(userId: string, deviceId: string | null, kind = "any") {
    await pruneChallenges().catch(() => undefined);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + AUTHENTICATOR_CHALLENGE_TTL_MS);
    await prisma.authenticatorChallenge.create({ data: { userId, flow: "login", kind, challengeHash: sha256(token), deviceId, expiresAt } });
    return { challenge: token, expiresAt };
  }

  async function createWebAuthnChallenge(input: { userId: string | null; deviceId: string | null; flow: "login" | "passwordless_login" | "enrollment" | "security_verification"; rpId: string; expectedOrigin: string; context?: Record<string, unknown> }) {
    await pruneChallenges().catch(() => undefined);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + AUTHENTICATOR_CHALLENGE_TTL_MS);
    const row = await prisma.authenticatorChallenge.create({ data: { userId: input.userId, flow: input.flow, kind: "webauthn", challengeHash: sha256(token), deviceId: input.deviceId, rpId: input.rpId, expectedOrigin: input.expectedOrigin, context: JSON.stringify(input.context || {}), expiresAt } });
    return { id: row.id, challenge: token, expiresAt };
  }

  async function activeWebAuthnFactorByCredentialId(credentialId: string, options: { requireDiscoverable?: boolean } = {}) {
    if (!credentialId) return null;
    return prisma.authenticator.findFirst({
      where: {
        credentialId,
        kind: "webauthn",
        state: "active",
        revokedAt: null,
        compromisedAt: null,
        ...(options.requireDiscoverable ? { discoverable: true } : {}),
      },
      include: { user: true },
    }).catch(() => null);
  }

  async function findChallenge(token: string, flow = "login") {
    if (!token || token.length < 32 || token.length > 512) return null;
    const row = await prisma.authenticatorChallenge.findUnique({ where: { challengeHash: sha256(token) }, include: { user: true, authenticator: true } }).catch(() => null);
    if (!row || row.flow !== flow || row.consumedAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return row;
  }

  async function claimChallenge(id: string) {
    const claimed = await prisma.authenticatorChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    return claimed.count === 1;
  }

  async function verifyLoginChallenge(input: { challenge: string; deviceId: string | null; code?: string; recoveryCode?: string }) {
    const challenge = await findChallenge(input.challenge);
    if (!challenge?.userId) return { ok: false as const, code: "MFA_CHALLENGE_INVALID" };
    if (challenge.deviceId && challenge.deviceId !== input.deviceId) return { ok: false as const, code: "MFA_CHALLENGE_DEVICE_MISMATCH" };
    if (challenge.kind === "webauthn" && (input.code || input.recoveryCode)) return { ok: false as const, code: "MFA_FACTOR_REQUIRED" };
    if (input.code) {
      const verified = await verifyTotpForUser(challenge.userId, input.code);
      if (!verified.ok) return { ok: false as const, code: verified.code };
      if (!(await claimChallenge(challenge.id))) return { ok: false as const, code: "MFA_CHALLENGE_INVALID" };
      return { ok: true as const, user: challenge.user, authMethod: "password+totp", factorKind: "totp", strength: "mfa" as const };
    }
    if (input.recoveryCode) {
      try {
        await prisma.$transaction(async (tx: any) => {
          const codeHash = recoveryHash(challenge.userId, input.recoveryCode!);
          const record = await tx.authenticatorRecoveryCode.findUnique({ where: { codeHash } });
          if (!record || record.userId !== challenge.userId || record.consumedAt) throw new Error("MFA_RECOVERY_INVALID");
          const claimed = await tx.authenticatorChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
          if (claimed.count !== 1) throw new Error("MFA_CHALLENGE_INVALID");
          const consumed = await tx.authenticatorRecoveryCode.updateMany({ where: { id: record.id, userId: challenge.userId, consumedAt: null }, data: { consumedAt: new Date() } });
          if (consumed.count !== 1) throw new Error("MFA_RECOVERY_INVALID");
        });
      } catch (error) {
        const code = error instanceof Error && ["MFA_RECOVERY_INVALID", "MFA_CHALLENGE_INVALID"].includes(error.message) ? error.message : "MFA_CHALLENGE_INVALID";
        return { ok: false as const, code };
      }
      return { ok: true as const, user: challenge.user, authMethod: "password+recovery", factorKind: "recovery", strength: "mfa" as const };
    }
    return { ok: false as const, code: "MFA_FACTOR_REQUIRED" };
  }

  async function registerWebAuthnFactor(input: {
    userId: string; label?: string | null; credentialId: string; publicKeySpki: string; publicKeyAlgorithm: string; signCount?: bigint;
    transports?: string[]; aaguid?: string | null; attachment?: string | null; discoverable?: boolean; backupEligible?: boolean; backupState?: boolean; userVerification?: string | null;
  }) {
    const existing = await prisma.authenticator.findUnique({ where: { credentialId: input.credentialId } }).catch(() => null);
    if (existing) return { ok: false as const, code: "PASSKEY_CREDENTIAL_EXISTS" };
    const now = new Date();
    const strength: AuthenticatorStrength = input.attachment === "cross-platform" ? "hardware_backed" : "phishing_resistant";
    const factor = await prisma.authenticator.create({ data: {
      userId: input.userId, kind: "webauthn", label: input.label || (input.attachment === "cross-platform" ? "Security key" : "Passkey"), state: "active", strength,
      credentialId: input.credentialId, publicKeySpki: input.publicKeySpki, publicKeyAlgorithm: input.publicKeyAlgorithm, signCount: input.signCount ?? BigInt(0),
      transports: JSON.stringify((input.transports || []).slice(0, 16)), aaguid: input.aaguid || null, attachment: input.attachment || null,
      discoverable: Boolean(input.discoverable), backupEligible: Boolean(input.backupEligible), backupState: Boolean(input.backupState), userVerification: input.userVerification || null,
      enrolledAt: now, lastUsedAt: now,
    } });
    return { ok: true as const, factor: publicAuthenticator(factor) };
  }

  async function markWebAuthnUsed(input: { factorId: string; signCount: bigint; backupState?: boolean; userVerification?: string | null }) {
    const factor = await prisma.authenticator.findUnique({ where: { id: input.factorId } });
    if (!factor || factor.state !== "active" || factor.revokedAt || factor.compromisedAt) return { ok: false as const, code: "PASSKEY_NOT_ACTIVE" };
    const prior = BigInt(factor.signCount || 0);
    const now = new Date();

    // Authenticators that report a zero counter do not provide clone-detection semantics.
    // We still record usage metadata, but never manufacture a non-zero counter for them.
    if (input.signCount === BigInt(0)) {
      await prisma.authenticator.updateMany({
        where: { id: factor.id, state: "active", revokedAt: null, compromisedAt: null },
        data: { lastUsedAt: now, backupState: input.backupState ?? factor.backupState, userVerification: input.userVerification || factor.userVerification },
      });
      return { ok: true as const };
    }

    if (prior > BigInt(0) && input.signCount <= prior) {
      await prisma.authenticator.updateMany({
        where: { id: factor.id, state: "active", revokedAt: null, compromisedAt: null },
        data: { state: "compromised", compromisedAt: now },
      });
      return { ok: false as const, code: "PASSKEY_COUNTER_ROLLBACK" };
    }

    // Compare-and-swap the signature counter. This prevents two concurrent assertions
    // from both accepting the same/stale counter after reading the same prior value.
    const advanced = await prisma.authenticator.updateMany({
      where: {
        id: factor.id,
        state: "active",
        revokedAt: null,
        compromisedAt: null,
        OR: [{ signCount: BigInt(0) }, { signCount: { lt: input.signCount } }],
      },
      data: {
        signCount: input.signCount,
        lastUsedAt: now,
        backupState: input.backupState ?? factor.backupState,
        userVerification: input.userVerification || factor.userVerification,
      },
    });
    if (advanced.count === 1) return { ok: true as const };

    const current = await prisma.authenticator.findUnique({ where: { id: factor.id } });
    if (!current || current.state !== "active" || current.revokedAt || current.compromisedAt) return { ok: false as const, code: "PASSKEY_NOT_ACTIVE" };
    const currentCount = BigInt(current.signCount || 0);
    if (currentCount > BigInt(0) && input.signCount <= currentCount) {
      await prisma.authenticator.updateMany({
        where: { id: factor.id, state: "active", revokedAt: null, compromisedAt: null },
        data: { state: "compromised", compromisedAt: new Date() },
      });
      return { ok: false as const, code: "PASSKEY_COUNTER_ROLLBACK" };
    }
    return { ok: false as const, code: "PASSKEY_COUNTER_UPDATE_CONFLICT" };
  }

  async function pruneChallenges() {
    return prisma.authenticatorChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, { consumedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }] } });
  }

  return {
    list, status, activeFactors, hasActiveFactor, beginTotpEnrollment, verifyTotpEnrollment, verifyTotpForUser, consumeRecoveryCode,
    regenerateRecoveryCodes, issueInitialRecoveryCodes, revokeFactor, disableAll, createLoginChallenge, findChallenge, claimChallenge, verifyLoginChallenge,
    registerWebAuthnFactor, markWebAuthnUsed, createWebAuthnChallenge, activeWebAuthnFactorByCredentialId, pruneChallenges, logSecurityEvent,
  };
}

export type AuthenticatorService = ReturnType<typeof createAuthenticatorService>;
