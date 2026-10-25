# G27 Pass 2: Scoped Studio Forms submission links

## Defect

The detailed Form submissions route correctly authorized either a Studio Settings editor or an explicitly assigned active Form reviewer. The separate `GET /api/studio-systems/submissions/:submissionId/target` used by deep-link navigation unconditionally required Studio Settings edit. Delegated reviewers could review a response when in the Form but could not resolve an ID-only link from navigation/inbox.

## Change

- The global authorization gateway now gives **only the exact delegated Form review GET/PATCH routes** authenticated admission, leaving per-Form authorization to each handler. All other Studio Systems mutations and Settings routes retain their coarse tool fence; the capability remains `settings` for kiosk/disabled-tool protection.
- Both routes use one `canReviewForm(request, formId)` decision, with existing active-user/expiry and per-Form grant policy. The new resolver does not grant any new review or admin rights.
- The target resolver reads **only** owning Form ID and the Form purpose; it calls the current per-Form authorization before returning the ID. An application response is never resolved through this route.
- Missing, unauthorized, revoked and application-only targets all return `404 FORM_RESPONSE_NOT_FOUND` with no response identity, answers, schema, reviewer note or respondent data. Cache-Control stays `private, no-store`.
- `studio-form-target-admission.ts` is a pure, bounded authorization callback boundary that makes failure-to-disclose cases directly testable without a database.
- The obsolete historical R73 tests now assert the canonical delegated-review policy and modern direct selected-ID detail load, not removed admin-only routing.

## Verification

`node tools/scripts/cluster-g27-p2-form-review-boundary-tests.mjs`: 26 executable policy assertions for exact method/path admission, denied route variants, and retained kiosk/Settings capability.

`node tools/scripts/cluster-g27-p2-delegated-form-target-tests.mjs`: 18 executable and contract checks, including revoked permission, Form mismatch, application exclusion, orphaned response, oversize ID, database failure and grant-store failure.

`node tools/scripts/cluster-td4-r73-studio-form-search-tests.mjs`: 35 earlier Studio Forms and Search checks with policy-accurate modern expectations.

`npm run cluster:g27:p2:delegated-form-links`: both above, Pass1's fresh search activation checks, and the inherited G26 source/portable regression chain.

Not a full database-backed Fastify integration or live browser/Qt acceptance. G27 Search and navigation coverage remains partial. Certification/release gates remain separate.
