# Cluster G26 Batch G → Next Group

**Canonical source**: `Cluster-v0.546.0-TD6-G26-BatchG-Credential-Lifecycle-MSI-Operator-Review-Source.zip`.
**Parent**: Batch F MSI Evidence Hardening.
**State**: Source implementation verified; G26 remains open; not certified.

1. New durable Inventory/Vault expiry notices: model `StudioInventoryExpiryNotice`, SQL migration `20261102000000_td6_g26_inventory_credential_expiry_notices`, `inventory-credential-expiry-lifecycle.ts`, worker registration and daily producer in `server-job-runtime.ts`, admin-only historical Inbox visibility, 21 focused tests.
2. Native MSI operator evidence: `msi_attempt_status.go`, native classification tests, read-only Desktop capability and user-facing assessment. No automatic retries or installed-product attestation.
3. TD5 test-harness import mock updated; 167 existing cases pass.
4. Existing core functions from Batch A–F (Packet, Package, Inventory seat binding, Library governance and provider recovery) preserved.

**Next grouped work**: real offboarding Inventory/credential disposition workflow, Vault rotation approval/evidence and controlled package/Windows MSI recovery **only when** the required native and PostgreSQL acceptance environments are available. Do not silently implement destructive storage disposition or self-authorized MSI retries. Study `TD6_G26_BATCH_G_CREDENTIAL_LIFECYCLE_MSI_RECOVERY.md` for exact limits.

**Required certification**: provision Node 24/dependencies/Prisma, run migration on fresh and existing PostgreSQL 18, exercise concurrent stage workers and expiry race under real transactions, observe Inbox across role downgrade and multi-process publishing, run MSI on a disposable Windows image with elevated/non-elevated/reboot/failure scenarios, and certify Qt UI.
