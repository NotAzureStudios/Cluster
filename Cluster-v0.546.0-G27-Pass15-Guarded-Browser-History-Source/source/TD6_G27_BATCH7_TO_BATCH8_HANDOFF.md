# Cluster G27 Batch 7 → Batch 8

**New canonical source:** `Cluster-v0.546.0-TD6-G27-Batch7-Durable-Announcement-Create-Source.zip`, directly based on the exact Batch 6 source. Do not apply G26 or earlier G27 patches over this source.

**Implemented in Batch 7:** durable per-author announcement create-intent UUID with database unique constraint, request digest and conflict-aware replay after unknown network results, preservation of author authorization on every replay, client retry-intent memory for Create and Duplicate, removal of five-second administrator announcement-list cache, user-facing retry guidance. New nullable columns require Prisma migration and client regeneration.

**Preserve:** all G27 Batches 1–6 Settings/People/onboarding/Operations/Search/Create/Communications work; G26 Vault, Library/media/retention, Package and Packet protection; existing taskbar Search/Project Tabs/Inbox recipient-only routing and People identity/UI texture. Avoid parallel notification or authorization systems.

**Next grouped G27 target:** improve remaining cross-resource Search/Create actions, exact navigation and Inbox/attention workflows; evaluate other create mutations for durable idempotency using the existing central mutation API or domain-specific identifiers without skipping authorization on receipt replay; complete UX discoverability. Then reconcile G27 requirements before G28.

**Tests:** `npm run cluster:td6:g27:durable-announcement-create` plus G27 tests and `node tools/scripts/cluster-td6-source-scan.mjs`. This checkpoint does not claim live Node 24/PostgreSQL/Qt/Windows certification. Native MSI automatic recovery, external revocation and unsafe provider deletion remain disabled/gated.
