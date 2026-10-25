# TD6 G27 Batch 5 | Home/Admin attention and People effective access

## Source changes

- Operations summary uses `summarizeStudioOnboardingAttention` to evaluate **required** Packet, Policy and Form evidence with the same `completionStateForUsers` implementation used by the member checklist. A completed checklist no longer counts as active or overdue. Optional incomplete steps do not keep onboarding open.
- Active published plans only. Current assignment status, exact required-step evidence and a supplied evaluation clock drive `assigned`, `active` (outstanding), `completed`, `overdue`, `dueSoon` and the oldest 12 overdue people/assignments. Pagination is bounded to 200 records per query by default, capped at 25,000 scanned records. A scan that exceeds its cap fails instead of presenting partial totals.
- Operations Packet/Policy metrics use `groupBy` on the full responsibility table inside `REPEATABLE READ`; source-level 5,000-row truncation is removed. Detailed overdue list is limited to 12 records; resource labels are looked up only for those records.
- The existing Operations panel now displays completed/outstanding/overdue/due-soon counts and opens the exact selected Person via canonical Work navigation. It does not start a new poll or duplicate onboarding authorization.
- People Access tab now has an on-demand effective Tool explanation for self or administrator-managed people. The server's `/api/access/explain` independently authorizes third-party inspection. No local permission simulator or cached cross-account decisions. Switching subject/tool/action invalidates the displayed decision.

## Development checks

- `node tools/scripts/cluster-td6-g27-attention-access-tests.mjs` (21 focused checks): evidence completion, policies/forms, due windows, active-state filtering, oldest-12 selection, cursor pagination and cap, missing versions, DB errors, full >5,000 record aggregates and navigation/source ownership.
- Inherited G27 Batch 1–4 application, onboarding, People, renewal, offboarding and configuration regression suites executed and passed separately.
- `node tools/scripts/cluster-td6-source-scan.mjs`: TypeScript syntax, renderer-relative imports, CSS delimiters.
- This is NOT a full TypeScript compilation or a live PostgreSQL/Windows/Qt/browser execution.

## Safety and remaining work

The 25,000-assignment cap intentionally produces an explicit error rather than a misleading subtotal. Admin Operations is a view, not a mutation; no changes to Packet delivery, onboarding assignment, grants, or content permissions. PostgreSQL transaction contention and live rendering remain unverified. G26 deferred physical disposal, native automatic MSI recovery, and unverified external provider revocation remain gated. No migration or native executable change.
