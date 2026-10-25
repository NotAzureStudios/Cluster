# Cluster PostgreSQL deployment

The Linux server launcher uses this Compose project when `apps/server/.env` does not already point at PostgreSQL. Windows uses its private PostgreSQL runtime. Both paths use the `cluster` SQL role and `cluster` database.

Manual Docker start:

```bash
docker compose --env-file deployment/postgresql/.env -f deployment/postgresql/docker-compose.yml up -d postgres
npm run db:deploy
npm run db:doctor
```

The PostgreSQL image version is synchronized from `config/toolchain-versions.json`. Database credentials belong in `deployment/postgresql/.env`, which is not part of source control.
