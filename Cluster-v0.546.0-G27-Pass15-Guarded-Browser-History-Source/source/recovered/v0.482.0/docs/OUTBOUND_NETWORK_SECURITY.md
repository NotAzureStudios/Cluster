# Outbound network security

Cluster treats every server-initiated HTTP request as a privileged network operation. Integration URLs are not passed directly to the platform `fetch()` implementation.

## Default policy

- HTTPS is required for normal outbound traffic.
- Hostnames are resolved before the connection is opened.
- Every resolved address is classified before use.
- Public requests cannot resolve to loopback, RFC1918, carrier-grade NAT, ULA, documentation, benchmark, multicast, or other non-public ranges.
- Link-local and metadata-style ranges are always blocked, including when a private Git integration is explicitly enabled.
- The approved DNS result is pinned into the HTTP/TLS socket lookup so the connection cannot silently perform a second, different DNS resolution.
- URL-embedded usernames/passwords and fragments are rejected.
- Request bodies and response bodies have hard byte ceilings.
- Redirect count is bounded and every redirect is revalidated. Cross-origin redirects are rejected so Authorization headers or webhook credentials cannot be forwarded to a different origin.

## Discord

Discord OAuth and bot API calls are HTTPS-only and host-allowlisted to `discord.com`. Discord webhook delivery is HTTPS-only and restricted to validated Discord webhook URLs on the supported Discord hosts. Integration response bodies are bounded before they are parsed or surfaced as errors.

## Self-hosted Git

Git integrations default to public-routable HTTPS. A studio administrator can deliberately enable **Allow private/LAN Git server** for a trusted self-hosted Gitea/Forgejo-style service.

That opt-in permits RFC1918, loopback, and IPv6 ULA destinations for the Git integration only. Plain HTTP is accepted only when the DNS-pinned destination is actually private and the private-network opt-in is enabled. The switch is treated as a security-weakening server configuration and uses the existing high-risk configuration confirmation path.

The opt-in does not permit link-local, multicast, cloud-metadata, or other always-blocked ranges. It also does not relax Discord or future integration policies.

## DNS rebinding

Checking a hostname and then allowing the HTTP library to resolve it again is insufficient. Cluster resolves the hostname, validates all returned addresses, selects an approved address, and supplies that address through the socket lookup callback while retaining the original hostname for HTTP Host/TLS SNI verification. Redirect destinations repeat the entire process.

## Adding an integration

New server-side integrations must use `secureOutboundFetch` through the shared request service. A new call site must define a narrow purpose-specific policy, including host allowlists when the service has fixed public hosts, and must not add an unrestricted raw `fetch()` path.

Private-network access must never be enabled merely because a URL was configured by an administrator. If a future integration genuinely requires LAN access, it needs its own explicit setting and security review.
