# TD4 R73 | Studio Forms and review-submission Search audit

## Scope and identity

- `studio_form` maps to an existing Studio Systems Forms editor; `form_submission` maps to the owning form's existing review panel.
- Search rows use canonical IDs and context-only metadata, not a synthetic Project scope. Resource Action and `cluster://resource/...` navigation go through the existing shared address/renderer handoff.
- Public applications continue to use the Applications workflow and are not indexed as ordinary form review submissions.

## Server data/privacy boundary

- Studio Form corpus fetch is bounded at 1,000; non-application submission corpus at 3,000. Refresh of unrelated Projects retains global Studio Form/submission corpus.
- Search indexed form data: stable ID, current title/key, purpose, status and revision. Indexed submission data: stable ID, owning form/title, review status and revision, with parent revision to revoke stale results.
- Search index creation **whitelists** submitted fields. No respondent name, email address, `answersJson`, freeform answers, PII or arbitrary Prisma row properties may be copied into `SearchIndexItem.raw`, labels, facets or terms.
- Live admission checks current DB row and owning form, including changed title, key, status, form purpose, ownership and revision; stale, removed or inaccessible results are withheld instead of publishing cached titles.
- Search discovery requires both admin identity and Settings edit authorization before the generic admin access branch.

## Direct navigation boundary

- `/api/studio-systems/submissions/:submissionId/target` resolves the current form ID but no answer/identity material; application responses get 404. It sets `Cache-Control: private, no-store`.
- `/api/studio-systems/forms/:formId/submissions/:submissionId` returns the exact submitted response **only after existing `requireAdmin`**, including out-of-page older submissions, and only when the form belongs to that ID and is not an application. It also sets `Cache-Control: private, no-store`.
- Reviewer-facing API returns answers only in its authorized detail response. Those details must not enter Search indexing or shareable URI metadata.
- The renderer opens the actual Studio Systems section, resolves target submission → form, and retrieves exact submission as necessary. Invalid records fail closed and never default to an unrelated record.
- `StudioSettingsPage` now resolves all valid Studio Settings sections; no longer forces most direct section selections back to Identity.

## Executable evidence

- `npm run techdebt:td4:r73:studio-form-search`: **35/35** focused assertions covering real index builder and admission in a mocked DB, privacy injection, authorization ordering, remote scopes and deep link routing.
- 51 inherited selected TD4 suites passed (R72 source and safety regressions). An older collection test required a **temporary TypeScript module link and Node type-strip flag** because the lean archive omits local dependencies; removed before packaging.
- Source scan: 1,040 TS/TSX, 110 CSS, 4,497 relative imports; zero authored syntax errors, CSS structural errors or missing authored relative imports. Missing generated Prisma-client import expected in lean archive.
- Baseline comparison of dependency-incomplete renderer TypeScript diagnostics: **0 added normalized error signatures**. This is NOT equivalent to a successful full `tsc` compile.

## Remaining limits

No Node 24 dependency-backed runtime, Prisma generation, authenticated multiuser, real PostgreSQL or Windows/Qt browser acceptance was performed. Form response rendering is covered by source test contracts, not a live mounted renderer fixture.
