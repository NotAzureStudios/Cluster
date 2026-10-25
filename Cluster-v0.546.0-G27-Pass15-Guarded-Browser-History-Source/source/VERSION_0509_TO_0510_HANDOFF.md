# Cluster v0.509 → v0.510 | Work System development-source handoff

## Trusted continuation base
- Input: `Cluster-v0.509.zip` (source-only, not Pass 14/15 reconciled).
- Output: `Cluster-v0.510.zip` plus independently replayable `Cluster-v0.510.patch`.
- v0.509 Work System wave transitions into v0.510 Planning/Projects/Library/Admin; **Work System not certified or complete**.

## Changes included
1. Board Timeline view over existing Card records, per-user saved view mode and 12-week date navigation; dates handled as calendar days to avoid UTC-midnight day shifting.
2. EntityComment revision field and migration. Edits/delete are compare-and-swap; reactions have bounded optimistic retry rather than blind last-write-wins; attribution checks strengthened for deleted/anonymized authors.
3. Board List reordering uses a transactional two-row revision/position swap (Serializable) with conflict responses and client-refresh behavior.
4. Tests: `cluster-0509-work-system-assertions.mjs`, `cluster-0509-reorder-assertions.mjs`. This milestone adds 24 executable checks. 15 inherited 0.507/0.508 suites pass with 314 assertions.

## Open risks
- PostgreSQL migration `20261008210000_entity_comment_revisions` is staged but unapplied. No Prisma client generated and no Node 24.20+ dependency-backed build.
- Board column reorder only returns conflict when the caller uses the canonical API; Web/Desktop real-time refresh and offline queues must be tested on the full runtime.
- Comment reaction retries are conflict-safe in source tests but have not been tested under PostgreSQL's real multi-process contention. Follow-up: event ordering and persistent comment edit history.
- Board Timeline is a new projection; no Calendar/Timeline record duplication. Verify Windows fractional DPI and mobile layout with the final runtime.
- Packet delivery, Vault recovery, 0.507 scoped positive grants and general Work System convergence remain in the feature ledger.
- Pass 14/15 authoritative source merge remains unresolved; do not replace that source with this staged branch without review.

## Next wave
0.510 Project/Calendar/Timeline/Library/Admin. Stop at v0.511 transition after a substantial development run. Keep the full 0.512 certification gates.
