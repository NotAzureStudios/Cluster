import { readFileSync } from "node:fs";
import path from "node:path";
import { booleanSetting, validateCorsOrigins } from "./security.js";
import { validateProductionAuthConfiguration } from "./auth.js";
import { BOOT_SECRET_SETTING_KEYS, decryptBootSettingStorageValue, isEncryptedValue, validateSecretEncryptionConfiguration } from "./setting-crypto.js";

export type BootSettings = Record<string, any>;
export type RuntimeProfile = "development" | "managed-host" | "direct-production";

export type RuntimeConfig = {
  clusterVersion: string;
  nodeEnv: string;
  runtimeProfile: RuntimeProfile;
  bootWorkspaceRoot: string;
  bootConfigFilePath: string;
  bootSettings: BootSettings;
  bootConfigWarning: string | null;
  fastifyLogger: false | { level: string; redact?: { paths: string[]; censor: string } };
  disableRequestLogging: boolean;
  listenHost: string;
  listenPort: number;
  autoSeed: boolean;
  bodyLimit: number;
  trustProxy: boolean;
  webOrigin: string;
  configuredCorsOrigins: ReadonlySet<string>;
  sessionCookie: string;
  sessionDays: number;
  sessionSecure: boolean;
  rateLimitEnabled: boolean;
  authRequired: boolean;
  devLoginEnabled: boolean;
  requestTimeoutMs: number;
  shutdownTimeoutMs: number;
  databaseBootstrapLockTimeoutMs: number;
  apiRateLimitMax: number;
  apiRateLimitWindowMs: number;
  authRateLimitMax: number;
  sessionIdleHours: number;
  sessionMaxPerUser: number;
  securityHeadersEnabled: boolean;
  requireMutationOrigin: boolean;
  requireDiscordLink: boolean;
  uploadLimitBytes: number;
  avatarUploadLimitBytes: number;
  allowExecutableUploads: boolean;
  backupVerifyAfterCreate: boolean;
  sessionSecret: string;
  authSecret: string;
};

const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

const DEFAULT_SESSION_SECRET = "local-cluster-session-secret-change-me";
const DEFAULT_AUTH_SECRET = "local-cluster-auth-secret-change-me";

function resolveWorkspaceRoot(cwd: string) {
  if (
    path.basename(cwd) === "server" &&
    path.basename(path.dirname(cwd)) === "apps"
  ) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}


function resolveBootConfigPath(workspaceRoot: string, env: NodeJS.ProcessEnv) {
  if (env.CLUSTER_CONFIG_FILE) return path.resolve(env.CLUSTER_CONFIG_FILE);
  return path.join(workspaceRoot, "cluster.config.json");
}

function readBootSettings(configPath: string): {
  settings: BootSettings;
  warning: string | null;
} {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Number(parsed.version) !== 2 ||
      parsed.secretPolicy !== "server-managed-only" ||
      !parsed.settings ||
      typeof parsed.settings !== "object" ||
      Array.isArray(parsed.settings)
    ) {
      return {
        settings: {},
        warning: `Cluster config ${configPath} must use schema version 2 with server-managed-only secret policy.`,
      };
    }
    const decoded = { ...(parsed.settings as BootSettings) };
    for (const key of BOOT_SECRET_SETTING_KEYS) {
      const stored = decoded[key];
      if (typeof stored !== "string" || !stored) continue;
      try {
        if (!isEncryptedValue(stored)) {
          return {
            settings: {},
            warning: `Cluster config ${configPath} contains plaintext protected setting ${key}.`,
          };
        }
        const raw = decryptBootSettingStorageValue(key, stored);
        decoded[key] = JSON.parse(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown secret-decryption error";
        return { settings: {}, warning: `Cluster config ${configPath} contains an unreadable protected setting (${key}): ${message}` };
      }
    }
    return { settings: decoded, warning: null };
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (code === "ENOENT") return { settings: {}, warning: null };
    const message =
      error instanceof Error ? error.message : "Unknown configuration error";
    return {
      settings: {},
      warning: `Cluster config ${configPath} could not be read: ${message}`,
    };
  }
}

function setting(settings: BootSettings, key: string) {
  return settings[key];
}

function finiteNumber(
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number; integer?: boolean } = {},
) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (options.integer) result = Math.trunc(result);
  if (options.min !== undefined) result = Math.max(options.min, result);
  if (options.max !== undefined) result = Math.min(options.max, result);
  return result;
}

function envOrSetting(
  env: NodeJS.ProcessEnv,
  envKey: string,
  settings: BootSettings,
  settingKey: string,
) {
  const envValue = env[envKey];
  return envValue !== undefined && envValue !== ""
    ? envValue
    : setting(settings, settingKey);
}

