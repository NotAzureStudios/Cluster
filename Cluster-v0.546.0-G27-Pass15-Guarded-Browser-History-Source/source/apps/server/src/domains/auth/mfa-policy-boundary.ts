import type { FastifyReply } from "fastify";
import { authMethodFactorStrength, factorStrengthSatisfies, normalizeStudioSecurityPolicy, securityPolicyMinimumFactorStrength, securityPolicyRequiresMfa } from "../../core/studio-security-policy.js";

function mfaSetupPath(pathname: string) {
  return pathname.startsWith("/api/auth/mfa/") || pathname === "/api/auth/csrf" || pathname === "/api/auth/logout";
}

export function enforceMfaEnrollmentRestriction(input: { pathname: string; session: any; reply: FastifyReply }) {
  if (String(input.session?.authMethod || "") !== "mfa-enrollment-pending" || mfaSetupPath(input.pathname)) return false;
  input.reply.code(428).send({
    ok: false,
    code: "MFA_ENROLLMENT_REQUIRED",
    error: "Studio security policy requires multi-factor authentication before this session can access the workspace.",
    action: "Finish authenticator enrollment and save the recovery codes, or sign out.",
    retryable: false,
    nextStep: "SETUP_MFA",
  });
  return true;
}

export async function enforceStudioMfaPolicyBoundary(input: {
  pathname: string;
  session: any;
  user: any;
  workspaceRole: unknown;
  prisma: any;
  settings: Record<string, any>;
  sessionDefaults: { sessionDays: number; sessionIdleHours: number; sessionMaxPerUser: number };
  reply: FastifyReply;
  onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void;
  clearSessionCookies: (reply: FastifyReply) => void;
}) {
  const policy = normalizeStudioSecurityPolicy(input.settings, input.sessionDefaults);
  const requiresMfa = securityPolicyRequiresMfa(policy, input.workspaceRole);
  if (!requiresMfa) return false;
  const minimumStrength = securityPolicyMinimumFactorStrength(policy, input.workspaceRole);
  const sessionStrength = authMethodFactorStrength(input.session?.authMethod);
  if (factorStrengthSatisfies(sessionStrength, minimumStrength)) return false;

  const acceptableStrengths = minimumStrength === "hardware_backed" ? ["hardware_backed"] : minimumStrength === "phishing_resistant" ? ["phishing_resistant", "hardware_backed"] : ["mfa", "phishing_resistant", "hardware_backed"];
  const activeFactorCount = await input.prisma.authenticator.count({ where: { userId: input.user.id, state: "active", revokedAt: null, compromisedAt: null, strength: { in: acceptableStrengths } } }).catch(() => 0);
  if (activeFactorCount < 1) {
    if (String(input.session.authMethod || "") !== "mfa-enrollment-pending") {
      await input.prisma.session.updateMany({ where: { id: input.session.id, revokedAt: null }, data: { authMethod: "mfa-enrollment-pending" } });
      input.session.authMethod = "mfa-enrollment-pending";
    }
    if (mfaSetupPath(input.pathname)) return false;
    input.reply.code(428).send({
      ok: false,
      code: "MFA_ENROLLMENT_REQUIRED",
      error: minimumStrength === "mfa" ? "Studio security policy requires multi-factor authentication before this session can access the workspace." : "Studio security policy requires a stronger authenticator before this session can access the workspace.",
      action: minimumStrength === "hardware_backed" ? "Add a hardware security key, then sign in again with it." : minimumStrength === "phishing_resistant" ? "Add a passkey or security key, then sign in again with it." : "Finish authenticator enrollment and save the recovery codes, or sign out.",
      retryable: false,
      nextStep: "SETUP_MFA",
    });
    return true;
  }

  await input.prisma.session.updateMany({ where: { id: input.session.id, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "security_policy_factor_strength_required" } });
  input.onUserSessionsRevoked(input.user.id, "security_policy_factor_strength_required");
  input.clearSessionCookies(input.reply);
  input.reply.code(401).send({
    ok: false,
    code: "MFA_SESSION_REQUIRED",
    error: "This session no longer satisfies the Studio authenticator-strength policy.",
    action: minimumStrength === "hardware_backed" ? "Sign in again using a hardware security key." : minimumStrength === "phishing_resistant" ? "Sign in again using a passkey or security key." : "Sign in again and complete the MFA challenge.",
    retryable: true,
  });
  return true;
}
