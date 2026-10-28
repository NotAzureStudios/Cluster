# Cluster RC37 | Discord Integration & Managed Bot

## Scope

The publicly installable Discord application remains a **projection/action surface**. Cluster's PostgreSQL data, authorization, Projects, Tickets, Notifications and Inbox remain authoritative.

Admin → Integrations → Discord now supports:
- Bot/application/public-key credential configuration (secrets are never returned to the UI)
- Public guild install link (bot + application commands; View Channel + Send Messages permissions)
- Native Cluster server-managed Gateway worker, persisted enabled state, start/restart/stop/status
- Per-process random relay secret, not stored in config or exposed in UI
- Approved guild registry, live bot membership check, explicit revocation, primary guild
- Per-project guild and channel/thread routing, existing notification policies, delivery health and retries
- Sync commands to approved guilds and report failures

A public install **does not authorize a guild**. Its administrator must explicitly approve it in Cluster, configure project connections/routes, and the invoking Discord user must link their Cluster account and have the underlying permission. Discord roles do not grant Cluster access.

The bot uses outbound Gateway connectivity and internal loopback communication with Cluster. No user-run PowerShell launcher or publicly exposed bot relay is required for the managed mode. A separate signed HTTP Interactions endpoint remains available for externally routed deployments, but avoid configuring both Gateway and Interactions Endpoint simultaneously.

## Setup

1. In the Discord Developer Portal, create an application, enable **Public Bot**, and copy its Application ID, Public Key and Bot Token into Cluster's Admin → Integrations → Discord.
2. Set the primary Server ID to the studio's Discord server and Save connection.
3. Use **Install on Discord server**. Discord requires a user with Manage Server permission to approve installation. Install to another server only if its admin wants to connect.
4. Click **Start / restart bot** and check status. The setting persists and the worker restarts with Cluster.
5. Add other installed server IDs under **Approved Discord servers**. A live bot membership check is required. Then sync actions.
6. Connect a Project to the Discord integration, select its approved guild and channel/thread, and configure delivery routes. Cluster account linking and Project authorization are mandatory for every action.

## No legacy compatibility

No migration or extra tables were added. Approved guild IDs and worker enablement are stored on the existing integration connection configuration. A default primary guild remains configured in Studio's Discord connection; no other guild is implicitly trusted.

## Validation limits

The source-level and simulated security/lifecycle checks must not be described as a live Discord/Windows certification. Real account linking, rate limits, OAuth setup, multiple guild installations, and client/server builds still require a working test server and Discord test guilds.
