/** In-session, authenticated, bounded Package resume protocol.
 * Each segment is reauthorized by the server; no durable bearer token or
 * partial ZIP is written to browser storage. Full digest verification is
 * performed by the caller before handing bytes to native staging.
 */
export const PACKAGE_DOWNLOAD_SEGMENT_BYTES = 4 * 1024 * 1024;
export type PackageSegmentFetch = (path: string, init: RequestInit) => Promise<Response>;

function fail(code: string): never { throw new Error(code); }
function validRange(response: Response, start: number, end: number, total: number): boolean {
  return response.status === 206
    && response.headers.get("content-range") === `bytes ${start}-${end}/${total}`
    && response.headers.get("x-cluster-package-segment-bytes") === String(PACKAGE_DOWNLOAD_SEGMENT_BYTES)
    && response.headers.get("content-type")?.toLowerCase().startsWith("application/zip") === true;
}

async function readSegment(response: Response, expected: number): Promise<Uint8Array> {
  if (response.headers.get("content-length") && Number(response.headers.get("content-length")) !== expected)
    fail("PACKAGE_SEGMENT_LENGTH_MISMATCH");
  if (!response.body) fail("PACKAGE_SEGMENT_NO_BODY");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected) fail("PACKAGE_SEGMENT_TOO_LARGE");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  if (offset !== expected) fail("PACKAGE_SEGMENT_TRUNCATED");
  return bytes;
}

