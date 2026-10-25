# G26 continued runtime handoff

New canonical source is the latest G26 Managed Preview I/O Authority source ZIP; its parent is G26 MSI Launch Intent & Recovery Evidence.

This checkpoint adds descriptor-bound thumbnail/GLB response streaming, source-file signature checks, exclusive/fsynced/atomic thumbnail writes, per-item crash-safe locks and adversarial tests. Earlier MSI, Vault, Inventory, Packet, Library retention, and Workstream code is preserved. See `TD6_G26_MANAGED_PREVIEW_IO_CLOSEOUT.md` for tests and limitations.

Next meaningful work is **provisioned runtime testing**, not more test-only claims. Use Node 24.20.x, exact dependencies and generated Prisma to compile, migrate a disposable PostgreSQL 18 instance, then exercise browser multi-user permission revocation, Windows MSI installs/failure windows/reboot, Qt, and real NAS/S3 provider behavior. Keep destructive cleanup and automatic MSI retry disabled until those checks and separate security reviews actually pass. This handoff does not close G26 certification.
