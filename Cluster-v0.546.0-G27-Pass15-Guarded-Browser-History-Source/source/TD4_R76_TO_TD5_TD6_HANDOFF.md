# Cluster TD4 R76 → TD5 / TD6 source continuation

**Use:** `Cluster-v0.546.0-TD4-R76-Finite-Source-Closeout-Source.zip` as the canonical code baseline, not an older R75 copy. `IMPLEMENTATION_ROADMAP_R76.md` supersedes TD4's active R75 status.

## TD4 result

Bounded TD4 source contracts are **SOURCE-CLOSED**. R76 fixes a confirmed silent outbox drain-timeout race, makes `work.assignment.changed` explicitly signal-only, preserves R57–R75 Search/Action, provider and Library safety, repairs one outdated Library bulk-test fixture, and supplies a finite signed-off owner matrix. Nothing here certifies runtime execution.

## Start TD5 from actual product risks

1. Build with the full Node 24 toolchain and generated Prisma; resolve real TS errors, not lean-environment noise.
2. Run fresh PostgreSQL 18 multi-process migrations/lease-fencing, outbox drain timeout/restart, revoked provider dispatch, and Library lifecycle CAS/multiuser tests.
3. Implement recoverable storage quarantine **only** after provider generation fencing, ownership evidence and retention/backup safety. Keep permanent unlink, auto GC and tier migration disabled until verified.
4. Complete native Windows/Qt process lifecycle, Cluster protocol activation, high-DPI UI/functional acceptance and shutdown-process-tree checks.
5. Validate Git/Discord/webhook in-flight cancellation, token rotation, restart and interruption against real services or realistic isolated providers.

## Then TD6 feature completion

Build actual resource-target pages/ACLs for Announcements, public applications, automations and secondary-repository navigation before adding them to Search. Close Forms/approval/team/user workflow UX end-to-end. Preserve existing source adapters and avoid a competing resource or event service.

## Nonnegotiable preservation

No legacy compatibility shims for nonexistent production instances. Keep floating/docked shell, taskbar Search, native Qt parity, user-color identity, responsive density, Comfortaa, permission-safe resources and disabled dangerous storage mutation paths.

**Evidence:** `TD4_R76_SOURCE_CLOSEOUT.md`, `TD4_R76_FINAL_OWNER_MATRIX.md`, new R76 tests, regression log/report, and exact R75→R76 patch replay.
