# TD4 R31 | Library collection sharing implementation audit

**Parent:** v0.546.0 TD3 R30 source-implementation closeout. **Phase:** TD4 started, not closed.

## Existing source and demonstrated gap

`LibraryCollection` already stores manual and smart views, revision CAS and bounded item pagination. Owner-only collection listing/reading meant the user-visible Collection feature could not be shared with studio colleagues. Item-level filtering and Records protection existed and were preserved.

## New complete workflow

1. Owner opens Library → Collections → Share collection. The roster is owner-only.
2. Choose an active studio member and Viewer/Editor collection access. The server rejects archived/disabled/expired recipients.
3. Server updates the grant and collection revision under Serializable CAS and writes scoped ActivityEvent evidence in the same transaction.
4. Shared recipient's Library Explorer lists grants; Viewer may browse, Editor may add/remove reference membership, neither may edit collection settings or sharing.
5. Every item page is independently filtered through the existing Library ACL, including excluding Personnel Records attachments. Collection grants do **not** enable direct Library file access. Shared collection membership counts are not surfaced.
6. Owner can change role or revoke. A stale revision returns HTTP 409; the UI reloads current grants rather than repeating the old command.

## Source ownership

- DB: `apps/server/prisma/schema.prisma` + migration `20261014203000_td4_library_collection_grants`
- Authorization: `apps/server/src/domains/library/library-collection-access.ts`
- Routes: `apps/server/src/domains/library/library-9e2-routes.ts`
- Client: `packages/renderer/src/features/library/LibraryWorkspacePage.tsx`, `library-types.ts`, `library-workspace.css`
- Tests: `tools/scripts/cluster-td4-library-collection-sharing-tests.mjs`, extended `cluster-0540-library-completion-tests.mjs`

## Regressions and remaining boundaries

- Private collection behavior, revision-protected membership, Smart Collection query semantics, bounded paging, Library ACL and Records restrictions preserved.
- Shares are user-scoped only; team/department grants and access expiry policy for collection grants remain future enhancement, not claimed here.
- Shared recipients still require their normal Studio Library tool permissions. No external recipient delivery or public URL capability was added.
- Server-side select-all-matching / bulk selection is still unfinished and remains the next adjacent Library workflow.
- Typed resource-change events, live browser/DB and release certification remain separate scope; in-memory handler tests establish only the tested source semantics.

**Status:** Collection-sharing source workflow implemented with focused tests. TD4/TD6 completion **NOT** declared.
