# Cluster 1.0 RC48 | Discord Account Linking & Bot Dashboard

## Implemented
- Self-service Discord OAuth linking in Account Settings → Profile, including linked identity, optional relinking with explicit confirmation and privacy/disconnect navigation.
- Uses the existing authenticated OAuth link/state/callback. Never treats a Discord role as a Cluster permission or exposes an OAuth token.
- OAuth availability is fetched lazily when a person opens the profile; no polling.
- Admin → Integrations → Discord now has Dashboard / Setup / Bot & servers / Deliveries, using existing permission-controlled backend routes.
- Dashboard displays managed Gateway status, OAuth readiness, approved-server health, linked-account coverage and durable notification delivery distribution, with start/stop actions.
- Setup tab provides an OAuth callback URL and explicit environment-variable guidance. Only the public redirect URI is returned; bot token and OAuth client secret are never returned.
- No extra database migrations, timers, front-end chart libraries, or new user-facing authorization scopes.

## Existing behavior preserved
- Cluster owns authorization, Discord identities do not grant permissions, guilds must be approved.
- Role synchronization stays opt-in and one-way with preview and assignment ownership tracking.
- Existing administrative service and message delivery APIs remain authoritative.

## Important configuration boundary
- The Discord bot token and Discord OAuth credentials are separate. User linking currently requires setting `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` in the server environment, then restarting Cluster. Bot configuration alone does not enable OAuth.
- Redirect URI must match the Discord Developer Portal OAuth2 redirect exactly and must be reachable over an appropriate HTTPS hostname for remote clients. A localhost callback is only suitable for local tests.
- Running the bot, completing real OAuth, delivering notifications, and Windows UI rendering remain unverified in this environment.
- Installer compiles source on the target Windows server. Stable reproducibility is blocked by the missing package-lock.json.
