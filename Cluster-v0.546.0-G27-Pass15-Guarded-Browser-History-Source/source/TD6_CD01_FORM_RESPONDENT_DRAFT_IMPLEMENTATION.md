# TD6 / CD-01 | Authenticated Forms respondent drafts

**Source checkpoint:** Cluster v0.546.0, TD6 CD-01 development slice, 2026-10-14. Parent: TD3 Deep Shared Actions + Appearance Cascade, Roadmap R25. **Status:** authenticated respondent drafts implemented and source-checked; CD-01 as a whole remains open for other authoring/collaboration requirements. No installed/PostgreSQL certification is asserted.

## Source owners and end-to-end flow

| Layer | Implementation |
| --- | --- |
| Database | `StudioFormResponseDraft` owns one owner-private draft per `(formId, userId)`, pinned to `formVersionId` and revision, with cascade cleanup for deleted forms, versions and user identities. Migration `20261014190000_studio_form_respondent_drafts`. |
| Server | `GET/PUT/DELETE /api/forms/:formKey/draft` validates authenticated identity, canonical audience, active/published form, author-configured `allowDrafts` / `acceptingResponses`, bounded and typed partial answers, CAS revision, serializable write against one-submission state and private response caching. |
| Submission | Existing `POST /api/forms/:formKey/submissions` deletes only the submitting user's draft **inside** the same serializable transaction. Submitted/under-review/approved responses block duplicate single-response submissions. |
| Member discovery | `GET /api/forms/available` exposes only private draft summary (date/stale), never draft contents. `MyFormsPanel` labels saved drafts. |
| Shared renderer | `StudioFormRunner` hydrates drafts, debounces edits, blocks stale-version overwrites, offers reload/discard, handles in-flight saves before final submit, and preserves existing completion/callback semantics. |
| Anonymous boundary | `PublicClusterCover` explicitly disables authenticated draft recovery. No browser localStorage of sensitive applicant answers. |
| Background/transport | The high-frequency private draft mutation path is excluded from generic persisted idempotency receipts. Revisions + serializable transaction supply conflict/duplication control; only the final submission uses the normal receipt path. |

## Actual implementation behavior

- Only the signed-in owner can retrieve a draft. General Forms administration and submission review do **not** expose draft answers. Forms that are not published, not audience-authorized or applications are not available through this API.
- A competing tab cannot overwrite or discard a newer revision. A save to a superseded published version is rejected. The reader returns `stale: true` without automatically migrating old answers.
- Partially completed answers may be saved without satisfying required fields or having complete email/URL/date formatting, but provided field types, option membership and length constraints still apply. Payload cap: 64 KiB UTF-8.
- The form runner does not clear user-entered answers on autosave failure. It displays a retry/recovery state. Submission waits for already-running autosaves before posting, and the database removes its draft atomically with the successful response.
- The authoritative final validator additionally requires true for required checkboxes/acknowledgements.

## Source regression evidence

- 68/68 tests covering in-memory route execution, authorization, private isolation, serializable draft write and submission, CAS conflicts, stale versions, create/discard, anonymous rejection, disabled drafts, payload limits, required checkbox, and incomplete-field behavior.
- Inherited Forms 38/38; TD3 shared action 16/16; TD3 native QML source 89/89; TD3 picker 31/31; TD1/TD2 closeout 15/15; other source regressions recorded in `TD6_CD01_VALIDATION_RESULTS.md`.
- Active source structural scans: TypeScript/TSX syntax, renderer-relative imports, CSS delimiters, source manifest + archive integrity.

## Important nonclaims and follow-up

- Full PostgreSQL migration application, Prisma client generation, authenticated multi-browser testing, React/Qt build and Windows certification require the target toolchain and are **not** claimed here. They belong to the separate release-certification roadmap.
- Public anonymous application recovery should use an explicit privacy-safe opt-in design rather than quietly persisting applicant answers in localStorage. Remains open.
- The broader CD-01 Forms authoring, Board/Whiteboard collaborative history and other TD6 CD-01/03/18 work remain open. This does not close TD3 or TD6.
- Add an owned draft retention/privacy inspection flow where policy requires one; do not make draft contents visible in administrator submission tables.
