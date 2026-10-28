# Cluster 1.0 RC43 | Discord Roles & Lifecycle (Test Candidate)

## Scope

RC43 continues RC42's managed bot, approved guilds, linked accounts, Discord Gateway health, Inbox delivery, and test-message features. It adds opt-in **Cluster → Discord** role mapping for account types and studio Teams. Discord roles NEVER grant Cluster account or resource permissions.

The integration is deliberately narrow: identity-label roles with **zero server-wide permissions** only. A Discord role with zero server permissions can still be referenced by channel overwrites, so review channel access before configuring it. Mapping @everyone, managed roles, Administrator, Manage Roles, or any role carrying server-wide permissions is rejected.

## Admin workflow

1. Under Admin → Integrations → Discord, install the bot in an approved server. The standard install is sufficient for notifications. For role synchronization, use **Install with Manage Roles** (permissions=268438528) and place the bot's own Discord role *above* all mapped roles in the Discord server role hierarchy. Discord Administrator is not required.
2. In **One-way role synchronization**, select an approved server and choose an account type or studio Team. Choose a safe Discord role. Add the mapping.
3. Select **Preview changes** before enabling. A preview estimates grants/revocations from active linked, unexpired Cluster accounts belonging to this studio, excluding archived Team memberships.
4. Enable synchronization explicitly. **Apply previewed changes** executes at most 25 changes per pass. When enabled, a maintenance task retries approximately every five minutes with adaptive backoff. It performs no bulk scans when disabled.
5. Removing a mapping schedules removal of only roles that Cluster previously confirmed it added. Pausing synchronization prevents all changes, including offboarding revocations, until it is resumed.

### Safeguards

- Mappings and guild approval are validated before saving. Account types and Teams must belong to the active studio. Changes are restricted to `integrations:manage`; preview requires `integrations:view`.
- Role permission bits, Discord bot `Manage Roles`, and Discord role hierarchy are checked at execution. **No Discord role is used for Cluster authorization.**
- A durable `DiscordRoleProjection` ledger tracks exactly which assignments Cluster successfully created. Roles already present when Cluster starts are tracked as `external` and **never removed by Cluster**.
- Disabled/archived/expired/unlinked users and removed Team members do not receive grants. Old Cluster-owned roles are removed by reconciliation after offboarding, relinking, or changing role mappings.
- Uncertain grants (provider timeout or interrupted state change) are not claimed as managed and are not automatically revoked. This intentionally favors safety over automated cleanup; admins must inspect such assignments in Discord.
- Privacy erasure will not pseudonymize a linked identity while there are outstanding managed/pending/uncertain Discord role assignments. Revoked and external ledger rows belonging to the erased account are cleared as part of fulfillment.
- An optimistic config comparison prevents role-mapping edits from overwriting concurrent bot/guild settings. All writes are bounded; no new Web client polling loop is introduced.

## Files and migrations

- `apps/server/src/domains/integrations/discord-role-projection.ts`: planner, guardrails and reconciliation.
- `apps/server/src/app/server-discord-runtime.ts`: authenticated admin routes and supervised maintenance task.
- `packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx`: operator controls, live role choices, mappings, previews and problem indicators.
- `apps/server/prisma/migrations/20261113000000_rc43_discord_role_projection/migration.sql`: owned role ledger. Requires `npm run db:deploy` as part of the standard installer path.
- `apps/server/src/core/storage-migrations.ts`: requires the new migration and indexes at startup.
- `apps/server/src/core/privacy-erasure.ts`: holds erasure while active role ownership needs reconciliation.
- `tools/scripts/cluster-rc43-discord-role-projection-tests.mjs`: mock provider and ledger behavior regression checks.

## Remaining before 1.0 Stable

- Real Windows installation + complete TypeScript/Prisma build, PostgreSQL 18 migration and live Discord role grant/revoke, OAuth unlink, bot hierarchy and permission tests.
- Manual in-app resolution/cleanup for ambiguous provider writes. The `uncertain` state is intentionally blocked from automatic adoption/removal.
- End-to-end offboarding timing and restart durability with real accounts, including server downtime. Role sync defaults off, so an admin must opt in to these changes.
- Consent/retention review, presence bridge and any privileged Discord Gateway intents. Discord Activities client stays v1.1.

This is an implementation checkpoint, not evidence that Discord role synchronization has been tested live.
