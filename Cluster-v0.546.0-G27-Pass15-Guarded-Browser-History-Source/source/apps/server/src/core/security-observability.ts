import crypto from "node:crypto";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|session|credential|webhook|pin|codeHash)/i;
const USER_KEY = /(?:userId|actorUserId|targetUserId|email|username|displayName|userAgent|ipAddress|remoteAddress|filesystem|filePath|dataRoot|uploadRoot|configFile|databaseUrl)/i;
const BEARER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi;
const ASSIGNMENT_PATTERN = /\b(password|passwd|secret|token|api[-_]?key|session|pin|credential)\s*[:=]\s*([^\s,;]+)/gi;
const JSON_SECRET_PATTERN = /(["'](?:password|passwd|secret|token|api[-_]?key|session|pin|credential|authorization|cookie)["']\s*:\s*)["'][^"']*["']/gi;
const SECRET_QUERY_PATTERN = /([?&](?:token|access_token|api_key|apikey|secret|code|session|key)=)[^&#\s]+/gi;
const DATABASE_URL_PATTERN = /\b(?:postgres(?:ql)?):\/\/[^\s"']+/gi;
const DISCORD_WEBHOOK_PATTERN = /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\s"'<>|]+\\)*[^\s"'<>|]*/g;
const POSIX_PRIVATE_PATH_PATTERN = /\/(?:home|Users|var|opt|srv|tmp)\/[^\s"']+/g;
const PUBLIC_SHARE_PATH_PATTERN = /\/api\/public\/share\/[^/?#\s"']{20,200}/gi;

export type SecurityTelemetrySnapshot = {
  total: number;
  failures: number;
  byEvent: Array<{ event: string; total: number; failures: number; lastAt: string }>;
  clientIncidents: Array<{
    id: string;
    kind: string;
    severity: "info" | "warning" | "error";
    route: string | null;
    requestId: string | null;
    message: string;
    createdAt: string;
  }>;
};

type SecurityEventMetric = { total: number; failures: number; lastAt: string };

export function createServerRequestId() {
  return crypto.randomUUID();
}

export function sanitizeClientCorrelationId(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 96) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized) ? normalized : null;
}

export function redactSensitiveText(value: unknown) {
  return String(value ?? "")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(ASSIGNMENT_PATTERN, (_match, key) => `${key}=[REDACTED]`)
    .replace(JSON_SECRET_PATTERN, (_match, prefix) => `${prefix}"[REDACTED]"`)
    .replace(SECRET_QUERY_PATTERN, (_match, prefix) => `${prefix}[REDACTED]`)
    .replace(DATABASE_URL_PATTERN, "[REDACTED_DATABASE_URL]")
    .replace(DISCORD_WEBHOOK_PATTERN, REDACTED)
    .replace(PUBLIC_SHARE_PATH_PATTERN, "/api/public/share/[REDACTED]")
    .replace(WINDOWS_PATH_PATTERN, REDACTED)
    .replace(POSIX_PRIVATE_PATH_PATTERN, REDACTED)
    .slice(0, 4_000);
}

function sanitizeValue(value: unknown, options: { diagnostic?: boolean; depth?: number } = {}): unknown {
  const depth = options.depth ?? 0;
  if (depth > 7) return "[TRUNCATED]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return safeErrorForLog(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitizeValue(entry, { ...options, depth: depth + 1 }));
  if (typeof value !== "object") return redactSensitiveText(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (SENSITIVE_KEY.test(key) || (options.diagnostic && USER_KEY.test(key))) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = sanitizeValue(entry, { ...options, depth: depth + 1 });
  }
  return result;
}


export function sanitizeRequestPath(value: unknown, routeTemplate?: unknown) {
  const template = String(routeTemplate || "").split("?")[0].trim();
  if (template && template !== "*") return redactSensitiveText(template).slice(0, 500);
  const pathname = String(value || "").split("?")[0].trim();
  return pathname ? redactSensitiveText(pathname).slice(0, 500) : "/";
}

export function redactForLog(value: unknown) {
  return sanitizeValue(value, { diagnostic: false });
}

export function sanitizeDiagnosticBundle(value: unknown) {
  return sanitizeValue(value, { diagnostic: true });
}

export function safeErrorForLog(error: unknown) {
  if (!(error instanceof Error)) return { message: redactSensitiveText(error) };
  const candidate = error as Error & { code?: unknown; statusCode?: unknown; cause?: unknown };
  return {
    name: redactSensitiveText(candidate.name),
    message: redactSensitiveText(candidate.message),
    code: candidate.code == null ? undefined : redactSensitiveText(candidate.code),
    statusCode: typeof candidate.statusCode === "number" ? candidate.statusCode : undefined,
    stack: candidate.stack ? redactSensitiveText(candidate.stack).split("\n").slice(0, 16).join("\n") : undefined,
    cause: candidate.cause ? sanitizeValue(candidate.cause, { diagnostic: true, depth: 1 }) : undefined,
  };
}

export class SecurityTelemetry {
  private total = 0;
  private failures = 0;
  private readonly events = new Map<string, SecurityEventMetric>();
  private readonly incidents: SecurityTelemetrySnapshot["clientIncidents"] = [];

  constructor(private readonly options: { maxEvents?: number; maxIncidents?: number } = {}) {}

  record(event: string, result: "SUCCESS" | "FAILURE" = "SUCCESS") {
    const key = String(event || "security.unknown").trim().slice(0, 100) || "security.unknown";
    const now = new Date().toISOString();
    this.total += 1;
    if (result === "FAILURE") this.failures += 1;
    if (!this.events.has(key) && this.events.size >= (this.options.maxEvents ?? 128)) {
      const oldest = this.events.keys().next().value;
      if (oldest) this.events.delete(oldest);
    }
    const metric = this.events.get(key) || { total: 0, failures: 0, lastAt: now };
    metric.total += 1;
    if (result === "FAILURE") metric.failures += 1;
    metric.lastAt = now;
    this.events.set(key, metric);
  }

  recordClientIncident(input: {
    kind: string;
    severity?: "info" | "warning" | "error";
    route?: string | null;
    requestId?: string | null;
    message: string;
  }) {
    const incident = {
      id: crypto.randomUUID(),
      kind: String(input.kind || "client.error").trim().slice(0, 80) || "client.error",
      severity: input.severity || "error",
      route: input.route ? redactSensitiveText(input.route).split("?")[0].slice(0, 180) : null,
      requestId: sanitizeClientCorrelationId(input.requestId),
      message: redactSensitiveText(input.message).slice(0, 800),
      createdAt: new Date().toISOString(),
    };
    this.incidents.push(incident);
    const limit = this.options.maxIncidents ?? 100;
    if (this.incidents.length > limit) this.incidents.splice(0, this.incidents.length - limit);
    this.record(input.kind || "client.error", input.severity === "error" ? "FAILURE" : "SUCCESS");
    return incident;
  }

  snapshot(): SecurityTelemetrySnapshot {
    return {
      total: this.total,
      failures: this.failures,
      byEvent: [...this.events.entries()]
        .map(([event, metric]) => ({ event, ...metric }))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
        .slice(0, 50),
      clientIncidents: [...this.incidents].reverse().slice(0, 50),
    };
  }
}
