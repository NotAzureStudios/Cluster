# Cluster v0.546.0 | TD5 implementation roadmap | Pass 3

**Source baseline:** TD5 P2, preserving TD4 R76.2 source closure and P1 native-shutdown corrections. **TD5 remains active.** Release/runtime certification remains separately governed by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## P3 implemented

1. **Local filesystem path containment.** `LocalStorageProvider` rejects existing symlink/junction ancestors during managed reads/writes/inventory/deletes and on materialization targets. Root health is failed when its configured path redirects. Leaf links and unsupported inventory entries are rejected rather than followed or silently ignored.
2. **Materialization source identity.** Materialization reads from an opened source descriptor, verifies inode/size/timestamps against the pre-open snapshot and current path, and publishes only after size/source identity checks. `openRead()` also opens and checks the current source descriptor before returning a stream. These checks reduce static symlink and source-swap risks; they are not an atomic Windows/SMB generation fence.
3. **Project Asset integrity audit truthfulness.** Storage and inventory failures, remote/S3 404s, missing locators, and truncated project inventories are treated as incomplete/unverified, not as missing/healthy. Only node-local provider `ENOENT` is treated as positive absence evidence. An incomplete audit blocks the existing bounded repair routes.
4. **Per-file verification.** Verification returns an explicit service-unavailable response for indeterminate storage errors instead of stating that the file is missing. Committed checksum metadata repair survives Activity-projection failures.
5. **UI integration.** Project Asset workspace displays incomplete scans, unavailable records and inventory failure; it withholds repair controls when the scan cannot be trusted.
6. **Verification.** 20 focused P3 tests against real local-provider code and extracted Project scan logic; 12 inherited P2 filesystem checks; 61 inherited TD4 source regression scripts; active source parse and relative-import checks; no new normalized server TypeScript diagnostics compared with P2 in a dependency-incomplete environment.

## Explicit unresolved acceptance requirements

- **Pinned dependencies:** This container has Linux Node 22.16.0 and Go 1.23.2, not the required Node 24.20.0 / Go 1.27.1; generated Prisma client and full workspace dependencies are absent. No dependency-backed release build has passed.
- **Live PostgreSQL:** No disposable PostgreSQL instance was available for migrations, multi-process queue/outbox contention, transactional rollback or crash recovery tests.
- **Windows/SMB/NAS:** Parent-component checks and descriptor identity are best-effort checks, not fully race-free handle-relative traversal. Shared/remote 404/ENOENT does not authorize archiving/deletion. Test actual reparse points, SMB reconnects, concurrent writers, failures and canonical-mutation isolation on Windows.
- **Storage disposal:** Quarantine, physical deletion, managed-blob GC and automatic tier migration remain disabled. Generation fencing, backup guarantees and safe restore still need real provider-level validation before they may be enabled.
- **Native acceptance:** Real Windows Host/launcher/Qt startup, stop/restart and process-tree ownership are not certified by this Linux pass.

## P4 priorities

1. Establish pinned build dependencies and a reproducible Node 24 + Prisma build with captured diagnostics.
2. Run real PostgreSQL 17/18 migrations and multi-process worker/outbox and post-commit failure tests.
3. Perform actual Windows/SMB path races, materialization, restart/shutdown and native-service acceptance.
4. Introduce a provider-held generation/ownership contract **before** considering recoverable quarantine execution or automatic file reclamation.
