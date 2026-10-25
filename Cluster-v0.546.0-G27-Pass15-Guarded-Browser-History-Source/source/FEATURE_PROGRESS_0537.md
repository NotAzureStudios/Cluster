# Cluster v0.537 | People & Admin closeout

### Implemented in source

- Revision-bound application reviews; conflicting decisions cannot overwrite a newer status without refresh.
- Account conversion tied atomically to the exact approved revision, not merely an approval state observed earlier.
- Explicit opt-in profile mappings on conversion, native confirmation, one-time credential presentation, and duplicate-click guard.
- Application list and Admin approval queue retain prior results on transient failures; successful approval decisions immediately update local status.
- Offboarding critical operations have synchronous in-flight protection and outcome-safe reconciliation. Impact-preview retry is read-only. Equipment evidence, cancellation, and offboarding completion claim case revisions before transactional side effects.

### Evidence and scope

The new 18 People/Admin tests check actual revision predicates and source integrations. The remaining inherited suites cover Work, Board, Library, and approval paths. Full source parse and import checks are separate. Actual server/DB concurrency, browser behavior, and native Windows execution are not certified; no Prisma migration was needed.

### Not complete

- Whole People/HR feature ledger, onboarding/offboarding runtime certification, full browser/DB e2e and any separate account credential recovery flow.
- Library/Admin and Desktop auto-update roadmap areas remain open. No new feature expansion or OS installer work is included.
