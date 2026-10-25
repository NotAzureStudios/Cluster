# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24.17.0
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    CLUSTER_AUTO_SEED=false \
    CLUSTER_DEV_LOGIN=false
WORKDIR /opt/cluster
RUN groupadd --system cluster && useradd --system --gid cluster --home /var/lib/cluster cluster
COPY package.json package-lock.json* ./
COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
COPY packages/api-client ./packages/api-client
COPY packages/renderer ./packages/renderer
COPY prisma.config.ts ./
COPY config ./config
COPY tools/scripts/database-command.mjs tools/scripts/database-config.mjs ./tools/scripts/
USER cluster
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/server/dist/index.js"]
