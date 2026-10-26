import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { normalizeMimeType, safeFileName, untrustedFileResponseHeaders, uploadContentDisposition } from "../../core/uploads.js";

function opaqueEtag(seed: string) {
  return `"${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}"`;
}

export function resourceIfRangeMatches(value: unknown, etag: string, modifiedAt: Date) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text.startsWith("\"") || text.startsWith("W/\"")) return text === etag;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return false;
  return Math.floor(modifiedAt.getTime() / 1000) <= Math.floor(date.getTime() / 1000);
}

export function parseSingleByteRange(range: string, total: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range || "").trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const bounded = Math.min(suffixLength, total);
    start = Math.max(0, total - bounded);
    end = total - 1;
  } else {
    start = Number(match[1] || 0);
    end = match[2] ? Number(match[2]) : total - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}

function notModified(request: FastifyRequest, etag: string, modifiedAt: Date) {
  const ifNoneMatch = String(request.headers["if-none-match"] || "").trim();
  if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch.split(",").map((item) => item.trim()).includes(etag))) return true;
  if (ifNoneMatch) return false;
  const since = String(request.headers["if-modified-since"] || "").trim();
  if (!since) return false;
  const date = new Date(since);
  return Number.isFinite(date.getTime()) && Math.floor(modifiedAt.getTime() / 1000) <= Math.floor(date.getTime() / 1000);
}

export async function sendStoredResource(request: FastifyRequest, reply: FastifyReply, input: {
  filePath: string;
  mimeType: string;
  originalName: string;
  requestedInline?: boolean;
  checksumSha256?: string | null;
  cacheControl?: string;
}) {
  const stat = await fs.stat(input.filePath);
  if (!stat.isFile()) return reply.code(404).send({ code: "RESOURCE_FILE_MISSING", message: "Stored resource is not a file." });
  const total = stat.size;
  const modifiedAt = stat.mtime;
  const etag = input.checksumSha256 && /^[a-f0-9]{64}$/i.test(input.checksumSha256)
    ? `"sha256-${input.checksumSha256.toLowerCase()}"`
    : opaqueEtag(`${total}:${Math.floor(stat.mtimeMs)}:${input.filePath}`);
  const contentType = normalizeMimeType(input.mimeType);
  const disposition = uploadContentDisposition(contentType, input.originalName, Boolean(input.requestedInline));

  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `${disposition}; filename="${safeFileName(input.originalName)}"`);
  reply.header("ETag", etag);
  reply.header("Last-Modified", modifiedAt.toUTCString());
  reply.header("Cache-Control", input.cacheControl || "private, max-age=0, must-revalidate");
  for (const [header, value] of Object.entries(untrustedFileResponseHeaders(contentType, input.originalName))) reply.header(header, value);

  if (notModified(request, etag, modifiedAt)) return reply.code(304).send();

  const rawRange = String(request.headers.range || "").trim();
  const range = rawRange && resourceIfRangeMatches(request.headers["if-range"], etag, modifiedAt) ? rawRange : "";
  if (!range) {
    reply.header("Content-Length", String(total));
    if (request.method === "HEAD") return reply.send();
    return reply.send(createReadStream(input.filePath));
  }

  const parsedRange = parseSingleByteRange(range, total);
  if (!parsedRange) {
    reply.header("Content-Range", `bytes */${total}`);
    return reply.code(416).send();
  }
  const { start, end } = parsedRange;
  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
  reply.header("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") return reply.send();
  return reply.send(createReadStream(input.filePath, { start, end }));
}

export async function sendStorageResource(request: FastifyRequest, reply: FastifyReply, input: {
  storage: {
    stat(locator: any): Promise<{ size: number; modifiedAt: Date }>;
    openRead(locator: any, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
  };
  locator: any;
  mimeType: string;
  originalName: string;
  requestedInline?: boolean;
  checksumSha256?: string | null;
  cacheControl?: string;
}) {
  const object = await input.storage.stat(input.locator);
  const total = object.size;
  const modifiedAt = object.modifiedAt;
  const etag = input.checksumSha256 && /^[a-f0-9]{64}$/i.test(input.checksumSha256)
    ? `"sha256-${input.checksumSha256.toLowerCase()}"`
    : opaqueEtag(`${total}:${Math.floor(modifiedAt.getTime())}:${input.locator.provider}:${input.locator.tier}:${input.locator.key}`);
  const contentType = normalizeMimeType(input.mimeType);
  const disposition = uploadContentDisposition(contentType, input.originalName, Boolean(input.requestedInline));

  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `${disposition}; filename="${safeFileName(input.originalName)}"`);
  reply.header("ETag", etag);
  reply.header("Last-Modified", modifiedAt.toUTCString());
  reply.header("Cache-Control", input.cacheControl || "private, max-age=0, must-revalidate");
  for (const [header, value] of Object.entries(untrustedFileResponseHeaders(contentType, input.originalName))) reply.header(header, value);
  if (notModified(request, etag, modifiedAt)) return reply.code(304).send();

  const rawRange = String(request.headers.range || "").trim();
  const rangeHeader = rawRange && resourceIfRangeMatches(request.headers["if-range"], etag, modifiedAt) ? rawRange : "";
  if (!rangeHeader) {
    reply.header("Content-Length", String(total));
    if (request.method === "HEAD") return reply.send();
    return reply.send(await input.storage.openRead(input.locator));
  }
  const range = parseSingleByteRange(rangeHeader, total);
  if (!range) {
    reply.header("Content-Range", `bytes */${total}`);
    return reply.code(416).send();
  }
  reply.code(206);
  reply.header("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
  reply.header("Content-Length", String(range.end - range.start + 1));
  if (request.method === "HEAD") return reply.send();
  return reply.send(await input.storage.openRead(input.locator, range));
}
