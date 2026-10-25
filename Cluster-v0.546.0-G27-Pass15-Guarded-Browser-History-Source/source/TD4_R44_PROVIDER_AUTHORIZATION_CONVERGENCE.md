# TD4 R44 | Provider authorization convergence

## Source-level findings

The R43 feed enrolled Board, Whiteboard and Timeline resources. Build, QA Plan, QA Session, Release and Project still depended on the generic fallback, which did not prove record existence and could send stale or false identifiers, including to administrators. Additionally, the shared rule fetch skipped all enrolled change kinds, so Project-level Access Rule denies were absent from provider decisions. Some legitimate outbox invalidations omit `resource.projectId` and therefore could not be authorized using the envelope alone.

## Implementation

- Five new providers batch-load only identity and archival status from `Project` and `Delivery*` Prisma authorities.
- Delivery providers use Project view authorization, matching `project-delivery-routes.ts` read paths. No additional tool grant is fabricated.
- A provider snapshot is resolved once for each feed batch. Canonical Project IDs, including for events with omitted optional scopes, are used to load Project records and Access Rules.
- An explicitly false `resource.projectId` never overrides the canonical row. A missing, archived or unauthorized resource cannot enter the poll or SSE results.
- Administrator bypasses stay scoped to permissions, never resource-existence proof.
- The source API still emits invalidation hints only, never record payloads; R42's Library/Personnel Record protection remains.

## Development-only evidence

Run `node tools/scripts/cluster-td4-r44-delivery-provider-tests.mjs`, then R43/R42 inherited feed suites and selected TD3/Library/job tests. Static TypeScript/JS syntax and relative imports were also reviewed. This is NOT equivalent to a dependency-backed Node 24 server compile, live PostgreSQL transaction test, or authenticated SSE certification.

## Out of scope

Remaining generic resource kinds, typed event producer contracts, lifecycle enrollment/draining, shared search/action adapters, large hierarchy jobs and retention-authoritative storage disposal are not marked complete. Physical files are not deleted by this change.
