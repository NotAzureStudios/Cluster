# Cluster 1.0 RC42 | Discord 1.0 Closeout, Pass 1

## Source changes

RC42 retains RC37's publicly installable, server-managed Discord bot, per-guild approval, OAuth account linking, project channel routes, protected interactions, and the canonical Cluster Inbox / durable receipt delivery system. RC38-RC41 visual changes are preserved.

- **Authentic bot connection status.** A managed Gateway worker sends authenticated READY/RESUMED/reconnecting and periodic liveness signals to a private loopback endpoint. The server marks a session stale after 45 seconds without a report. Console messages no longer declare the bot healthy. Stops/restarts revoke the old relay credential. This is not a live Discord certification.
- **Named Discord servers.** Approved guilds now show provider-derived names and icons with reachability indicators; a 5-minute success / 30-second failure cache prevents REST calls on every view. Primary ID and guild approval remain the authorization source. Guild metadata requests are batched (4 at once); provider failures do not imply a guild is approved or reachable.
- **Admin connectivity diagnostic.** Admin → Integrations → Discord now offers **Send test message** to the configured chat channel. The endpoint requires `integrations:manage`, verifies the channel's actual guild is approved and is a text/thread channel, disables mentions, verifies a returned message ID, rate-limits per channel, and logs successful sends. It does *not* create a second Notifications system and does not validate queued Inbox delivery.
- **Account linking coverage.** Shows Linked / Not linked among active, unexpired Cluster accounts, with no personal identity list returned.
- **OAuth setup honesty.** The Admin panel now indicates when server-side Discord OAuth is not configured or is using a different Application ID. User OAuth still requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI on the server. A bot token alone is not user-account OAuth.
- **Installation options.** Keeps standard Discord install permissions and adds an explicitly optional Discord **Administrator** install link. Discord Administrator does NOT grant Cluster role or access rights. This is a high-privilege option, not required by Cluster.

## Security contract

Discord roles do not authorize Cluster actions. Only active linked Cluster identities with verified Project/Board/tool permissions may act. External installs require explicit Cluster approval per guild; a test message cannot target an unapproved guild. Discord project and notification data remain in Cluster. Never log or ship the bot token, OAuth secret, relay secret, or session cookies.

## Remaining 1.0 requirements (not claimed as delivered)

- End-to-end Node 24 / Prisma 7 / PostgreSQL 18 installation on Windows with a real Discord test server and linked test users.
- Configurable Discord role mapping, reversible onboarding/offboarding role projection, and presence bridging. Role mapping should remain one-way (Cluster → Discord) with an explicit revocation ledger, never Discord roles → Cluster grants.
- Consent/retention policies and ingestion scopes for privileged Discord context (Guild Members, Presence, Message Content intents). These require carefully bounded processing; intents enabled in Developer Portal do not magically implement privacy controls in Cluster. Full Discord Activities client is v1.1.
- Verify actual Inbox delivery through the worker, retries, deferrals and command responses; test unapproved/revoked guilds, expired accounts, Gateway loss and Windows managed process restart.
- OAuth currently requires server environment settings, not a complete all-in-one UI secret setup. The panel now reveals this limitation.

## Verification boundaries

RC42 source-level focused tests + inherited checks and a compiled Go Windows installer are not a complete Windows app build. The installer builds the app and downloads toolchains on the target PC. Real Discord network and Windows proof remain pending.
