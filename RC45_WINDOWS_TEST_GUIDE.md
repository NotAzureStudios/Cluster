# RC45 Windows startup validation

Expected sequence after installation and launch:

- Installer reports `Cluster Installer 1.0.0-rc.45` and creates an isolated candidate, retaining existing installation until build success.
- Server downloads/reuses private Node 24.20.0 and PostgreSQL 18.6.
- `npm run db:deploy` reports **157** migrations and applies `20261114000000_rc45_discord_role_index_name` on an upgraded RC44 database.
- The API reports `PostgreSQL schema verified`, not `DATABASE_SCHEMA_OUT_OF_DATE`.
- Web UI is reachable at the configured address (usually `http://localhost:3000`).
- After the server starts, check Admin > Integrations > Discord. Role synchronization should remain disabled unless the administrator explicitly enabled it.

If startup still fails, collect the end of `D:\Cluster-Server\Cluster\installer.log` and native Cluster Server logs. Do not paste tokens, connection credentials, or the contents of private keys.
