import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { buildDomainConnectionPlan, type ConnectionConfiguration } from "./domain-connection-plans.js";

/** Contract-level readiness only. Never confuses configured settings with an
 * installed gateway, functioning remote login, or trusted TLS certificate. */
export function domainDeploymentReadiness(hostname: string, profile: ConnectionConfiguration, settings: Record<string, unknown>) {
  const plan = buildDomainConnectionPlan(hostname, profile);
  const normalized = (value: unknown) => String(value || "").trim().replace(/\/$/, "").toLowerCase();
  const checks: Array<{ id: string; label: string; expected: string | number | boolean; observed: unknown; pass: boolean }> = [
    { id: "public-web-url", label: "Canonical web URL", expected: plan.canonicalUrl, observed: settings.publicWebUrl || null,
      pass: normalized(settings.publicWebUrl) === normalized(plan.canonicalUrl) },
    { id: "public-api-url", label: "Canonical API URL", expected: plan.canonicalUrl, observed: settings.publicApiUrl || null,
      pass: normalized(settings.publicApiUrl) === normalized(plan.canonicalUrl) },
    { id: "web-port", label: "Web origin port", expected: profile.webPort, observed: settings.webPort || null,
      pass: Number(settings.webPort) === profile.webPort },
    { id: "api-port", label: "API origin port", expected: profile.apiPort, observed: settings.serverPort || null,
      pass: Number(settings.serverPort) === profile.apiPort },
  ];
  checks.push({ id: "cors-origin", label: "Permitted browser origin", expected: plan.canonicalUrl, observed: settings.corsOrigins || null,
    pass: String(settings.corsOrigins || "").split(/[\n,]/).map(normalized).includes(normalized(plan.canonicalUrl)) });
  if (profile.mode !== "lan") {
    const expectsProxy = ["caddy", "nginx", "cloudflare", "tailscale"].includes(profile.provider);
    checks.push({ id: "proxy-trust", label: "Reverse-proxy header trust", expected: expectsProxy,
      observed: settings.trustedProxy ?? null, pass: settings.trustedProxy === expectsProxy });
    checks.push({ id: "secure-cookies", label: "Secure session cookies", expected: true, observed: settings.sessionSecure || null, pass: settings.sessionSecure === true });
  }
  const isLoopback = (host: unknown) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized(host));
  const nativeDirectHttps = profile.mode === "direct_https" && profile.provider === "manual";
  const explicitBind = typeof settings.webHost === "string" && isIP(settings.webHost) !== 0 &&
    !isLoopback(settings.webHost) && !["0.0.0.0", "::"].includes(settings.webHost);
  checks.push({ id: "web-exposure", label: nativeDirectHttps ? "Native HTTPS interface" : "Private web listener",
    expected: nativeDirectHttps ? "explicit Windows interface IP" : "loopback only", observed: settings.webHost || null,
    pass: nativeDirectHttps ? explicitBind : isLoopback(settings.webHost) });
  if (nativeDirectHttps) {
    const fileConfigured = (value: unknown) => typeof value === "string" && value.trim().length > 0 && !value.includes("REPLACE_WITH");
    checks.push({ id: "native-cert-file", label: "Native TLS certificate path", expected: true,
      observed: Boolean(settings.webTlsCertFile), pass: fileConfigured(settings.webTlsCertFile) });
    checks.push({ id: "native-key-file", label: "Native TLS key path", expected: true,
      observed: Boolean(settings.webTlsKeyFile), pass: fileConfigured(settings.webTlsKeyFile) });
    checks.push({ id: "native-lan-http", label: "Plain LAN HTTP disabled", expected: false,
      observed: settings.allowInsecureLanHttp ?? false, pass: settings.allowInsecureLanHttp !== true });
  }
  checks.push({ id: "api-exposure", label: "Private API listener", expected: "loopback only", observed: settings.serverHost || null,
    pass: isLoopback(settings.serverHost) });
  return { configured: checks.every(check => check.pass), checks, gatewayInstalled: "not_verified", tls: "not_verified", outsideReachability: "not_verified", desktopLogin: "not_verified" };
}

/** Reviewed, version-pinned deployment document. Does not include provider
 * tokens, certificates, passwords, filesystem installation instructions that
 * execute without operator review, or any claim of successful provisioning. */
export function domainDeploymentBundle(input: { domainId: string; revision: number; hostname: string; profile: ConnectionConfiguration; instanceId: string }) {
  const plan = buildDomainConnectionPlan(input.hostname, input.profile);
  const payload = {
    format: "cluster-domain-deployment", schemaVersion: 1, domainId: input.domainId, revision: input.revision,
    serverInstanceId: input.instanceId, hostname: input.hostname, mode: input.profile.mode, provider: input.profile.provider,
    deploymentState: "requires_operator_review", artifacts: plan.artifacts, instructions: plan.instructions,
  };
  const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { ...payload, sha256, digestContract: "SHA-256 of UTF-8 JSON.stringify(bundle excluding sha256 and digestContract)" };
}
