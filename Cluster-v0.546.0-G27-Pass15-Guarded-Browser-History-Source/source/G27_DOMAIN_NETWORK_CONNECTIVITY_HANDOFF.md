# G27 Domain Network Connectivity: All Modes

## Source baseline
From `Cluster-v0.546.0-TD6-G27-Domain-Lifecycle-Server-Identity-Source.zip`.

## What this checkpoint DOES implement

- Five access modes, stored as audited, revision-protected profiles on the existing Studio Domain Registry:
  - LAN-only (manual, Caddy, nginx)
  - Private VPN (Tailscale Serve, WireGuard, custom)
  - Reverse proxy (Caddy, nginx, custom)
  - Direct public HTTPS ingress (Caddy or nginx with public TCP/443 and trusted TLS)
  - Managed tunnel (Cloudflare Tunnel or another tunnel provider)
- Both the web application **and** Cluster API are routed through the planned hostname. Web and API origin ports are separate, configurable, and must differ.
- The registry binding must be verified and belong to the current `serverInstanceId` before an access profile may be saved.
- Profile write checks revision, independent administrator authorization and transactionally persisted security audit. Stale requests or failed audits roll back.
- Changing or removing the server binding or rotating domain proof invalidates old connection plans.
- Config artifacts: Caddyfile, nginx server block, cloudflared ingress, Tailscale Serve plus loopback Caddy mux, example server settings and a PowerShell remote check.
- Read-only loopback port probes for web and API, without arbitrary URL fetch, remote SSRF or automatic firewall manipulation.
- Vault UI exposes all five modes, compatible providers, origin ports, downloadable/copyable (text) deployment instructions, and on-demand listener diagnostics.

## Runtime setup after saving a profile
1. Verify the TXT record in Studio Settings, then bind your custom hostname to this **local** server identity.
2. Select your connection mode/provider in Studio Settings. Save the profile. Copy generated artifacts to your gateway machine; review them before activation.
3. Install and configure the selected provider/service explicitly. For direct public HTTPS open only TCP/443 to the TLS gateway, never directly to the application/API/DB/NAS.
4. Configure the Cluster public web and API URL, CORS origin, listener ports, proxy trust and cookie policy using `cluster-network-settings.json` as a **reviewed reference** in Server Config. The file is not itself imported or executed. Environment overrides may take precedence; restart services.
5. Ensure the production web frontend actually runs on the configured web port. The development Vite server is NOT a production web host. TLS must terminate at the gateway or a separately configured trusted endpoint.
6. Verify DNS, TLS identity and connectivity **from a different network** using `connection-check.ps1`. Test live login/session cookies, streaming/event delivery, large uploads, web and Desktop client independently.
7. Keep a LAN/private VPN fallback connection until public access is proven stable.

## Special handling
- Tailscale Serve offers a `.ts.net` URL/certificate for its tailnet. The user's custom Vault hostname is NOT automatically TLS-valid on Tailscale Serve. Use the hostname Tailscale actually reports or separately provision trusted custom-domain TLS and private DNS. Update Cluster canonical URLs accordingly.
- WireGuard/custom VPN requires actual VPN interface, keys, user enrollment, private DNS and TLS setup. This source never writes VPN keys.
- Cloudflare Tunnel requires a provisioned Cloudflare tunnel and corresponding hostname route, plus installed/supervised `cloudflared`. The config uses a default-deny fallback. Provider credentials are NOT included in the profile.
- Reverse proxy requires a running Caddy/nginx gateway. Caddy can automate publicly trusted certificates where DNS and public reachability support ACME. nginx expects certificate paths supplied by the operator.
- Direct HTTPS means **direct internet TCP/443 to a local HTTPS gateway**, not Cloudflare routing, and not unencrypted exposure of the API listener.
- Public HTTPS and tunnel profiles keep the application listeners loopback-only; proxy trust must not be enabled if users can bypass the gateway. Websocket/SSE and long uploads need gateway-specific testing.
- Saved configuration is `operator_action_required`, NOT a claim that DNS, certificates, external reachability, users, or Desktop sign-in are functional.

## Not implemented / not claimed
- Installing/starting/stopping/supervising Caddy, nginx, Tailscale, WireGuard or cloudflared as native Windows services.
- Automatic DNS API writes, ACME DNS-01 credentials, Cloudflare account authorization, certificate issuance/renewal or registrar billing.
- Remote multi-server enrollment, HA, failover or tunnel agent health telemetry.
- Validated full production web/API build, real inbound internet connectivity or Windows native control-panel integration.
- Windows Server Config boot-settings application with automatic rollback; configuration artifacts must be applied manually after review.

## Safety rule
No read-only check is an activation authorization. Do not toggle `sessionSecure`, `trustedProxy`, listening interfaces or DNS based on a successful local TCP socket test. Keep external origins encrypted and protect Cloudflare/Tailscale credentials in Studio Settings rather than plaintext in a domain record.

## On-demand public HTTPS diagnostic
- `GET /api/admin/domains/:id/connection/check-public` performs an explicit, administrator-authorized, no-credentials HTTPS `GET /health` against the saved hostname. DNS A answers must be publicly routable; the selected address is pinned for the HTTPS connection (no DNS rebinding), TLS chain and hostname are verified, redirects are not followed, and the request times out.
- LAN/VPN profiles are refused by this endpoint, to prevent server-side request forgery and accidental local-network probing.
- Its vantage point is the Cluster server, **not** an external browser. A pass does not prove that other users can connect, and a fail may be due to egress restrictions or hairpin routing. The generated `connection-check.ps1` is for a different client network.
