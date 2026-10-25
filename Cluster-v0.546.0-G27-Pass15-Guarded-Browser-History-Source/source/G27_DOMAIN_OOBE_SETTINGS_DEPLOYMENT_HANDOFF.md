# Cluster v0.546.0 • G27 Domains in OOBE, Studio Settings and Server Config

## Baseline
`Cluster-v0.546.0-TD6-G27-Network-Access-All-Modes-Source.zip` (3,300 files).

## Authoritative ownership
- **OOBE (before authentication)**: Domain & Access stage collects an optional domain, connection mode and compatible gateway provider. Server validates the fields and stores only `domainSetupIntent`. No DNS control, certificates or credentials; setup remains local-only and Owner MFA remains mandatory.
- **Authenticated OOBE continuation**: Admin Setup Checklist's Domain item opens a two-stage journey. Studio registration and DNS proof first, server identity/binding and access profile second. It stays marked incomplete until the current server has a verified binding and profile. This checklist status is **not** a live reachability check.
- **Studio Settings → Domains**: Registry, ownership challenges, verification, registrar, renewal metadata and notes.
- **Server Configuration → Domains & gateways**: Attach a verified hostname to this installation; choose LAN, private VPN, reverse proxy, direct HTTPS or managed tunnel; save an audited profile; generate/read deployment files; check effective server-config alignment and inspect local DNS/TLS evidence.
- **Vault**: Read-only inventory of domains and verified/bound status. No registration, DNS proof, network configuration or lifecycle mutations there. Vault still protects provider credentials separately.
- **Canonical admin API**: `/api/admin/domains`, including `/setup-intent` and `/deployment/{bundle,readiness}`. Removed old `/api/admin/vault/domains` routes and retired the Inventory-owned source folder: **no compatibility shim** (zero production instances).

## New source services
- `apps/server/src/domains/domains/domain-deployment-readiness.ts`: deterministic checks of canonical web/API URLs, CORS origins, ports, secure-session and proxy settings, and private listener addresses. This is settings evidence, **not** an installed or active gateway signal.
- Deployment bundle (`cluster-domain-deployment` v1): revision/instance-bound manifest with mode/provider, operator-reviewed gateway configs, instructions and SHA-256 payload digest. Requires current admin authorization and verified binding to the current server.
- The Desktop/Qt client still requires actual remote login testing; a server-local check cannot prove accessibility on the public Internet. The existing native executable is unchanged.

## Validation
- Existing Domain Registry: 27 focused checks.
- Existing Domain Lifecycle: 32 runtime checks.
- Domain networking: 139 checks, including 13 valid provider variants, denied stale writes, and new deployment bundle/readiness authorization.
- New Domain OOBE/Settings/Deployment: 26 checks.
- G09 setup guidance: 14 checks; v0.506 setup: 10 checks.
- G27 config rollback: 16 checks; Server Config: 13 checks.
- Source parse/import/CSS scan: zero errors.
- Legacy settings-convergence test: 8/9. Its remaining assertion expects `patchSettings(patch)` while the baseline code intentionally calls `patchSettings(patch, expected)`. This failure exists unchanged in the baseline, not introduced here.

## Pending functionality
1. Native Windows service installation/supervision for approved Caddy/nginx/cloudflared profiles, including start/stop/restart, crash recovery, update/rollback and diagnostics. Not yet source-implemented.
2. Provider credential enrollment and API-driven DNS/TLS provisioning with independent operator authorization and secrets stored in Vault, not the Domain Registry.
3. Tailscale/WireGuard enrollment and custom VPN policies; internet gateway and local-network routes have different trust boundaries.
4. Activation with reversible server-settings publication and TLS/remote-client verification, including Server Config restarts and Desktop integration.
5. Live Node 24, PostgreSQL and Windows runtime certification deferred by user direction. No new migration for this pass; previous domain migrations remain required.

## Continuation guidance
Use this complete ZIP as canonical source. Do not restore the old Vault domain write UI or deprecated `/api/admin/vault/domains` routes. Prioritize native provider orchestration next; avoid auto-installing third-party services or exposing private server/API/database listeners simply because a planned hostname resolves.
