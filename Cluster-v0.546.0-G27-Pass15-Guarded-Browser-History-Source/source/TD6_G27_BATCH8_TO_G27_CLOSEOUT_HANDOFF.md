# Cluster G27 Batch 8 → G27 Closeout

**Canonical source:** `Cluster-v0.546.0-TD6-G27-Batch8-Announcement-Restart-Recovery-Source.zip`, parent Batch 7 ZIP.

G27 Batches 1–8 are source implemented. Batch 8 provides author-scoped read-only create-intent recovery and privacy-minimal tab-persistent markers to reconcile ambiguous announcement Creates/Duplicates after navigation/reload. No new Prisma migration. Batch 7's unique intent migration remains required on deployment.

**Next substantive G27/G28 work:** Finish cross-resource resource/action/Search/Create coverage and exact Inbox follow-through, check Help/empty-state/accessibility behavior, then reconcile the Feature Ledger against actual UI/backend, flag missing implementations, and transition to G28 source integration. Stop producing tiny safeguards without end-user workflow benefit.

Preserve the canonical privacy/security architecture, taskbar Search, Global Create, Projects, People identity styling, Packets distribution authority, and G26 guarded native/provider operations. Do not represent syntax/mock regression tests as live Postgres/Windows certification.

**Validation command:** `npm run cluster:td6:g27:durable-announcement-create`, plus relevant G27 suites and `node tools/scripts/cluster-td6-source-scan.mjs`.
