# Cluster v0.546.0 | TD6 G27 Batch 3: Application and Onboarding Integration

**Parent:** G27 Batch 2 People Access Lifecycle. **Status:** grouped development source implemented, not production-certified. No new Prisma migration or native binary changes.

## Implemented workflow

1. Public applications continue to enter the canonical StudioFormSubmission review queue. Administrator decisions now use an optimistic-revision predicate **inside a database transaction** with an appended tamper-evident security audit. Rejected applications resolve prior administrator Inbox actions without erasing history.
2. Conversion uses the original approved application's `updatedAt` compare-and-swap claim in the same transaction as creating the initial member account. It produces a PASSWORD_CHANGE_REQUIRED identity with no elevated tool, Project or workspace grants, and syncs normalized workforce authority rather than cloning public-provided access labels.
3. The mapping helper strictly validates **only explicitly selected** allowed profile fields. It rejects deleted/unapproved mappings, conflicting destinations, duplicate selections, non-string payloads, oversize values, and invalid email text. Unselected applicant data never enters People. The confirmed conversion metadata contains mapped field names, not copied sensitive application answers.
4. If the operator selects onboarding, the **current** Plan Version is reloaded within the conversion transaction; its published and active states are required, and **strict** audience evaluation is performed with normalized People memberships. Ineligible or now-inactive selections roll back the account instead of silently omitting onboarding. The version-pinned assignment and first-login Inbox action commit with account and security audit evidence. Selecting no onboarding remains an explicit choice.
5. The pending administrator application action is resolved transactionally when conversion succeeds. One-time credentials stay only in the immediate privileged response, with no plaintext in activity, audit, notifications or persisted conversion metadata. The non-security activity projection cannot hide a committed credential response if its own write fails.
6. Privileged applicant detail has a `Cache-Control: no-store` single-record endpoint. Inbox notification navigation resolves `studio_application` to Studio Settings → Studio Systems → Applications, even if the submission is not in the first listing page. The authoring panel can open the new Person profile and copy the Person ID; the previously converted record retains a People follow-through action.
7. Operations reporting counts submitted + under-review + approved applications awaiting action, and separately identifies approved applications awaiting person creation. Previously the summary omitted both under-review and approved applications.

## Tests and checks

- `cluster-td6-g27-application-onboarding-tests.mjs`: **21/21** pure-field and actual registered route-handler checks, with rollback-capable fixture, duplicate conversion, failed audit/Inboxes, stale plan, audience exclusion, rejected review, and exact-record deep-link authorization.
- Existing `cluster-0537-people-admin-closeout-tests.mjs`: **18/18**.
- Existing cross-tool UX and announcement schedule suites: **12/12** and **10/10**; old route-mock import tables were updated to reflect new production imports without dropping previous assertions.
- G27 Batch 2 and Batch 1 inherited commands: **13 People lifecycle + 17 renewals + 21 offboarding + 18 return-to-studio + 16 configuration rollback + 14 setup guidance + 12 config review + 12 revisions** passed. The long combined command completed these suites but hit its execution window at the trailing source scan; the same source scan was subsequently run separately and passed.
- Source scan: **1,103** TS/TSX files, **3,235** relative renderer imports, **110** CSS files, 0 parse/import/brace findings. Exact source archive and patch replay reported separately in integrity report.

## Remaining work

- Native Qt/browser authenticated runtime behavior and PostgreSQL database execution remain unverified and intentionally do not block G27 source development per the project owner's decision.
- Recipient-facing onboarding **step completion** and progress presentation should be reconciled in later G27 work. The new Inbox action does not by itself implement a self-service onboarding UI. Source-level on-demand GET `/api/onboarding` already exists.
- Cross-workspace effective access explanation / Access Explorer link from People, Home action projections, shared Search/Create, Communications, and remaining Admin UX are subsequent G27 slices. Do not pretend this pass completed the whole G27 milestone.
- G26 disabled physical disposal, external revocation and Windows Installer recovery stay safety-blocked/unverified.
