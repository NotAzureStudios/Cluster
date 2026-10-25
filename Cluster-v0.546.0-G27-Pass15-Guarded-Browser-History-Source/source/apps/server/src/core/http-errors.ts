import { z } from "zod";
import { clusterErrorCodeForStatus, clusterErrorDefinition, type ClusterErrorCode } from "@cluster/shared";

export type ClusterHttpErrorBody = {
  ok: false;
  error: string;
  title?: string;
  code: string;
  action?: string;
  retryable?: boolean;
  requestId?: string;
  issues?: Array<{ path: string; message: string }>;
};

export type NormalizedHttpError = {
  statusCode: number;
  body: ClusterHttpErrorBody;
  logLevel: "info" | "warn" | "error";
};

export type ClusterHttpError = Error & {
  statusCode?: number;
  code?: string;
  action?: string;
  retryable?: boolean;
};

function numericStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const statusCode = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : null;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code || "");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.trim() : "";
}

export function createHttpError(code: ClusterErrorCode | string, message?: string, statusCode?: number): ClusterHttpError {
  const definition = clusterErrorDefinition(code);
  const error = new Error(message || definition?.message || "The request could not be completed.") as ClusterHttpError;
  error.code = code;
  error.statusCode = statusCode || definition?.httpStatus || 500;
  error.action = definition?.action;
  error.retryable = definition?.retryable;
  return error;
}

export function inferHttpErrorCode(statusCode: number, message = "", currentCode = "") {
  if (currentCode) return currentCode;
  const normalized = message.toLowerCase();
  if (/storage schema|database schema|missing required database fields|relation .+ does not exist|column .+ does not exist|migration|p2021|p2022/.test(normalized)) return "STORAGE_SCHEMA_OUT_OF_DATE";
  if (/project lead|active workspace member/.test(normalized)) return "PROJECT_LEAD_REQUIRED";
  if (/no workspace|complete setup|workspace.*setup/.test(normalized)) return "WORKSPACE_NOT_READY";
  if (/origin|cross-site/.test(normalized) && statusCode === 403) return "ORIGIN_BLOCKED";
  if (/revision|changed after|newer version/.test(normalized) && statusCode === 409) return "REVISION_CONFLICT";
  if (/rate limit|too many requests/.test(normalized) || statusCode === 429) return "RATE_LIMITED";
  return clusterErrorCodeForStatus(statusCode);
}

export function normalizeErrorResponseBody(payload: unknown, statusCode: number, requestId?: string): ClusterHttpErrorBody {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawMessage = String(record.error || record.message || "").trim();
  const code = inferHttpErrorCode(statusCode, rawMessage, String(record.code || ""));
  const definition = clusterErrorDefinition(code);
  const exposeMessage = statusCode < 500 || code === "STORAGE_SCHEMA_OUT_OF_DATE" || code === "STORAGE_VERIFY_FAILED" || code === "PROJECT_CREATE_FAILED";
  const error = exposeMessage && rawMessage ? rawMessage : definition?.message || "The request could not be completed.";
  return {
    ok: false,
    error,
    title: String(record.title || definition?.title || "Request failed"),
    code,
    action: String(record.action || definition?.action || "Retry the action or inspect Cluster diagnostics."),
    retryable: typeof record.retryable === "boolean" ? record.retryable : Boolean(definition?.retryable),
    requestId: String(record.requestId || requestId || "") || undefined,
    ...(Array.isArray(record.issues) ? { issues: record.issues.slice(0, 20) as Array<{ path: string; message: string }> } : {}),
  };
}

export function normalizeHttpError(error: unknown, requestId?: string): NormalizedHttpError {
  if (error instanceof z.ZodError) {
    const definition = clusterErrorDefinition("VALIDATION_FAILED");
    return {
      statusCode: 400,
      body: {
        ok: false,
        error: "One or more fields were not accepted.",
        title: definition?.title,
        code: "VALIDATION_FAILED",
        action: definition?.action,
        retryable: false,
        requestId,
        issues: ((error as any).issues || []).slice(0, 20).map((issue: any) => ({
          path: Array.isArray(issue.path) ? issue.path.map(String).join(".") : "",
          message: String(issue.message || "Invalid value."),
        })),
      },
      logLevel: "info",
    };
  }

  const code = errorCode(error);
  if (code === "P2021" || code === "P2022" || (error instanceof Error && /LibraryItem|relation .+ does not exist|column .+ does not exist|database schema|storage schema|migration/i.test(error.message))) {
    return {
      statusCode: 503,
      body: normalizeErrorResponseBody({
        error: "Cluster storage is missing data structures required by this version.",
        code: "STORAGE_SCHEMA_OUT_OF_DATE",
      }, 503, requestId),
      logLevel: "error",
    };
  }

  if (code === "P2025") {
    return {
      statusCode: 404,
      body: normalizeErrorResponseBody({ error: "The requested record was not found.", code: "RESOURCE_NOT_FOUND" }, 404, requestId),
      logLevel: "info",
    };
  }
  // PostgreSQL's Card admission trigger is the canonical final guard against
  // simultaneous List/Board archival and Card/Ticket inserts. Map its named
  // constraint to actionable conflict feedback instead of a generic 500.
  const databaseConstraint = String((error as any)?.meta?.constraint || (error as any)?.meta?.constraint_name || (error as any)?.meta?.database_error || "");
  if (code === "P2004" && databaseConstraint.includes("Card_active_destination_unarchived")) {
    return {
      statusCode: 409,
      body: normalizeErrorResponseBody({
        error: "The destination Board or column was archived while this work was being saved. No Card or Ticket was created. Choose an active destination and retry.",
        code: "CARD_DESTINATION_ARCHIVED",
      }, 409, requestId),
      logLevel: "info",
    };
  }
  if (code === "P2034") {
    return {
      statusCode: 409,
      body: normalizeErrorResponseBody({
        error: "A concurrent change prevented this write. Refresh and retry after reviewing the latest state.",
        code: "CONCURRENT_WRITE_CONFLICT",
      }, 409, requestId),
      logLevel: "info",
    };
  }
  if (code === "P2002") {
    return {
      statusCode: 409,
      body: normalizeErrorResponseBody({ error: "A record with that value already exists.", code: "CONFLICT" }, 409, requestId),
      logLevel: "info",
    };
  }
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return {
      statusCode: 413,
      body: normalizeErrorResponseBody({ error: "The request body is too large.", code: "BODY_TOO_LARGE" }, 413, requestId),
      logLevel: "info",
    };
  }

  const statusCode = numericStatus(error);
  if (statusCode) {
    const message = errorMessage(error);
    return {
      statusCode,
      body: normalizeErrorResponseBody({
        error: message,
        code,
        action: (error as ClusterHttpError).action,
        retryable: (error as ClusterHttpError).retryable,
      }, statusCode, requestId),
      logLevel: statusCode >= 500 ? "error" : statusCode === 429 ? "warn" : "info",
    };
  }

  return {
    statusCode: 500,
    body: normalizeErrorResponseBody({ code: "INTERNAL_ERROR" }, 500, requestId),
    logLevel: "error",
  };
}
