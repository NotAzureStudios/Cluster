# TD6 G27 Batch 6 | Search, Create, Navigation & Communications

## Implemented source workflow

- Kept canonical Command Palette and Shared Create; added administrator-only Compose and Review announcement actions instead of a second creation API. The shared Create picker exposes the existing Studio authoring tool to admins without adding an unsupported Create mode to the resource manifest.
- Created / duplicated announcements open the exact saved author record. Admins can copy an `#studioSettings/studioSystems` link with an `inspect=studio-announcement:<id>` selector; the receiving Studio Settings page and announcement panel consume that context. Direct record GET enforces the same administrative authorization as the list. Missing/denied records fail without showing historic content.
- Announcements no longer silently stop at 250 records. The authorized listing now supports bounded 1–100 size pages, keyset (`createdAt`, `id`) cursors, invalid-cursor rejection and case-insensitive title/body search. The author UI pages through 50 at a time, coalesces duplicate rows, invalidates stale requests, retains a separately authorized deep-linked record outside the current search/page and avoids additional background polling.
- User-facing announcement notifications open/stay in the recipient Inbox projection, never the admin-only author records or unrelated Activity. Desktop notification routing also returns Inbox for announcements. Recipient action menus cannot expose author-only resource actions. Existing Inbox acknowledgement/read state is preserved.
- Same-frame duplicate Create/Duplicate clicks are blocked by a synchronous mutation lock. This is local click coalescing, not a durable server idempotency guarantee for retries after ambiguous network failures.

## Executed validation

- `cluster-td6-g27-announcement-navigation-tests.mjs`: 13/13 isolated route and cross-surface checks, including >150 rows with tied timestamps, query filtering, missing target, unauthenticated rejection before DB reads, Inbox routing, Command Palette and Settings links.
- `cluster-td6-g06-announcement-schedule-tests.mjs`: 10/10, `cluster-td6-g07-cross-tool-ux-tests.mjs`: 12/12.
- G27 Batch 1–5 focus suites: configuration (16), People (13), applications (21), member onboarding (12), Admin attention (21) checks all passed.
- `cluster-td6-access-renewal-tests.mjs`: 17/17.
- Source scan: syntax and renderer imports/CSS; not a dependency-backed TypeScript build.

## Remaining product scope

- Broader G27 Search/Create/navigation coverage across other resource types and communications authoring; full server-side idempotency for ambiguous announcement-creation retries; cross-tool Inbox/action consistency; help/discoverability; G28 integration reconciliation and TD7 technical cleanup.
- G26 native MSI automatic recovery, third-party credential revocation and provider-level destructive disposal remain gated.
- Node24 package compilation, PostgreSQL18 live concurrency, authenticated browsers and Windows/Qt certification are deferred per product planning, not passed.
- No Prisma migration or native binary replacement in Batch 6.
