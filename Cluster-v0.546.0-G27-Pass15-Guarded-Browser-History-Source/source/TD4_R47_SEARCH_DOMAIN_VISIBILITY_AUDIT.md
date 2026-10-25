# TD4 R47 | Search authorization and cross-workspace discovery audit

## Source-grounded defects

**Library:** `apps/server/src/domains/search/search-routes.ts` admitted indexed Library items through generic target `library` authorization. That does not evaluate the folder-inheritance authority used by Library's actual read APIs. Some Project members could therefore see otherwise restricted Library titles and metadata through Search.

**Personnel Records:** Search's `decorated.isAdmin` early return ran before any Records attachment check. Search titles and IDs of Records-controlled Library items could be admitted even though the Library API explicitly redirects them through Records policy.

**Packets and policies:** The generic admin shortcut ran before audience and Packet-folder checks, so Search did not consistently enforce the owning Studio/Library distribution rules. Existing Calendar privacy was correctly first and is preserved.

**Error handling:** Search's previous Packet `libraryAccess.canAccessItem()` path used a best-effort ACL context, which has legacy fallbacks for unavailable ACL tables. Search is a data-disclosure surface and cannot treat permission read failure as a grant.

## Implementation and trace

- `search-repository.ts` selects `ownerId` and `source` on indexed Library rows, preserving current item provenance for strict Library access evaluation.
- `search-sensitive-access.ts` owns the explicit privacy admission for Library, Packet and Policy kinds, calling `libraryAccess.contextForUser(..., {strict:true})` followed by `visibleFor` with the canonical Project record. No duplicate ACL engine was added.
- `search-routes.ts` calls that adapter **before** the administrator shortcut. Calendar remains protected by `canAccessCalendarEvent` first.
- `search-service.ts` invokes an optional `prepareBatch` before the existing concurrent admission checks, batching Personnel Records attachment lookups by candidate window. An unresolved Records table or rejected lookup aborts the Search request.
- The Search result/ranking cache continues to store **only rank/indices**, never authorized result payloads or grants. This pass does not change the Search UI layout or background polling.

## Executable development evidence

- `tools/scripts/cluster-td4-r47-search-domain-visibility-tests.mjs`: **22/22** focused negative and positive policy assertions.
- `tools/scripts/cluster-td4-r47-search-route-integration-tests.mjs`: **6/6** tests against the registered `/api/command/search` Fastify handler using mocked service, data and authorization boundaries.
- Inherited Search, cross-engine Calendar, resource identity, ACL refresh, provider feeds, Library/storage and TD2 ownership regressions run separately; refer to `TD4_R47_VALIDATION.json` for the selected battery and environment limitations.

## Not claimed / still open

- No full dependency-backed TypeScript build or Prisma Client generation was performed in the lean package. No PostgreSQL/live browser/Qt testing, transaction-race certification, scale benchmark, or production authorization proof is claimed.
- This is the **first authoritative Search adapter slice**, not all Search/Action/Provider workflows. Source Control/People/governance discovery, provider-owned lifecycle, event typing, larger hierarchy jobs and storage disposal remain TD4 work.
- The canonical Library storage+Records policies remain separate from Packet *distribution* permissions. Search disclosure does not grant file source/download authority.
