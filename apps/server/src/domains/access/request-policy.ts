import type { ClusterToolPermissionKey } from "@cluster/shared";
export type ToolPermissionLevel = "view" | "edit" | "manage";
export type ResourcePermissionLevel = "view" | "contribute" | "manage";
export type RequestAccessRequirement =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "admin" }
  | { kind: "tool"; tool: ClusterToolPermissionKey; level: ToolPermissionLevel };

export type ClusterRequestPolicy = {
  pathname: string;
  method: string;
  isApi: boolean;
  access: RequestAccessRequirement;
  capability: ClusterToolPermissionKey | null;
  resourceMinimum: ResourcePermissionLevel;
  administrativeMutation: boolean;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function normalizeHttpMethod(method: string) {
  return String(method || "GET").toUpperCase();
}

export function requestCapabilityForPath(pathname: string): ClusterToolPermissionKey | null {
  const path = String(pathname || "/");
  if (path === "/api/me/heartbeat" || path === "/api/security/client-incidents" || path === "/api/team/assignments") return null;

  if (/^\/api\/(?:project-delivery\/build|projects\/[^/]+\/delivery\/build)(?:\/|$)/.test(path)) return "builds";
  if (/^\/api\/(?:project-delivery\/(?:qa-plan|qa-session)|projects\/[^/]+\/delivery\/(?:qa-plan|qa-session))(?:\/|$)/.test(path)) return "qa";
  if (/^\/api\/(?:project-delivery\/release|projects\/[^/]+\/delivery\/release)(?:\/|$)/.test(path)) return "builds";

  if (path.startsWith("/api/tickets")) return "tickets";
  if (/^\/api\/projects\/[^/]+\/boards(?:\/|$)/.test(path)) return "boards";
  if (path.startsWith("/api/boards") || path.startsWith("/api/lists") || path.startsWith("/api/cards") || path.startsWith("/api/checklist")) return "boards";
  if (path.startsWith("/api/whiteboards")) return "whiteboards";
  if (path.startsWith("/api/review-assets") || path.startsWith("/api/review-comments") || /^\/api\/projects\/[^/]+\/(?:media|video-production|review-assets|media-processing)(?:\/|$)/.test(path)) return "viewer";
  if (path.startsWith("/api/project-files") || /\/api\/projects\/[^/]+\/(?:files|assets)/.test(path)) return "library";
  if (path.startsWith("/api/uploads")) return null;
  if (path.startsWith("/api/access-rules")) return "projects";
  if (path.startsWith("/api/projects") || path.startsWith("/api/project-workflows")) return "projects";
  if (path.startsWith("/api/packets")) return "packets";
  if (path.startsWith("/api/me/inventory") || path.startsWith("/api/admin/inventory")) return "inventory";
  if (path.startsWith("/api/admin/vault")) return "vault";
  if (path.startsWith("/api/desktop-libraries") || path.startsWith("/api/library")) return "library";
  if (path.startsWith("/api/calendar")) return "calendar";
  if (path.startsWith("/api/timeline")) return "timeline";
  if (path.startsWith("/api/time") || path.startsWith("/api/schedule")) return "scheduler";
  if (path.startsWith("/api/persistence")) return "serverConfig";
  if (path.startsWith("/api/server-config") || path.startsWith("/api/security")) return "serverConfig";
  if (path.startsWith("/api/admin/users")) return "people";
  if (path.includes("/source-control")) return "sourceControl";
  if (path.startsWith("/api/admin/integrations") || path.startsWith("/api/admin/discord")) return "integrations";
  if (path.startsWith("/api/entity-comments")) return null;
  if (path.startsWith("/api/notifications")) return "inbox";
  if (path.startsWith("/api/activity") || path.startsWith("/api/audit")) return "activity";
  if (path === "/api/users" || path.startsWith("/api/users/activity") || path.startsWith("/api/users/") || path.startsWith("/api/team/")) return "people";
  if (path.startsWith("/api/studio-systems")) return "settings";
  if (path.startsWith("/api/settings") || path.startsWith("/api/automation")) return "settings";
  if (path.startsWith("/api/command/search")) return "mywork";
  return null;
}

function toolRequirement(pathname: string, method: string, tool: ClusterToolPermissionKey | null): RequestAccessRequirement {
  if (!tool) return { kind: "authenticated" };
  if (/^\/api\/projects\/[^/]+$/.test(pathname) && method === "PATCH") return { kind: "tool", tool, level: "view" };
  if (tool === "inbox" && method === "POST" && /^\/api\/notifications\/(?:read|acknowledge|dismiss|restore|snooze)$/.test(pathname)) {
    return { kind: "tool", tool, level: "view" };
  }
  if (UNSAFE_METHODS.has(method)) {
    return { kind: "tool", tool, level: tool === "integrations" || tool === "serverConfig" ? "manage" : "edit" };
  }
  return { kind: "tool", tool, level: "view" };
}

export function isAdministrativeMutation(pathname: string, method: string) {
  const normalizedMethod = normalizeHttpMethod(method);
  if (!UNSAFE_METHODS.has(normalizedMethod)) return false;
  if (pathname.startsWith("/api/admin/") && !pathname.startsWith("/api/admin/integrations/")) return true;
  if (pathname === "/api/projects" && normalizedMethod === "POST") return true;
  if (/^\/api\/projects\/[^/]+$/.test(pathname) && normalizedMethod === "DELETE") return true;
  if (pathname === "/api/users" && normalizedMethod === "POST") return true;
  if (/^\/api\/users\/[^/]+$/.test(pathname) && ["PATCH", "DELETE"].includes(normalizedMethod)) return true;
  return pathname.startsWith("/api/persistence")
    || pathname.startsWith("/api/context-packs")
    || pathname.startsWith("/api/communication");
}

export function isPublicRequest(pathname: string, method = "GET") {
  const path = String(pathname || "/");
  const normalizedMethod = normalizeHttpMethod(method);
  if (["/health", "/health/live", "/health/ready"].includes(path)) return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (path === "/api/meta/compatibility") return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (path === "/api/me") return normalizedMethod === "GET";
  if (path === "/api/auth/config") return normalizedMethod === "GET";
  if (path === "/api/auth/csrf") return normalizedMethod === "GET";
  if (["/api/auth/login", "/api/auth/passkeys/login/start", "/api/auth/passkeys/login/verify", "/api/auth/mfa/challenge", "/api/auth/mfa/passkeys/challenge", "/api/auth/dev-login", "/api/auth/logout", "/api/auth/password-reset-request", "/api/auth/owner-recovery", "/api/auth/desktop-session-redeem"].includes(path)) return normalizedMethod === "POST";
  if (path === "/api/setup/status") return normalizedMethod === "GET";
  if (path === "/api/setup/complete") return normalizedMethod === "POST";
  if (path === "/api/auth/discord/callback" || path === "/api/auth/discord/link") return normalizedMethod === "GET";
  if (["/api/integrations/discord/interactions", "/api/integrations/discord/gateway-relay"].includes(path)) return normalizedMethod === "POST";
  if (path.startsWith("/api/branding/")) return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (path === "/api/kiosk/public") return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (path === "/api/kiosk/admin-exit") return normalizedMethod === "POST";
  if (path.startsWith("/api/public/v1/")) return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod);
  if (["/api/public/legal/privacy", "/api/public/legal/terms", "/api/public/legal/operator-agreement", "/api/public/legal/copyright", "/api/public/legal/security"].includes(path)) return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (["/api/public/privacy/consent-config", "/api/public/privacy/third-parties"].includes(path)) return normalizedMethod === "GET" || normalizedMethod === "HEAD";
  if (path === "/api/public/copyright/reports" || path === "/api/public/copyright/cases/status") return normalizedMethod === "POST";
  if (path.startsWith("/api/public/share/")) return normalizedMethod === "GET";
  return false;
}

