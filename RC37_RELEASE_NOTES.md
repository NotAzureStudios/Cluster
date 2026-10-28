# Cluster 1.0.0 RC37 | Discord Management Convergence

This is an engineering TEST release, not certified Stable.

## Implemented

- Managed Discord Gateway bot process controlled by Admin → Integrations → Discord: start/restart, stop, inspect status; startup restores enabled state and shutdown stops worker. No separate token launcher needed for the managed path.
- Bot token/application ID/public key remain configured via Admin; the dynamically generated relay token exists only in process memory, is never shown in the UI, and rotates when the bot restarts.
- Discord public installation URL using `bot` and `applications.commands` scopes, minimal channel/message permissions. Application creation, enabling Public Bot and consent to install still happen at Discord.
- Explicit Guild allowlist in the existing integration connection, with live bot membership verification before approval and immediate revocation; no automatically authorized guilds other than explicitly configured primary. Other public installs cannot reach Cluster data.
- Guild-aware Project channel routing with server membership verification, notification delivery scope checks, and per-guild command registration diagnostics.
- Linked/active Cluster users and canonical Project permissions remain authoritative, including Inbox acknowledgments.
- Gateway interaction 1.5s deferred acknowledgement for slow responses, rather than missing Discord's 3-second deadline.
- Admin UI controls for approved servers, bot lifecycle, status refresh, install link and command-sync result.
- Existing durable Notification/Inbox delivery receipts and retries preserved. No new duplicate notifications service or separate Discord database.

## Verification

- RC36 inherited 12/12 source check groups passed.
- RC37 focused Discord management: 11/11 executable/mocked checks passed.
- Existing Go Installer test suite passed; Windows x64 PE installer compiled from RC37 source.
- New source parsed with TypeScript source scanner, relative imports checked.
- The RC37 archive/patch and installer embedded revision were verified after packaging.

## Certification not completed

- Actual Windows application TypeScript/React/Prisma build, clean installation, server startup and permissions in PostgreSQL 18 remain unverified here (npm packages / Node 24 runtime unavailable).
- Live Discord Public Bot installation, authorized multi-guild setup, user linking, Gateway interaction latencies, outbound receipts, and Windows child-process supervision must be tested against a disposable Discord guild.
- Do not install RC37 as a declared Stable release. Existing installation rollback protections are provided by the release-candidate installer.

See `RC37_DISCORD_INTEGRATION.md` for setup and architecture.
