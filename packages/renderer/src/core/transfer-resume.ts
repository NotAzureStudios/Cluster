import { TransferSha256, verifiedSha256Etag } from "./transfer-sha256";

export type RangeFetch = (range: { start: number; etag: string } | null, signal?: AbortSignal) => Promise<Response>;
export type WritableDownload = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> };
export type ResumableDownloadOptions = {
  signal?: AbortSignal;
  ensureCurrent?: () => void;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  onRetry?: (attempt: number, offset: number) => void;
  beforeRead?: () => Promise<void>;
  onVerifying?: () => void;
  expectedSha256?: string | null;
  expectedTotalBytes?: number | null;
  maxRetries?: number;
  /** Zero means unrestricted; pacing is applied after writing each chunk. */
  maxBytesPerSecond?: number;
};

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
}
function retryableStatus(status: number) { return status === 408 || status === 429 || [500,502,503,504].includes(status); }
function retryableStreamError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && error.message === "TRANSFER_STREAM_INTERRUPTED");
}
function interrupted(): Error { return new Error("TRANSFER_STREAM_INTERRUPTED"); }
async function waitForRetry(ms: number, signal?: AbortSignal) {
  abortIfRequested(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Download cancelled.", "AbortError")); };
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
function contentLength(response: Response) {
  const raw = response.headers.get("content-length");
  if (raw === null) return null;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid download Content-Length.");
  return length;
}
function responseIsFile(response: Response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/problem+json")) throw new Error("The download returned an error page instead of a file.");
}
function totalForPartial(response: Response, offset: number) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
  if (!match) throw new Error("Resume response is missing an exact Content-Range.");
  const [start, end, total] = match.slice(1).map(Number);
  if (![start,end,total].every(Number.isSafeInteger) || start !== offset || end < start || end >= total) {
    throw new Error("Resume response does not match the requested byte offset.");
  }
  const length = contentLength(response);
  if (length !== null && length !== end - start + 1) throw new Error("Resume response length does not match its range.");
  return { total, bytesInResponse: end - start + 1 };
}

/** A one-writer, bounded-memory transfer. Interrupted connections resume only
 * with a server-provided strong content SHA-256 ETag and exact HTTP byte ranges.
 * The writable is committed only after content length and digest verification.
 */
export async function downloadWithVerifiedResume(fetcher: RangeFetch, sink: WritableDownload, options: ResumableDownloadOptions = {}) {
  let offset = 0;
  let totalBytes: number | null = null;
  let sourceEtag: string | null = null;
  let expectedSha: string | null = null;
  const hasher = new TransferSha256();
  const metadataSha = /^[a-f0-9]{64}$/i.test(options.expectedSha256 || "") ? options.expectedSha256!.toLowerCase() : null;
  let retries = 0;
  const maxRetries = Math.max(0, Math.min(5, Math.trunc(options.maxRetries ?? 3)));
  const speed = Math.max(0, Math.min(500 * 1024 * 1024, Math.trunc(options.maxBytesPerSecond ?? 0)));
  let throttleEpoch = Date.now();
  let throttleBytes = 0;
  let activeResponse: Response | null = null;
  try {
    while (true) {
      abortIfRequested(options.signal);
      options.ensureCurrent?.();
      await options.beforeRead?.();
      let response: Response;
      try {
        response = await fetcher(offset ? { start: offset, etag: sourceEtag! } : null, options.signal);
      } catch (error) {
        if (offset && !sourceEtag) throw new Error("Cannot safely resume: the server did not provide a strong checksum ETag.");
        if (retries >= maxRetries || !retryableStreamError(error)) throw error;
        retries++;
        options.onRetry?.(retries, offset);
        await waitForRetry(Math.min(2_000, 250 * (2 ** (retries - 1))), options.signal);
        continue;
      }
      activeResponse = response;
      try {
        if (!response.ok && retryableStatus(response.status)) throw interrupted();
        if (!response.ok) throw new Error("Download rejected with HTTP " + response.status + ".");
        responseIsFile(response);
        if (offset === 0) {
          if (response.status !== 200 || response.headers.get("content-range")) {
            throw new Error("Initial download must return a complete HTTP 200 file response.");
          }
          totalBytes = contentLength(response);
          if (options.expectedTotalBytes != null && Number.isSafeInteger(options.expectedTotalBytes) && options.expectedTotalBytes >= 0) {
            if (totalBytes !== null && options.expectedTotalBytes !== totalBytes) throw new Error("The file size differs from the Library version selected.");
            if (totalBytes === null) totalBytes = options.expectedTotalBytes;
          }
          sourceEtag = response.headers.get("etag");
          const headerSha = verifiedSha256Etag(sourceEtag);
          if (metadataSha && headerSha && metadataSha !== headerSha) throw new Error("The Library checksum differs from the download response.");
          expectedSha = metadataSha || headerSha;
          // The hash-qualified ETag is the immutable resume validator.
          if (!expectedSha) sourceEtag = null;
        } else {
          if (response.status !== 206) throw new Error("Resume was refused or the source changed; partial file discarded.");
          if (response.headers.get("etag") !== sourceEtag) throw new Error("Resume ETag changed; partial file discarded.");
          const range = totalForPartial(response, offset);
          if (totalBytes !== range.total) throw new Error("The source size changed during download.");
        }
        if (!response.body) throw new Error("The download response has no readable stream.");
        const reader = response.body.getReader();
        let receivedThisResponse = 0;
        let readError: unknown = null;
        try {
          while (true) {
            abortIfRequested(options.signal);
            options.ensureCurrent?.();
            await options.beforeRead?.();
            let value: Uint8Array | undefined, done: boolean;
            try { ({ value, done } = await reader.read()); }
            catch (error) { readError = error; break; }
            if (done) break;
            if (!value?.byteLength) continue;
            if (!Number.isSafeInteger(offset + value.byteLength) || (totalBytes !== null && offset + value.byteLength > totalBytes)) {
              throw new Error("The server sent bytes outside the declared file length.");
            }
            await sink.write(value);
            hasher.update(value);
            offset += value.byteLength;
            receivedThisResponse += value.byteLength;
            options.onProgress?.(offset, totalBytes);
            if (speed > 0) {
              throttleBytes += value.byteLength;
              const expectedMs = throttleBytes * 1_000 / speed;
              const spentMs = Date.now() - throttleEpoch;
              if (expectedMs > spentMs) await waitForRetry(Math.min(10_000, expectedMs - spentMs), options.signal);
              if (Date.now() - throttleEpoch > 10_000) { throttleEpoch = Date.now(); throttleBytes = 0; }
            }
          }
        } finally {
          if (readError) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        if (readError) throw interrupted();
        const declared = contentLength(response);
        if (declared !== null && receivedThisResponse !== declared) throw interrupted();
        if (totalBytes !== null && offset < totalBytes) throw interrupted();
        if (totalBytes === null) totalBytes = offset; // EOF from unknown-length complete response
        break;
      } catch (error) {
        const retryable = retryableStreamError(error) &&
          (offset === 0 || (Boolean(sourceEtag) && totalBytes !== null && offset < totalBytes));
        if (!retryable || retries >= maxRetries) throw error;
        retries++;
        options.onRetry?.(retries, offset);
        await response.body?.cancel().catch(() => undefined);
        activeResponse = null;
        await waitForRetry(Math.min(2_000, 250 * (2 ** (retries - 1))), options.signal);
      } finally {
        activeResponse = null;
      }
    }
    abortIfRequested(options.signal);
    options.ensureCurrent?.();
    options.onVerifying?.();
    const sha256 = expectedSha ? hasher.digestHex() : null;
    if (expectedSha && sha256 !== expectedSha) throw new Error("SHA-256 mismatch: the downloaded file was not saved.");
    await sink.close();
    return { bytesWritten: offset, totalBytes, sha256, verified: Boolean(expectedSha) };
  } catch (error) {
    await activeResponse?.body?.cancel().catch(() => undefined);
    await sink.abort(error).catch(() => undefined);
    throw error;
  }
}
