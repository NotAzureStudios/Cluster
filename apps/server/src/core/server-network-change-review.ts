import { isIP } from "node:net";

/** Policy-only review. Never binds a socket, changes a firewall, or applies a configuration. */
export const NETWORK_REVIEW_KEYS = [
  "serverHost", "serverPort", "webHost", "webPort", "allowInsecureLanHttp", "webTlsCertFile", "webTlsKeyFile", "publicApiUrl", "publicWebUrl",
  "corsOrigins", "trustedProxy", "sessionSecure", "lanDiscoveryEnabled",
] as const;
export type NetworkReviewKey = (typeof NETWORK_REVIEW_KEYS)[number];
export type NetworkReviewIssue = { code: string; field: string; message: string };
const privatePostgresqlPort = 54321; // Managed private runtime; verified again by native preflight.

function hostKind(value: unknown): "loopback" | "wildcard" | "explicit" | "invalid" {
  if (typeof value !== "string" || !value.trim() || value.length > 255 || value !== value.trim()) return "invalid";
  const host = value.toLowerCase();
  if (host === "localhost" || host === "::1" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) && isIP(host) === 4) return "loopback";
  if (host === "0.0.0.0" || host === "::") return "wildcard";
  if (isIP(host)) return "explicit";
  return "invalid"; // No ambiguous DNS names or zone-indexed IPv6 in a listener bind.
}
function explicitPrivateLAN(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (isIP(value) === 4) {
    const octets = value.split(".").map(Number);
    return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  if (isIP(value) === 6) return /^(?:fc|fd)/i.test(value);
  return false;
}
function validPort(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535; }
function originOf(value: unknown): { origin: string; host: string; protocol: string; local: boolean } | null {
  if (typeof value !== "string" || value.length > 2048 || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.hash || url.search || url.pathname !== "/") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const local = hostKind(host) === "loopback";
    return { origin: url.origin, host, protocol: url.protocol, local };
  } catch { return null; }
}
const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

