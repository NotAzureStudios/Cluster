# Cluster v0.544.0 | Forms authoring, assignment, submission and review

## Connected source-level workflows

1. **Admin authors Forms:** Existing field builder and starter templates retained. Fields can be reordered, drafts saved in-place with optimistic revision checks, and published atomically as immutable published versions. Published forms are not edited in-place.
2. **Admin changes assignment:** Update the form title, description and Studio Audience independently of published field versions. Changing the audience immediately changes member discovery and submission authorization. Form edits use a revision-qualified database write.
3. **Member completes Forms:** Account Settings → My forms lists active, published, audience-authorized non-application forms and previous response states. Member form definitions omit private profile mapping keys. User submits through the existing Form Runner without repeated-click replay.
4. **One-response safety:** Authenticated form submission rechecks the latest published version and duplicate-submission rule inside a Prisma Serializable transaction. Serialization conflicts return a revision-style failure. Response options are versioned.
5. **Admin reviews:** Forms editor shows paginated non-application submissions with historical version fields and answers, status filters, reviewer notes, approve/reject/under-review decisions, required rejection reason, and revision-checked single-use review decisions. Applications remain in their own workflow.
6. **Notifications:** Forms may notify active studio owners/admins on submission using the existing Inbox activity projection. Final review outcomes can notify the originating member. Responses contain no ordinary-list secrets. Member and reviewer listings use no-store headers.

## Tests and boundaries

- 38/38 Forms route/UI workflow checks passed, exercising route handlers with an in-memory Prisma-like DB including access gating, version-safe saves, submissions, approval/rejection, notification wiring, and stale-revision conflicts.
- 116/116 selected inherited Forms/Inventory/People/Boards/Library checks passed (32 + 10 + 18 + 17 + 26 + 13).
- Active TS/TSX syntax check: 1,034 files, zero parse errors. CSS: 108, zero delimiter errors. Renderer relative imports: 3,060, zero missing.
- **Not certified:** live PostgreSQL serializable contention, Qt/Windows runtime, browser usability, full dependency-backed TypeScript compilation, and end-to-end Inbox delivery. Existing unrelated features remain on the master roadmap. No migration or native change.
- **Remaining Forms enhancements:** server-saved partially completed respondent drafts, scheduled reminders/due-date assignments, and advanced conditional logic are not implemented by this milestone. Audience-based discovery and response tracking are implemented; not every form is a mandatory assignment.
