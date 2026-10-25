# Cluster 0.514.0 → 0.515.0 handoff

Base: Cluster-v0.514.zip, retaining authoritative Pass 15 source reconciliation, Pass 16 exposure work, Package signed release registry/delivery and all later Packet/Work/Library changes.

This update adds device-scoped deployment reporting with single-use ten-minute challenges, revocation-aware transition checks, immutable reports, bounded offer creation and an independent Go staging executable. The web UI shows device claims and refuses to label them as verified installations. A delivered ZIP only means bytes were offered to a verified device session; a native stage only means isolated verification and extraction.

New Prisma migration: `20261009060000_managed_package_device_receipts`. Apply with the full existing migration chain in a real database before expecting the endpoints to run.

New files: `apps/server/src/domains/inventory/managed-package-deployments.ts`, Go stager source/test/README/go.mod, new receipt and cross-language checks, this handoff, feature ledger.

Regression and static validation evidence lives in `CLUSTER_0515_VALIDATION_RESULTS.md` and `CLUSTER_0515_REGRESSION_RESULTS.txt`.

Next: native authenticated downloader and staging orchestration, atomic activation/rollback with file durability, independent receipt trust, then broader Packet PDF/media, Work collaboration, Library/Calendar and remaining roadmap. Do not equate a signed archive or a device claim with OS installation.
