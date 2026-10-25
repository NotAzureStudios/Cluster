# Cluster 0.512 source validation

- Source checkpoint based on `Cluster-v0.511.zip`.
- 18/18 regression suites passed (0 failed), spanning versions 0.507–0.511.
- New Packet/Notification executable assertions: 15/15 passed.
- Repository TS/TSX syntax parsed: 998 files, 0 diagnostics.
- Renderer-relative module specifiers inspected: 3,100, 0 unresolved.
- CSS delimiter scan: 108 files, 0 errors.
- CI/real build gate **NOT RUN**: Node runtime here is 22.16.0, while repo requires >=24.20.0; lean source omits npm dependencies and generated Prisma Client.
- No PostgreSQL/Qt/Go runtime or security certification claimed.
