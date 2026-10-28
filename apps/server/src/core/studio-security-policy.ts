export type StudioSecurityPolicy = {
  mfaRequirement: "optional" | "admins" | "all";
  mfaMinimumStrength: "mfa" | "phishing_resistant" | "hardware_backed";
  adminMfaMinimumStrength: "mfa" | "phishing_resistant" | "hardware_backed";
  highRiskVerificationMinimumStrength: "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed";
  highRiskRequireDeviceProof: boolean;
  sessionDays: number;
  sessionIdleHours: number;
  sessionMaxPerUser: number;
  credentialRequireExpiry: boolean;
  credentialMaxLifetimeDays: number;
  credentialRotationDays: number;
  credentialAllowedScopes: string[];
};

export type StudioSecurityPolicyDefaults = {
  sessionDays: number;
  sessionIdleHours: number;
  sessionMaxPerUser: number;
};

const DEFAULT_ALLOWED_SCOPES = [
  "projects.read", "projects.write", "files.read", "files.write",
  "boards.read", "boards.write", "viewer.read", "viewer.write",
  "builds.read", "builds.write", "qa.read", "qa.write",
  "tickets.read", "tickets.write", "calendar.read", "calendar.write",
  "webhooks.emit", "extensions.run",
];

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizedScopes(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((item) => String(item || "").trim().toLowerCase()).filter((item) => /^[a-z0-9][a-z0-9._:-]{1,79}$/.test(item)))].slice(0, 128);
}

export function normalizeStudioSecurityPolicy(settings: Record<string, any> | null | undefined, defaults: StudioSecurityPolicyDefaults): StudioSecurityPolicy {
  const rawRequirement = String(settings?.securityMfaRequirement || "optional").toLowerCase();
  const factorStrength = (value: unknown, fallback: "mfa" | "phishing_resistant" | "hardware_backed") => {
    const normalized = String(value || "").toLowerCase();
    return normalized === "hardware_backed" || normalized === "phishing_resistant" || normalized === "mfa" ? normalized : fallback;
  };
  const verificationStrength = (value: unknown) => {
    const normalized = String(value || "").toLowerCase();
    return normalized === "hardware_backed" || normalized === "phishing_resistant" || normalized === "mfa" || normalized === "knowledge" ? normalized : "knowledge";
  };
  const allowedScopes = normalizedScopes(settings?.securityCredentialAllowedScopesCsv);
  return {
    mfaRequirement: rawRequirement === "all" || rawRequirement === "admins" ? rawRequirement : "optional",
    mfaMinimumStrength: factorStrength(settings?.securityMfaMinimumStrength, "mfa"),
    adminMfaMinimumStrength: factorStrength(settings?.securityAdminMfaMinimumStrength, "phishing_resistant"),
    highRiskVerificationMinimumStrength: verificationStrength(settings?.securityHighRiskVerificationMinimumStrength),
    highRiskRequireDeviceProof: settings?.securityHighRiskRequireDeviceProof === true,
    sessionDays: boundedNumber(settings?.sessionDays, defaults.sessionDays, 1, 365),
    sessionIdleHours: boundedNumber(settings?.sessionIdleHours, defaults.sessionIdleHours, 1, 8760),
    sessionMaxPerUser: Math.floor(boundedNumber(settings?.sessionMaxPerUser, defaults.sessionMaxPerUser, 1, 100)),
    credentialRequireExpiry: settings?.securityCredentialRequireExpiry !== false,
    credentialMaxLifetimeDays: Math.floor(boundedNumber(settings?.securityCredentialMaxLifetimeDays, 90, 1, 3650)),
    credentialRotationDays: Math.floor(boundedNumber(settings?.securityCredentialRotationDays, 60, 1, 3650)),
    credentialAllowedScopes: allowedScopes.length ? allowedScopes : DEFAULT_ALLOWED_SCOPES,
  };
}

export function securityPolicyRequiresMfa(policy: StudioSecurityPolicy, workspaceRole: unknown) {
  // Owners are strongly encouraged to enroll MFA after bootstrap, but an
  // optional studio policy must not silently force enrollment. This allows a
  // new, loopback-only server to reach the workspace before WebAuthn or domain
  // configuration. Explicit admins/all policies still fail closed.
  if (policy.mfaRequirement === "all") return true;
  if (policy.mfaRequirement === "admins") return ["owner", "admin"].includes(String(workspaceRole || "").toLowerCase());
  return false;
}

export function credentialExpiryForPolicy(policy: StudioSecurityPolicy, requestedExpiresAt: Date | null | undefined, now = new Date()) {
  const maximum = new Date(now.getTime() + policy.credentialMaxLifetimeDays * 24 * 60 * 60 * 1000);
  if (!requestedExpiresAt) return policy.credentialRequireExpiry ? maximum : null;
  if (requestedExpiresAt.getTime() <= now.getTime()) throw new Error("Credential expiry must be in the future.");
  if (requestedExpiresAt.getTime() > maximum.getTime()) throw new Error(`Credential expiry exceeds the Studio maximum of ${policy.credentialMaxLifetimeDays} days.`);
  return requestedExpiresAt;
}

export function credentialScopesOutsidePolicy(policy: StudioSecurityPolicy, scopes: string[]) {
  const allowed = new Set(policy.credentialAllowedScopes.map((scope) => String(scope).toLowerCase()));
  return [...new Set(scopes.map((scope) => String(scope).toLowerCase()))].filter((scope) => !allowed.has(scope));
}

export function credentialScopesAllowed(policy: StudioSecurityPolicy, scopes: string[]) {
  return credentialScopesOutsidePolicy(policy, scopes).length === 0;
}

export function credentialRotationDue(policy: StudioSecurityPolicy, createdAt: Date | string, now = Date.now()) {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && now - created >= policy.credentialRotationDays * 24 * 60 * 60 * 1000;
}

export function securityPolicyMinimumFactorStrength(policy: StudioSecurityPolicy, workspaceRole: unknown) {
  return ["owner", "admin"].includes(String(workspaceRole || "").toLowerCase()) ? policy.adminMfaMinimumStrength : policy.mfaMinimumStrength;
}

export function securityPolicyHighRiskVerificationStrength(policy: StudioSecurityPolicy) {
  return policy.highRiskVerificationMinimumStrength;
}

export function authMethodFactorStrength(authMethod: unknown): "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed" {
  const value = String(authMethod || "").toLowerCase();
  if (value.includes("security-key")) return "hardware_backed";
  if (value.includes("passkey")) return "phishing_resistant";
  if (/(?:\+mfa|\+totp|\+recovery|mfa-enrolled)/i.test(value)) return "mfa";
  return "knowledge";
}

export function factorStrengthSatisfies(actual: string, minimum: "mfa" | "phishing_resistant" | "hardware_backed") {
  const rank: Record<string, number> = { knowledge: 0, mfa: 1, phishing_resistant: 2, hardware_backed: 3 };
  return (rank[actual] || 0) >= rank[minimum];
}
