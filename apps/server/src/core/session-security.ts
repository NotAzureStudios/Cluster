import { securityVerificationPolicy, type SecurityVerificationPolicy, type SecurityVerificationPurpose } from "./security-verification.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/passkeys/login/start",
  "/api/auth/passkeys/login/verify",
  "/api/auth/mfa/challenge",
  "/api/auth/mfa/passkeys/challenge",
  "/api/auth/dev-login",
  "/api/setup/status",
  "/api/setup/complete",
]);

export function isUnsafeHttpMethod(method: string) {
  return !SAFE_METHODS.has(String(method || "GET").toUpperCase());
}

export function csrfProtectionRequired(pathname: string, method: string) {
  const path = String(pathname || "/");
  if (!isUnsafeHttpMethod(method) || !path.startsWith("/api/")) return false;
  if (CSRF_EXEMPT_PATHS.has(path)) return false;
  if (path.startsWith("/api/auth/discord/")) return false;
  return true;
}

export type ReauthPurpose = SecurityVerificationPurpose;
export type ReauthPolicy = SecurityVerificationPolicy;

export function reauthPurposeForRequest(pathname: string, method: string, hasPrivilegedConfigAccess: boolean): ReauthPurpose | null {
  const path = String(pathname || "/");
  const unsafe = isUnsafeHttpMethod(method);
  if (method.toUpperCase() === "POST" && (path === "/api/context-packs/from-settings-with-secrets" || /^\/api\/context-packs\/[^/]+\/(?:secret-export|apply)$/.test(path))) return hasPrivilegedConfigAccess ? "context_secret_export" : null;
  if (path.startsWith("/api/context-packs/") && path.endsWith("/export")) return hasPrivilegedConfigAccess ? "context_export" : null;
  if (path === "/api/security/events/export") return "security_export";
  if (method.toUpperCase() === "POST" && /^\/api\/admin\/vault\/secrets\/[^/]+\/reveal$/.test(path)) return hasPrivilegedConfigAccess ? "vault_secret_reveal" : null;
  if (path === "/api/privacy/data-export" && unsafe) return "privacy";
  if (path === "/api/privacy/data-requests" && unsafe) return "privacy";
  if (path.startsWith("/api/privacy/data-requests/") && unsafe) return "privacy";
  if (path === "/api/privacy/integrations/discord" && unsafe) return "privacy";
  if (!unsafe) return null;
  if (/^\/api\/knowledge\/[^/]+\/(permissions|permanent|retention|ownership)$/.test(path) && unsafe) return "library_administration";
  if (/^\/api\/(admin\/personnel-records|personnel-records)\//.test(path) && unsafe) return "personnel_records";
  if (path === "/api/admin/personnel-records" && unsafe) return "personnel_records";
  if (path === "/api/me/sessions/revoke-others") return "session_management";
  if (/^\/api\/me\/devices\/[^/]+\/proof\/rotate$/.test(path)) return "mfa";
  if (path.startsWith("/api/auth/mfa/") && !["/api/auth/mfa/challenge", "/api/auth/mfa/passkeys/challenge"].includes(path)) return "mfa";
  if (/^\/api\/admin\/users\/[^/]+\/authenticators\/reset$/.test(path)) return hasPrivilegedConfigAccess ? "mfa" : null;
  if (path === "/api/server-config") return hasPrivilegedConfigAccess ? "server_configuration" : null;
  if (path === "/api/settings") return hasPrivilegedConfigAccess ? "studio_administration" : null;
  if (path.startsWith("/api/context-packs")) return hasPrivilegedConfigAccess ? "context_export" : null;
  if (path.startsWith("/api/admin/")) return hasPrivilegedConfigAccess ? "studio_administration" : null;
  return null;
}

export function reauthPolicyForRequest(pathname: string, method: string, hasPrivilegedConfigAccess: boolean): ReauthPolicy | null {
  const purpose = reauthPurposeForRequest(pathname, method, hasPrivilegedConfigAccess);
  return purpose ? securityVerificationPolicy(purpose) : null;
}

export function recentAuthenticationRequired(pathname: string, method: string, hasPrivilegedConfigAccess: boolean) {
  return reauthPolicyForRequest(pathname, method, hasPrivilegedConfigAccess) !== null;
}
