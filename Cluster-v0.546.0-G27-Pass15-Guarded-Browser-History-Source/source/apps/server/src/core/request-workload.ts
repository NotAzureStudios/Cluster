import { availableParallelism } from "node:os";
import { Transform, type TransformCallback } from "node:stream";

export type RequestWorkClass = "normal" | "heavy" | "critical";

export type RequestWorkPolicy = {
  cost: number;
  workClass: RequestWorkClass;
  bodyLimitBytes: number;
};

const KIB = 1024;
const MIB = 1024 * KIB;

function upper(method: string) {
  return String(method || "GET").toUpperCase();
}

const AUTH_TRANSPORT_LIMITED_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/passkeys/login/start",
  "/api/auth/passkeys/login/verify",
  "/api/auth/mfa/challenge",
  "/api/auth/reauth",
  "/api/auth/session-password",
  "/api/auth/dev-login",
]);

export type AuthTransportRateLimitPolicy = {
  bucketName: "auth-transport" | "security-transport";
  limit: number;
};

export function authTransportRateLimitPolicy(input: {
  pathname: string;
  method: string;
  authRateLimitMax: number;
}): AuthTransportRateLimitPolicy | null {
  const method = upper(input.method);
  const configuredLimit = Math.max(1, Math.trunc(input.authRateLimitMax || 1));
  const securityMutation =
    ((input.pathname === "/api/admin/security/policy" && method === "PUT") ||
      (input.pathname === "/api/admin/security/secrets/rewrap" && method === "POST") ||
      (input.pathname === "/api/admin/security/credentials" && method === "POST") ||
      (/^\/api\/admin\/security\/credentials\/[^/]+\/rotate$/.test(input.pathname) && method === "POST") ||
      (/^\/api\/admin\/security\/credentials\/[^/]+$/.test(input.pathname) && method === "DELETE") ||
      (/^\/api\/admin\/integrations\/webhooks(?:\/[^/]+(?:\/rotate-secret|\/test)?|\/deliveries\/[^/]+\/retry)?$/.test(input.pathname) && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (/^\/api\/(?:admin\/devices\/[^/]+\/[^/]+|me\/devices\/[^/]+)$/.test(input.pathname) && method === "DELETE") ||
      (/^\/api\/auth\/mfa\/(?:enroll\/(?:start|verify)|recovery\/regenerate|disable)$/.test(input.pathname) && method === "POST"));
  if (securityMutation) {
    return { bucketName: "security-transport", limit: Math.max(12, Math.min(120, configuredLimit * 2)) };
  }
  if (method !== "POST" || !AUTH_TRANSPORT_LIMITED_PATHS.has(input.pathname)) return null;
  return {
    bucketName: "auth-transport",
    limit: Math.max(60, Math.min(1_000, configuredLimit * 10)),
  };
}


export type UserScopedRateLimitPolicy = {
  bucketName: "search-user" | "comment-user" | "upload-user" | "export-user";
  limit: number;
};

export function userScopedRateLimitPolicy(input: { pathname: string; method: string; apiRateLimitMax: number }): UserScopedRateLimitPolicy | null {
  const method = upper(input.method);
  const max = Math.max(60, Math.trunc(input.apiRateLimitMax || 60));
  if (input.pathname === "/api/command/search" && ["GET", "POST"].includes(method)) {
    return { bucketName: "search-user", limit: Math.max(120, Math.min(1_200, Math.floor(max / 5))) };
  }
  if ((input.pathname === "/api/entity-comments" || /^\/api\/entity-comments\/[^/]+$/.test(input.pathname) || input.pathname.startsWith("/api/shared-work/")) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { bucketName: "comment-user", limit: Math.max(60, Math.min(300, Math.floor(max / 20))) };
  }
  if ((/^\/api\/projects\/[^/]+\/(?:files|review-assets)$/.test(input.pathname) || input.pathname === "/api/library/upload") && method === "POST") {
    return { bucketName: "upload-user", limit: Math.max(30, Math.min(120, Math.floor(max / 50))) };
  }
  if (/(?:\/export$|\/status-reports\/generate$)/.test(input.pathname) && ["GET", "POST"].includes(method)) {
    return { bucketName: "export-user", limit: Math.max(20, Math.min(90, Math.floor(max / 100))) };
  }
  return null;
}

function base64EnvelopeLimit(rawBytes: number, globalLimit: number) {
  return Math.min(globalLimit, Math.ceil(rawBytes * 4 / 3) + 2 * MIB);
}

export function requestWorkPolicy(input: {
  pathname: string;
  method: string;
  globalBodyLimitBytes: number;
  uploadLimitBytes: number;
  avatarUploadLimitBytes: number;
}): RequestWorkPolicy {
  const path = input.pathname;
  const method = upper(input.method);
  const globalLimit = Math.max(MIB, input.globalBodyLimitBytes);

  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    const critical = /\/api\/admin\/(?:diagnostics\/bundle|backups(?:\/[^/]+\/(?:verify|restore-drill))?|storage\/verify)/.test(path);
    const heavy = critical || /(?:\/export$|\/model-preview$|\/api\/command\/search$|\/api\/security\/events\/integrity$)/.test(path);
    return { cost: critical ? 12 : heavy ? 6 : 1, workClass: critical ? "critical" : heavy ? "heavy" : "normal", bodyLimitBytes: 64 * KIB };
  }

  // Signed MSI publishing is explicitly privileged and bounded separately
  // from ordinary API JSON. Admission still enforces the configured global cap.
  if (method === "POST" && /^\/api\/admin\/packages\/[^/]+\/releases$/.test(path)) {
    return { cost: 12, workClass: "critical", bodyLimitBytes: Math.min(globalLimit, 46 * MIB) };
  }

  if (/\/api\/uploads\/[^/]+\/chunks$/.test(path) && method === "PUT") {
    return { cost: 4, workClass: "heavy", bodyLimitBytes: Math.min(globalLimit, 9 * MIB) };
  }

  if (/\/api\/(?:users\/me\/avatar|admin\/users\/[^/]+\/avatar|admin\/branding\/logo)$/.test(path)) {
    return { cost: 4, workClass: "heavy", bodyLimitBytes: base64EnvelopeLimit(input.avatarUploadLimitBytes, globalLimit) };
  }

  if (/\/api\/(?:public\/copyright\/reports|copyright\/cases\/[^/]+\/counter-notice)$/.test(path)) {
    return { cost: 6, workClass: "heavy", bodyLimitBytes: Math.min(globalLimit, 18 * MIB) };
  }

  if (/\/api\/library\/[^/]+\/model-thumbnail$/.test(path)) {
    return { cost: 4, workClass: "heavy", bodyLimitBytes: Math.min(globalLimit, 8 * MIB) };
  }

  if (/\/api\/admin\/(?:backups\/now|backups\/[^/]+\/(?:verify|restore-drill)|storage\/verify)$/.test(path)) {
    return { cost: 12, workClass: "critical", bodyLimitBytes: Math.min(globalLimit, 512 * KIB) };
  }

  if (/\/api\/(?:sync\/batch|knowledge\/bulk|persistence\/bulk-status|context-packs\/import|discord\/(?:messages|forums)\/import)/.test(path)) {
    return { cost: 6, workClass: "heavy", bodyLimitBytes: Math.min(globalLimit, 16 * MIB) };
  }

  if (/(?:\/export$|\/status-reports\/generate$|\/control-center\/sync-timeline$|\/automation\/tickets\/preview$)/.test(path)) {
    return { cost: 6, workClass: "heavy", bodyLimitBytes: Math.min(globalLimit, 4 * MIB) };
  }

  return { cost: method === "DELETE" ? 2 : 2, workClass: "normal", bodyLimitBytes: Math.min(globalLimit, 2 * MIB) };
}

