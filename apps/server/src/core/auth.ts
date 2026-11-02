import crypto from "node:crypto";
import { hashCredential, verifyCredential } from "./credential-security.js";
import { isLoopbackAddress } from "./security.js";

export const GENERIC_AUTH_ERROR = "The username or password is incorrect, or this account is unavailable.";
export const PASSWORD_MIN_LENGTH = 12;
// The exception applies only when the server has verified an owner's or
// administrator's current workspace membership.
export const PRIVILEGED_PASSWORD_MIN_LENGTH = 1;
export const PASSWORD_MAX_LENGTH = 1024;
export const LOGIN_FAILURE_LIMIT = 8;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_DECAY_MS = 24 * 60 * 60 * 1000;
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export const DISCORD_LINK_STATE_LIFETIME_MS = 10 * 60 * 1000;


export type ProductionAuthConfiguration = {
  nodeEnv?: string;
  runtimeProfile?: "development" | "managed-host" | "direct-production";
  listenHost?: string;
  sessionSecret?: string;
  authSecret?: string;
  authRequired: boolean;
  devLoginEnabled: boolean;
  sessionSecure: boolean;
  rateLimitEnabled: boolean;
  securityHeadersEnabled: boolean;
  requireMutationOrigin: boolean;
  requireDiscordLink: boolean;
  discordClientId?: string;
  discordClientSecret?: string;
  discordRedirectUri?: string;
  webOrigin: string;
};

export function validateProductionAuthConfiguration(config: ProductionAuthConfiguration) {
  if (config.nodeEnv !== "production") return;
  const managedHost = config.runtimeProfile === "managed-host";
  const sessionSecret = String(config.sessionSecret || "");
  const authSecret = String(config.authSecret || "");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) throw new Error("Production requires SESSION_SECRET with at least 32 bytes.");
  if (Buffer.byteLength(authSecret, "utf8") < 32) throw new Error("Production requires CLUSTER_AUTH_SECRET with at least 32 bytes.");
  if (sessionSecret === authSecret) throw new Error("Production requires distinct SESSION_SECRET and CLUSTER_AUTH_SECRET values.");
  if (!config.authRequired) throw new Error("Production cannot disable Cluster authentication.");
  if (config.devLoginEnabled) throw new Error("Production cannot enable the local development login.");
  if (!managedHost && !config.sessionSecure) throw new Error("Production requires secure session cookies.");
  if (!config.rateLimitEnabled) throw new Error("Production cannot disable request rate limiting.");
  if (!config.securityHeadersEnabled) throw new Error("Production cannot disable security headers.");
  if (!config.requireMutationOrigin) throw new Error("Production cannot disable mutation origin checks.");
  if (config.requireDiscordLink && (!config.discordClientId || !config.discordClientSecret || !config.discordRedirectUri)) {
    throw new Error("Production requires Discord OAuth configuration when mandatory Discord linking is enabled.");
  }

  if (managedHost && !isLoopbackAddress(config.listenHost)) {
    throw new Error("Managed-host production requires the private API to bind to loopback.");
  }

  const urls: Array<[string, string | undefined]> = [["WEB_ORIGIN", config.webOrigin]];
  if (config.requireDiscordLink || config.discordRedirectUri) urls.push(["DISCORD_REDIRECT_URI", config.discordRedirectUri]);
  for (const [label, rawUrl] of urls) {
    let parsed: URL;
    try { parsed = new URL(String(rawUrl)); } catch { throw new Error(`Production ${label} must be a valid URL.`); }
    if (managedHost) {
      if (!["http:", "https:"].includes(parsed.protocol) || !isLoopbackAddress(parsed.hostname)) {
        throw new Error(`Managed-host production ${label} must use a loopback HTTP(S) URL.`);
      }
      continue;
    }
    if (parsed.protocol !== "https:") throw new Error(`Production ${label} must use HTTPS.`);
  }
}


export function loginLockDurationMs(failureCount: number, baseMs = LOGIN_LOCK_MS) {
  const failures = Math.max(0, Math.floor(Number(failureCount) || 0));
  if (failures < LOGIN_FAILURE_LIMIT) return 0;
  const escalation = Math.floor((failures - LOGIN_FAILURE_LIMIT) / 2);
  return Math.min(24 * 60 * 60 * 1000, baseMs * 2 ** escalation);
}

export function sessionRecentlyAuthenticated(createdAt: Date | string | number, now = Date.now(), windowMs = REAUTH_WINDOW_MS) {
  const authenticatedAt = new Date(createdAt).getTime();
  return Number.isFinite(authenticatedAt) && authenticatedAt <= now && now - authenticatedAt <= windowMs;
}

export type AccountState =
  | "PASSWORD_CHANGE_REQUIRED"
  | "DISCORD_LINK_REQUIRED"
  | "ACTIVE"
  | "PASSWORD_RESET_REQUIRED"
  | "LOCKED"
  | "SUSPENDED"
  | "DISABLED";

const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-_.";
export function normalizeAuthUsername(value: string) {
  const username = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("Username must be 3 to 32 characters and use letters, numbers, periods, underscores, or hyphens.");
  }
  return username;
}

export function validateNewPassword(
  passwordValue: string,
  _identity: { username?: string | null; displayName?: string | null } = {},
  policy: { allowPrivilegedShortPassword?: boolean } = {},
) {
  const password = String(passwordValue ?? "").normalize("NFC");
  const length = [...password].length;
  const minimum = policy.allowPrivilegedShortPassword ? PRIVILEGED_PASSWORD_MIN_LENGTH : PASSWORD_MIN_LENGTH;
  if (length < minimum || length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must contain between ${minimum} and ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return password;
}

export async function hashPassword(password: string) {
  return hashCredential(password);
}

export async function verifyPassword(passwordHash: string, password: string) {
  return (await verifyCredential(passwordHash, password)).valid;
}

export function generateTemporaryPassword(length = 24) {
  const size = Math.max(PASSWORD_MIN_LENGTH, Math.min(PASSWORD_MAX_LENGTH, Math.floor(length)));
  let value = "";
  for (let index = 0; index < size; index += 1) value += TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)];
  return value;
}

export function keyedDigest(secret: string, purpose: string, value: string) {
  return crypto.createHmac("sha256", secret).update(`${purpose}\u0000${value}`, "utf8").digest("base64url");
}

export function oauthStateDigest(secret: string, state: string) {
  return keyedDigest(secret, "discord-link-state", state);
}

export function randomOAuthState() {
  return crypto.randomBytes(32).toString("base64url");
}

export function nextAccountState(discordUserId?: string | null, requireDiscordLink = false): AccountState {
  return requireDiscordLink && !discordUserId ? "DISCORD_LINK_REQUIRED" : "ACTIVE";
}

export function accountStateAllowsWorkspace(state?: string | null, requireDiscordLink = false) {
  return state === "ACTIVE" || (!requireDiscordLink && state === "DISCORD_LINK_REQUIRED");
}

export function accountNextStep(state?: string | null, requireDiscordLink = false) {
  if (state === "PASSWORD_CHANGE_REQUIRED") return "SET_PASSWORD";
  if (state === "PASSWORD_RESET_REQUIRED") return "RESET_PASSWORD";
  if (state === "DISCORD_LINK_REQUIRED" && requireDiscordLink) return "LINK_DISCORD";
  return "NONE";
}

export function safeAuthenticationReason(error: unknown) {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  return error.message.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "UNKNOWN_ERROR";
}
