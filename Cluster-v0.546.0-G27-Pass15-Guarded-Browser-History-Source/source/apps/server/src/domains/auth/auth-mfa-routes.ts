import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";
import { createAuthenticatorService } from "./authenticator-service.js";
import { requestDeviceId } from "../sessions/session-device.js";
import { normalizeStudioSecurityPolicy, securityPolicyMinimumFactorStrength, securityPolicyRequiresMfa } from "../../core/studio-security-policy.js";
import { highRiskSecurityVerificationPurpose, issueSecurityVerification, nextVerificationGeneration, revokeUserSecurityVerifications, securityVerificationPolicy, strongerVerificationStrength, verifierStrengthSatisfies, type SecurityVerificationPurpose } from "../../core/security-verification.js";
import { securityPolicyHighRiskVerificationStrength } from "../../core/studio-security-policy.js";
import { verifyWebAuthnRegistration, verifyWebAuthnAssertion, webAuthnClientChallenge, webAuthnRpFromOrigin } from "./webauthn.js";

function mfaError(reply: any, code: string) {
  const messages: Record<string, string> = {
    MFA_ALREADY_ENABLED: "Multi-factor authentication is already enabled.",
    MFA_ENROLLMENT_NOT_PENDING: "No MFA enrollment is waiting for verification.",
    MFA_CODE_INVALID: "The authentication code was not accepted.",
    MFA_RECOVERY_INVALID: "The recovery code was not accepted.",
    MFA_CHALLENGE_INVALID: "The MFA sign-in challenge expired or was already used.",
    MFA_CHALLENGE_DEVICE_MISMATCH: "The MFA sign-in challenge belongs to a different device.",
    MFA_FACTOR_REQUIRED: "Enter an authenticator or recovery code.",
    MFA_POLICY_REQUIRED: "Studio security policy requires multi-factor authentication for this account.",
    MFA_FACTOR_NOT_FOUND: "That authenticator is no longer available.",
    MFA_LAST_FACTOR: "Add another authenticator before removing your last active factor.",
    MFA_POLICY_FACTOR_REQUIRED: "Add another authenticator that satisfies Studio security policy before removing this factor.",
    PASSKEY_CREDENTIAL_EXISTS: "That passkey or security key is already registered.",
    PASSKEY_CHALLENGE_INVALID: "The passkey challenge expired or was already used.",
    PASSKEY_VERIFICATION_FAILED: "The passkey response could not be verified.",
  };
  const status = code === "MFA_ALREADY_ENABLED" ? 409 : code.includes("CHALLENGE") ? 401 : 400;
  return reply.code(status).send({ ok: false, code, error: messages[code] || "MFA verification failed." });
}

