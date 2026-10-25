# TD4 R46 | Source Control canonical invalidations and Review queue authorization

## Confirmed defects

- `source_repository`, `source_commit`, and `source_review` were accepted through generic change-feed authorization. The generic path did not prove real SourceRepository/SourceCommit/SourceReview records or their active Project bindings, and trusted optional envelope Project IDs too much.
- Repositories may have multiple ProjectSourceBindings. A user's permission in one Project cannot authorize a source change explicitly scoped to another Project.
- `/api/source-control/review-queue` swallowed failed Project Access Rule lookups with `catch(() => [])`, potentially evaluating review visibility without existing deny rules.

## Implemented

- Three enrolled providers resolve canonical identity and the source relationship through batched Prisma queries, filtering archived repositories and archived Project bindings.
- Extended the existing provider snapshot to gather all live linked Project IDs, so Access Rules and Project objects are loaded before the visibility decision. Explicitly scoped repository/commit changes require an authorized binding for that scope. Unscoped changes can be disclosed only through an authorized bound Project. Review invalidations additionally require its exact canonical Project and an active repository binding.
- Current `sourceControl` Tool Permission and inherited Project Access Rules are mandatory. Lookup failures propagate; failed providers cannot produce accepted changes. Generic administrator fast paths do not bypass the new records.
- Review queue no longer treats an unavailable Access Rule store as empty permissions.
- Added focused provider tests and `/api/changes` route integration tests, including multi-binding rules, source kind spoofing, missing/deleted/archived identities, permission revocation, disabled tools and provider failures.

## Scope limits

- These source changes do **not** create new search index entries, command executions, producer event kinds or subscription lifecycle machinery. That cross-consumer integration remains TD4 work.
- R46's synchronous test harnesses validate the real TypeScript source transpiled against mocked persistence. They do not establish live PostgreSQL/HTTP/SSE concurrency or installed Windows/Qt behavior.
- No schema migration; same outbox envelope and canonical resource kinds.