export class ConcurrentWorkLimiter {
  private heavyGlobal = 0;
  private criticalGlobal = 0;
  private readonly heavyClients = new Map<string, number>();
  private readonly criticalClients = new Map<string, number>();
  private readonly heavyWorkspaces = new Map<string, number>();
  private readonly criticalWorkspaces = new Map<string, number>();

  private readonly limits: {
    heavyGlobal: number;
    heavyPerClient: number;
    heavyPerWorkspace: number;
    criticalGlobal: number;
    criticalPerClient: number;
    criticalPerWorkspace: number;
  };
  private capacityScale = 1;

  constructor(limits: Partial<{
    heavyGlobal: number;
    heavyPerClient: number;
    heavyPerWorkspace: number;
    criticalGlobal: number;
    criticalPerClient: number;
    criticalPerWorkspace: number;
  }> = {}) {
    const parallelism = Math.max(1, availableParallelism());
    this.limits = {
      heavyGlobal: Math.max(8, Math.round(limits.heavyGlobal ?? parallelism * 4)),
      heavyPerClient: Math.max(1, Math.round(limits.heavyPerClient ?? 3)),
      heavyPerWorkspace: Math.max(2, Math.round(limits.heavyPerWorkspace ?? parallelism * 2)),
      criticalGlobal: Math.max(2, Math.round(limits.criticalGlobal ?? Math.ceil(parallelism / 2))),
      criticalPerClient: Math.max(1, Math.round(limits.criticalPerClient ?? 1)),
      criticalPerWorkspace: Math.max(1, Math.round(limits.criticalPerWorkspace ?? Math.ceil(parallelism / 3))),
    };
  }