export async function downloadPackageSegmentsToSink(input: {
  onSegment: (start: number, bytes: Uint8Array) => Promise<void>;
  resumeFrom?: number;
  endpoint: string; channel: string; platform: string; deviceId: string;
  artifactSize: number; artifactSha256: string; fetcher: PackageSegmentFetch;
  onProgress?: (done: number, total: number) => void;
  onLease: (headers: Headers) => { deploymentId: string; receiptChallenge: string } | null | Promise<{ deploymentId: string; receiptChallenge: string } | null>;
  /** Nonsecret deployment identity recovered from the profile-bound native
   * checkpoint. The challenge is always rotated by the server and never saved. */
  recovery?: { deploymentId: string };
  signal?: AbortSignal;
}): Promise<{ initialHeaders: Headers }> {
  if (!Number.isSafeInteger(input.artifactSize) || input.artifactSize < 1 || input.artifactSize > 32 * 4 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(input.artifactSha256)) fail("PACKAGE_SEGMENT_TARGET_INVALID");
  if (input.resumeFrom !== undefined && (!Number.isSafeInteger(input.resumeFrom) || input.resumeFrom < 0
    || input.resumeFrom > input.artifactSize)) fail("PACKAGE_SEGMENT_RESUME_OFFSET_INVALID");
  const headers = { "Content-Type": "application/json", "Accept": "application/zip", "X-Cluster-Device-Id": input.deviceId };
  const endFirst = Math.min(input.artifactSize, PACKAGE_DOWNLOAD_SEGMENT_BYTES) - 1;
  let initialHeaders = new Headers();
  let lease: { deploymentId: string; receiptChallenge: string } | null = null;
  let nextStart: number;
  if (input.recovery) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.recovery.deploymentId)) fail("PACKAGE_RECOVERY_ID_INVALID");
    const response = await input.fetcher(`${input.endpoint}/recover`, { method: "POST", headers,
      body: JSON.stringify({ channel: input.channel, platform: input.platform,
        deploymentId: input.recovery.deploymentId, artifactSha256: input.artifactSha256 }), cache: "no-store", signal: input.signal });
    if (!response.ok) fail((await response.json().catch(() => ({})))?.code || `PACKAGE_RECOVERY_DENIED_${response.status}`);
    const renewed = await response.json().catch(() => null);
    if (renewed?.ok !== true || renewed?.deploymentId !== input.recovery.deploymentId
      || typeof renewed.receiptChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(renewed.receiptChallenge))
      fail("PACKAGE_RECOVERY_RESPONSE_INVALID");
    lease = { deploymentId: renewed.deploymentId, receiptChallenge: renewed.receiptChallenge };
    // Never reissue the original deployment offer or write already verified bytes.
    nextStart = input.resumeFrom ?? 0;
    input.onProgress?.(nextStart, input.artifactSize);
  } else {
    const initial = await input.fetcher(input.endpoint, { method: "POST", headers: { ...headers, Range: `bytes=0-${endFirst}` },
      body: JSON.stringify({ channel: input.channel, platform: input.platform }), cache: "no-store", signal: input.signal });
    if (!initial.ok) fail((await initial.json().catch(() => ({})))?.code || `PACKAGE_DOWNLOAD_FAILED_${initial.status}`);
    if (!validRange(initial, 0, endFirst, input.artifactSize)
      || initial.headers.get("x-cluster-package-sha256") !== input.artifactSha256)
      fail("PACKAGE_SEGMENT_RESPONSE_INVALID");
    initialHeaders = initial.headers;
    // Persist only nonsecret offer identity BEFORE writing the first native byte.
    // A failed bind leaves a zero-byte checkpoint; never silently replace an
    // existing binding with a newer deployment offer.
    lease = await input.onLease(initial.headers);
    if (input.artifactSize > PACKAGE_DOWNLOAD_SEGMENT_BYTES && (!lease?.deploymentId || !lease.receiptChallenge))
      fail("PACKAGE_SEGMENT_LEASE_MISSING");
    const firstBytes = await readSegment(initial, endFirst + 1);
    const firstRemaining = Math.max(0, Math.min(endFirst + 1, input.resumeFrom ?? 0));
    if (firstRemaining < firstBytes.length)
      await input.onSegment(firstRemaining, firstBytes.subarray(firstRemaining));
    nextStart = Math.max(endFirst + 1, input.resumeFrom ?? 0);
    input.onProgress?.(nextStart, input.artifactSize);
  }
  if (nextStart < input.artifactSize && (!lease?.deploymentId || !lease.receiptChallenge))
    fail("PACKAGE_SEGMENT_LEASE_MISSING");
  for (let start = nextStart; start < input.artifactSize; start += PACKAGE_DOWNLOAD_SEGMENT_BYTES) {
    if (input.signal?.aborted) fail("PACKAGE_TRANSFER_PAUSED");
    const end = Math.min(start + PACKAGE_DOWNLOAD_SEGMENT_BYTES, input.artifactSize) - 1;
    let response: Response | null = null;
    // Retry only transport failures. An HTTP denial is authoritative and
    // must not be retried or replaced by a cached earlier authorization.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await input.fetcher(`${input.endpoint}/resume`, { method: "POST", headers,
          body: JSON.stringify({ channel: input.channel, platform: input.platform,
            deploymentId: lease!.deploymentId, challenge: lease!.receiptChallenge, start, end }), cache: "no-store", signal: input.signal });
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
    if (!response) fail("PACKAGE_SEGMENT_UNAVAILABLE");
    if (!response.ok) fail((await response.json().catch(() => ({})))?.code || `PACKAGE_SEGMENT_REJECTED_${response.status}`);
    if (!validRange(response, start, end, input.artifactSize)
      || response.headers.get("x-cluster-package-sha256") !== input.artifactSha256)
      fail("PACKAGE_SEGMENT_RESPONSE_INVALID");
    await input.onSegment(start, await readSegment(response, end - start + 1));
    input.onProgress?.(end + 1, input.artifactSize);
  }
  return { initialHeaders };
}

/** Backward-compatible bounded in-memory kit path. Archive-only callers may
 * instead stream each authorized segment to the native digest-bound spool.
 */
export async function downloadPackageSegments(input: Omit<Parameters<typeof downloadPackageSegmentsToSink>[0], "onSegment" | "resumeFrom">): Promise<{ bytes: Uint8Array; initialHeaders: Headers }> {
  const bytes = new Uint8Array(input.artifactSize);
  const result = await downloadPackageSegmentsToSink({ ...input,
    onSegment: async (start, chunk) => { bytes.set(chunk, start); },
  });
  return { bytes, initialHeaders: result.initialHeaders };
}
