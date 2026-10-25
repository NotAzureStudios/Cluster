# Cluster v0.546.0 — G27 Domain Lifecycle & Server Identity Handoff

## Canonical source
This checkpoint extends `Cluster-v0.546.0-TD6-G27-Domain-Management-Source.zip` (which itself extended G27 Batch 8). Use the **full updated source ZIP**, not the baseline and overlay independently, for new work.

## Source-implemented in this connected pass
- Bind a verified hostname **only to this Cluster installation**, using the stable `readSettings(true).serverInstanceId` UUID and current server display name. Operators cannot supply an arbitrary server label to impersonate another installation.
- Recheck both current DNS TXT control and the local server identity when committing a binding. The existing revision CAS and transactionally persisted security audit remain required.
- Store an explicit, validated A, AAAA or CNAME *intended* DNS record for a bound hostname. Copyable DNS instructions help manual provisioning.
- Administrator-only, read-only DNS status checks distinguish ownership challenge present/missing/unavailable and routing matching/mismatched/unavailable. NXDOMAIN / missing records do not get misrepresented as provider outages; IPv6 addresses compare canonically.
- Track optional operator-entered registrar, expiration date and notes, with warnings for expired or expiring domains. These values are **not verified against registrar data**.
- Rotate ownership challenge: atomically revoke prior proof and detach the hostname/server/DNS intent. External DNS/TLS remains untouched. Explicitly reverify after rotation.
- Paginate/search the Domain Registry in pages of 50 instead of silently hiding domains after a hard 500-record cap. Added exact-ID read endpoint for selecting a domain outside the current page.
- Vault domain controls now cover lookup, registrar/expiry management, proof rotation, verified local-server binding, manual DNS instructions, unbinding and on-demand DNS inspection.
- New additive Prisma migration: `20261106000000_td6_g27_domain_binding_lifecycle` in addition to baseline `20261105000000_td6_g27_vault_domain_registry`.

## Required security and behavior boundaries
- A binding is **an audited intent associated with a configured installation identity**, not a remote cryptographic handshake, live DNS change, valid TLS certificate, or proof that the installation is reachable over the Internet. Remote servers require a separate enrollment/attestation mechanism.
- Domain TXT proves control of a DNS record at inspection time, not legal registrar ownership.
- No automatic DNS writes, firewall rules, proxy changes, NAT traversal, certificate issuance, or changes to the Cluster listener. Admins must decide whether a hostname stays private behind a VPN / reverse proxy.
- Registrar expiration is self-reported; no registrar integration or automatic renewal is implemented.
- Binding/proof changes still fail closed when the transactional security audit fails.
- Retired server IDs are not silently rebound after a restore/reinitialization. The registry describes the recorded server identity, not a current heartbeat.

## Validation
- New executable route-level suite and inherited domain normalization/verification checks.
- Inherited G27 configuration and Communications regressions.
- Active-source parser/import/CSS scan as recorded in the integrity report.
- ZIP/source-hash/overlay reconstruction checks as recorded in the integrity report.
- No full Node 24 + generated Prisma client build or live PostgreSQL/DNS/browser certification claimed.

## Remaining G27 / feature backlog
- Full cross-resource Search/Create/Inbox/navigation/Help closeout remains independent from domain work.
- Domain multi-hostname / multi-server assignments, remote instance onboarding, registrar API lookup, automatic expiry notices, DNS-provider adapters with Vault-held credentials, certificate provisioning/renewal and route reachability tests are future integrations. Do not claim they are implemented.
- G26 native MSI, external secret-provider revocation and physically destructive storage reconciliation remain explicitly incomplete; keep those safety gates intact.
- G28 cross-workspace reconciliation and TD7 source cleanup still follow G27.
