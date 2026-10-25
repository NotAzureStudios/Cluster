# TD4 R74 | approval Search / exact-record navigation audit

## Data authority

- Approval identity is a global `approvalRequest` `clusterPersistenceRecord` surfaced as the existing canonical `approval` resource kind. Project context on an approval does not create a synthetic Search ownership scope.
- Search reads a bounded set of approval IDs, titles, statuses and timestamps, not the request payload, requester IDs, email addresses, review notes or justification fields. Source titles are already potentially user-authored and may contain personal information: only Studio administrators receive this Search kind.
- A cached title is never admitted without reloading its current persistence record (kind, deleted/archived state, title, status, updatedAt). Failed DB calls reject the entire batch.

## Navigation and direct lookup

- The renderer maps `approval` to `admin` / inspector scope `approval`; the application checks active admin identity and opens Admin > Approvals.
- The existing `adminForApprovals` guard was tightened to require administrator identity for the entire global approval queue, exact lookup, and decisions; a generic Project manager no longer receives all Studio approvals. The guard is used by new GET `/api/admin/approvals/:approvalId`; API response has `Cache-Control: private, no-store` and returns 404 when no record exists. The same guard already protects list and decisions. Avatar audit IDs are supported for deep-link navigation, but avatar audits are deliberately not added to global Search.
- The Approval Center reads `inspect=approval:<ID>` from the same shared navigation handoff as other resources. It selects exact IDs outside its 500-row page, clears stale local filters and avoids falling back to the first unrelated queue item. Newer navigation invalidates older outstanding lookups. Queue refresh keeps the separately authorized record when absent from current page.
- Copy Link uses the canonical Work Action, including `cluster://` on desktop where supported.

## Executable evidence

- 32/32 targeted R74 checks cover whitelisting, deleted/archived state, stale titles/status/revisions, non-approval records, DB failure, admission bound, authorization ordering, exact endpoint, UI routing, historical records, fallback prevention and shared Copy Link.
- 51/51 inherited TD4 executable scripts passed, including corrected R57 unsupported-kind fixture. R35 collection fixture needed a temporary `node_modules/typescript` symlink (removed before packaging). Other tests used Node 22 `--experimental-strip-types`; Node 24 runtime not available here.
- 1,040 TS/TSX parsed, 110 CSS parsed, 4,498 authored relative imports verified. Generated Prisma import remains absent in lean source. Server and renderer incomplete `tsc` baseline comparisons each show **0 new normalized diagnostic signatures**, not a successful compiler run.
- No Prisma migration or native binary modification.

## Open gates

No live authenticated browser, full dependency-backed Node 24 build, PostgreSQL migration/concurrency, actual native Windows/Qt protocol activation, or NAS/S3 execution acceptance performed. Approval-adapter integration is source-complete, not TD4 source closure or release certification.
