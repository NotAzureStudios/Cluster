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
  direct_https: ["manual", "caddy", "nginx"],
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
// The Go Host owns *all* web, API, health, and realtime routes. Provider
// ingress must never point directly to the private Node API listener.
function gatewayCaddy(host: string, webPort: number, _apiPort: number, lan: boolean): string {
  return `${lan ? `http://${host}` : host} {\n  reverse_proxy 127.0.0.1:${webPort}\n}\n`;
}
function gatewayNginx(host: string, webPort: number, _apiPort: number, httpOnly: boolean): string {
  return `# Install a trusted TLS certificate before enabling HTTPS.\nserver {\n  listen ${httpOnly ? "80" : "443 ssl"};\n  server_name ${host};\n${httpOnly ? "" : "  ssl_certificate /path/to/fullchain.pem;\n  ssl_certificate_key /path/to/privkey.pem;\n"}  location / {\n    proxy_pass http://127.0.0.1:${webPort};\n    proxy_http_version 1.1;\n    proxy_set_header Host $http_host;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection $connection_upgrade;\n    proxy_read_timeout 3600s;\n    proxy_request_buffering off;\n  }\n}\n# In nginx http {} define: map $http_upgrade $connection_upgrade { default upgrade; '' close; }\n`;
}
export function buildDomainConnectionPlan(host: string, settings: ConnectionConfiguration) {
  validateConnectionConfiguration(settings);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.length > 253 || host.split(".").some(label => !label || label.length > 63)) throw new Error("Invalid bound hostname");
  const { mode, provider, apiPort, webPort, publicPort } = settings;
  const isLanHttp = mode === "lan";
  const nativeDirectHttps = mode === "direct_https" && provider === "manual";
  const canonicalUrl = `${isLanHttp ? "http" : "https"}://${host}${publicPort === (isLanHttp ? 80 : 443) ? "" : `:${publicPort}`}`;
  const instructions: string[] = [
    `Cluster's managed Web/API gateway listens on loopback port ${webPort}; Node API stays private on loopback port ${apiPort}. All ingress routes, including /api and /health, must target the Web gateway only.`,
    `Set publicWebUrl and publicApiUrl to ${canonicalUrl}; set WEB_ORIGIN to ${canonicalUrl}, corsOrigins to ${canonicalUrl}, and use secure session cookies for HTTPS. Restart services after updating boot settings.`,
    "Create or update internal/public DNS as appropriate. DNS binding alone does not deploy this gateway or authenticate its owner.",
    "Test sign-in, API, SSE/realtime, uploads and the Desktop client from an actual remote device before changing your main URL.",
  ];
  const artifacts: { filename: string; contents: string; purpose: string }[] = [];
  if (mode === "lan") {
    instructions.unshift("LAN access must stay inside a trusted private network. Never port-forward a plaintext HTTP origin.");
    if (provider === "manual") instructions.push(`Use an existing LAN proxy on port ${publicPort} to forward every route to the loopback Web gateway port ${webPort}. If using Cluster's native direct-LAN listener instead, configure an explicit private interface and use the real Web port in the public URL. Never forward to the private API port.`);
    else artifacts.push({ filename: provider === "caddy" ? "Caddyfile" : "cluster-nginx.conf", contents: provider === "caddy" ? gatewayCaddy(host, webPort, apiPort, true) : gatewayNginx(host, webPort, apiPort, true), purpose: "LAN-only reverse proxy" });
  } else if (mode === "private_vpn") {
    instructions.unshift("VPN clients must authenticate to the private network before reaching Cluster; Cluster account authentication remains mandatory.");
    if (provider === "tailscale") {
      artifacts.push({ filename: "tailscale-serve.txt", contents: `# Tailscale Serve terminates HTTPS for the tailnet-assigned .ts.net hostname.\n# Cluster's Go Host handles the Web client AND all API routes on one port.\ntailscale serve --bg ${webPort}\ntailscale serve status\n# The canonical URL must match the HTTPS address reported by Tailscale.\n# A custom ${host} hostname requires separate trusted DNS/TLS work.\n`, purpose: "Tailnet-only HTTPS access via the managed Cluster Web/API gateway" });
      instructions.push("Use the actual HTTPS address returned by Tailscale Serve as the Cluster canonical URL until the custom domain has independently working TLS. The stored DNS domain is not automatic Tailscale HTTPS.");
    } else {
      artifacts.push({ filename: "Caddyfile", contents: gatewayCaddy(host, webPort, apiPort, false), purpose: "TLS gateway reachable over the private VPN" });
      instructions.push("Provision your WireGuard/custom VPN yourself, configure split DNS for the custom hostname, and obtain a trusted TLS certificate (usually DNS-01). No VPN keys are stored in this domain record.");
    }
  } else if (mode === "managed_tunnel") {
    if (provider === "cloudflare") {
      artifacts.push({ filename: "cloudflared-config.yml", contents: `# Replace the placeholders; keep the tunnel credentials file private.\ntunnel: YOUR_TUNNEL_UUID\ncredentials-file: C:/REPLACE_WITH_ACTUAL_PATH/TUNNEL_UUID.json\ningress:\n  - hostname: ${host}\n    service: http://127.0.0.1:${webPort}\n  - service: http_status:404\n`, purpose: "Cloudflare locally-managed tunnel ingress" });
      artifacts.push({ filename: "cloudflared-setup.txt", contents: `# Locally-managed Cloudflare Tunnel, Windows PowerShell (separate from Dashboard-managed tunnels).
# Ensure cloudflared.exe is installed and on PATH.
cloudflared tunnel login
cloudflared tunnel create cluster-studio
# Replace the UUID and credentials-file in cloudflared-config.yml with the printed values.
# Use the config file explicitly; a custom filename is NOT discovered automatically.
cloudflared tunnel route dns YOUR_TUNNEL_UUID ${host}
cloudflared --config ./cloudflared-config.yml tunnel ingress validate
cloudflared --config ./cloudflared-config.yml tunnel run YOUR_TUNNEL_UUID
# For permanent service startup, follow Cloudflare's Windows Service instructions.
# Make configuration and tunnel credentials readable by that service identity.
# Never paste credential JSON, tunnel tokens or Access secrets into Cluster.
`, purpose: "Windows locally-managed tunnel setup and configuration validation" });
      artifacts.push({ filename: "cloudflare-dashboard-setup.txt", contents: `# Recommended Cloudflare Dashboard-managed tunnel (Windows).
# 1. Cloudflare dashboard > Networks > Tunnels > Create Tunnel.
# 2. Install the Windows connector as a service using Cloudflare's provided command.
# 3. Set this published application hostname: ${host}
# 4. Set the HTTP service/origin URL: http://127.0.0.1:${webPort}
# 5. Add Cloudflare Access policies and MFA before inviting studio users.
# 6. Confirm the connector is healthy; test login, API and transfers remotely.
# Do NOT also run a locally-managed tunnel for the same hostname.
# Never paste installation tokens into the Cluster domain registry.
`, purpose: "Dashboard-managed connector setup without exposing secrets to Cluster" });
            instructions.push("Create the tunnel and hostname route with Cloudflare, install cloudflared as a managed service, and validate ingress rules. No router port forwarding required.");
      instructions.push("Cloudflare Access policies must account for Desktop-client authentication. Check Cloudflare request-size limits for Library transfers.");
    } else {
      instructions.push(`Configure the custom tunnel's single HTTP origin as http://127.0.0.1:${webPort} for all request paths. Do not configure a second direct-to-API ingress route.`);
    }
  } else if (nativeDirectHttps) {
    instructions.unshift("Native direct HTTPS: the Go Host terminates TLS itself, without Caddy/nginx or Cloudflare.");
    instructions.push("Set webHost to an explicit Windows interface IP, webTlsCertFile and webTlsKeyFile to existing readable PEM files, and leave allowInsecureLanHttp disabled.");
    instructions.push(`Forward only external TCP 443 to the selected Web gateway port ${webPort} when public router access is deliberately enabled. Firewall rules must allow the approved source networks; never open the private Node API or database port.`);
    instructions.push("Replace the placeholders in the generated Server Config example, review with a security PIN, and restart using the native Windows supervisor. No certificates or firewall rules are provisioned automatically.");
    artifacts.push({ filename: "native-https-setup.txt", contents: `# Native Go Host direct HTTPS, Windows.
# REQUIRED: choose an actual interface IP assigned to this Windows server.
webHost = <YOUR_WINDOWS_INTERFACE_IP>
webPort = ${webPort}
serverHost = 127.0.0.1
serverPort = ${apiPort}
publicWebUrl = ${canonicalUrl}
publicApiUrl = ${canonicalUrl}
allowInsecureLanHttp = false
webTlsCertFile = <FULL_PATH_TO_CERTIFICATE_PEM>
webTlsKeyFile = <FULL_PATH_TO_PRIVATE_KEY_PEM>
# Certificates and access rules must be provisioned separately.
# The service account must have read permission to both PEM files.
`, purpose: "Native TLS settings that must be completed in Server Configuration" });
  } else {
    const useCaddy = provider === "caddy";
    artifacts.push({ filename: useCaddy ? "Caddyfile" : "cluster-nginx.conf", contents: useCaddy ? gatewayCaddy(host, webPort, apiPort, false) : gatewayNginx(host, webPort, apiPort, false), purpose: "HTTPS ingress for both web and API" });
    if (useCaddy) artifacts.push({ filename: "caddy-setup.txt", contents: `# Install Caddy v2 from the official project, then from this directory:\ncaddy validate --config Caddyfile\ncaddy run --config Caddyfile\n# Install as a persistent managed service once validation and reachability succeed.\n`, purpose: "Validate and run the public HTTPS gateway" });
    else artifacts.push({ filename: "nginx-setup.txt", contents: `# Put the server block inside your nginx http configuration, configure TLS certificates, then:\nnginx -t\n# Reload the managed nginx service using your platform's service manager.\n`, purpose: "Validate the HTTPS server block" });
    if (mode === "direct_https") instructions.push("Direct public HTTPS requires a public IP, inbound TCP 443 firewall/NAT forwarding to the TLS gateway, and a trusted certificate. Keep both application origins private.");
    else instructions.push("Deploy the reverse proxy at the ingress host; allow inbound HTTPS to the proxy only, not directly to the Cluster API, frontend, PostgreSQL or NAS.");
  }
  const expectedServerConfig = {
    serverHost: "127.0.0.1", serverPort: apiPort,
    webHost: nativeDirectHttps ? "REPLACE_WITH_WINDOWS_INTERFACE_IP" : "127.0.0.1", webPort,
    ...(nativeDirectHttps ? { webTlsCertFile: "REPLACE_WITH_CERTIFICATE_PEM_PATH", webTlsKeyFile: "REPLACE_WITH_PRIVATE_KEY_PEM_PATH", allowInsecureLanHttp: false } : {}),
    publicApiUrl: canonicalUrl, publicWebUrl: canonicalUrl, corsOrigins: canonicalUrl,
    trustedProxy: provider !== "manual", sessionSecure: !isLanHttp,
  };
  artifacts.push({ filename: "cluster-network-settings.json", contents: JSON.stringify(expectedServerConfig, null, 2) + "\n", purpose: "Review and apply these fields in Server Config, then restart Cluster (not a complete import)" });
  artifacts.push({ filename: "connection-check.ps1", contents: `$ErrorActionPreference = 'Stop'\n$base = '${canonicalUrl}'\ntry {\n  $u = [uri]$base\n  if ($u.Scheme -ne '${isLanHttp ? "http" : "https"}') { throw 'Unexpected URL scheme' }\n  $r = Invoke-WebRequest -Uri ($base + '/health') -TimeoutSec 10 -UseBasicParsing\n  Write-Host ('HTTP response: ' + [int]$r.StatusCode)\n  Write-Host 'Check login, SSE/realtime, file transfer and Desktop manually.'\n} catch { Write-Error ('Outside-client reachability failed: ' + $_); exit 1 }\n`, purpose: "Run from a DIFFERENT machine/network after deployment (checks HTTPS certificate validation by default)" });
  instructions.push("Apply the generated Cluster Server Config fields after review. Changes to server listeners, origin policy, cookies and frontend deployment require service restart.");
  return { mode, provider, canonicalUrl, origin: { web: `http://127.0.0.1:${webPort}`, api: `http://127.0.0.1:${apiPort}` }, publicPort, instructions, artifacts, deploymentState: "operator_action_required" as const };
}
