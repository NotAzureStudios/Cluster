export type ClusterRuntimeAccessMode = "normal" | "maintenance" | "read-only" | "recovery";

export type ClusterRuntimeRequestDecision = {
  allowed: boolean;
  code?: "SERVER_MAINTENANCE" | "SERVER_READ_ONLY" | "SERVER_RECOVERY_HOLD";
  status?: 423 | 503;
  error?: string;
  action?: string;
  retryable?: boolean;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function normalizeClusterRuntimeAccessMode(value: unknown): ClusterRuntimeAccessMode {
  const normalized = String(value || "normal").trim().toLowerCase();
  if (normalized === "maintenance") return "maintenance";
  if (normalized === "read-only" || normalized === "readonly" || normalized === "read_only") return "read-only";
  if (normalized === "recovery" || normalized === "restore" || normalized === "recovery-hold") return "recovery";
  return "normal";
}

export function runtimeAccessModeFromEnvironment(env: NodeJS.ProcessEnv = process.env): ClusterRuntimeAccessMode {
  return normalizeClusterRuntimeAccessMode(env.CLUSTER_SERVER_MODE || env.CLUSTER_RUNTIME_MODE || "normal");
}

/** A held server must retain ONLY the diagnostics and sign-in required for
 * an authorized operator to investigate. A URL prefix does not authorize a
 * mutation: normal route authentication/permission checks remain mandatory.
 */
function isControlPlaneReadPath(pathname: string): boolean {
  const path = String(pathname || "/");
  return path === "/health" || path.startsWith("/health/")
    || path === "/api/meta" || path.startsWith("/api/meta/")
    || path === "/api/me" || path === "/api/setup/status"
    || path === "/api/auth/config" || path === "/api/auth/csrf" || path === "/api/auth/mfa/status"
    || /^\/api\/admin\/(operations|backups|maintenance)(?:\/|$)/.test(path);
}

const HELD_AUTH_ACTIONS = new Set([
  "/api/auth/login", "/api/auth/logout", "/api/auth/reauth",
  "/api/auth/passkeys/login/start", "/api/auth/passkeys/login/verify",
  "/api/auth/reauth/passkey/start", "/api/auth/reauth/passkey/verify",
  "/api/auth/mfa/challenge",
  "/api/auth/desktop-session-code", "/api/auth/desktop-session-redeem",
]);

function isExplicitHeldControlAction(pathname: string, method: string): boolean {
  if (method !== "POST") return false;
  if (HELD_AUTH_ACTIONS.has(pathname)) return true;
  // Existing endpoint performs an authenticated bounded local-only diagnostic.
  if (pathname === "/api/admin/operations/api-tools/check") return true;
  // Responders must be able to acknowledge a canonical incident even during
  // maintenance. The route enforces responder/administrator authorization.
  if (/^\/api\/admin\/operations\/incidents\/[^/]+\/acknowledge$/.test(pathname)) return true;
  return false;
}

export function runtimeRequestDecision(input: { mode: ClusterRuntimeAccessMode; pathname: string; method: string }): ClusterRuntimeRequestDecision {
  const method = String(input.method || "GET").toUpperCase();
  if (input.mode === "normal") return { allowed: true };
  if (method === "OPTIONS") return { allowed: true };
  if ((method === "GET" || method === "HEAD") && isControlPlaneReadPath(input.pathname)) return { allowed: true };
  if (isExplicitHeldControlAction(input.pathname, method)) return { allowed: true };

  if (input.mode === "read-only") {
    if (SAFE_METHODS.has(method)) return { allowed: true };
    return {
      allowed: false,
      code: "SERVER_READ_ONLY",
      status: 423,
      error: "Cluster is temporarily read-only. This change was not accepted.",
      action: "Keep local work queued and retry after the server returns to normal write mode.",
      retryable: true,
    };
  }

  if (input.mode === "maintenance") {
    return {
      allowed: false,
      code: "SERVER_MAINTENANCE",
      status: 503,
      error: "Cluster is in maintenance mode and is not accepting workspace traffic.",
      action: "Reconnect after maintenance completes. Local changes should remain queued until then.",
      retryable: true,
    };
  }

  return {
    allowed: false,
    code: "SERVER_RECOVERY_HOLD",
    status: 503,
    error: "Cluster is in recovery mode and workspace access is temporarily held.",
    action: "Do not replay queued changes until recovery completes and the server reports normal or read-only mode.",
    retryable: true,
  };
}

export function publicServerRuntimeState(input: { ready: boolean; draining: boolean; mode: ClusterRuntimeAccessMode }) {
  if (input.draining) return "draining" as const;
  if (input.mode === "maintenance") return "maintenance" as const;
  if (input.mode === "read-only") return "read-only" as const;
  if (input.mode === "recovery") return "recovery" as const;
  return input.ready ? "healthy" as const : "starting" as const;
}
