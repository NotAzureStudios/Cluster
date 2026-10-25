# Cluster v0.546.0 · TD3 Pass 24 · Admin action integrity

Parent source: TD3 Pass 23. Source implementation only. No changes to PostgreSQL schema, native executable, or release-certification roadmap.

## Implementation

- Added a small reusable synchronous surface-action gate, with a React hook that separates the immediate lock from rendered pending feedback. An unrelated action cannot bypass the gate before React commits, and an old completion cannot release another owner's lock.
- Added newest-response ownership for async detail and checklist/history reads. Older incident responses never overwrite a newer selection; older checklist and configuration-history projections are ignored, including following unmount.
- Operations Incident creation, note insertion, and status transitions now acquire the same single-flight action lock. Creation and note inserts send stable server-supported idempotency keys, reused for identical uncertain retries and replaced after confirmed completion.
- Incident mutation paths operate on the selected incident captured at admission. Changing the selection during a pending write never attaches the returned details to a different incident. A confirmed write is not mislabeled as failed merely because a subsequent health refresh fails.
- Setup Checklist Skip/Restore and Export share an immediate lock; writes invalidate prior reads before dispatch. Configuration Preview and Apply use one lock to prevent cross-action submission races. Configuration revision refreshes use newest-response ownership.
- Added explicit progress labels and aria-busy for affected admin mutation controls. Existing form fields, status evidence, tabs, taskbar utility controls, People identity, and appearance personalization are preserved.

## Development checks

- 17/17 Pass 24 assertions passed, including executed action gate, retry receipt, and stale-response simulations.
- 15/15 core inherited development scripts passed, plus 17/17 TD3 generation-specific scripts (prior to final UI feedback labels; source-contract tests re-run after).
- The parser/import/style scan ran after implementation; see TD3_PASS24_SOURCE_SCAN.json. This is not a full dependency-backed TypeScript compile, native Qt runtime check, or authenticated Windows application test.
- Eight representative dark/light desktop/phone visual fixtures were created with Cluster's source CSS. They are **not 1:1 mounted React screenshots**. No generic external UI images were used.

## TD3 continuation

TD1 and TD2 remain implementation-closed. TD3 implementation still needs a deliberate sweep of independent action owners, actual conflicting style rules, and meaningful remaining Qt source parity. Certification remains exclusively in the separate release roadmap.
