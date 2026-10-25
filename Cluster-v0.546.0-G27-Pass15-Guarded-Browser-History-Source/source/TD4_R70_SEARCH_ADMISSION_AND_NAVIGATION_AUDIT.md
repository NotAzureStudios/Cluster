# TD4 R70 | Search authorization-admission and navigation closeout audit

**Baseline:** v0.546.0 TD4 R69. This is a source-level integration pass. Runtime certification remains a separate track.

## Defect and remediation

R69's global Command Search correctly re-authorized *indexed candidates* using current actor ACL decisions. However, the ranked candidate carried indexed titles, metadata and an indexed Project/Board placement. If a record was archived, moved, deleted or reclassified after indexing, a valid **old** ACL could still allow the stale result and a wrong navigation target. A Project rename/archive could also leave its children visible if the child had not changed. The palette independently merged cached React Project summaries with the freshly authorized search results. It also fell back to the generic Projects screen for results without a usable resource target.

R70 introduces **request-local live admission** between ranking and result publication. Authorization, Calendar visibility, protected Records filtering, strict Library ACLs and Packet/policy audiences still belong to the established domain owners and execute after the new admission fence; the fence is not a parallel access engine.

### Admission rules and ownership

- At most 12 candidates in each Search admission batch. A failure to read a supported source table fails the entire request rather than granting access. Each kind is hydrated with one `findMany` per batch; owning Projects are checked together in an additional bounded lookup.
- Record identity must exist and its indexed update time must agree with the live update time. Where applicable, Project, Board, Card, comment and Activity placement must still match. Archived Projects, Boards, Cards, ProjectFiles, Builds, QA plans/sessions, releases, users, controls and Library lifecycle states are rejected.
- Project-scoped entries carry the Project's indexed `updatedAt`, not just their own. Archive, rename or other parent revision changes hide a stale child until indexing catches up.
- Latest published Policy version and Policy revision are checked; Packet definition *and* source-folder revisions are checked. Their separate audience and Library ACL policies are still applied.
- Search does not fall back to an unrelated Project screen for an unresolvable resource. Activity's explicit workspace fallback remains available.
- Online project query results come from the authorized Search API only, rather than an additional, stale renderer summary list. Existing signed-in local Project search is retained **only while offline** and its worker is not started for online browsing.
- The existing per-process ranking cache is still permission-independent. Neither admission results nor authorization grants survive a single request.

### Finite current-index adapter matrix

| Indexed kind | Live model/identity | Additional conditions |
|---|---|---|
| Project | `Project` | Not archived; same version |
| Board | `Board` | Owning Project revision, Board scope and archived state |
| Card / Ticket | `Card` | Board placement and Project revision; correct work-item kind |
| Whiteboard / elements | `Whiteboard` | Whole-canvas version and parent revision; child points at owning Whiteboard |
| Library file | `LibraryItem` | Project, lifecycle, version; strict Library and Records checks follow |
| Project file | `ProjectFile` | Project, archive/lifecycle, version |
| Review asset | `ReviewAsset` | Project, lifecycle, version |
| Calendar event | `CalendarEvent` | Project and record version; Calendar visibility still authoritative |
| Timeline item | `TimelineItem` | Project/version |
| Project Control | `ProjectControlRecord` | Project/archive/version |
| Build | `DeliveryBuild` | Project/archive/version |
| QA plan / session | `DeliveryQaPlan` / `DeliveryQaSession` | Project/archive/version and correct subtype |
| Release | `DeliveryRelease` | Project/archive/version |
| Person | `User` | Not archived; record version; disclosure policy still applies |
| Packet | `PacketDefinition` plus `LibraryItem` folder | Definition and folder versions, lifecycle, fresh audience and Library access |
| Policy | `StudioPolicy` and latest published version | Active policy, policy and version freshness, fresh audience |
| Card comment | `CardComment` | Existence, Card/Board placement, exact body match, parent archive checks |
| Activity | `ActivityEvent` | Existence, Project/Board/Card placement; activity ACL still applies |

The Search index currently does **not** index all possible manifest resource kinds (e.g. source revisions/reviews, form submissions, automation and governance resources). Those adapters remain separate implementation work; R70 does not fabricate support. It also does not supply an authenticated server-side open-resource endpoint for every consumer of a deep link. Destination workspaces must continue to enforce their own authorization.

## Negative executable evidence

`tools/scripts/cluster-td4-r70-live-search-admission-tests.mjs` covers 41 focused runtime/source checks covering existence, archive/Trash, missing/changed dates, parent-Project revision, cross-Project moves, Board moves, Card/Ticket reclassification, Comment text freshness, Calendar status freshness, Packet/Policy edits, selected delivery source models, query coalescing, unavailable database, wrong navigation fallbacks, online-vs-offline Project discovery and request-local admission.

Inherited R47 Search route sensitive-ACL fixture now stubs this *new* admission dependency while separately testing it in the R70 suite; its existing six privacy expectations remain unchanged. R48 authoritative Search caching tests remain intact. No Prisma schema or native executable changes.

## Explicit limits

- Source tests use mocked tables and static TypeScript source parsing. No live PostgreSQL MVCC, simultaneous revoke while streaming a response, real multi-user authenticated browser, Node 24 install/build, native Qt activation, or NAS provider acceptance is claimed.
- A mutation **after** live admission but before the response reaches a client is a normal cross-request race; this is not a permanent authorization grant. Destination object loading must always re-authorize.
- A newly edited record can temporarily be absent from results until the Search index refreshes. A short-lived missing result is preferable to disclosing stale private data.
- Offline local Project search deliberately uses content cached during a previously authorized session. Its read-only offline policy and revocation-on-reconnect need runtime acceptance.
- Query-time hydration adds small bounded database work to Search. Measure p95 latency and under-load DB pressure in release certification.