export function reviewNetworkChange(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  options: { managedPrivatePostgresPort?: number } = {},
) {
  const effectiveCurrent: Record<string, unknown> = { serverHost: "127.0.0.1", serverPort: 4000, webHost: "127.0.0.1", webPort: 3000, ...current };
  const candidate: Record<string, unknown> = { ...effectiveCurrent, ...proposed };
  const blockers: NetworkReviewIssue[] = [];
  const warnings: NetworkReviewIssue[] = [];
  const editedKeys = NETWORK_REVIEW_KEYS.filter(key => changed(effectiveCurrent[key], candidate[key]));
  const issue = (kind: "block" | "warn", code: string, field: string, message: string) =>
    (kind === "block" ? blockers : warnings).push({ code, field, message });
  const apiHost = hostKind(candidate.serverHost ?? "127.0.0.1");
  const webHost = hostKind(candidate.webHost ?? "127.0.0.1");
  if (apiHost === "invalid") issue("block", "INVALID_API_BIND", "serverHost", "Private API bind must be a literal IP or localhost.");
  else if (apiHost !== "loopback") issue("block", "API_MUST_BE_PRIVATE", "serverHost", "The managed Node API must remain loopback-only. Expose only a vetted gateway.");
  if (webHost === "invalid") issue("block", "INVALID_WEB_BIND", "webHost", "Gateway bind must be a literal IP or localhost.");
  for (const [key, label] of [["serverPort", "API"], ["webPort", "web gateway"]] as const) {
    const port = candidate[key];
    if (!validPort(port)) issue("block", "INVALID_TCP_PORT", key, `${label} port must be an integer from 1 to 65535.`);
    else if (port < 1024) issue("warn", "PRIVILEGED_PORT", key, `${label} uses a privileged or commonly reserved TCP port. Confirm Windows bindings and firewall intent.`);
  }
  if (validPort(candidate.serverPort) && validPort(candidate.webPort) && candidate.serverPort === candidate.webPort) {
    issue("block", "PORT_COLLISION", "webPort", "Private API and gateway cannot share the same managed listener port.");
  }
  const pgPort = options.managedPrivatePostgresPort ?? privatePostgresqlPort;
  if (validPort(pgPort)) {
    if (candidate.serverPort === pgPort) issue("block", "POSTGRESQL_PORT_COLLISION", "serverPort", "API port conflicts with managed private PostgreSQL.");
    if (candidate.webPort === pgPort) issue("block", "POSTGRESQL_PORT_COLLISION", "webPort", "Gateway port conflicts with managed private PostgreSQL.");
  }
  const allowInsecureLAN = candidate.allowInsecureLanHttp === true;
  if (candidate.allowInsecureLanHttp !== undefined && typeof candidate.allowInsecureLanHttp !== "boolean") {
    issue("block", "INVALID_LAN_ACKNOWLEDGEMENT", "allowInsecureLanHttp", "LAN HTTP acknowledgement must be a boolean.");
  }
  const certPath = candidate.webTlsCertFile;
  const keyPath = candidate.webTlsKeyFile;
  for (const [field, value] of [["webTlsCertFile", certPath], ["webTlsKeyFile", keyPath]] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length > 2048 || value.includes("\u0000") || value.includes("://"))) {
      issue("block", "INVALID_TLS_FILE_PATH", field, "Provide a local certificate/key file path, not a URL or certificate contents.");
    }
  }
  const hasCert = typeof certPath === "string" && certPath.trim().length > 0;
  const hasKey = typeof keyPath === "string" && keyPath.trim().length > 0;
  if (hasCert !== hasKey) issue("block", "INCOMPLETE_TLS_PAIR", "webTlsKeyFile", "Direct HTTPS requires both certificate and private key file paths.");
  if (allowInsecureLAN && hasCert) issue("block", "CONFLICTING_TRANSPORT", "allowInsecureLanHttp", "Choose direct TLS or acknowledged LAN HTTP, not both.");
  const apiUrl = originOf(candidate.publicApiUrl);
  const webUrl = originOf(candidate.publicWebUrl);
  for (const [key, url] of [["publicApiUrl", apiUrl], ["publicWebUrl", webUrl]] as const) {
    if (candidate[key] && !url) issue("block", "INVALID_PUBLIC_ORIGIN", key, "Use an HTTP(S) origin only, with no credentials, path, query or fragment.");
    if (url?.protocol === "http:" && !url.local) issue("warn", "PUBLIC_HTTP", key, "HTTP without TLS exposes credentials on untrusted networks. Use HTTPS for public access.");
  }
  if ((apiUrl && !apiUrl.local && apiUrl.protocol === "https:") || (webUrl && !webUrl.local && webUrl.protocol === "https:")) {
    if (candidate.sessionSecure !== true) issue("block", "HTTPS_REQUIRES_SECURE_COOKIE", "sessionSecure", "Enable secure session cookies for externally addressed HTTPS origins.");
  }
  if (webHost !== "loopback" && webHost !== "invalid") {
    if (!webUrl || webUrl.local) {
      issue("block", "REMOTE_GATEWAY_ORIGIN_REQUIRED", "publicWebUrl", "An exposed listener requires an explicit member-facing non-loopback web origin.");
    }
    if (allowInsecureLAN) {
      if (!explicitPrivateLAN(candidate.webHost)) issue("block", "INSECURE_LAN_NOT_PRIVATE", "webHost", "Plain HTTP is permitted only on a specific RFC1918/ULA private interface, never a wildcard or public bind.");
      if (webUrl?.protocol !== "http:") issue("block", "LAN_HTTP_ORIGIN_MISMATCH", "publicWebUrl", "Plain LAN HTTP requires an HTTP web origin.");
      issue("warn", "LAN_HTTP_RISK", "allowInsecureLanHttp", "LAN HTTP sends credentials without TLS. Use only on a trusted network with a restricted Windows Firewall rule.");
    } else if (!hasCert || !hasKey) {
      issue("block", "REMOTE_TLS_REQUIRED", "webTlsCertFile", "A non-loopback gateway requires a direct TLS certificate/key pair or explicit private-LAN HTTP acknowledgement.");
    }
    if (hasCert && hasKey && webUrl?.protocol !== "https:") issue("block", "DIRECT_TLS_REQUIRES_HTTPS", "publicWebUrl", "Direct TLS requires an HTTPS public web origin.");
    issue("warn", "GATEWAY_EXPOSED", "webHost", "Gateway may be reachable beyond localhost. Managed Host requires explicit remote-access authorization and a trusted TLS certificate, or a separately approved insecure-LAN policy. Inspect Windows Firewall and gateway reachability before restart.");
    if (candidate.trustedProxy === true) issue("block", "PUBLIC_PROXY_HEADER_TRUST", "trustedProxy", "Do not trust arbitrary forwarded headers on a directly reachable gateway. Bind behind a restricted trusted proxy.");
  }
  if (webHost === "loopback" && allowInsecureLAN) {
    issue("warn", "INACTIVE_LAN_HTTP", "allowInsecureLanHttp", "LAN HTTP acknowledgement is inactive while the gateway is bound to loopback.");
  }
  if (candidate.lanDiscoveryEnabled === true && webHost !== "loopback") issue("warn", "LAN_DISCOVERY", "lanDiscoveryEnabled", "LAN discovery advertises server connection metadata to other devices on the local network.");
  if (candidate.corsOrigins !== undefined && candidate.corsOrigins !== null) {
    if (typeof candidate.corsOrigins !== "string" || candidate.corsOrigins.length > 4000) {
      issue("block", "INVALID_CORS_ORIGIN", "corsOrigins", "CORS origins must be a bounded comma/newline-separated list of HTTP(S) origins.");
    } else {
      const entries = candidate.corsOrigins.split(/[\n,]+/).map(value => value.trim()).filter(Boolean).map(originOf);
      if (entries.some(value => !value)) issue("block", "INVALID_CORS_ORIGIN", "corsOrigins", "CORS entries must be HTTP(S) origins without credentials, paths, queries or fragments.");
      if (webUrl && !entries.some(value => value?.origin === webUrl.origin)) issue("warn", "PUBLIC_WEB_CORS", "corsOrigins", "The web origin is missing from explicit CORS origins. Review cross-origin requests before deploying.");
    }
  }
  if (editedKeys.some(key => ["serverHost", "serverPort", "webHost", "webPort", "publicApiUrl", "publicWebUrl", "trustedProxy", "sessionSecure", "corsOrigins"].includes(key))) {
    issue("warn", "RESTART_REQUIRED", "network", "Network changes are saved for the next managed restart; external gateway and client reachability must be checked afterwards.");
  }
  return {
    ok: blockers.length === 0,
    editedKeys,
    blockers,
    warnings,
    exposure: { api: apiHost === "loopback" ? "loopback" : apiHost, gateway: webHost, windowsFirewall: "not_checked", routerForwarding: "not_checked", externalTls: "not_checked", clientReachability: "not_checked" },
    requiresRestart: editedKeys.some(key => key !== "lanDiscoveryEnabled"),
    requiresExposureConfirmation: editedKeys.some(key => ["webHost", "allowInsecureLanHttp", "webTlsCertFile", "webTlsKeyFile", "publicApiUrl", "publicWebUrl", "trustedProxy", "sessionSecure"].includes(key)) &&
      (allowInsecureLAN || webHost === "wildcard" || webHost === "explicit" || Boolean(apiUrl && !apiUrl.local && apiUrl.protocol === "http:") || Boolean(webUrl && !webUrl.local && webUrl.protocol === "http:")),
    note: "Policy-only preview: no listeners, firewalls, DNS, proxies, TLS certificates or runtime services were modified or probed. Saved settings are not deployed until managed restart.",
  };
}

/** Compare against canonical G27 bound-domain profiles. This does NOT verify an
 * installed proxy/TLS route. Only the fixed local instance is considered. */
export function reviewBoundDomainPortDrift(
  candidates: readonly { id: string; connectionWebPort: number | null; connectionApiPort: number | null }[],
  next: Record<string, unknown>,
): { checked: number; mismatches: { id: string; webPortMismatch: boolean; apiPortMismatch: boolean }[] } {
  const mismatches: { id: string; webPortMismatch: boolean; apiPortMismatch: boolean }[] = [];
  for (const item of candidates) {
    if (typeof item.id !== "string" || !/^[a-f0-9-]{36}$/i.test(item.id)) continue;
    const webPortMismatch = validPort(item.connectionWebPort) && item.connectionWebPort !== (next.webPort ?? 3000);
    const apiPortMismatch = validPort(item.connectionApiPort) && item.connectionApiPort !== (next.serverPort ?? 4000);
    if (webPortMismatch || apiPortMismatch) mismatches.push({ id: item.id, webPortMismatch, apiPortMismatch });
  }
  return { checked: candidates.length, mismatches };
}
