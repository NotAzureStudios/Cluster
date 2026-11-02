# RC43 Windows / Discord Test Guide

Run this on a disposable Discord guild with test user accounts, and back up the Cluster PostgreSQL database before any testing.

1. Copy the RC43 installer EXE beside the managed `Cluster/` folder (typically `D:\Cluster-Server\`) and run it. The EXE is a source-building installer; installation is not confirmed by the existence of the EXE alone.
2. Inspect `Cluster\installer.log` for dependency compilation, Prisma generation/deployment and application startup. Verify the `DiscordRoleProjection` table and indexes were deployed.
3. In Admin → Integrations → Discord, verify the bot is running and approve only the disposable test guild. For role synchronization, install with Manage Roles and move the bot's Discord role above the test identity-label roles.
4. Create zero-server-permission Discord roles. Add an account-type and a Team mapping. Verify preview before enabling, then enable and apply. The first batch is capped at 25 mutations.
5. Verify a previously assigned Discord role remains untouched. Check that a newly linked, active Cluster user in the mapped account type receives the role and an expired/disabled account does not.
6. Remove the Cluster user from the mapped Team, unlink their Discord identity, or offboard the user. Verify only Cluster-owned roles are revoked, and that a legitimate unrelated role remains.
7. Stop the bot/revoke Manage Roles permission and verify errors surface instead of showing success. Check role hierarchy denial and a privileged-role mapping rejection.
8. Confirm mapping and bot-management endpoints are inaccessible without `integrations:manage`. Confirm no Discord role grants Cluster Project, Admin, or Vault access.
9. Check Home, charts, project icons (including custom Git logo), Scheduler, QA and Operations visuals remain intact after upgrade.
10. Check localhost Request log volume and 429s after leaving Admin and browser tabs idle; visual widgets and role UI must not add continuous browser polling.

**Known constraint:** If an HTTP request times out after Discord potentially accepted a role grant, Cluster records it as `uncertain` and does not automatically claim or revoke the role. Investigate in Discord. The admin resolution interface remains a separate closeout item.
