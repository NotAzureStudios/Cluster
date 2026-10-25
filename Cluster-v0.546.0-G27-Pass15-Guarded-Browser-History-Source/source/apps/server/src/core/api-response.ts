import type { FastifyReply, FastifyRequest } from "fastify";
import { API_CONTRACT, type ApiErrorCode, type ApiErrorResponse, type ApiSuccessResponse } from "@cluster/shared";
import { normalizeErrorResponseBody } from "./http-errors.js";

export function apiOperationLabel(request: FastifyRequest) {
  const method = String(request.method || "REQUEST").toUpperCase().slice(0, 12);
  const route = String(request.routeOptions?.url || String(request.url || "").split("?")[0] || "/")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 180);
  return `${method} ${route}`;
}

export function apiError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode | string,
  error: string,
  details?: Record<string, unknown>,
) {
  const normalized = normalizeErrorResponseBody({ code, error }, statusCode, String(request.id));
  const body: ApiErrorResponse = {
    ...normalized,
    requestId: String(request.id),
    contractVersion: API_CONTRACT.version,
    operation: apiOperationLabel(request),
    occurredAt: new Date().toISOString(),
    ...(details ? { details } : {}),
  };
  return reply.code(statusCode).send(body);
}

export function apiSuccess<T>(request: FastifyRequest, data: T): ApiSuccessResponse<T> {
  return {
    ok: true,
    data,
    requestId: String(request.id),
    contractVersion: API_CONTRACT.version,
  };
}

export function normalizeApiErrorBody(
  payload: unknown,
  requestId: string,
  statusCode = 400,
  context: { operation?: string; occurredAt?: string } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body = payload as Record<string, unknown>;
  if (body.ok !== false && !body.error) return payload;
  const operation = String(body.operation || context.operation || "REQUEST /unknown").replace(/[\r\n\t]/g, " ").slice(0, 200);
  const occurredAt = String(body.occurredAt || context.occurredAt || new Date().toISOString()).slice(0, 64);
  return {
    ...body,
    ...normalizeErrorResponseBody(body, statusCode, requestId),
    contractVersion: String(body.contractVersion || API_CONTRACT.version),
    operation,
    occurredAt,
  };
}
