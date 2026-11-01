# Cluster RC46: First-run contrast fix + connection guidance

## Change
Fix setup-mode cards rendering black text on dark buttons because the unstyled button did not explicitly inherit the themed text color. Heading/description, hover/selected, keyboard focus, and import preview now have explicit semantic foreground styles. Release identity RC46. No data or schema migration.

## Remote access status and constraints
The first-run **Domain & Access** step records an intent; it does not install or activate a tunnel, configure TLS, or open Windows Firewall. Cluster's managed Go host defaults to loopback-only `127.0.0.1:3000`; the private API and PostgreSQL are not public. Its Host and Origin validation requires deployment configuration and should not be bypassed.

For internal team trials, prefer a limited-access VPN (Tailscale), with host binding, public origin, HTTPS and auth settings deliberately configured and tested. For public HTTPS, use a managed outbound tunnel and a studio subdomain **only after confirming the Cluster Go host trusts the intended public origin/HTTPS termination path**; merely pointing a Cloudflare Tunnel at port 3000 will not produce a supported secure production deployment in RC46. Do not expose ports 4000, 4100, 54321 or raw database services. Complete initial owner setup at localhost, enable MFA, add user accounts, establish tested backups, and verify access by another device before declaring remote access ready.

## Verification boundaries
This source-only contrast fix can be checked with source assertions and Chromium style rendering. The Windows EXE is a source-building installer; application end-to-end Windows behavior is not certified by the Linux build environment. Keep the existing installation until tested.