function booleanFromEnvOrSetting(
  env: NodeJS.ProcessEnv,
  envKey: string,
  settings: BootSettings,
  settingKey: string,
  fallback: boolean,
) {
  const envValue = env[envKey];
  if (envValue !== undefined && envValue !== "")
    return booleanSetting(envValue, fallback);
  return booleanSetting(setting(settings, settingKey), fallback);
}

function normalizeOrigin(value: string, label: string) {
  const normalized = validateCorsOrigins(value);
  if (!normalized || normalized.includes(","))
    throw new Error(`${label} must contain exactly one HTTP(S) origin.`);
  return normalized;
}

export function loadRuntimeConfig(
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    version?: string;
  } = {},
): RuntimeConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const clusterVersion = options.version ?? "1.0.4";
  const nodeEnv =
    String(env.NODE_ENV || "development")
      .trim()
      .toLowerCase() || "development";
  const hostRuntime = String(env.CLUSTER_HOST_RUNTIME || "").trim().toLowerCase();
  const requestedProfile = String(env.CLUSTER_RUNTIME_PROFILE || "").trim().toLowerCase();
  if (requestedProfile && !["development", "managed-host", "direct-production"].includes(requestedProfile)) {
    throw new Error(`Unsupported CLUSTER_RUNTIME_PROFILE: ${requestedProfile}`);
  }
  const runtimeProfile: RuntimeProfile = nodeEnv !== "production"
    ? "development"
    : requestedProfile === "managed-host" || (!requestedProfile && hostRuntime === "go")
      ? "managed-host"
      : "direct-production";
  if (runtimeProfile === "managed-host" && hostRuntime !== "go") {
    throw new Error("Managed-host runtime requires CLUSTER_HOST_RUNTIME=go.");
  }
  const bootWorkspaceRoot = resolveWorkspaceRoot(cwd);
  const bootConfigFilePath = resolveBootConfigPath(bootWorkspaceRoot, env);
  const boot = readBootSettings(bootConfigFilePath);
  if (nodeEnv === "production" && boot.warning) throw new Error(boot.warning);
  const bootSettings = boot.settings;
  const listenHost =
    String(
      env.HOST || setting(bootSettings, "serverHost") || "0.0.0.0",
    ).trim() || "0.0.0.0";
  const listenPort = finiteNumber(
    env.PORT ?? setting(bootSettings, "serverPort"),
    4000,
    { min: 1, max: 65_535, integer: true },
  );

  const webOrigin = normalizeOrigin(
    String(
      env.WEB_ORIGIN ||
        setting(bootSettings, "publicWebUrl") ||
        "http://localhost:3000",
    ),
    "WEB_ORIGIN",
  );
  const configuredOrigins = String(
    env.CLUSTER_CORS_ORIGINS || setting(bootSettings, "corsOrigins") || "",
  );
  const normalizedConfiguredOrigins = validateCorsOrigins(configuredOrigins)
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (runtimeProfile === "direct-production") {
    const loopbackOrigins = normalizedConfiguredOrigins.filter((origin) => {
      const hostname = new URL(origin).hostname;
      return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1"
      );
    });
    if (loopbackOrigins.length) {
      throw new Error(
        `Production CORS origins cannot include loopback addresses: ${loopbackOrigins.join(", ")}`,
      );
    }
  }
  const configuredCorsOrigins = new Set<string>([
    ...(runtimeProfile === "development" ? LOCAL_DEV_ORIGINS : []),
    webOrigin,
    ...(runtimeProfile === "managed-host" ? [] : normalizedConfiguredOrigins),
  ]);

  const configuredBodyLimitMb = finiteNumber(
    setting(bootSettings, "requestBodyLimitMb") ??
      setting(bootSettings, "uploadLimitMb"),
    512,
    { min: 1, max: 2048 },
  );
  const bodyLimit = finiteNumber(
    env.CLUSTER_BODY_LIMIT_BYTES ?? configuredBodyLimitMb * 1024 * 1024,
    512 * 1024 * 1024,
    { min: 1024 * 1024, max: 2 * 1024 * 1024 * 1024, integer: true },
  );

  const configuredSessionDays = finiteNumber(
    envOrSetting(env, "SESSION_DAYS", bootSettings, "sessionDays"),
    7,
    { min: 1, max: 365, integer: true },
  );
  const sessionDays = configuredSessionDays;
  const sessionSecure = booleanFromEnvOrSetting(
    env,
    "SESSION_SECURE",
    bootSettings,
    "sessionSecure",
    runtimeProfile === "direct-production",
  );
  const rateLimitEnabled = booleanFromEnvOrSetting(
    env,
    "CLUSTER_RATE_LIMIT",
    bootSettings,
    "rateLimitEnabled",
    true,
  );
  const authRequired = booleanFromEnvOrSetting(
    env,
    "CLUSTER_REQUIRE_AUTH",
    bootSettings,
    "authRequired",
    true,
  );
  const devLoginEnabled = booleanFromEnvOrSetting(
    env,
    "CLUSTER_DEV_LOGIN",
    bootSettings,
    "devLoginEnabled",
    false,
  );
  const requestTimeoutMs = finiteNumber(
    env.CLUSTER_EXTERNAL_TIMEOUT_MS ??
      finiteNumber(setting(bootSettings, "requestTimeoutSeconds"), 15, {
        min: 1,
        max: 120,
      }) * 1000,
    15_000,
    { min: 1_000, max: 120_000, integer: true },
  );
  const shutdownTimeoutMs = finiteNumber(
    envOrSetting(env, "CLUSTER_SHUTDOWN_TIMEOUT_MS", bootSettings, "shutdownTimeoutMs"),
    30_000,
    { min: 5_000, max: 120_000, integer: true },
  );
  const databaseBootstrapLockTimeoutMs = finiteNumber(
    envOrSetting(env, "CLUSTER_DATABASE_BOOTSTRAP_LOCK_TIMEOUT_MS", bootSettings, "databaseBootstrapLockTimeoutMs"),
    60_000,
    { min: 5_000, max: 300_000, integer: true },
  );
  // Earlier native/web configuration surfaces persisted 10 or 120 as their
  // bootstrap defaults. Both values make normal multi-widget navigation unusable.
  // Correct only those obsolete defaults; an explicit environment override is
  // intentional and remains authoritative (useful for load/abuse testing).
  const rawConfiguredApiBudget = envOrSetting(env, "CLUSTER_RATE_LIMIT_MAX", bootSettings, "rateLimitMax");
  const apiRateLimitMax = !String(env.CLUSTER_RATE_LIMIT_MAX ?? "").trim()
    && (Number(rawConfiguredApiBudget) === 10 || Number(rawConfiguredApiBudget) === 120)
    ? 12_000
    : finiteNumber(rawConfiguredApiBudget, 12_000, { min: 10, max: 100_000, integer: true });
  const apiRateLimitWindowMs = finiteNumber(
    env.CLUSTER_RATE_LIMIT_WINDOW_MS ??
      finiteNumber(setting(bootSettings, "rateLimitWindowMinutes"), 1, {
        min: 1 / 6,
        max: 60,
      }) * 60_000,
    60_000,
    { min: 10_000, max: 60 * 60_000, integer: true },
  );
  const authRateLimitMax = finiteNumber(
    envOrSetting(
      env,
      "CLUSTER_AUTH_RATE_LIMIT_MAX",
      bootSettings,
      "authRateLimitMax",
    ),
    12,
    { min: 3, max: 10_000, integer: true },
  );
  const configuredSessionIdleHours = finiteNumber(
    envOrSetting(
      env,
      "CLUSTER_SESSION_IDLE_HOURS",
      bootSettings,
      "sessionIdleHours",
    ),
    12,
    { min: 1, max: 8760, integer: true },
  );
  const sessionIdleHours = env.CLUSTER_SESSION_IDLE_HOURS ? configuredSessionIdleHours : configuredSessionIdleHours === 168 ? 12 : configuredSessionIdleHours;
  const configuredSessionMaxPerUser = finiteNumber(
    envOrSetting(
      env,
      "CLUSTER_SESSION_MAX_PER_USER",
      bootSettings,
      "sessionMaxPerUser",
    ),
    5,
    { min: 1, max: 100, integer: true },
  );
  const sessionMaxPerUser = env.CLUSTER_SESSION_MAX_PER_USER ? configuredSessionMaxPerUser : configuredSessionMaxPerUser === 10 ? 5 : configuredSessionMaxPerUser;
  const securityHeadersEnabled = booleanFromEnvOrSetting(
    env,
    "CLUSTER_SECURITY_HEADERS",
    bootSettings,
    "securityHeadersEnabled",
    true,
  );
  const requireMutationOrigin = booleanFromEnvOrSetting(
    env,
    "CLUSTER_REQUIRE_MUTATION_ORIGIN",
    bootSettings,
    "requireMutationOrigin",
    true,
  );
  const requireDiscordLink = booleanFromEnvOrSetting(
    env,
    "CLUSTER_REQUIRE_DISCORD_LINK",
    bootSettings,
    "requireDiscordLink",
    false,
  );
  const uploadLimitBytes = finiteNumber(
    env.CLUSTER_UPLOAD_LIMIT_BYTES ??
      finiteNumber(setting(bootSettings, "uploadLimitMb"), 512, {
        min: 1,
        max: 2048,
      }) *
        1024 *
        1024,
    512 * 1024 * 1024,
    { min: 1024 * 1024, max: 2 * 1024 * 1024 * 1024, integer: true },
  );
  const avatarUploadLimitBytes = finiteNumber(
    env.CLUSTER_AVATAR_UPLOAD_LIMIT_BYTES ??
      finiteNumber(setting(bootSettings, "avatarUploadLimitMb"), 5, {
        min: 0.25,
        max: 50,
      }) *
        1024 *
        1024,
    5 * 1024 * 1024,
    { min: 256 * 1024, max: 50 * 1024 * 1024, integer: true },
  );
  const allowExecutableUploads = booleanFromEnvOrSetting(
    env,
    "CLUSTER_ALLOW_EXECUTABLE_UPLOADS",
    bootSettings,
    "allowExecutableUploads",
    false,
  );
  const backupVerifyAfterCreate = booleanFromEnvOrSetting(
    env,
    "CLUSTER_BACKUP_VERIFY_AFTER_CREATE",
    bootSettings,
    "backupVerifyAfterCreate",
    true,
  );
  const sessionSecret =
    env.SESSION_SECRET || env.CLUSTER_SECRET_KEY || DEFAULT_SESSION_SECRET;
  const authSecret =
    env.CLUSTER_AUTH_SECRET ||
    env.CLUSTER_SECRET_KEY ||
    env.SESSION_SECRET ||
    DEFAULT_AUTH_SECRET;

  validateSecretEncryptionConfiguration({
    nodeEnv,
    env,
    sessionSecret: env.SESSION_SECRET,
    authSecret: env.CLUSTER_AUTH_SECRET,
  });

  validateProductionAuthConfiguration({
    nodeEnv,
    runtimeProfile,
    listenHost,
    sessionSecret: env.SESSION_SECRET,
    authSecret: env.CLUSTER_AUTH_SECRET,
    authRequired,
    devLoginEnabled,
    sessionSecure,
    rateLimitEnabled,
    securityHeadersEnabled,
    requireMutationOrigin,
    requireDiscordLink,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordClientSecret: env.DISCORD_CLIENT_SECRET,
    discordRedirectUri: env.DISCORD_REDIRECT_URI,
    webOrigin,
  });

  const logLevel =
    String(
      env.CLUSTER_LOG_LEVEL || setting(bootSettings, "logLevel") || "info",
    ).trim() || "info";
  const enableRequestLogs = booleanFromEnvOrSetting(
    env,
    "CLUSTER_ENABLE_REQUEST_LOGS",
    bootSettings,
    "enableRequestLogs",
    false,
  );
  const autoSeed = booleanFromEnvOrSetting(
    env,
    "CLUSTER_AUTO_SEED",
    bootSettings,
    "autoSeed",
    false,
  );

  return {
    clusterVersion,
    nodeEnv,
    runtimeProfile,
    bootWorkspaceRoot,
    bootConfigFilePath,
    bootSettings,
    bootConfigWarning: boot.warning,
    fastifyLogger: logLevel === "silent" ? false : {
      level: logLevel,
      redact: {
        paths: [
          "req.headers.authorization", "req.headers.cookie", "req.headers.set-cookie",
          "res.headers.set-cookie", "headers.authorization", "headers.cookie",
          "password", "pin", "token", "secret", "apiKey", "webhookUrl",
          "discordWebhookUrl", "discordBotToken", "databaseUrlOverride", "databaseUrl", "redisUrlOverride", "redisUrl",
          "*.password", "*.pin", "*.token", "*.secret", "*.apiKey", "*.webhookUrl",
          "*.discordWebhookUrl", "*.discordBotToken", "*.databaseUrlOverride", "*.databaseUrl", "*.redisUrlOverride", "*.redisUrl",
          "req.body.discordWebhookUrl", "req.body.discordBotToken", "req.body.databaseUrlOverride", "req.body.redisUrlOverride",
        ],
        censor: "[REDACTED]",
      },
    },
    disableRequestLogging: !enableRequestLogs,
    listenHost,
    listenPort,
    autoSeed,
    bodyLimit,
    trustProxy: booleanFromEnvOrSetting(
      env,
      "CLUSTER_TRUST_PROXY",
      bootSettings,
      "trustedProxy",
      runtimeProfile === "managed-host",
    ),
    webOrigin,
    configuredCorsOrigins,
    sessionCookie: sessionSecure ? "__Host-cluster_session" : "cluster_session",
    sessionDays,
    sessionSecure,
    rateLimitEnabled,
    authRequired,
    devLoginEnabled,
    requestTimeoutMs,
    shutdownTimeoutMs,
    databaseBootstrapLockTimeoutMs,
    apiRateLimitMax,
    apiRateLimitWindowMs,
    authRateLimitMax,
    sessionIdleHours,
    sessionMaxPerUser,
    securityHeadersEnabled,
    requireMutationOrigin,
    requireDiscordLink,
    uploadLimitBytes,
    avatarUploadLimitBytes,
    allowExecutableUploads,
    backupVerifyAfterCreate,
    sessionSecret,
    authSecret,
  };
}
