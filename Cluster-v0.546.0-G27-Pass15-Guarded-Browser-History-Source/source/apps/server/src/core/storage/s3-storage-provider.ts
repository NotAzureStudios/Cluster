import { createHmac, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";
import type {
  StorageBrowserUploadCapability,
  StorageMultipartPart,
  StorageMultipartSession,
  StorageMultipartInspection,
  StorageObjectStat,
  StorageProvider,
  StorageProviderCapabilities,
  StorageReadRange,
} from "./storage-types.js";
import { OperationCancelledError, throwIfAborted } from "../operation-cancellation.js";
import { requireS3WriteSuccess } from "./s3-write-response.js";

type S3Config = {
  id?: string;
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}
function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function canonicalQuery(query: URLSearchParams) {
  return [...query.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}
function xmlDecode(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function wildcardMatches(pattern: string, value: string) {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export class S3StorageProvider implements StorageProvider {
  readonly id: string;
  readonly kind = "s3-compatible";
  readonly durable = true;
  readonly sharedAcrossNodes = true;
  readonly capabilities: StorageProviderCapabilities = {
    streamingReads: true,
    rangeReads: true,
    streamingWrites: true,
    sharedAcrossNodes: true,
    objectStorage: true,
    multipartUploads: true,
  };
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string | null;

  constructor(config: S3Config) {
    this.id = String(config.id || "object");
    this.endpoint = new URL(config.endpoint);
    if (this.endpoint.protocol !== "https:") throw new Error("S3-compatible storage endpoint must use HTTPS.");
    if (this.endpoint.username || this.endpoint.password || this.endpoint.hash) throw new Error("S3 endpoint must not embed credentials or fragments.");
    this.bucket = String(config.bucket || "").trim();
    this.region = String(config.region || "us-east-1").trim() || "us-east-1";
    this.accessKeyId = String(config.accessKeyId || "").trim();
    this.secretAccessKey = String(config.secretAccessKey || "");
    this.sessionToken = config.sessionToken ? String(config.sessionToken) : null;
    if (!this.bucket || !this.accessKeyId || !this.secretAccessKey) throw new Error("S3-compatible storage requires bucket and access credentials.");
  }

  private objectUrl(key = "", query?: URLSearchParams) {
    const basePath = this.endpoint.pathname.replace(/\/+$/, "");
    const objectPath = key ? `/${this.bucket}/${key.split("/").map(awsEncode).join("/")}` : `/${this.bucket}`;
    const url = new URL(this.endpoint.toString());
    url.pathname = `${basePath}${objectPath}` || "/";
    url.search = query ? canonicalQuery(query) : "";
    return url;
  }

  private signedHeaders(method: string, url: URL, payloadHash: string, additional: Record<string, string> = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(Object.entries(additional).map(([key, value]) => [key.toLowerCase(), String(value).trim()])),
    };
    if (this.sessionToken) headers["x-amz-security-token"] = this.sessionToken;
    const headerNames = Object.keys(headers).sort();
    const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]!.replace(/\s+/g, " ")}\n`).join("");
    const canonicalRequest = [
      method.toUpperCase(),
      url.pathname.split("/").map((segment) => awsEncode(decodeURIComponent(segment))).join("/"),
      canonicalQuery(url.searchParams),
      canonicalHeaders,
      headerNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${headerNames.join(";")}, Signature=${signature}`;
    return headers;
  }

  private signingKey(dateStamp: string) {
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    return hmac(serviceKey, "aws4_request");
  }

  private presignedUrl(method: string, url: URL, expiresSeconds: number) {
    const boundedExpiry = Math.max(60, Math.min(3600, Math.round(expiresSeconds || 900)));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const query = new URLSearchParams(url.searchParams);
    query.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    query.set("X-Amz-Credential", `${this.accessKeyId}/${scope}`);
    query.set("X-Amz-Date", amzDate);
    query.set("X-Amz-Expires", String(boundedExpiry));
    query.set("X-Amz-SignedHeaders", "host");
    if (this.sessionToken) query.set("X-Amz-Security-Token", this.sessionToken);
    const canonicalUri = url.pathname.split("/").map((segment) => awsEncode(decodeURIComponent(segment))).join("/");
    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      canonicalQuery(query),
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign, "utf8").digest("hex");
    query.set("X-Amz-Signature", signature);
    const signed = new URL(url.toString());
    signed.search = canonicalQuery(query);
    return { url: signed.toString(), expiresAt: new Date(now.getTime() + boundedExpiry * 1000) };
  }

  private async request(method: string, url: URL, input: { headers?: Record<string, string>; body?: Readable | Buffer | null; payloadHash?: string; maxResponseBytes?: number; signal?: AbortSignal } = {}) {
    const payloadHash = input.payloadHash || sha256("");
    const signed = this.signedHeaders(method, url, payloadHash, input.headers || {});
    const requestModule = url.protocol === "https:" ? https : http;
    return new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = requestModule.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: signed,
        servername: url.hostname,
      }, (res) => {
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
          resolve(res);
          return;
        }
        let total = 0;
        const chunks: Buffer[] = [];
        const max = input.maxResponseBytes ?? 256 * 1024;
        res.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total <= max) chunks.push(buffer);
        });
        res.on("end", () => reject(Object.assign(
          new Error(`S3 ${method} failed with HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 2000)}`),
          { storageHttpStatus: res.statusCode,
            storageErrorCode: /<Code>([A-Za-z0-9_-]{1,64})<\/Code>/.exec(Buffer.concat(chunks).toString("utf8"))?.[1] || null },
        )));
        res.on("error", reject);
      });
      const onAbort = () => req.destroy(input.signal?.reason instanceof Error ? input.signal.reason : new OperationCancelledError("S3 storage request cancelled."));
      if (input.signal?.aborted) onAbort();
      else input.signal?.addEventListener("abort", onAbort, { once: true });
      req.setTimeout(30_000, () => req.destroy(new Error("S3 request timed out.")));
      req.on("close", () => input.signal?.removeEventListener("abort", onAbort));
      req.on("error", reject);
      if (Buffer.isBuffer(input.body)) req.end(input.body);
      else if (input.body) input.body.pipe(req);
      else req.end();
    });
  }

  async copyObject(sourceKey: string, targetKey: string, input: { checksumSha256?: string | null; signal?: AbortSignal } = {}) {
    throwIfAborted(input.signal);
    const encodedSource = `/${this.bucket}/${sourceKey.split("/").map(awsEncode).join("/")}`;
    const headers: Record<string, string> = {
      "x-amz-copy-source": encodedSource,
      "x-amz-metadata-directive": "REPLACE",
    };
    if (input.checksumSha256) headers["x-amz-meta-cluster-sha256"] = input.checksumSha256;
    const response = await this.request("PUT", this.objectUrl(targetKey), {
      headers,
      payloadHash: sha256(""),
      signal: input.signal,
    });
    await requireS3WriteSuccess(response, "CopyObject");
    return this.stat(targetKey);
  }

  async createMultipartUpload(key: string, input: { contentType?: string | null; signal?: AbortSignal } = {}): Promise<StorageMultipartSession> {
    throwIfAborted(input.signal);
    const query = new URLSearchParams();
    query.set("uploads", "");
    const headers: Record<string, string> = {};
    if (input.contentType) headers["content-type"] = String(input.contentType);
    const initiated = await this.request("POST", this.objectUrl(key, query), { headers, payloadHash: sha256(""), signal: input.signal });
    const chunks: Buffer[] = [];
    for await (const chunk of initiated) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const xml = Buffer.concat(chunks).toString("utf8");
    const uploadId = xml.match(/<UploadId>([\s\S]*?)<\/UploadId>/)?.[1];
    if (!uploadId) throw new Error("S3 multipart upload did not return an UploadId.");
    return { uploadId: xmlDecode(uploadId) };
  }

  async createMultipartPartUploadUrl(key: string, uploadId: string, partNumber: number, expiresSeconds: number) {
    const boundedPart = Math.max(1, Math.min(10_000, Math.round(partNumber)));
    const query = new URLSearchParams({ partNumber: String(boundedPart), uploadId });
    return this.presignedUrl("PUT", this.objectUrl(key, query), expiresSeconds);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: StorageMultipartPart[], input: { checksumSha256?: string | null; signal?: AbortSignal } = {}) {
    throwIfAborted(input.signal);
    const ordered = [...parts].sort((left, right) => left.partNumber - right.partNumber);
    if (!ordered.length) throw new Error("S3 multipart completion requires at least one part.");
    const body = Buffer.from(
      `<CompleteMultipartUpload>${ordered.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>&quot;${String(part.etag).replace(/^"|"$/g, "")}&quot;</ETag></Part>`).join("")}</CompleteMultipartUpload>`,
      "utf8",
    );
    const response = await this.request("POST", this.objectUrl(key, new URLSearchParams({ uploadId })), {
      headers: { "content-length": String(body.length), "content-type": "application/xml" },
      body,
      payloadHash: sha256(body),
      signal: input.signal,
    });
    await requireS3WriteSuccess(response, "CompleteMultipartUpload");
    const statResult = await this.stat(key);
    return { ...statResult, checksumSha256: input.checksumSha256 || statResult.checksumSha256 || null };
  }

  /** Inspect at most 100 remote parts. A 404 is evidence that this specific
   * multipart ID is unavailable, not that uploaded bytes never existed.
   * ETags and remote identifiers stay server-side.
   */
  async inspectMultipartUpload(key: string, uploadId: string): Promise<StorageMultipartInspection> {
    if (!uploadId || uploadId.length > 1024 || /[\u0000-\u001f]/.test(uploadId)) throw new Error("Invalid multipart inspection identity.");
    const response = await this.request("GET", this.objectUrl(key, new URLSearchParams({
      uploadId, "max-parts": "100",
    })), { payloadHash: "UNSIGNED-PAYLOAD", maxResponseBytes: 128 * 1024 }).catch((error: any) => {
      if (error?.storageHttpStatus === 404 && error?.storageErrorCode === "NoSuchUpload") return null;
      throw error;
    });
    if (!response) return { state: "not_found", observedParts: 0, observedBytes: 0, truncated: false };
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += part.length;
      if (length > 128 * 1024) throw new Error("Multipart inspection response exceeded the evidence limit.");
      chunks.push(part);
    }
    const xml = Buffer.concat(chunks).toString("utf8");
    if (!/<ListPartsResult(?:\s[^>]*)?>/.test(xml) || !/<\/ListPartsResult>/.test(xml)) throw new Error("Multipart inspection returned an invalid response.");
    const observed = [...xml.matchAll(/<Part>\s*([\s\S]*?)<\/Part>/g)];
    if (observed.length > 100) throw new Error("Multipart inspection returned more parts than requested.");
    const sizes = observed.map((match) => Number(/<Size>(\d+)<\/Size>/.exec(match[1] || "")?.[1]));
    if (sizes.some((size) => !Number.isSafeInteger(size) || size < 0)) throw new Error("Multipart inspection contains an invalid part length.");
    return {
      state: "active", observedParts: sizes.length,
      observedBytes: sizes.reduce((sum, size) => sum + size, 0),
      truncated: /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml),
    };
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    const response = await this.request("DELETE", this.objectUrl(key, new URLSearchParams({ uploadId })), { payloadHash: "UNSIGNED-PAYLOAD" });
    response.resume();
  }

  async putFile(key: string, sourcePath: string, options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    const info = await stat(sourcePath);
    const threshold = Math.max(32 * 1024 * 1024, Number(process.env.CLUSTER_STORAGE_MULTIPART_THRESHOLD_BYTES || 100 * 1024 * 1024));
    if (info.size < threshold) return this.putStream(key, createReadStream(sourcePath, options.signal ? { signal: options.signal } : undefined), { size: info.size, signal: options.signal });

    const partSize = Math.max(8 * 1024 * 1024, Number(process.env.CLUSTER_STORAGE_MULTIPART_PART_BYTES || 32 * 1024 * 1024));
    const parallelism = Math.max(1, Math.min(8, Number(process.env.CLUSTER_STORAGE_MULTIPART_CONCURRENCY || 4)));
    const { uploadId } = await this.createMultipartUpload(key, { signal: options.signal });

    const parts = Array.from({ length: Math.ceil(info.size / partSize) }, (_, index) => {
      const start = index * partSize;
      const end = Math.min(info.size - 1, start + partSize - 1);
      return { partNumber: index + 1, start, end, size: end - start + 1 };
    });
    const completed = new Array<{ partNumber: number; etag: string }>(parts.length);
    let cursor = 0;

    const uploadPart = async () => {
      while (cursor < parts.length) {
        const part = parts[cursor++]!;
        const query = new URLSearchParams({ partNumber: String(part.partNumber), uploadId });
        throwIfAborted(options.signal);
        const response = await this.request("PUT", this.objectUrl(key, query), {
          headers: { "content-length": String(part.size), "content-type": "application/octet-stream" },
          body: createReadStream(sourcePath, { start: part.start, end: part.end, ...(options.signal ? { signal: options.signal } : {}) }),
          payloadHash: "UNSIGNED-PAYLOAD",
          signal: options.signal,
        });
        const etag = String(response.headers.etag || "").replace(/^"|"$/g, "");
        response.resume();
        if (!etag) throw new Error(`S3 multipart part ${part.partNumber} did not return an ETag.`);
        completed[part.partNumber - 1] = { partNumber: part.partNumber, etag };
      }
    };

    try {
      await Promise.all(Array.from({ length: parallelism }, () => uploadPart()));
      await this.completeMultipartUpload(
        key,
        uploadId,
        completed.map((part, index) => ({ ...part, sizeBytes: parts[index]!.size })),
        { signal: options.signal },
      );
      return { size: info.size, modifiedAt: new Date(), checksumSha256: null };
    } catch (error) {
      await this.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  async putStream(key: string, stream: Readable, input: { size: number; checksumSha256?: string | null; signal?: AbortSignal }): Promise<StorageObjectStat> {
    throwIfAborted(input.signal);
    const url = this.objectUrl(key);
    const headers: Record<string, string> = {
      "content-length": String(input.size),
      "content-type": "application/octet-stream",
    };
    if (input.checksumSha256) headers["x-amz-meta-cluster-sha256"] = input.checksumSha256;
    const response = await this.request("PUT", url, { headers, body: stream, payloadHash: "UNSIGNED-PAYLOAD", signal: input.signal });
    response.resume();
    return { size: input.size, modifiedAt: new Date(), checksumSha256: input.checksumSha256 || null };
  }

  async openRead(key: string, range?: StorageReadRange) {
    const headers: Record<string, string> = {};
    if (range) headers.range = `bytes=${range.start}-${range.end}`;
    return this.request("GET", this.objectUrl(key), { headers, payloadHash: "UNSIGNED-PAYLOAD" });
  }

  async stat(key: string): Promise<StorageObjectStat> {
    const response = await this.request("HEAD", this.objectUrl(key), { payloadHash: "UNSIGNED-PAYLOAD" });
    const size = Number(response.headers["content-length"] || 0);
    const modifiedAt = response.headers["last-modified"] ? new Date(String(response.headers["last-modified"])) : new Date();
    const checksumSha256 = response.headers["x-amz-meta-cluster-sha256"] ? String(response.headers["x-amz-meta-cluster-sha256"]) : null;
    // Version IDs are opaque provider observations. An unversioned S3 object
    // may report "null"; never use ETag or Last-Modified as a generation lease.
    const rawVersionId = response.headers["x-amz-version-id"];
    const providerVersionId = typeof rawVersionId === "string" && rawVersionId !== "null"
      && rawVersionId.length >= 1 && rawVersionId.length <= 1024 && !/[\x00-\x1f]/.test(rawVersionId)
      ? rawVersionId : null;
    response.resume();
    return { size, modifiedAt, checksumSha256, providerVersionId };
  }

  async delete(key: string) {
    const response = await this.request("DELETE", this.objectUrl(key), { payloadHash: "UNSIGNED-PAYLOAD" });
    response.resume();
  }

  async list(prefix: string) {
    const results: string[] = [];
    let continuation: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ "list-type": "2", prefix });
      if (continuation) query.set("continuation-token", continuation);
      const response = await this.request("GET", this.objectUrl("", query), { payloadHash: "UNSIGNED-PAYLOAD", maxResponseBytes: 4 * 1024 * 1024 });
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const xml = Buffer.concat(chunks).toString("utf8");
      for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) results.push(xmlDecode(match[1] || ""));
      const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
      if (!next) break;
      continuation = xmlDecode(next);
    }
    return results;
  }

  async browserUploadCapability(origin: string | null): Promise<StorageBrowserUploadCapability> {
    const checkedAt = new Date();
    const normalizedOrigin = String(origin || "").trim() || null;
    if (!normalizedOrigin) {
      return {
        state: "unverified",
        origin: null,
        detail: "Browser origin is unknown, so object-storage CORS cannot be verified server-side.",
        allowsPut: null,
        exposesEtag: null,
        allowsContentType: null,
        checkedAt,
      };
    }
    try {
      const response = await this.request("GET", this.objectUrl("", new URLSearchParams({ cors: "" })), {
        payloadHash: "UNSIGNED-PAYLOAD",
        maxResponseBytes: 512 * 1024,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const xml = Buffer.concat(chunks).toString("utf8");
      const rules = [...xml.matchAll(/<CORSRule>([\s\S]*?)<\/CORSRule>/g)].map((match) => match[1] || "");
      const parsed = rules.map((rule) => ({
        origins: [...rule.matchAll(/<AllowedOrigin>([\s\S]*?)<\/AllowedOrigin>/g)].map((match) => xmlDecode(match[1] || "").trim()),
        methods: [...rule.matchAll(/<AllowedMethod>([\s\S]*?)<\/AllowedMethod>/g)].map((match) => xmlDecode(match[1] || "").trim().toUpperCase()),
        headers: [...rule.matchAll(/<AllowedHeader>([\s\S]*?)<\/AllowedHeader>/g)].map((match) => xmlDecode(match[1] || "").trim().toLowerCase()),
        expose: [...rule.matchAll(/<ExposeHeader>([\s\S]*?)<\/ExposeHeader>/g)].map((match) => xmlDecode(match[1] || "").trim().toLowerCase()),
      }));
      const applicable = parsed.filter((rule) => rule.origins.some((allowed) => wildcardMatches(allowed, normalizedOrigin)));
      const allowsPut = applicable.some((rule) => rule.methods.includes("PUT"));
      const exposesEtag = applicable.some((rule) => rule.expose.some((allowed) => wildcardMatches(allowed, "etag")));
      const allowsContentType = applicable.some((rule) => rule.headers.some((allowed) => wildcardMatches(allowed, "content-type")));
      const ready = allowsPut && exposesEtag && allowsContentType;
      return {
        state: ready ? "ready" : "misconfigured",
        origin: normalizedOrigin,
        detail: ready
          ? "Object-storage CORS permits direct multipart PUT and exposes ETag."
          : `Object-storage CORS is missing ${[
              !allowsPut ? "PUT" : null,
              !allowsContentType ? "AllowedHeader content-type/*" : null,
              !exposesEtag ? "ExposeHeader ETag" : null,
            ].filter(Boolean).join(", ")}.`,
        allowsPut,
        exposesEtag,
        allowsContentType,
        checkedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      const definitelyMissing = /HTTP 404/i.test(message) && /NoSuchCORSConfiguration|cors/i.test(message);
      return {
        state: definitelyMissing ? "misconfigured" : "unverified",
        origin: normalizedOrigin,
        detail: definitelyMissing
          ? "Object-storage bucket has no CORS policy for browser direct uploads."
          : `CORS configuration could not be inspected with the configured credentials: ${message.slice(0, 300)}`,
        allowsPut: definitelyMissing ? false : null,
        exposesEtag: definitelyMissing ? false : null,
        allowsContentType: definitelyMissing ? false : null,
        checkedAt,
      };
    }
  }

  async health() {
    try {
      const response = await this.request("HEAD", this.objectUrl(), { payloadHash: "UNSIGNED-PAYLOAD" });
      response.resume();
      return { ok: true, detail: `${this.endpoint.hostname}/${this.bucket}`, freeBytes: null };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Object storage unavailable.", freeBytes: null };
    }
  }
}
