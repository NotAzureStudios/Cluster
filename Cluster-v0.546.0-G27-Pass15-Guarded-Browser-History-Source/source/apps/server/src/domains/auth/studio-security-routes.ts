import { z } from "zod";
import { expectedServerConfigFields } from "../../core/server-config-preconditions.js";
import type { AuthRouteDependencies } from "./auth-types.js";
import { authMethodFactorStrength, credentialRotationDue, credentialScopesAllowed, factorStrengthSatisfies, normalizeStudioSecurityPolicy, securityPolicyMinimumFactorStrength } from "../../core/studio-security-policy.js";
import { encryptionKeyConfigured, encryptionKeyId, previousEncryptionKeyIds } from "../../core/setting-crypto.js";
import { rewrapSecuritySecrets } from "./security-secret-rewrap.js";
import { serializeServiceCredential } from "./service-credential-service.js";

const policySchema = z.object({
  mfaRequirement: z.enum(["optional", "admins", "all"]),
  mfaMinimumStrength: z.enum(["mfa", "phishing_resistant", "hardware_backed"]),
  adminMfaMinimumStrength: z.enum(["mfa", "phishing_resistant", "hardware_backed"]),
  highRiskVerificationMinimumStrength: z.enum(["knowledge", "mfa", "phishing_resistant", "hardware_backed"]),
  highRiskRequireDeviceProof: z.boolean(),
  sessionDays: z.number().int().min(1).max(365),
  sessionIdleHours: z.number().min(1).max(8760),
  sessionMaxPerUser: z.number().int().min(1).max(100),
  credentialRequireExpiry: z.boolean(),
  credentialMaxLifetimeDays: z.number().int().min(1).max(3650),
  credentialRotationDays: z.number().int().min(1).max(3650),
  credentialAllowedScopes: z.array(z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._:-]+$/)).min(1).max(128),
});

const ACTIVE_USER_WHERE = {
  archived: false,
  accountState: { notIn: ["DISABLED", "SUSPENDED", "PRIVACY_ERASED"] },
};

function mfaBackedAuthMethod(value: unknown) {
  return /(?:\+mfa|\+recovery|mfa-enrolled)/i.test(String(value || ""));
}

function policyRank(value: string) {
  return value === "all" ? 2 : value === "admins" ? 1 : 0;
}

function mfaRequiredUserWhere(requirement: "optional" | "admins" | "all") {
  if (requirement === "optional") return null;
  if (requirement === "admins") {
    return { ...ACTIVE_USER_WHERE, memberships: { some: { role: { in: ["owner", "admin"] } } } };
  }
  return { ...ACTIVE_USER_WHERE };
}

