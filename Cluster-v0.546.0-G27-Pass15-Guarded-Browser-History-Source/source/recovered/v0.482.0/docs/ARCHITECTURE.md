# Cluster architecture

## Product boundaries

Cluster has one canonical source tree and three build products:

1. `apps/server` + `apps/web`: PostgreSQL-only server and web client.
2. `apps/server-launcher-go` + `apps/host-go`: native Windows/Linux server bootstrap and managed host.
3. `apps/desktop-qt`: native Qt/C++ desktop host with the shared Cluster renderer and `apps/update-helper-go` for signed update verification.

Shared contracts live under `packages/shared`, API transport code under `packages/api-client`, and reusable React application UI under `packages/renderer`.

## Server runtime

The public managed host defaults to port 3000 and proxies the private API process on port 4100. Windows provisions private Node.js and PostgreSQL under the server directory. Linux provisions private Node.js and uses `deployment/postgresql/docker-compose.yml` unless an external PostgreSQL URL is configured.

The SQL role and database are both `cluster`. The Windows operating-system account shown by PostgreSQL `initdb` owns the local database files but is not the SQL role.

## Database

Prisma migrations remain the canonical database history. Prisma 7 generates its client under `apps/server/src/generated/prisma` and uses `@prisma/adapter-pg` for runtime PostgreSQL connections. The datasource URL used by Prisma CLI lives in root `prisma.config.ts`.

## Desktop

The desktop application is a C++20 + Qt host. The main application surface uses `Qt WebView` to render the same server-hosted React application used in a browser, so navigation, setup, taskbar, project pages, and styling have one implementation. C++ remains responsible for the native process, tray behavior, deep links, signed updates, local preferences, file/native services, server-profile isolation, and packaging. On Windows the WebView backend uses the operating-system WebView2 runtime rather than Electron or a separately bundled Chromium runtime. Each Cluster server is assigned an isolated WebView2 user-data folder selected before Qt WebView initializes, which separates cookies, DOM storage, permissions, and cache between servers. `desktop:setup` detects the compatible Qt/compiler installation and required Qt modules and writes only local machine toolchain state under `.cluster/`.

## Release source model

The release contains one source archive instead of three duplicated source trees. Product packages are generated from that canonical source, which prevents Windows, Linux, and Desktop source copies from drifting apart.


Security boundaries and defaults are maintained in `docs/SECURITY_ARCHITECTURE.md`.