  setCapacityScale(scale: number) {
    this.capacityScale = Math.max(.1, Math.min(1, Number.isFinite(scale) ? scale : 1));
  }

  acquire(workClass: RequestWorkClass, keys: { clientKey: string; workspaceKey?: string | null }): (() => void) | null {
    if (workClass === "normal") return () => undefined;
    const critical = workClass === "critical";
    const clientMap = critical ? this.criticalClients : this.heavyClients;
    const workspaceMap = critical ? this.criticalWorkspaces : this.heavyWorkspaces;
    const global = critical ? this.criticalGlobal : this.heavyGlobal;
    const baseGlobalLimit = critical ? this.limits.criticalGlobal : this.limits.heavyGlobal;
    const globalLimit = Math.max(1, Math.floor(baseGlobalLimit * this.capacityScale));
    const clientLimit = critical ? this.limits.criticalPerClient : this.limits.heavyPerClient;
    const baseWorkspaceLimit = critical ? this.limits.criticalPerWorkspace : this.limits.heavyPerWorkspace;
    const workspaceLimit = Math.max(1, Math.min(globalLimit, Math.floor(baseWorkspaceLimit * this.capacityScale)));
    const clientKey = String(keys.clientKey || "anonymous");
    const workspaceKey = keys.workspaceKey ? String(keys.workspaceKey) : null;
    const clientCount = clientMap.get(clientKey) || 0;
    const workspaceCount = workspaceKey ? workspaceMap.get(workspaceKey) || 0 : 0;
    if (global >= globalLimit || clientCount >= clientLimit || (workspaceKey && workspaceCount >= workspaceLimit)) return null;

    if (critical) this.criticalGlobal += 1; else this.heavyGlobal += 1;
    clientMap.set(clientKey, clientCount + 1);
    if (workspaceKey) workspaceMap.set(workspaceKey, workspaceCount + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (critical) this.criticalGlobal = Math.max(0, this.criticalGlobal - 1); else this.heavyGlobal = Math.max(0, this.heavyGlobal - 1);
      const nextClient = Math.max(0, (clientMap.get(clientKey) || 1) - 1);
      if (nextClient) clientMap.set(clientKey, nextClient); else clientMap.delete(clientKey);
      if (workspaceKey) {
        const nextWorkspace = Math.max(0, (workspaceMap.get(workspaceKey) || 1) - 1);
        if (nextWorkspace) workspaceMap.set(workspaceKey, nextWorkspace); else workspaceMap.delete(workspaceKey);
      }
    };
  }

  stats() {
    return {
      heavyInFlight: this.heavyGlobal,
      criticalInFlight: this.criticalGlobal,
      capacityScale: this.capacityScale,
      limits: { ...this.limits },
      activeWorkspaces: {
        heavy: this.heavyWorkspaces.size,
        critical: this.criticalWorkspaces.size,
      },
      effectiveLimits: {
        heavyGlobal: Math.max(1, Math.floor(this.limits.heavyGlobal * this.capacityScale)),
        heavyPerWorkspace: Math.max(1, Math.floor(this.limits.heavyPerWorkspace * this.capacityScale)),
        criticalGlobal: Math.max(1, Math.floor(this.limits.criticalGlobal * this.capacityScale)),
        criticalPerWorkspace: Math.max(1, Math.floor(this.limits.criticalPerWorkspace * this.capacityScale)),
      },
    };
  }
}

export function boundedPayloadStream(payload: NodeJS.ReadableStream, maximumBytes: number) {
  let received = 0;
  const stream = new Transform({
    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      received += bytes;
      (stream as Transform & { receivedEncodedLength: number }).receivedEncodedLength = received;
      if (received > maximumBytes) {
        const error = Object.assign(new Error("Request body exceeds the route-specific Cluster limit."), { statusCode: 413, code: "BODY_TOO_LARGE" });
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  }) as Transform & { receivedEncodedLength: number };
  stream.receivedEncodedLength = 0;
  payload.pipe(stream);
  return stream;
}