async function scanById(model: any, query: Record<string, any>, visit: (rows: any[]) => Promise<void> | void, pageSize = 500) {
  let cursor: string | null = null;
  while (true) {
    const rows: any[] = await model.findMany({
      ...query,
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) return;
    await visit(rows);
    if (rows.length < pageSize) return;
    cursor = String(rows[rows.length - 1].id);
  }
}

export function registerStudioSecurityRoutes(deps: AuthRouteDependencies) {
  const { app, prisma, authorization, getCurrentSession, readSettings, saveSettings, rewrapProtectedSettings, settingsForClient, requireConfirmation, logSecurityEvent, onUserSessionsRevoked } = deps;

  async function currentPolicy() {
    const settings = await readSettings();
    return { settings, policy: normalizeStudioSecurityPolicy(settings, {
      sessionDays: Number(settings.sessionDays || 7),
      sessionIdleHours: Number(settings.sessionIdleHours || 168),
      sessionMaxPerUser: Number(settings.sessionMaxPerUser || 10),
    }) };
  }

  async function revokeSessionsOutsideMfaPolicy(policy: any, currentSession: any) {
    if (policy.mfaRequirement === "optional") return 0;
    const now = new Date();
    let revokedSessions = 0;
    await scanById(prisma.session, {
      where: { revokedAt: null, id: { not: currentSession.id } },
      select: { id: true, userId: true, authMethod: true, user: { select: { memberships: { select: { role: true }, take: 16 } } } },
    }, async (rows) => {
      const noncompliant = rows.filter((row: any) => {
        const roles = (row.user?.memberships || []).map((membership: any) => String(membership.role || "member").toLowerCase());
        const role = roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : roles[0] || "member";
        const required = policy.mfaRequirement === "all" || (policy.mfaRequirement === "admins" && ["owner", "admin"].includes(role));
        if (!required) return false;
        return !factorStrengthSatisfies(authMethodFactorStrength(row.authMethod), securityPolicyMinimumFactorStrength(policy, role));
      });
      if (!noncompliant.length) return;
      const ids = noncompliant.map((row: any) => String(row.id));
      const result = await prisma.session.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now, revocationReason: "security_policy_authenticator_strength_tightened" } });
      revokedSessions += Number(result.count || 0);
      for (const userId of [...new Set(noncompliant.map((row: any) => String(row.userId)))]) onUserSessionsRevoked(userId, "security_policy_authenticator_strength_tightened", userId === currentSession.userId ? currentSession.id : null);
    });
    return revokedSessions;
  }

  async function credentialPosture(policy: any, now: Date) {
    const activeWhere = { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    let activeCredentials = 0;
    let rotationDue = 0;
    let missingExpiry = 0;
    let scopePolicyViolations = 0;
    let lifetimePolicyViolations = 0;
    await scanById(prisma.serviceCredential, { where: activeWhere }, async (rows) => {
      for (const row of rows) {
        activeCredentials += 1;
        if (credentialRotationDue(policy, row.updatedAt || row.createdAt, now.getTime())) rotationDue += 1;
        if (!row.expiresAt) missingExpiry += 1;
        if (!credentialScopesAllowed(policy, serializeServiceCredential(row).scopes)) scopePolicyViolations += 1;
        const createdAt = new Date(row.createdAt).getTime();
        if (Number.isFinite(createdAt) && now.getTime() >= createdAt + policy.credentialMaxLifetimeDays * 24 * 60 * 60 * 1000) lifetimePolicyViolations += 1;
      }
    });
    return { activeCredentials, rotationDue, missingExpiry, scopePolicyViolations, lifetimePolicyViolations };
  }

  app.get("/api/admin/security/policy", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const { policy } = await currentPolicy();
    return { ok: true, policy };
  });

  app.put("/api/admin/security/policy", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "UPDATE SECURITY POLICY")) return;
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = policySchema.parse(request.body || {});
    const { settings, policy: previous } = await currentPolicy();
    const strengthRank = (value: string) => value === "hardware_backed" ? 3 : value === "phishing_resistant" ? 2 : value === "mfa" ? 1 : 0;
    const tighteningMfa = policyRank(body.mfaRequirement) > policyRank(previous.mfaRequirement)
      || strengthRank(body.mfaMinimumStrength) > strengthRank(previous.mfaMinimumStrength)
      || strengthRank(body.adminMfaMinimumStrength) > strengthRank(previous.adminMfaMinimumStrength);
    const currentAdminRequired = body.mfaRequirement === "all" || body.mfaRequirement === "admins";
    if (tighteningMfa && currentAdminRequired && !factorStrengthSatisfies(authMethodFactorStrength(session.authMethod), body.adminMfaMinimumStrength)) {
      return reply.code(409).send({ ok: false, code: "MFA_POLICY_BOOTSTRAP_REQUIRED", error: "Verify this administrator with an authenticator that satisfies the new policy before requiring it for other accounts." });
    }

    const previousScopes = new Set(previous.credentialAllowedScopes.map((scope) => String(scope).toLowerCase()));
    const nextScopes = new Set(body.credentialAllowedScopes.map((scope) => String(scope).toLowerCase()));
    const removedCredentialScopes = [...previousScopes].filter((scope) => !nextScopes.has(scope));
    const changes = {
      securityMfaRequirement: body.mfaRequirement,
      securityMfaMinimumStrength: body.mfaMinimumStrength,
      securityAdminMfaMinimumStrength: body.adminMfaMinimumStrength,
      securityHighRiskVerificationMinimumStrength: body.highRiskVerificationMinimumStrength,
      securityHighRiskRequireDeviceProof: body.highRiskRequireDeviceProof,
      sessionDays: body.sessionDays,
      sessionIdleHours: body.sessionIdleHours,
      sessionMaxPerUser: body.sessionMaxPerUser,
      securityCredentialRequireExpiry: body.credentialRequireExpiry,
      securityCredentialMaxLifetimeDays: body.credentialMaxLifetimeDays,
      securityCredentialRotationDays: body.credentialRotationDays,
      securityCredentialAllowedScopesCsv: body.credentialAllowedScopes.join(","),
    };
    try {
      await saveSettings({}, {
        changedFields: changes,
        expectedSettings: expectedServerConfigFields(settingsForClient(settings), changes),
      });
    } catch (error: any) {
      if (error?.code === "SERVER_CONFIG_CONFLICT") {
        return reply.code(409).send({ ok: false, code: error.code, error: error.message, conflictingKeys: error.conflictingKeys });
      }
      throw error;
    }

    const revokedSessions = tighteningMfa ? await revokeSessionsOutsideMfaPolicy(body, session) : 0;
    await logSecurityEvent({ event: "security.policy_updated", actorUserId: admin.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_SECURITY_POLICY", request, metadata: { previousMfaRequirement: previous.mfaRequirement, nextMfaRequirement: body.mfaRequirement, previousAdminMfaMinimumStrength: previous.adminMfaMinimumStrength, nextAdminMfaMinimumStrength: body.adminMfaMinimumStrength, previousHighRiskVerificationMinimumStrength: previous.highRiskVerificationMinimumStrength, nextHighRiskVerificationMinimumStrength: body.highRiskVerificationMinimumStrength, previousHighRiskRequireDeviceProof: previous.highRiskRequireDeviceProof, nextHighRiskRequireDeviceProof: body.highRiskRequireDeviceProof, revokedSessions, removedCredentialScopes } });
    return { ok: true, policy: body, revokedSessions, removedCredentialScopes };
  });

  app.get("/api/admin/security/posture", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const { policy, settings } = await currentPolicy();
    const now = new Date();
    const requiredUserWhere = mfaRequiredUserWhere(policy.mfaRequirement);

    const [activeUsers, mfaEnabledUsers, activeSessions, credentials, registeredDevices, verifiedDevices] = await Promise.all([
      prisma.user.count({ where: ACTIVE_USER_WHERE }),
      prisma.user.count({ where: { ...ACTIVE_USER_WHERE, authenticators: { some: { state: "active", revokedAt: null, compromisedAt: null } } } }),
      prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      credentialPosture(policy, now),
      prisma.deviceRegistration.count({ where: { revokedAt: null } }),
      prisma.deviceRegistration.count({ where: { revokedAt: null, proofStatus: "verified", proofKeyFingerprint: { not: null } } }),
    ]);

    let mfaRequiredUsers = 0;
    let mfaEnrollmentGaps = 0;
    let mfaStrengthGaps = 0;
    let requiredSessionsWithoutMfa = 0;
    if (requiredUserWhere) {
      [mfaRequiredUsers, mfaEnrollmentGaps] = await Promise.all([
        prisma.user.count({ where: requiredUserWhere }),
        prisma.user.count({ where: { ...requiredUserWhere, authenticators: { none: { state: "active", revokedAt: null, compromisedAt: null } } } }),
      ]);
      await scanById(prisma.user, {
        where: requiredUserWhere,
        select: { id: true, memberships: { select: { role: true }, take: 16 }, authenticators: { where: { state: "active", revokedAt: null, compromisedAt: null }, select: { strength: true } } },
      }, async (rows) => {
        for (const row of rows) {
          const roles = (row.memberships || []).map((membership: any) => String(membership.role || "member").toLowerCase());
          const role = roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : roles[0] || "member";
          const minimumStrength = securityPolicyMinimumFactorStrength(policy, role);
          if (!(row.authenticators || []).some((factor: any) => factorStrengthSatisfies(String(factor.strength || "mfa"), minimumStrength))) mfaStrengthGaps += 1;
        }
      });
      await scanById(prisma.session, {
        where: { revokedAt: null, expiresAt: { gt: now }, user: { is: requiredUserWhere } },
        select: { id: true, authMethod: true, user: { select: { memberships: { select: { role: true }, take: 16 } } } },
      }, async (rows) => {
        for (const row of rows) {
          const roles = (row.user?.memberships || []).map((membership: any) => String(membership.role || "member").toLowerCase());
          const role = roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : roles[0] || "member";
          if (!factorStrengthSatisfies(authMethodFactorStrength(row.authMethod), securityPolicyMinimumFactorStrength(policy, role))) requiredSessionsWithoutMfa += 1;
        }
      });
    }

    const findings: Array<{ id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; remediation: string }> = [];
    const addFinding = (id: string, severity: "critical" | "warning" | "info", title: string, detail: string, remediation: string) => findings.push({ id, severity, title, detail, remediation });
    if (!encryptionKeyConfigured()) addFinding("encryption-key-missing", "critical", "Dedicated secret-encryption key is not configured", "Protected settings fall back to a development-only key outside production; production startup refuses this configuration.", "Configure a unique CLUSTER_SECRET_KEY with at least 32 bytes and rewrap protected secrets.");
    if (settings.securityHeadersEnabled === false) addFinding("security-headers-disabled", "critical", "HTTP security headers are disabled", "CSP, frame protection, nosniff, Referrer Policy, Permissions Policy, and HSTS policy cannot be enforced by Cluster.", "Enable Security Headers in Server Config.");
    if (settings.requireMutationOrigin === false) addFinding("mutation-origin-disabled", "critical", "Cross-site mutation protection is disabled", "Unsafe requests are not requiring the canonical Origin and Fetch Metadata integrity decision.", "Enable mutation Origin/Fetch Metadata enforcement.");
    if (settings.rateLimitEnabled === false) addFinding("rate-limit-disabled", "warning", "Request rate limiting is disabled", "Authentication and API abuse controls have reduced protection against repeated requests.", "Enable server rate limiting unless an equivalent trusted edge control is enforced and documented.");
    if (settings.allowExecutableUploads === true) addFinding("executable-uploads-enabled", "warning", "Executable uploads are enabled", "Untrusted executable/script payloads may enter Library storage.", "Disable executable uploads unless the Studio has an explicit governed binary-distribution need.");
    if (mfaEnrollmentGaps) addFinding("mfa-enrollment-gaps", "critical", "Required accounts are missing MFA", `${mfaEnrollmentGaps} account(s) covered by Studio MFA policy do not have an active authenticator.`, "Enroll compliant authenticators or adjust the Studio MFA scope intentionally.");
    if (mfaStrengthGaps) addFinding("mfa-strength-gaps", "critical", "Authenticator strength does not meet policy", `${mfaStrengthGaps} account(s) lack an active factor strong enough for their role.`, "Enroll passkeys/security keys that satisfy the configured minimum strength.");
    if (requiredSessionsWithoutMfa) addFinding("session-strength-gaps", "warning", "Active sessions predate stronger authentication policy", `${requiredSessionsWithoutMfa} active session(s) do not satisfy current factor-strength requirements.`, "Revoke noncompliant sessions and require fresh authentication.");
    const unverifiedDevices = Math.max(0, registeredDevices - verifiedDevices);
    if (policy.highRiskRequireDeviceProof && unverifiedDevices) addFinding("device-proof-gaps", "warning", "Registered devices lack asymmetric proof", `${unverifiedDevices} non-revoked device registration(s) are still installation-ID-only and cannot satisfy the high-risk device-proof policy.`, "Open Cluster from each device so it can establish its non-exportable device key, or revoke registrations that are no longer used.");
    if (credentials.rotationDue) addFinding("credential-rotation-due", "warning", "Scoped credentials are due for rotation", `${credentials.rotationDue} credential(s) exceed the Studio rotation target.`, "Rotate the affected credentials and update their consumers.");
    if (credentials.scopePolicyViolations) addFinding("credential-scope-policy", "critical", "Scoped credentials exceed current policy", `${credentials.scopePolicyViolations} active credential(s) contain scopes no longer permitted by Studio policy.`, "Revoke or replace credentials with approved scopes.");
    if (credentials.lifetimePolicyViolations) addFinding("credential-lifetime-policy", "critical", "Scoped credentials exceed maximum lifetime", `${credentials.lifetimePolicyViolations} active credential(s) are older than the configured maximum lifetime.`, "Replace the affected credentials.");
    if (policy.credentialRequireExpiry && credentials.missingExpiry) addFinding("credential-expiry-missing", "warning", "Scoped credentials are missing expiry", `${credentials.missingExpiry} active credential(s) have no expiry while Studio policy requires one.`, "Rotate or replace those credentials with compliant expiry dates.");
    if (previousEncryptionKeyIds().length) addFinding("secret-key-rotation-pending", "info", "Previous encryption keys remain configured", `${previousEncryptionKeyIds().length} previous key(s) remain available for decryption during rotation.`, "Rewrap protected secrets, verify recovery, then remove retired keys from CLUSTER_SECRET_KEY_PREVIOUS.");

    const healthy = findings.every((finding) => finding.severity === "info");

    return { ok: true, policy, posture: {
      activeUsers,
      mfaEnabledUsers,
      mfaRequiredUsers,
      mfaEnrollmentGaps,
      mfaStrengthGaps,
      activeSessions,
      requiredSessionsWithoutMfa,
      registeredDevices,
      verifiedDevices,
      unverifiedDevices: Math.max(0, registeredDevices - verifiedDevices),
      activeCredentials: credentials.activeCredentials,
      credentialRotationDue: credentials.rotationDue,
      credentialsWithoutExpiry: credentials.missingExpiry,
      credentialScopePolicyViolations: credentials.scopePolicyViolations,
      credentialLifetimePolicyViolations: credentials.lifetimePolicyViolations,
      encryptionKeyConfigured: encryptionKeyConfigured(),
      encryptionKeyId: encryptionKeyId(),
      previousEncryptionKeyIds: previousEncryptionKeyIds(),
      findings,
      healthy,
    } };
  });

  app.post("/api/admin/security/secrets/rewrap", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "REWRAP SECRETS")) return;
    if (!encryptionKeyConfigured()) return reply.code(409).send({ ok: false, code: "ENCRYPTION_KEY_REQUIRED", error: "Configure CLUSTER_SECRET_KEY before rewrapping protected secrets." });
    await rewrapProtectedSettings();
    const securitySecrets = await rewrapSecuritySecrets(prisma);
    await logSecurityEvent({ event: "security.secrets_rewrapped", actorUserId: admin.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_SECRET_REWRAP", request, metadata: { encryptionKeyId: encryptionKeyId(), previousKeyCount: previousEncryptionKeyIds().length, ...securitySecrets } });
    return { ok: true, encryptionKeyId: encryptionKeyId(), previousEncryptionKeyIds: previousEncryptionKeyIds(), securitySecrets, note: "Protected settings, context-pack secrets, MFA seeds, and webhook signing secrets were rewritten using the active operator-provided Cluster secret key." };
  });
}
