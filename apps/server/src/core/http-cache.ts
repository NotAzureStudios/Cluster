import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function requestHeader(request: FastifyRequest, name: string) {
  const raw = request.headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

function appendVary(reply: FastifyReply, value: string) {
  const current = String(reply.getHeader("Vary") || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!current.some((entry) => entry.toLowerCase() === value.toLowerCase())) current.push(value);
  if (current.length) reply.header("Vary", current.join(", "));
}

export function resourceRevision(payload: unknown) {
  const json = JSON.stringify(payload ?? null);
  return createHash("sha256").update(json).digest("base64url");
}

export function sendPrivateRevalidated(request: FastifyRequest, reply: FastifyReply, payload: unknown, revision = resourceRevision(payload)) {
  const normalizedRevision = String(revision || resourceRevision(payload));
  const etag = `"${normalizedRevision}"`;
  reply.header("Cache-Control", "private, no-cache, must-revalidate");
  reply.header("ETag", etag);
  reply.header("X-Cluster-Resource-Revision", normalizedRevision);
  appendVary(reply, "Cookie");

  const supplied = String(requestHeader(request, "if-none-match") || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (supplied.includes("*") || supplied.includes(etag) || supplied.includes(`W/${etag}`)) {
    return reply.code(304).send();
  }
  return reply.send(payload);
}