export function registerAuthMfaRoutes(deps: AuthRouteDependencies) {
  const { app, prisma, getCurrentSession, logSecurityEvent, createSession, clearCurrentSessionCache, decorateUserForClient, accountNextStep, readSettings } = deps;
  const service = createAuthenticatorService({ prisma, logSecurityEvent });

  async function invalidateAuthenticatorProof(userId: string, fallbackUser?: any) {
    const user = fallbackUser || await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await prisma.user.update({ where: { id: userId }, data: { verificationGeneration: nextVerificationGeneration(user) } });
    await revokeUserSecurityVerifications(prisma, userId);
  }

  async function policyRequiresMfaForUser(userId: string) {
    const settings = await readSettings();
    const policy = normalizeStudioSecurityPolicy(settings, {
      sessionDays: Number(settings.sessionDays || 7),
      sessionIdleHours: Number(settings.sessionIdleHours || 168),
      sessionMaxPerUser: Number(settings.sessionMaxPerUser || 10),
    });
    const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { role: true }, take: 16 }).catch(() => []);
    const roles = memberships.map((row: any) => String(row.role || "member").toLowerCase());
    const role = roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : roles[0] || "member";
    return { required: securityPolicyRequiresMfa(policy, role), minimumStrength: securityPolicyMinimumFactorStrength(policy, role) };
  }

  app.get("/api/auth/mfa/status", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    return { ok: true, ...(await service.status(session.userId)) };
  });

  app.post("/api/auth/mfa/enroll/start", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const result = await service.beginTotpEnrollment(session.user);
    if (!result.ok) return mfaError(reply, result.code);
    await logSecurityEvent({ event: "mfa.enrollment_started", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "USER_MFA_ENROLLMENT", request });
    reply.header("Cache-Control", "no-store");
    return { ok: true, secret: result.secret, provisioningUri: result.uri };
  });

  app.post("/api/auth/mfa/enroll/verify", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ code: z.string().min(6).max(32) }).parse(request.body || {});
    const result = await service.verifyTotpEnrollment(session.userId, body.code);
    if (!result.ok) {
      await logSecurityEvent({ event: "mfa.enrollment_failed", actorUserId: session.userId, targetUserId: session.userId, result: "FAILURE", reasonCode: result.code, request });
      return mfaError(reply, result.code);
    }
    await invalidateAuthenticatorProof(session.userId, session.user);
    if (String(session.authMethod || "") === "mfa-enrollment-pending") {
      await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { authMethod: "password+mfa-enrolled" } });
      session.authMethod = "password+mfa-enrolled";
    }
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.enabled", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "TOTP_VERIFIED", request });
    reply.header("Cache-Control", "no-store");
    return { ok: true, recoveryCodes: result.recoveryCodes };
  });

  app.post("/api/auth/mfa/recovery/regenerate", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ code: z.string().min(6).max(32) }).parse(request.body || {});
    const result = await service.regenerateRecoveryCodes(session.userId, { code: body.code });
    if (!result.ok) return mfaError(reply, result.code);
    await invalidateAuthenticatorProof(session.userId, session.user);
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.recovery_codes_regenerated", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "TOTP_VERIFIED", request });
    reply.header("Cache-Control", "no-store");
    return { ok: true, recoveryCodes: result.recoveryCodes };
  });

  app.post("/api/auth/mfa/disable", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    if ((await policyRequiresMfaForUser(session.userId)).required) return mfaError(reply, "MFA_POLICY_REQUIRED");
    const body = z.object({ code: z.string().max(64).optional(), recoveryCode: z.string().max(64).optional() }).refine((value) => Boolean(value.code || value.recoveryCode), { message: "An authenticator or recovery code is required." }).parse(request.body || {});
    const result = await service.disableAll(session.userId, body);
    if (!result.ok) return mfaError(reply, result.code);
    await invalidateAuthenticatorProof(session.userId, session.user);
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.disabled", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "USER_MFA_DISABLED", request });
    return { ok: true };
  });


  app.post("/api/auth/mfa/passkeys/enroll/start", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ label: z.string().trim().min(1).max(80).optional() }).parse(request.body || {});
    const relyingParty = webAuthnRpFromOrigin(deps.webOrigin);
    const challenge = await service.createWebAuthnChallenge({ userId: session.userId, deviceId: requestDeviceId(request), flow: "enrollment", rpId: relyingParty.rpId, expectedOrigin: relyingParty.origin, context: { label: body.label || null } });
    const existing = await service.activeFactors(session.userId);
    const excludeCredentials = existing.filter((factor: any) => factor.kind === "webauthn" && factor.credentialId).map((factor: any) => ({ id: factor.credentialId, type: "public-key", transports: (() => { try { return JSON.parse(factor.transports || "[]"); } catch { return []; } })() }));
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt.toISOString(),
      publicKey: {
        challenge: challenge.challenge,
        rp: { id: relyingParty.rpId, name: relyingParty.rpName },
        user: { id: Buffer.from(String(session.userId), "utf8").toString("base64url"), name: String(session.user?.email || session.user?.username || session.userId), displayName: String(session.user?.displayName || session.user?.username || "Cluster user") },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
        timeout: 300000,
        attestation: "none",
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        extensions: { credProps: true },
        excludeCredentials,
      },
    };
  });

  app.post("/api/auth/mfa/passkeys/enroll/verify", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ credential: z.any(), label: z.string().trim().min(1).max(80).optional() }).parse(request.body || {});
    const challengeValue = webAuthnClientChallenge(body.credential);
    if (!challengeValue) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    const challenge = await service.findChallenge(challengeValue, "enrollment");
    if (!challenge || challenge.userId !== session.userId || challenge.kind !== "webauthn" || !challenge.rpId || !challenge.expectedOrigin) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    let verified: any;
    try {
      verified = verifyWebAuthnRegistration({ credential: body.credential, expectedChallenge: challengeValue, expectedOrigin: challenge.expectedOrigin, rpId: challenge.rpId });
    } catch (error) {
      await logSecurityEvent({ event: "mfa.passkey_enrollment_failed", actorUserId: session.userId, targetUserId: session.userId, result: "FAILURE", reasonCode: error instanceof Error ? error.message : "PASSKEY_VERIFICATION_FAILED", request });
      return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    }
    if (!(await service.claimChallenge(challenge.id))) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    let context: any = {};
    try { context = JSON.parse(challenge.context || "{}"); } catch {}
    const registered = await service.registerWebAuthnFactor({ userId: session.userId, label: body.label || context.label || undefined, ...verified });
    if (!registered.ok) return mfaError(reply, registered.code);
    const recoveryCodes = await service.issueInitialRecoveryCodes(session.userId);
    await invalidateAuthenticatorProof(session.userId, session.user);
    if (String(session.authMethod || "") === "mfa-enrollment-pending") {
      const policyState = await policyRequiresMfaForUser(session.userId);
      if (verifierStrengthSatisfies(String(registered.factor.strength || "phishing_resistant"), policyState.minimumStrength)) {
        const authMethod = registered.factor.strength === "hardware_backed" ? "password+security-key" : "password+passkey";
        await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { authMethod } });
        session.authMethod = authMethod;
        clearCurrentSessionCache(request);
      }
    }
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.passkey_enabled", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: verified.attachment === "cross-platform" ? "SECURITY_KEY_REGISTERED" : "PASSKEY_REGISTERED", request, metadata: { factorId: registered.factor.id, attachment: verified.attachment, backupEligible: verified.backupEligible } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, factor: registered.factor, recoveryCodes };
  });

  app.post("/api/auth/mfa/passkeys/challenge", async (request, reply) => {
    const body = z.object({ challenge: z.string().min(32).max(512), credential: z.any() }).parse(request.body || {});
    const challenge = await service.findChallenge(body.challenge);
    if (!challenge?.userId || challenge.deviceId && challenge.deviceId !== requestDeviceId(request)) return mfaError(reply, "MFA_CHALLENGE_INVALID");
    const factor = await prisma.authenticator.findUnique({ where: { credentialId: String(body.credential?.rawId || body.credential?.id || "") } }).catch(() => null);
    if (!factor || factor.userId !== challenge.userId || factor.kind !== "webauthn" || factor.state !== "active" || !factor.publicKeySpki || !factor.publicKeyAlgorithm) return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    const relyingParty = webAuthnRpFromOrigin(deps.webOrigin);
    let verified: any;
    try {
      verified = verifyWebAuthnAssertion({ credential: body.credential, expectedChallenge: body.challenge, expectedOrigin: relyingParty.origin, rpId: relyingParty.rpId, credentialId: factor.credentialId, publicKeySpki: factor.publicKeySpki, publicKeyAlgorithm: factor.publicKeyAlgorithm, requireUserVerification: true });
    } catch (error) {
      await logSecurityEvent({ event: "mfa.passkey_login_failed", actorUserId: challenge.userId, targetUserId: challenge.userId, result: "FAILURE", reasonCode: error instanceof Error ? error.message : "PASSKEY_VERIFICATION_FAILED", request });
      return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    }
    if (!(await service.claimChallenge(challenge.id))) return mfaError(reply, "MFA_CHALLENGE_INVALID");
    const usage = await service.markWebAuthnUsed({ factorId: factor.id, signCount: verified.signCount, backupState: verified.backupState, userVerification: verified.userVerification });
    if (!usage.ok) return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    try {
      await createSession(challenge.userId, reply, request, { authMethod: factor.strength === "hardware_backed" ? "password+security-key" : "password+passkey" });
      clearCurrentSessionCache(request);
    } catch {
      return reply.code(409).send({ ok: false, code: "AUTH_SESSION_UNAVAILABLE", error: "Passkey verification succeeded, but Cluster could not create a login session. Sign in again." });
    }
    const refreshed = await prisma.user.findUnique({ where: { id: challenge.userId } });
    await logSecurityEvent({ event: "account.login_succeeded", actorUserId: challenge.userId, targetUserId: challenge.userId, result: "SUCCESS", reasonCode: factor.strength === "hardware_backed" ? "PASSWORD_SECURITY_KEY_MFA" : "PASSWORD_PASSKEY_MFA", request, metadata: { factorId: factor.id } });
    return { ok: true, user: await decorateUserForClient(refreshed), nextStep: accountNextStep(refreshed?.accountState, deps.requireDiscordLink) };
  });


  app.post("/api/auth/reauth/passkey/start", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const purposes = ["security_export", "privacy", "session_management", "mfa", "server_configuration", "studio_administration", "context_export", "context_secret_export", "library_administration", "personnel_records", "vault_secret_reveal"] as const satisfies readonly SecurityVerificationPurpose[];
    const body = z.object({ purpose: z.enum(purposes), reason: z.string().trim().min(1).max(500).optional() }).parse(request.body || {});
    const settings = await readSettings();
    const studioPolicy = normalizeStudioSecurityPolicy(settings, { sessionDays: Number(settings.sessionDays || 7), sessionIdleHours: Number(settings.sessionIdleHours || 168), sessionMaxPerUser: Number(settings.sessionMaxPerUser || 10) });
    const basePolicy = securityVerificationPolicy(body.purpose);
    const minimumStrength = highRiskSecurityVerificationPurpose(body.purpose) ? strongerVerificationStrength(basePolicy.minimumStrength, securityPolicyHighRiskVerificationStrength(studioPolicy)) : basePolicy.minimumStrength;
    if (basePolicy.reasonMode === "required" && !body.reason) return reply.code(400).send({ ok: false, code: "AUTH_REAUTH_REASON_REQUIRED", error: "Enter a reason for this security verification." });
    const factors = (await service.activeFactors(session.userId)).filter((factor: any) => factor.kind === "webauthn" && factor.credentialId && verifierStrengthSatisfies(String(factor.strength || "phishing_resistant"), minimumStrength));
    if (!factors.length) return reply.code(409).send({ ok: false, code: "AUTH_REAUTH_FACTOR_UNAVAILABLE", error: "No active passkey or security key satisfies this verification policy." });
    const relyingParty = webAuthnRpFromOrigin(deps.webOrigin);
    const challenge = await service.createWebAuthnChallenge({ userId: session.userId, deviceId: requestDeviceId(request), flow: "security_verification", rpId: relyingParty.rpId, expectedOrigin: relyingParty.origin, context: { purpose: body.purpose, reason: body.reason || null, sessionId: session.id, minimumStrength } });
    return { ok: true, challenge: challenge.challenge, expiresAt: challenge.expiresAt.toISOString(), publicKey: { challenge: challenge.challenge, rpId: relyingParty.rpId, timeout: 300000, userVerification: "required", allowCredentials: factors.map((factor: any) => ({ id: factor.credentialId, type: "public-key", transports: (() => { try { return JSON.parse(factor.transports || "[]"); } catch { return []; } })() })) }, minimumStrength };
  });

  app.post("/api/auth/reauth/passkey/verify", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ challenge: z.string().min(32).max(512), credential: z.any() }).parse(request.body || {});
    const challenge = await service.findChallenge(body.challenge, "security_verification");
    if (!challenge || challenge.userId !== session.userId || challenge.deviceId && challenge.deviceId !== requestDeviceId(request) || !challenge.rpId || !challenge.expectedOrigin) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    let context: any = {};
    try { context = JSON.parse(challenge.context || "{}"); } catch {}
    if (context.sessionId !== session.id || !context.purpose) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    const factor = await prisma.authenticator.findUnique({ where: { credentialId: String(body.credential?.rawId || body.credential?.id || "") } }).catch(() => null);
    if (!factor || factor.userId !== session.userId || factor.kind !== "webauthn" || factor.state !== "active" || factor.revokedAt || factor.compromisedAt || !factor.publicKeySpki || !factor.publicKeyAlgorithm || !verifierStrengthSatisfies(String(factor.strength || "phishing_resistant"), context.minimumStrength || "phishing_resistant")) return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    let verified: any;
    try { verified = verifyWebAuthnAssertion({ credential: body.credential, expectedChallenge: body.challenge, expectedOrigin: challenge.expectedOrigin, rpId: challenge.rpId, credentialId: factor.credentialId, publicKeySpki: factor.publicKeySpki, publicKeyAlgorithm: factor.publicKeyAlgorithm, requireUserVerification: true }); }
    catch (error) { await logSecurityEvent({ event: "account.reauth_failed", actorUserId: session.userId, targetUserId: session.userId, result: "FAILURE", reasonCode: error instanceof Error ? error.message : "PASSKEY_VERIFICATION_FAILED", request, metadata: { purpose: context.purpose } }); return mfaError(reply, "PASSKEY_VERIFICATION_FAILED"); }
    if (!(await service.claimChallenge(challenge.id))) return mfaError(reply, "PASSKEY_CHALLENGE_INVALID");
    const usage = await service.markWebAuthnUsed({ factorId: factor.id, signCount: verified.signCount, backupState: verified.backupState, userVerification: verified.userVerification });
    if (!usage.ok) return mfaError(reply, "PASSKEY_VERIFICATION_FAILED");
    const purpose = context.purpose as SecurityVerificationPurpose;
    const verificationPolicy = securityVerificationPolicy(purpose);
    const grant = await issueSecurityVerification(prisma, { sessionId: session.id, userId: session.userId, user: session.user, purpose, method: factor.strength === "hardware_backed" ? "security_key" : "passkey", verifierStrength: factor.strength, ttlMs: verificationPolicy.ttlMs, singleUse: verificationPolicy.singleUse, requiredReason: context.reason || null, auditCorrelationId: String(request.id || "") || null });
    await logSecurityEvent({ event: "account.reauthenticated", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: factor.strength === "hardware_backed" ? "SECURITY_KEY_REAUTHENTICATION" : "PASSKEY_REAUTHENTICATION", request, metadata: { purpose, factorId: factor.id, verifierStrength: factor.strength, singleUse: verificationPolicy.singleUse } });
    return { ok: true, method: factor.strength === "hardware_backed" ? "security_key" : "passkey", purpose, verifierStrength: factor.strength, reauthenticatedAt: new Date(grant.issuedAt).toISOString(), grantExpiresAt: new Date(grant.expiresAt).toISOString(), singleUse: verificationPolicy.singleUse };
  });

  app.delete("/api/auth/mfa/factors/:factorId", async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ factorId: z.string().min(1).max(128) }).parse(request.params || {});
    const policyState = await policyRequiresMfaForUser(session.userId);
    const result = await service.revokeFactor(session.userId, params.factorId, policyState.required ? { minimumStrength: policyState.minimumStrength } : {});
    if (!result.ok) return mfaError(reply, result.code);
    await invalidateAuthenticatorProof(session.userId, session.user);
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.factor_revoked", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "USER_FACTOR_REMOVED", request, metadata: { factorId: params.factorId } });
    return { ok: true };
  });

  app.post("/api/auth/mfa/challenge", async (request, reply) => {
    const body = z.object({ challenge: z.string().min(32).max(256), code: z.string().max(64).optional(), recoveryCode: z.string().max(64).optional() }).refine((value) => Boolean(value.code || value.recoveryCode), { message: "An authenticator or recovery code is required." }).parse(request.body || {});
    const result = await service.verifyLoginChallenge({ ...body, deviceId: requestDeviceId(request) });
    if (!result.ok) {
      await logSecurityEvent({ event: "mfa.login_failed", actorUserId: null, targetUserId: null, result: "FAILURE", reasonCode: result.code, request });
      return mfaError(reply, result.code);
    }
    try {
      await createSession(result.user.id, reply, request, { authMethod: result.authMethod });
      clearCurrentSessionCache(request);
    } catch {
      return reply.code(409).send({ ok: false, code: "AUTH_SESSION_UNAVAILABLE", error: "MFA succeeded, but Cluster could not create a login session. Sign in again." });
    }
    const refreshed = await prisma.user.findUnique({ where: { id: result.user.id } });
    await logSecurityEvent({ event: "account.login_succeeded", actorUserId: result.user.id, targetUserId: result.user.id, result: "SUCCESS", reasonCode: result.authMethod === "password+recovery" ? "PASSWORD_RECOVERY_MFA" : "PASSWORD_TOTP_MFA", request });
    return { ok: true, user: await decorateUserForClient(refreshed), nextStep: accountNextStep(refreshed?.accountState, deps.requireDiscordLink) };
  });
}
