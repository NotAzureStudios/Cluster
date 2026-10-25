# TD4 R32 | Server-authoritative Library matching selection

## Defect and user impact

`LibraryWorkspacePage` formerly fetched up to 12 additional client pages and selected at most 200 *loaded* rows. Sparse ACL visibility or deep pagination could silently leave out matching items. The API already offered bounded 200-item revision-checked bulk actions, but no server-authoritative discovery of the exact permitted result set.

## Implemented journey

1. User filters Library workspace, then clicks **Select matching (max 200)**.
2. New `POST /api/library/bulk/select-matching` parses the same validated query fields as `GET /api/library/workspace` and calls the same server-side `libraryWorkspaceWhere` filter builder. Collection views remain explicitly excluded pending collection-aware selection.
3. Server performs a repeatable-read paged search with stable sorting; restricts results by Library ACL and excludes Personnel Records attachments; returns exactly the accessible matches and revisions only when the complete accessible set fits 200.
4. More than 200 accessible results, 20,000 rows scanned without exhaustion, inconsistent provider rows or failed read snapshots produce explicit errors. No subset is returned.
5. Client checks navigation/query version, installs the returned rows and selected IDs, and uses the existing revision-captured bulk preview/write path; bulk write independently revalidates access and revisions. Background same-query refresh preserves selection rather than silently shrinking it to the first page.
6. The existing bulk mutation also checks Personnel Records attachment policy, preventing an attacker from bypassing UI selection by submitting guessed IDs.

## Bounds and follow-up

- This is a **bounded batch**. It deliberately does **not** claim 40,000-row bulk jobs, server-issued durable selection tokens or operation-job cancellation. Those require asynchronous job ownership and explicit impact/authorization semantics.
- The read snapshot is consistent during selection. Subsequent edits before mutation can still yield 409 revision conflict, as intended.
- Server returns selected item metadata only for ACL-accessible and non-Records items. There is no persistent selection token or reusable bearer capability.
- `POST` requires authenticated Library-view rights. Mutation rights are checked again in the existing action endpoint.
- Historical source and TD3 closeout preserved. No Prisma schema/migration or native binary changes.

## Validation and limitations

- Executable selection tests cover 0/200/201 match limits, scarce permissions beyond twelve pages, scan cut-off, invalid rows/revisions, snapshot source contract, Records protection and UI integration.
- Inherited TD3/Library/Forms regressions, TypeScript grammar and import paths, and CSS parsing tested (results in `TD4_R32_SOURCE_VALIDATION.json`).
- This environment uses Node 22 versus Cluster's declared Node 24.20 runtime, lacks generated Prisma/client and package dependencies. No full server/browser build or installed Qt/PostgreSQL runtime certification is claimed.
