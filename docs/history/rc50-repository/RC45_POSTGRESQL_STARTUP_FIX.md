# Cluster 1.0 RC45: PostgreSQL Discord role index startup fix

## Symptom

After RC44 installs and PostgreSQL successfully applies 156 migrations, the API shuts down with `DATABASE_SCHEMA_OUT_OF_DATE` and reports the missing index:

`DiscordRoleProjection_connectionId_guildId_discordUserId_roleId_key`

This error is **not** a failed PostgreSQL install, a missing table, or lost data. PostgreSQL truncates identifiers to 63 bytes, while that index name in the RC43 migration had 67 bytes. The *unique index itself* exists under the truncated name `DiscordRoleProjection_connectionId_guildId_discordUserId_roleId`. The RC44 startup admission code only checked the full 67-byte name, so it rejected a healthy freshly migrated database.

## RC45 correction

- Migration `20261114000000_rc45_discord_role_index_name` renames the existing unique index to `DiscordRoleProjection_owner_key` using `ALTER INDEX ... RENAME TO` (no table or index rebuild).
- The Prisma schema declares the same short name using `@@unique(..., map: "DiscordRoleProjection_owner_key")`.
- Startup verification now requires the short name and the RC45 migration to be applied.
- A dedicated RC45 regression suite validates the 63-byte limit and startup admission, including missing-index rejection.
- Release metadata advances to `1.0.0-rc.45`; application source version remains `0.546.0`.

## Windows test

1. Keep your existing `D:\Cluster-Server\Cluster\Server\data` folder and database intact. Do **not** delete or manually recreate PostgreSQL.
2. Place `Cluster-Installer-RC45-DB-INDEX-FIX-TEST.exe` in the same folder as prior Cluster installers, for example `D:\Cluster-Server\`.
3. Run it. It builds a candidate before switching the managed installation. Once installed, start `Cluster Server.exe`.
4. Look for `157 migrations found`, the `20261114000000_rc45_discord_role_index_name` migration, `All migrations have been successfully applied`, then `PostgreSQL schema verified` and successful API/Web readiness.
5. Keep `D:\Cluster-Server\Cluster\installer.log` and the native control-panel log for any further errors.

Do not manually mark the migration as applied or remove the schema startup guard.

## Certification limits

The RC45 Windows installer EXE compiled in the build environment and Go installer tests passed. No live PostgreSQL migration or complete Windows application build was available in this environment; both must be verified on Windows. `package-lock.json` is still missing, so dependency reproducibility remains a separate stable-release blocker.
