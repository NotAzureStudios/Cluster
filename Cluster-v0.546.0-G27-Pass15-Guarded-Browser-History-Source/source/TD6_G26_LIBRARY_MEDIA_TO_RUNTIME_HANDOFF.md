# G26 Library Media Authority → Runtime / Next Development Handoff

## Canonical source
Use the **G26 Library Media Authorization & Cache Closeout** archive built on the Retention Mutation Authority checkpoint. Do not resume from the earlier G26 OneBatch or Batch H source.

## Preserved architecture
Packets' source-vs-delivery distinction, authorized Inventory/Vault custody and reviewed rotation, offboarding, Library retention and relocation authority, native Package destination isolation and read-only MSI evidence are unchanged. No active production instances must be migrated. Physical deletion and unfenced provider recovery stay disabled.

## New operational boundary
A viewer's access to a model never grants access to its companion files. Model conversion refuses inaccessible companions before reading bytes or reusing a cached derivative. Contribute permission is required to replace a thumbnail. Copyright-disabled and Personnel Records content cannot be smuggled through the model converter. Cache keys depend on all visible inputs, not merely model checksum. Read-only endpoints validate paths before returning bytes.

## Execution priorities
1. Full Node 24.20.x workspace install/build + generated Prisma client; disposable PostgreSQL 18 migration validation.
2. Authenticated A/B/administrator live tests for model previews and related file permissions, denied Records and copyright dependencies, cache revocation, failed Assimp conversion, model thumbnail rewrite, and slow storage.
3. Native Windows MSI installer lifecycle, reboot and independent OS observation testing. No automatic retry/repair/uninstall is authorized by a receipt or registration match.
4. Real NAS/S3 generation and retention fencing, backup recovery evidence and independent disposition authority before any destructive storage operation.
5. External provider credential revocation evidence, authorization revocation races and Qt/Windows UI acceptance.

**Build/source regressions are development evidence only. G26 is not production certified.**
