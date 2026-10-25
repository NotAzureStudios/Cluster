# Cluster G26 continuation after Workstream 6

Canonical parent is **G26 Workstream 6** full source. Incremental patch parent **G26 Workstream 5**. G25 source-closed. G26 remains **OPEN**.

Workstream 6 implemented Packet published-release recipient requirements (immutable manifest+recipient identity, transactional assignment and Activity Event, strict frozen audience, recipient/manager UI, privacy export v10, PostgreSQL migration), plus admin-only read-only upload reconciliation queue with no provider-secret disclosure or disposition.

Run `npm run cluster:td6:g26:ws6` for all latest G26 controlled source regressions and G24 private discussion assertions. Run `npm run techdebt:td5:source-closeout` for the separate 167-case TD5 closeout. See `TD6_G26_WORKSTREAM6_REQUIRED_DELIVERY_RECOVERY.md` and `TD6_G26_WORKSTREAM6_VERIFICATION.json` for factual claims. Do not mark migration or real object-storage concurrency as certified without executing them.

Next grouped priority: upload recovery tooling with provider-generation evidence, manual verified disposition and lease fencing (no blind cleanup), Packet required-ack due-date notifications/reminders and author impact view, Library bulk retention and cross-tool link verification, Packages, Inventory/Vault and native installation/update recovery.

Unverified runtime gates: Node24 compilation, Prisma client generation, PostgreSQL SQL/migrations/two-writer locking, real S3 multipart/post-failure reconciliation, authenticated browser, Windows and Qt packaging. Zero deployed production users: clean canonical changes remain preferred over legacy shims.
