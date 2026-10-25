import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export type OutboundRequestPolicy = {
  purpose?: string;
  allowedHosts?: readonly string[];
  allowPrivateNetwork?: boolean;
  requireHttps?: boolean;
  allowHttpPrivateNetwork?: boolean;
  maxRedirects?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Optional PEM trust anchor for an explicitly trusted self-hosted/private endpoint. Default platform trust remains the normal path. */
  trustedCaPem?: string | Buffer;
  /** Optional SHA-256 certificate fingerprints. Pinning supplements normal hostname/certificate validation; it never disables verification. */
  pinnedCertificateSha256?: readonly string[];
};

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const ALWAYS_BLOCKED_V4 = [
  ["0.0.0.0", 8],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;
const PRIVATE_V4 = [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
] as const;

function ipv4ToInt(value: string) {
  return value.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;
}

function ipv4InCidr(value: string, base: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(value) & mask) === (ipv4ToInt(base) & mask);
}

function normalizedIp(value: string) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (trimmed.startsWith("::ffff:") && net.isIP(trimmed.slice(7)) === 4) return trimmed.slice(7);
  return trimmed;
}

export function classifyOutboundAddress(value: string) {
  const address = normalizedIp(value);
  const family = net.isIP(address);
  if (!family) return { address, family: 0, alwaysBlocked: true, privateNetwork: true };
  if (family === 4) {
    const alwaysBlocked = ALWAYS_BLOCKED_V4.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
    const privateNetwork = alwaysBlocked || PRIVATE_V4.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
    return { address, family, alwaysBlocked, privateNetwork };
  }

  const compact = address.replace(/^\[|\]$/g, "");
  const alwaysBlocked = compact === "::" || compact.startsWith("fe8") || compact.startsWith("fe9") || compact.startsWith("fea") || compact.startsWith("feb") || compact.startsWith("ff");
  const privateNetwork = alwaysBlocked || compact === "::1" || compact.startsWith("fc") || compact.startsWith("fd") || compact.startsWith("2001:db8:");
  return { address: compact, family, alwaysBlocked, privateNetwork };
}

function safeHostLabel(url: URL, policy: OutboundRequestPolicy) {
  return `${policy.purpose || "outbound request"} (${url.hostname})`;
}

