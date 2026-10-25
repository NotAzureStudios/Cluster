export type MutationOriginInput = {
  enabled: boolean;
  method: string;
  pathname: string;
  fetchSite?: string | null;
  fetchMode?: string | null;
  fetchDest?: string | null;
  origin?: string | null;
  clusterClientHeadersPresent?: boolean;
  allowedOrigins: ReadonlySet<string>;
};

export type MutationOriginDecision = {
  allowed: boolean;
  reason: "disabled" | "safe_method" | "non_api" | "cross_site" | "allowed_origin" | "untrusted_origin" | "same_origin_metadata" | "native_protocol_headers" | "missing_request_integrity_evidence";
  evidence: "none" | "origin" | "fetch_metadata" | "native_protocol";
};

export function booleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export function mutationOriginDecisionForRequest(input: MutationOriginInput): MutationOriginDecision {
  if (!input.enabled) return { allowed: true, reason: "disabled", evidence: "none" };
  const method = String(input.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { allowed: true, reason: "safe_method", evidence: "none" };
  const pathname = input.pathname || "/";
  if (!pathname.startsWith("/api/")) return { allowed: true, reason: "non_api", evidence: "none" };

  const fetchSite = String(input.fetchSite || "").trim().toLowerCase();
  const fetchMode = String(input.fetchMode || "").trim().toLowerCase();
  const fetchDest = String(input.fetchDest || "").trim().toLowerCase();
  if (fetchSite === "cross-site") return { allowed: false, reason: "cross_site", evidence: "fetch_metadata" };

  const origin = String(input.origin || "").trim();
  if (origin) {
    return input.allowedOrigins.has(origin)
      ? { allowed: true, reason: "allowed_origin", evidence: "origin" }
      : { allowed: false, reason: "untrusted_origin", evidence: "origin" };
  }

  // Same-origin Fetch Metadata is a browser-provided signal. Reject navigational mutation
  // shapes even if Sec-Fetch-Site was forged/forwarded incorrectly by an intermediary.
  if (fetchSite === "same-origin" && fetchMode !== "navigate" && fetchDest !== "document") {
    return { allowed: true, reason: "same_origin_metadata", evidence: "fetch_metadata" };
  }

  // Cluster's native/API clients send both protocol and host headers. Browsers cannot attach
  // these cross-origin without a successful CORS preflight, so they are accepted only when
  // browser Fetch Metadata is absent rather than contradictory.
  if (input.clusterClientHeadersPresent && !fetchSite) {
    return { allowed: true, reason: "native_protocol_headers", evidence: "native_protocol" };
  }

  return { allowed: false, reason: "missing_request_integrity_evidence", evidence: "none" };
}

export function mutationOriginAllowedForRequest(input: MutationOriginInput) {
  return mutationOriginDecisionForRequest(input).allowed;
}

export function safeUrl(value: string | undefined | null, label: string, allowedProtocols = ["http:", "https:"]) {
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label} must use ${allowedProtocols.join(" or ")}.`);
  }
  return parsed.toString();
}

export function validateDiscordWebhookUrl(value: string | undefined | null) {
  if (!value) return "";
  const url = new URL(safeUrl(value, "Discord webhook URL", ["https:"]));
  const allowedHost = url.hostname === "discord.com" || url.hostname === "discordapp.com" || url.hostname.endsWith(".discord.com");
  if (!allowedHost || !url.pathname.startsWith("/api/webhooks/")) {
    throw new Error("Discord webhook URL must be a Discord webhook URL.");
  }
  return url.toString();
}

export function validateCorsOrigins(value: string | undefined | null) {
  if (!value) return "";
  const origins = String(value).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  const normalized = origins.map((origin) => {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error(`Allowed origin must be an http(s) origin without paths or credentials: ${origin}`);
    }
    return parsed.origin;
  });
  return [...new Set(normalized)].join(", ");
}

export function isLoopbackAddress(value: string | undefined | null) {
  const address = String(value || "").trim().toLowerCase();
  if (address === "::1" || address === "localhost") return true;
  const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
  const parts = normalized.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
    && Number(parts[0]) === 127;
}
