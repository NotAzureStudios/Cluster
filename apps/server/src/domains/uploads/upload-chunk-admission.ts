import { availableParallelism } from "node:os";

export type BufferedUploadRange = { start: number; end: number; total: number; bytes: number };
type HeaderDecision =
  | { ok: true; range: BufferedUploadRange }
  | { ok: false; status: 400 | 413; code: string; message: string };

/** Early, pre-body admission only. The durable writer still validates every
 * byte and commits the offset conditionally after fsync. */
export function preflightBufferedChunkHeaders(
  headers: { "content-range"?: unknown; "content-length"?: unknown },
  maxBytes: number,
): HeaderDecision {
  const header = typeof headers["content-range"] === "string" ? headers["content-range"] : "";
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(header);
  if (!match) return { ok: false, status: 400, code: "UPLOAD_RANGE_REQUIRED", message: "Content-Range is required." };
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  const bytes = end - start + 1;
  if (![start, end, total, bytes].every(Number.isSafeInteger) || start < 0 || end < start || end >= total || total < 1 || bytes < 1) {
    return { ok: false, status: 400, code: "UPLOAD_RANGE_INVALID", message: "Upload chunk range is invalid." };
  }
  if (bytes > maxBytes) {
    return { ok: false, status: 413, code: "UPLOAD_CHUNK_TOO_LARGE", message: "Upload chunk exceeds the configured limit." };
  }
  const lengthHeader = headers["content-length"];
  if (lengthHeader !== undefined) {
    if (typeof lengthHeader !== "string" || !/^\d+$/.test(lengthHeader)) {
      return { ok: false, status: 400, code: "UPLOAD_LENGTH_INVALID", message: "Upload chunk length is invalid." };
    }
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 1 || length !== bytes) {
      return { ok: false, status: 400, code: "UPLOAD_LENGTH_INVALID", message: "Upload chunk length does not match Content-Range." };
    }
  }
  // Chunked-transfer clients without Content-Length remain supported; the
  // existing Fastify 8 MiB parser cap and durable byte-range check still apply.
  return { ok: true, range: { start, end, total, bytes } };
}

export function bufferedUploadAdmissionLimit(raw: unknown = process.env.CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX) {
  const value = Number(raw);
  const fallback = Math.max(2, Math.min(8, availableParallelism()));
  return raw === undefined || raw === null || raw === "" || !Number.isFinite(value)
    ? fallback : Math.max(1, Math.min(16, Math.floor(value)));
}

export function createBufferedUploadAdmission(maxConcurrent = bufferedUploadAdmissionLimit()) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) throw new Error("Invalid buffered upload concurrency limit.");
  let active = 0;
  let denied = 0;
  return {
    acquire(): (() => void) | null {
      if (active >= maxConcurrent) { denied++; return null; }
      active++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        active--;
      };
    },
    snapshot() { return { active, limit: maxConcurrent, rejected: denied }; },
  };
}
