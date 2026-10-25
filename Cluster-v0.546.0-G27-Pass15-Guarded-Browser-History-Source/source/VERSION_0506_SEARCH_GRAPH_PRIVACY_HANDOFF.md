# Cluster v0.506 | Search, Access Rules & Graph Convergence

**Status:** Cumulative development staging source. **Not** merged with the authoritative Pass 15 build; **not** certified on live Windows/PostgreSQL.

## Work completed

1. Search now ranks only matching index candidates before evaluating ACLs. It verifies authorization on **every** request in bounded concurrent batches until the requested number of visible results is filled. This avoids the previous whole-corpus permission scan on each search and eliminates the five-second authorization cache that could reuse revoked grants.
2. Ranking-only cache stores index positions/scores/reasons, not titles, sensitive payloads, or permission decisions. Cache hits still rerun authorization. Search responses remain `Cache-Control: private, no-store`.
3. Removed global `candidateCount` and `totalIndexed` from ordinary search responses because they disclosed counts of unauthorized matches. The admin-only diagnostics endpoint retains internal index counts. The Search status UI no longer shows potentially misleading global candidate ratios.
4. A project refresh now merges only that project's access rules, preserving studio-wide rules, unrelated project rules and explicit deletion of old project rules. ACL change events with project IDs refresh the full rule corpus instead of running the wrong project-only branch.
5. Repeated ACL change events replay the latest rule set when a refresh is already in progress, even when an intervening project merge wins the index race. Search waits for pending indexing work and rebuilds dirty snapshots rather than serving known-stale indexed results.
6. Search repository no longer converts access-rule database errors into an empty allow/deny policy. ACL load errors propagate and search fails closed. Incremental People reloads include the canonical workforce-authority joins.
7. The Resource Graph rejects project subjects that conflict with requested project scope. Its `truncated` flag now reports unread fetched siblings when `maxEdges` is reached.

## Verification

- `npm run cluster:0506:search:privacy`: **13/13** focused behavioral/structural tests, including revoked access after ranking cache hit, unrelated ACL preservation, ACL event replay, repository outage, bounded result filling, and graph scope/truncation.
- `npm run cluster:0506:cross-engine`: **9/9** existing security/graph/search behavior checks.
- `npm run verify:source-foundation`: **PASS** (full inherited suite including the new tests).
- TypeScript parse/relative renderer import/CSS delimiters and source manifest integrity: see `SOURCE_VALIDATION.txt` in the packaged ZIP.

## Release authority and outstanding gates

The base is reconstructed P13 + staged P16C + cumulative 0.506 updates, **not** a successful Pass 15 integration. Do **not** deploy this tree or overwrite Pass 14/15 Admin/Project Type changes. An incremental patch is included for conflict review.

Outstanding: integration with Pass 15; real PostgreSQL migration/bootstrap, ACL revocation under multiple processes/tabs, search index change-stream delivery and transaction consistency, real graph latency and workload profiling, Windows host and Qt/native parity, GPU-driver tests and DPI certification. Search index corpus remains bounded by configured limits; a source check cannot prove large-studio production behavior.

## Program continuity

The 0.506 integration/security closeout remains open. 0.507 Company/Resource Graph and shared engines; 0.508 People, Forms, Packets, Inventory/Vault; 0.509 Work System; 0.510 Projects/Planning/Library/Admin; 0.511 communications/integrations/distribution; 0.512 full release certification; 1.0 certified launch. Keep major work, small wins, cleanup and testing visible in the Feature Ledger.