/** These paths have their own current, Form-specific reviewer grant at the handler.
 * Keep the Settings capability for kiosk/config gating, but do not reject a
 * delegated reviewer at the coarse tool-permission preHandler.
 */
export function isScopedStudioFormReviewRequest(pathname: string, method: string) {
  const verb = normalizeHttpMethod(method);
  if (verb === "GET" && /^\/api\/studio-systems\/submissions\/[^/]+\/target$/.test(pathname)) return true;
  if (verb === "GET" && /^\/api\/studio-systems\/forms\/[^/]+\/submissions(?:\/[^/]+)?$/.test(pathname)) return true;
  return verb === "PATCH" && /^\/api\/studio-systems\/forms\/[^/]+\/submissions\/[^/]+\/review$/.test(pathname);
}

export function describeClusterRequest(pathname: string, method = "GET"): ClusterRequestPolicy {
  const path = String(pathname || "/");
  const normalizedMethod = normalizeHttpMethod(method);
  const capability = requestCapabilityForPath(path);
  const administrativeMutation = isAdministrativeMutation(path, normalizedMethod);
  let access: RequestAccessRequirement;

  if (isPublicRequest(path, normalizedMethod)) access = { kind: "public" };
  else if (isScopedStudioFormReviewRequest(path, normalizedMethod)) access = { kind: "authenticated" };
  else if (path.startsWith("/api/admin/integrations/")) access = toolRequirement(path, normalizedMethod, capability || "integrations");
  else if (path.startsWith("/api/admin/") || path.startsWith("/api/context-packs") || administrativeMutation) access = { kind: "admin" };
  else access = toolRequirement(path, normalizedMethod, capability);

  return {
    pathname: path,
    method: normalizedMethod,
    isApi: path.startsWith("/api/"),
    access,
    capability,
    resourceMinimum: SAFE_METHODS.has(normalizedMethod) ? "view" : "contribute",
    administrativeMutation,
  };
}
