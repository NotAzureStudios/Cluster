# TD4 R71 | Source Review discovery, authorization and navigation audit

**Verified baseline:** R70. Scope: source-level implementation and mocked/executable regression only.

## Previously missing end-to-end integration

R70's live admission pipeline covered the existing indexed Search kinds, but Source Control reviews were canonical resources without indexed Search results. Merely adding a UI link would be unsafe because Projects can have multiple Source repositories and Source Review titles can be stale after repository removal, reassignment, archive or permission revocation.

## New source implementation and authority boundaries

| Layer | Owner and implemented behavior | Denial/freshness checks |
| --- | --- | --- |
| Scope vocabulary | `CLUSTER_SEARCH_SCOPE_MANIFEST` | `source_review` is an explicit remote result kind; no local Search shadow authority |
| Corpus | Search repository reads bounded Source Reviews with narrowly selected Project and repository state | Project in active corpus, repository nonarchived; 3,000 full/1,000 Project refresh ceiling |
| Placement | Source Control's existing `projectSourceContext()` picks first nonarchived binding sorted `isPrimary DESC, createdAt ASC` | Search only indexes reviews belonging to that same binding, not another bound/secondary repository |
| Index | Project-scoped Source Review result, direct canonical resource address | Project revision stamped; repository and binding evidence retained within the private server index |
| Live admission | Existing request-local, batched live Search fence | Record deletion/move/edit, owning Project rename/archive, repository identity/archive/revision, primary binding removal/replacement/revision all deny before publication |
| Permissions | Search route delegates to existing authorization engine | Current Source Control tool permission **and** owning Project view authorization; no admin bypass for this kind |
| Renderer | Shared `clusterResourceNavigation` + `searchResultWorkContext` | Opens exact Project → Source → Review inspector; no generic Project-page fallback |
| Work Actions | Existing shared Action Registry and permalink logic | Reverse navigation yields canonical Source Review, Repository or Commit source kind |

Source Review title and description are intentionally indexed server-side. Search does not send those fields until live admission and current access controls pass. The source index is not an authorization grant. A DB read failure rejects the Search operation; no stale client-side match is substituted.

## Regressions and negative evidence

- 26 new direct assertions: construction, primary/secondary binding, missing Project, removed and archived repository, review identity and placement changes, Project/binding/repository revision changes, database-read failure, unprepared result, tool/Project authorization ordering, navigation symmetry, and corpus integration.
- 51 selected inherited regression suites passed (one inherited TypeScript-importing test required a temporary global toolchain link, then that link was removed).
- Active-source syntax and authored-import scan passed; `TD4_R71_SOURCE_SCAN.json` records counts and explicitly expected absent generated Prisma client.

## Deliberate exclusions

- This checkpoint does **not** index arbitrary Source Commits or Source Repositories as project-independent Search results. Commits and repositories can belong to multiple Projects, and the correct per-Project active binding must be represented without duplicate/ambiguous identities. Existing R58 commit deep links remain intact.
- No new dedicated `work.assignment.changed` consumer was claimed. Wildcard subscribers and backfill semantics remain as documented in R69.
- This does not prove authentic Node 24/Prisma/PostgreSQL execution, actual logged-in browser permissions, or Qt navigation; source test doubles are not production evidence.
- Physical Library disposal, managed-blob GC and automatic tier migration remain disabled due to missing generation-safe ownership and recovery guarantees.
