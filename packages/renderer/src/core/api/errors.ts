import { clusterErrorDefinition } from "@cluster/shared";

export type ApiErrorIssue = { path?: string; message: string; code?: string };
export type ApiErrorRecoveryKind = "retry" | "refresh" | "reauthenticate" | "review" | "work_offline" | "request_access" | "none";

function sanitizeOperationPath(path: string) {
  const rawPathname = String(path || "").split("?")[0] || "/";
  const pathname = rawPathname.replace(/^\/api\/public\/share\/[^/]+/i, "/api/public/share/:token");
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      if (/^[a-z0-9_-]{20,}$/i.test(segment) && /\d/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

export function apiOperationLabel(method: string, path: string) {
  return `${String(method || "GET").toUpperCase().slice(0, 12)} ${sanitizeOperationPath(path)}`.slice(0, 200);
}

function apiRecoveryKind(code: string, retryable: boolean): ApiErrorRecoveryKind {
  if (["AUTH_REQUIRED", "AUTH_REAUTH_REQUIRED", "AUTH_SESSION_UNAVAILABLE"].includes(code)) return "reauthenticate";
  if (["REVISION_CONFLICT", "VERSION_CONFLICT", "STUDIO_SETTINGS_CONFLICT", "CONFLICT", "IDEMPOTENCY_RESULT_UNKNOWN"].includes(code) || /(?:REVISION|VERSION)_CONFLICT$/.test(code) || code.startsWith("SYNC_") || code === "CONFLICT_RESOLUTION_NOT_ALLOWED") return "review";
  if (["RESOURCE_NOT_FOUND", "ROUTE_NOT_FOUND", "SERVER_RESPONSE_INVALID", "CLIENT_UPGRADE_REQUIRED", "IDEMPOTENCY_ALREADY_COMMITTED"].includes(code)) return "refresh";
  if (["NETWORK_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(code)) return "work_offline";
  if (["PERMISSION_DENIED", "ACCESS_DENIED", "FORBIDDEN", "TOOL_DISABLED"].includes(code)) return "request_access";
  return retryable ? "retry" : "none";
}

export class ApiError extends Error {
  status: number;
  code: string;
  title: string;
  action: string;
  retryable: boolean;
  requestId?: string | null;
  contractVersion?: string | null;
  retryAfterSeconds?: number | null;
  operation?: string | null;
  occurredAt: string;
  payload?: unknown;
  issues: ApiErrorIssue[];
  userMessage: string;

  constructor(
    message: string,
    status: number,
    payload?: unknown,
    requestId?: string | null,
    code = "INTERNAL_ERROR",
    options: { title?: string; action?: string; retryable?: boolean; issues?: ApiErrorIssue[]; contractVersion?: string | null; retryAfterSeconds?: number | null; operation?: string | null; occurredAt?: string | null } = {},
  ) {
    const definition = clusterErrorDefinition(code);
    const userMessage = message || definition?.message || "The request could not be completed.";
    const reference = [code, requestId ? `request ${requestId}` : ""].filter(Boolean).join(" · ");
    super(`${userMessage}${reference ? ` (${reference})` : ""}`);
    this.name = "ApiError";
    this.userMessage = userMessage;
    this.status = status;
    this.code = code;
    this.title = options.title || definition?.title || "Request failed";
    this.action = options.action || definition?.action || "Retry the action or inspect Cluster diagnostics.";
    this.retryable = options.retryable ?? definition?.retryable ?? status >= 500;
    this.payload = payload;
    this.requestId = requestId;
    this.contractVersion = options.contractVersion || null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.operation = options.operation || null;
    this.occurredAt = options.occurredAt || new Date().toISOString();
    this.issues = options.issues || [];
  }
}

export function apiErrorPresentation(error: unknown) {
  if (error instanceof ApiError) {
    return {
      title: error.title,
      message: error.userMessage,
      code: error.code,
      status: error.status,
      action: error.action,
      retryable: error.retryable,
      recoveryKind: apiRecoveryKind(error.code, error.retryable),
      requestId: error.requestId || null,
      contractVersion: error.contractVersion || null,
      retryAfterSeconds: error.retryAfterSeconds ?? null,
      operation: error.operation || null,
      occurredAt: error.occurredAt,
      issues: error.issues,
    };
  }
  if (error instanceof Error) {
    return {
      title: "Request failed",
      message: error.message,
      code: "CLIENT_ERROR",
      status: 0,
      action: "Review the message and retry the action.",
      retryable: false,
      recoveryKind: "none" as ApiErrorRecoveryKind,
      requestId: null,
      contractVersion: null,
      retryAfterSeconds: null,
      operation: null,
      occurredAt: new Date().toISOString(),
      issues: [] as ApiErrorIssue[],
    };
  }
  return {
    title: "Request failed",
    message: "Cluster could not complete the action.",
    code: "CLIENT_ERROR",
    status: 0,
    action: "Retry the action. If it repeats, inspect Admin diagnostics.",
    retryable: true,
    recoveryKind: "retry" as ApiErrorRecoveryKind,
    requestId: null,
    contractVersion: null,
    retryAfterSeconds: null,
    operation: null,
    occurredAt: new Date().toISOString(),
    issues: [] as ApiErrorIssue[],
  };
}

export function formatApiError(error: unknown) {
  const detail = apiErrorPresentation(error);
  const reference = [detail.code, detail.requestId ? `request ${detail.requestId}` : ""].filter(Boolean).join(" · ");
  return `${detail.message}${reference ? ` (${reference})` : ""}`;
}

export type ApiErrorPresentation = ReturnType<typeof apiErrorPresentation>;

export function formatApiErrorPresentationDiagnostics(detail: ApiErrorPresentation) {
  const lines = [
    "Cluster error diagnostics",
    `Code: ${detail.code}`,
    `Status: ${detail.status || "client"}`,
    `Occurred: ${detail.occurredAt}`,
    detail.operation ? `Operation: ${detail.operation}` : null,
    detail.requestId ? `Request ID: ${detail.requestId}` : null,
    detail.contractVersion ? `API contract: ${detail.contractVersion}` : null,
    `Retryable: ${detail.retryable ? "yes" : "no"}`,
    `Recovery: ${detail.recoveryKind}`,
    detail.retryAfterSeconds != null ? `Retry after: ${detail.retryAfterSeconds}s` : null,
    `Summary: ${detail.title}`,
    `Message: ${detail.message}`,
    `Suggested action: ${detail.action}`,
    ...detail.issues.slice(0, 5).map((issue, index) => `Issue ${index + 1}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`),
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n").slice(0, 8_000);
}

export function formatApiErrorDiagnostics(error: unknown) {
  return formatApiErrorPresentationDiagnostics(apiErrorPresentation(error));
}

export function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function isApiNetworkFailure(error: unknown) {
  return !isOnline() || error instanceof TypeError || (error instanceof ApiError && [0, 408, 502, 503, 504].includes(error.status));
}
