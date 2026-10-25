# Cluster Discord Gateway Relay

Cluster's Discord **business logic lives in the Cluster server**. This package is an optional outbound-only Gateway transport for private/self-hosted studios that do not want to expose Cluster's signed Discord interaction endpoint to the public internet.

## Architecture

`Discord Gateway → Cluster Discord Gateway Relay → localhost Cluster server → existing Cluster Discord production service`

The relay does not decide permissions, resolve Projects, create Tickets, or own notification state. Cluster maps the Discord user to the linked Cluster identity and applies the normal Project/tool authorization rules. The same server service also supports Discord's signed HTTPS interaction endpoint, so public and private deployment modes share one authority.

## Current behavior

- Gateway v10 with **zero privileged intents** (`intents: 0`).
- Session resume, heartbeat acknowledgement checks, and bounded reconnect backoff.
- Forwards `INTERACTION_CREATE` payloads to Cluster over an authenticated relay endpoint.
- Returns Cluster's interaction response to Discord.
- `/cluster status` and `/cluster help` are server-owned commands.
- **Create Cluster Ticket** remains a message context action and uses Cluster's linked-identity/Project authorization.
- No Discord role becomes a Cluster permission source.

## Environment

- `CLUSTER_DISCORD_BOT_TOKEN` — Discord bot token used only for the Gateway connection.
- `CLUSTER_DISCORD_RELAY_TOKEN` — random 32+ character current secret shared with the Cluster server process. Keep it local/private and separate from the Discord bot token.
- `CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS` — optional server-side-only previous relay secret accepted temporarily during credential rotation. Remove it after the bot is confirmed on the new current token.
- `CLUSTER_SERVER_URL` — defaults to `http://127.0.0.1:3000`.

For direct command registration during development only:
- `CLUSTER_DISCORD_APPLICATION_ID`
- `CLUSTER_DISCORD_TEST_GUILD_ID`

Production command synchronization should normally be triggered from Cluster's Integrations administration surface so the server-owned command manifest remains authoritative.
