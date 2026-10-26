/** Connection deployment profiles for a verified, locally-bound Studio domain.
 * These generate operator-managed configurations. Nothing launches a process,
 * changes DNS, opens a firewall, or handles third-party provider credentials.
 */
export const CONNECTION_MODES = ["lan", "private_vpn", "reverse_proxy", "direct_https", "managed_tunnel"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];
export type ConnectionProvider = "manual" | "tailscale" | "wireguard" | "caddy" | "nginx" | "cloudflare" | "custom";
export type ConnectionConfiguration = { mode: ConnectionMode; provider: ConnectionProvider; webPort: number; apiPort: number; publicPort: number };
const providers: Record<ConnectionMode, readonly ConnectionProvider[]> = {
  lan: ["manual", "caddy", "nginx"],
  private_vpn: ["tailscale", "wireguard", "custom"],
  reverse_proxy: ["caddy", "nginx", "custom"],
  direct_https: ["caddy", "nginx"],
  managed_tunnel: ["cloudflare", "custom"],
};
export function validateConnectionConfiguration(value: ConnectionConfiguration): ConnectionConfiguration {
  if (!CONNECTION_MODES.includes(value.mode) || !providers[value.mode]?.includes(value.provider)) throw new Error("Unsupported connection mode/provider combination");
  const ports = [value.webPort, value.apiPort, value.publicPort];
  if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("Invalid connection port");
  if (value.webPort === value.apiPort) throw new Error("Frontend and API origins must be separate");
  if ((value.mode === "managed_tunnel" || value.mode === "direct_https" || value.mode === "reverse_proxy") && value.publicPort !== 443) throw new Error("External HTTPS must use port 443");
  return value;
}
function gatewayCaddy(host: string, webPort: number, apiPort: number, lan: boolean): string {
  return `${lan ? `http://${host}` : host} {\n  @api path /api/* /health /.well-known/security.txt /security.txt\n  reverse_proxy @api 127.0.0.1:${apiPort}\n  reverse_proxy 127.0.0.1:${webPort}\n}\n`;
}
function gatewayNginx(host: string, webPort: number, apiPort: number, httpOnly: boolean): string {
  return `# Install an authenticated, valid TLS certificate before enabling HTTPS.\nserver {\n  listen ${httpOnly ? "80" : "443 ssl"};\n  server_name ${host};\n${httpOnly ? "" : "  ssl_certificate /path/to/fullchain.pem;\n  ssl_certificate_key /path/to/privkey.pem;\n"}  location ~ ^/(api/|health$|\\.well-known/security\\.txt$|security\\.txt$) {\n    proxy_pass http://127.0.0.1:${apiPort};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection $connection_upgrade;\n    proxy_read_timeout 3600s;\n    proxy_request_buffering off;\n  }\n  location / {\n    proxy_pass http://127.0.0.1:${webPort};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Proto $scheme;\n  }\n}\n# In nginx http {} define: map $http_upgrade $connection_upgrade { default upgrade; '' close; }\n`;
}
export function buildDomainConnectionPlan(host: string, settings: ConnectionConfiguration) {
  validateConnectionConfiguration(settings);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.length > 253 || host.split(".").some(label => !label || label.length > 63)) throw new Error("Invalid bound hostname");
  const { mode, provider, apiPort, webPort, publicPort } = settings;
  const isLanHttp = mode === "lan";
  const isPrivateTailscale = mode === "private_vpn" && provider === "tailscale";
  const canonicalUrl = `${isLanHttp ? "http" : "https"}://${host}${publicPort === (isLanHttp ? 80 : 443) ? "" : `:${publicPort}`}`;
  const instructions: string[] = [
    `Cluster web frontend must listen on loopback port ${webPort}; Cluster API must listen on loopback port ${apiPort}. Do not expose PostgreSQL or storage ports.`,
    `Set publicWebUrl and publicApiUrl to ${canonicalUrl}; set WEB_ORIGIN to ${canonicalUrl}, corsOrigins to ${canonicalUrl}, and use secure session cookies for HTTPS. Restart services after updating boot settings.`,
    "Create or update internal/public DNS as appropriate. DNS binding alone does not deploy this gateway or authenticate its owner.",
    "Test sign-in, API, SSE/realtime, uploads and the Desktop client from an actual remote device before changing your main URL.",
  ];
  const artifacts: { filename: string; contents: string; purpose: string }[] = [];
  if (mode === "lan") {
    instructions.unshift("LAN access must stay inside a trusted private network. Never port-forward a plaintext HTTP origin.");
    if (provider === "manual") instructions.push("Use your existing local DNS and local HTTP gateway to forward API paths to the API port and other paths to the web port.");
    else artifacts.push({ filename: provider === "caddy" ? "Caddyfile" : "cluster-nginx.conf", contents: provider === "caddy" ? gatewayCaddy(host, webPort, apiPort, true) : gatewayNginx(host, webPort, apiPort, true), purpose: "LAN-only reverse proxy" });
  } else if (mode === "private_vpn") {
    instructions.unshift("VPN clients must authenticate to the private network before reaching Cluster; Cluster account authentication remains mandatory.");
    if (provider === "tailscale") {
      artifacts.push({ filename: "tailscale-serve.txt", contents: `# Tailscale Serve HTTPS uses your machine's tailnet .ts.net hostname.\n# It DOES NOT automatically issue a certificate for ${host}.\ntailscale serve --bg http://127.0.0.1:${webPort}\n# For both front-end and API paths, run the provided Caddy routing gateway on loopback first;\n# point Tailscale Serve to the Caddy listener instead of directly to the frontend.\n`, purpose: "Tailnet-only access (requires local gateway to route API)" });
      artifacts.push({ filename: "Caddyfile", contents: `:8088 {\n  bind 127.0.0.1\n  @api path /api/* /health /.well-known/security.txt /security.txt\n  reverse_proxy @api 127.0.0.1:${apiPort}\n  reverse_proxy 127.0.0.1:${webPort}\n}\n`, purpose: "Local loopback web/API mux for Tailscale Serve" });
      artifacts[0].contents = `# Run Caddy with the accompanying Caddyfile, then:\ntailscale serve --bg http://127.0.0.1:8088\n# Access through the hostname Tailscale assigns (usually machine.tailnet.ts.net).\n# A custom ${host} hostname needs separate private DNS and trusted TLS configuration.\n`;
      instructions.push("The browser URL returned by Tailscale Serve is the actual canonical URL until custom-name TLS is configured; do not claim that custom-domain HTTPS is ready merely because TXT proof passed.");
    } else {
      artifacts.push({ filename: "Caddyfile", contents: gatewayCaddy(host, webPort, apiPort, false), purpose: "TLS gateway reachable over the private VPN" });
      instructions.push("Provision your WireGuard/custom VPN yourself, configure split DNS for the custom hostname, and obtain a trusted TLS certificate (usually DNS-01). No VPN keys are stored in this domain record.");
    }
  } else if (mode === "managed_tunnel") {
    if (provider === "cloudflare") {
      artifacts.push({ filename: "cloudflared-config.yml", contents: `# Replace the placeholders; keep the tunnel credentials file private.\ntunnel: YOUR_TUNNEL_UUID\ncredentials-file: /secure/path/TUNNEL_UUID.json\ningress:\n  - hostname: ${host}\n    path: '^/(api/|health$|\\.well-known/security\\.txt$|security\\.txt$)'\n    service: http://127.0.0.1:${apiPort}\n  - hostname: ${host}\n    service: http://127.0.0.1:${webPort}\n  - service: http_status:404\n`, purpose: "Cloudflare locally-managed tunnel ingress" });
      artifacts.push({ filename: "cloudflared-setup.txt", contents: `# Use your Cloudflare account and an interactive admin shell.\n# Never paste a tunnel token or JSON credentials into the Studio Domain Registry.\ncloudflared tunnel login\ncloudflared tunnel create cluster-studio\n# Copy the resulting tunnel UUID and credentials-file path into cloudflared-config.yml.\ncloudflared tunnel route dns YOUR_TUNNEL_UUID ${host}\ncloudflared tunnel ingress validate\ncloudflared tunnel run YOUR_TUNNEL_UUID\n# Configure persistent service startup separately after manual verification.\n`, purpose: "Provider authorization, DNS route and outbound tunnel setup" });
      instructions.push("Create the tunnel and hostname route with Cloudflare, install cloudflared as a managed service, and validate ingress rules. No router port forwarding required.");
      instructions.push("Cloudflare Access policies must account for Desktop-client authentication. Check Cloudflare request-size limits for Library transfers.");
    } else {
      artifacts.push({ filename: "Caddyfile", contents: `:8088 {\n  bind 127.0.0.1\n  @api path /api/* /health /.well-known/security.txt /security.txt\n  reverse_proxy @api 127.0.0.1:${apiPort}\n  reverse_proxy 127.0.0.1:${webPort}\n}\n`, purpose: "Loopback-only web/API mux for the external TLS tunnel" });
      instructions.push("Configure your provider's tunnel to http://127.0.0.1:8088, then verify its public hostname and HTTPS policy.");
    }
  } else {
    const useCaddy = provider === "caddy";
    artifacts.push({ filename: useCaddy ? "Caddyfile" : "cluster-nginx.conf", contents: useCaddy ? gatewayCaddy(host, webPort, apiPort, false) : gatewayNginx(host, webPort, apiPort, false), purpose: "HTTPS ingress for both web and API" });
    if (useCaddy) artifacts.push({ filename: "caddy-setup.txt", contents: `# Install Caddy v2 from the official project, then from this directory:\ncaddy validate --config Caddyfile\ncaddy run --config Caddyfile\n# Install as a persistent managed service once validation and reachability succeed.\n`, purpose: "Validate and run the public HTTPS gateway" });
    else artifacts.push({ filename: "nginx-setup.txt", contents: `# Put the server block inside your nginx http configuration, configure TLS certificates, then:\nnginx -t\n# Reload the managed nginx service using your platform's service manager.\n`, purpose: "Validate the HTTPS server block" });
    if (mode === "direct_https") instructions.push("Direct public HTTPS requires a public IP, inbound TCP 443 firewall/NAT forwarding to the TLS gateway, and a trusted certificate. Keep both application origins private.");
    else instructions.push("Deploy the reverse proxy at the ingress host; allow inbound HTTPS to the proxy only, not directly to the Cluster API, frontend, PostgreSQL or NAS.");
  }
  const expectedServerConfig = { serverHost: "127.0.0.1", serverPort: apiPort, webHost: "127.0.0.1", webPort, publicApiUrl: canonicalUrl, publicWebUrl: canonicalUrl, corsOrigins: canonicalUrl, trustedProxy: provider !== "manual", sessionSecure: !isLanHttp };
  artifacts.push({ filename: "cluster-network-settings.json", contents: JSON.stringify(expectedServerConfig, null, 2) + "\n", purpose: "Review and apply these fields in Server Config, then restart Cluster (not a complete import)" });
  artifacts.push({ filename: "connection-check.ps1", contents: `$ErrorActionPreference = 'Stop'\n$base = '${canonicalUrl}'\ntry {\n  $u = [uri]$base\n  if ($u.Scheme -ne '${isLanHttp ? "http" : "https"}') { throw 'Unexpected URL scheme' }\n  $r = Invoke-WebRequest -Uri ($base + '/health') -TimeoutSec 10 -UseBasicParsing\n  Write-Host ('HTTP response: ' + [int]$r.StatusCode)\n  Write-Host 'Check login, SSE/realtime, file transfer and Desktop manually.'\n} catch { Write-Error ('Outside-client reachability failed: ' + $_); exit 1 }\n`, purpose: "Run from a DIFFERENT machine/network after deployment (checks HTTPS certificate validation by default)" });
  instructions.push("Apply the generated Cluster Server Config fields after review. Changes to server listeners, origin policy, cookies and frontend deployment require service restart.");
  return { mode, provider, canonicalUrl, origin: { web: `http://127.0.0.1:${webPort}`, api: `http://127.0.0.1:${apiPort}` }, publicPort, instructions, artifacts, deploymentState: "operator_action_required" as const };
}
