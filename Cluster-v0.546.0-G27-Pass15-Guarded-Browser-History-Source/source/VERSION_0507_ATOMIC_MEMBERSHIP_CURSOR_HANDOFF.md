# Cluster v0.507 | Atomic Project Crew + Secure Resource Discovery Paging

**Baseline:** `Cluster-v0.507-Project-Roles-Access-Impact.zip` (full development source).
**Status:** Source implemented, parser validated, focused mock-runtime/security tests passing. **Not** PostgreSQL or Windows certified.

## Implemented

1. **Atomic Project revisions and ProjectMembership replacement.** The PATCH Project route now runs optimistic revision CAS and all crew writes within one Prisma interactive transaction. A revision conflict rolls back immediately; a member upsert failure does not leave a new Project header with stale crew. The membership writer supports an existing transaction and a backwards-compatible standalone transactional wrapper. Existing role validation/lead checks and Project update authorization remain in place. No new tables or migrations.
2. **Paged Resource Picker discovery.** `/api/access/targets` now supports bounded keyset continuation across Project, Board, Whiteboard, Library, and Review Asset types. The previous first-301-per-kind truncation is removed. Only one kind is scanned at a time; up to 320 candidates are evaluated per request. The UI exposes explicit **Load more authorized resources** actions in both Project Access controls.
3. **Encrypted cursor isolation.** Paging tokens use AES-256-GCM with an AUTH_SECRET-derived key, a fresh nonce, and a 15-minute lifetime. The token binds the authenticated actor, Project, search query, and minimum requested access. Hidden/denied resource IDs are not visible in the token. Tampered, expired, or cross-scope tokens fail closed with a request-level error. Authorized project, target, Access Rules and Library source/folder ACL checks still run on every page.
4. **Authorization query reduction.** The project-level rule snapshot is fetched once per discovery request rather than per 16-candidate chunk; a narrow second query reads only old direct-target rules without canonical `projectId`. All policy read failures stop discovery. Returned resource names remain bound to the Project and individually reauthorized.
5. **Stale responses and double clicks.** The existing request-sequence guard prevents previous search pages from overwriting new results. The Load More path has an in-flight gate, deduplicates returned resources, and clears invalid cursors without falling back to local Project objects.
6. **Regression coverage.** The new `cluster:0507:atomic-cursor` test exercises a simulated interrupted crew write, CAS conflicts, invalid roles, denied candidates across multiple pages, encrypted cursor tamper/scope isolation, ACL fail-closed behavior, and UI wiring. Existing 0.507 checks remain wired into the `verify:source-foundation` gate.

## Caveats / remaining work

- Simulated transaction-rollback tests use an in-memory mock; **real PostgreSQL failure injection/transaction isolation and competing edits remain to be tested**. This source change is not DB-integrated certification.
- Cursor results are a best-effort current-data traversal, not a database snapshot across requests. Concurrent renames, creates, and archive changes may shift page boundaries; every displayed candidate remains permission filtered.
- Full TypeScript dependency-backed build is unavailable in the lean/reconstructed source. TS/TSX AST parsing and focused TS-stripping/mock tests are not a substitute for compilation.
- Project/Team scoped Permission Bundle inheritance and broader Resource Picker adoption beyond Project Access remain 0.507 work. Avoid treating Studio tool permission bundles as blanket grants to Project resources.
- Source is still descended from Pass 13 + P16C staged changes; Pass 14/15 authoritative source conflict review remains necessary before integration. Native binaries have **not** been rebuilt. No release certification.
- 0.508 People/Forms/Packets/Inventory/Vault and subsequent 0.509–0.511 waves remain on roadmap; comprehensive real runtime certification is 0.512.

**Resume:** Begin with this entire ZIP source. Focus next on scoped team/project effective provenance using the canonical authorization engine, then adopt the canonical picker/action registry in appropriate other workspaces; avoid shadow permission tables. Preserve atomic Project writer and encrypted cursor contract.