export function normalizeCertificateFingerprint(value: string) {
  return String(value || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function certificateIdentityPolicy(policy: OutboundRequestPolicy) {
  const pins = (policy.pinnedCertificateSha256 || []).map(normalizeCertificateFingerprint).filter((value) => value.length === 64);
  if (!pins.length) return undefined;
  return (hostname: string, certificate: tls.PeerCertificate) => {
    const identityError = tls.checkServerIdentity(hostname, certificate);
    if (identityError) return identityError;
    const actual = normalizeCertificateFingerprint(certificate.fingerprint256 || "");
    if (!actual || !pins.includes(actual)) return new Error(`${policy.purpose || "Outbound request"} certificate fingerprint does not match the configured trusted pin.`);
    return undefined;
  };
}

export function validateOutboundUrl(rawUrl: string, policy: OutboundRequestPolicy = {}) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${policy.purpose || "Outbound request"} URL is invalid.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${policy.purpose || "Outbound request"} must use HTTP or HTTPS.`);
  if ((policy.requireHttps || !policy.allowHttpPrivateNetwork) && url.protocol !== "https:") throw new Error(`${policy.purpose || "Outbound request"} requires HTTPS.`);
  if (url.username || url.password) throw new Error(`${policy.purpose || "Outbound request"} URL must not contain embedded credentials.`);
  if (url.hash) throw new Error(`${policy.purpose || "Outbound request"} URL must not contain a fragment.`);
  const allowedHosts = (policy.allowedHosts || []).map((host) => host.toLowerCase());
  if (allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`${policy.purpose || "Outbound request"} host is not allowlisted.`);
  }
  return url;
}

async function resolveValidatedAddress(url: URL, policy: OutboundRequestPolicy) {
  const connectionHost = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(connectionHost);
  const resolved = literalFamily
    ? [{ address: connectionHost, family: literalFamily }]
    : await dns.lookup(connectionHost, { all: true, verbatim: true });
  if (!resolved.length) throw new Error(`${safeHostLabel(url, policy)} did not resolve to an address.`);

  const approved = resolved.map((entry) => classifyOutboundAddress(entry.address));
  for (const entry of approved) {
    if (entry.alwaysBlocked) throw new Error(`${safeHostLabel(url, policy)} resolved to a blocked local/link address.`);
    if (entry.privateNetwork && !policy.allowPrivateNetwork) throw new Error(`${safeHostLabel(url, policy)} resolved to a private/reserved address.`);
  }
  return approved[0]!;
}

function requestBodyBuffer(body: RequestInit["body"], maxBytes: number) {
  if (body === undefined || body === null) return null;
  let buffer: Buffer;
  if (typeof body === "string") buffer = Buffer.from(body, "utf8");
  else if (body instanceof URLSearchParams) buffer = Buffer.from(body.toString(), "utf8");
  else if (body instanceof ArrayBuffer) buffer = Buffer.from(body);
  else if (ArrayBuffer.isView(body)) buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else if (Buffer.isBuffer(body)) buffer = body;
  else throw new Error("Outbound request body type is not supported by Cluster's bounded HTTP client.");
  if (buffer.length > maxBytes) throw new Error(`Outbound request body exceeds the ${maxBytes}-byte limit.`);
  return buffer;
}

function safeHeaders(input: HeadersInit | undefined) {
  const headers = new Headers(input || {});
  for (const name of ["host", "connection", "proxy-authorization", "proxy-connection", "transfer-encoding", "content-length"]) headers.delete(name);
  return headers;
}

function headersToNode(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}

function responseHeaders(input: http.IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, String(value));
  }
  return headers;
}

function redirectedMethod(status: number, method: string) {
  if (status === 303 && method !== "HEAD") return "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

export async function secureOutboundFetch(rawUrl: string, init: RequestInit = {}, timeoutMs = 15_000, policy: OutboundRequestPolicy = {}): Promise<Response> {
  const maxRedirects = Math.max(0, Math.min(8, policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS));
  const maxRequestBytes = Math.max(0, policy.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES);
  const maxResponseBytes = Math.max(1, policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  let url = validateOutboundUrl(rawUrl, policy);
  let method = String(init.method || "GET").toUpperCase();
  let body = requestBodyBuffer(init.body, maxRequestBytes);
  let headers = safeHeaders(init.headers);

  for (let redirectCount = 0; ; redirectCount++) {
    const pinned = await resolveValidatedAddress(url, policy);
    if (url.protocol === "http:" && (!policy.allowHttpPrivateNetwork || !pinned.privateNetwork)) {
      throw new Error(`${policy.purpose || "Outbound request"} permits plain HTTP only to an explicitly allowed private-network destination.`);
    }
    const requestModule = url.protocol === "https:" ? https : http;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

    const result = await new Promise<{ status: number; statusText: string; headers: Headers; body: Buffer }>((resolve, reject) => {
      let settled = false;
      const req = requestModule.request({
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: headersToNode(headers),
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family as 4 | 6),
        servername: url.protocol === "https:" && net.isIP(url.hostname) === 0 ? url.hostname : undefined,
        ...(url.protocol === "https:" && policy.trustedCaPem ? { ca: policy.trustedCaPem } : {}),
        ...(url.protocol === "https:" && policy.pinnedCertificateSha256?.length ? { checkServerIdentity: certificateIdentityPolicy(policy) } : {}),
      }, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > maxResponseBytes) {
            res.destroy(new Error(`Outbound response exceeds the ${maxResponseBytes}-byte limit.`));
            return;
          }
          chunks.push(buffer);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status: res.statusCode || 0, statusText: res.statusMessage || "", headers: responseHeaders(res.headers), body: Buffer.concat(chunks) });
        });
        res.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
      });
      const timer = setTimeout(() => req.destroy(new Error(`${policy.purpose || "Outbound request"} timed out.`)), Math.max(1, timeoutMs));
      (timer as any).unref?.();
      req.on("close", () => clearTimeout(timer));
      req.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
      if (init.signal) {
        const abort = () => req.destroy(new Error(`${policy.purpose || "Outbound request"} aborted.`));
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort, { once: true });
      }
      if (body?.length) req.write(body);
      req.end();
    });

    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.get("location")) {
      if (redirectCount >= maxRedirects) throw new Error(`${policy.purpose || "Outbound request"} exceeded the redirect limit.`);
      const next = validateOutboundUrl(new URL(result.headers.get("location")!, url).toString(), policy);
      if (next.origin !== url.origin) throw new Error(`${policy.purpose || "Outbound request"} cross-origin redirect was blocked.`);
      const nextMethod = redirectedMethod(result.status, method);
      if (nextMethod !== method) {
        method = nextMethod;
        body = null;
        headers.delete("content-type");
      }
      url = next;
      continue;
    }

    return new Response(new Uint8Array(result.body), { status: result.status, statusText: result.statusText, headers: result.headers });
  }
}
