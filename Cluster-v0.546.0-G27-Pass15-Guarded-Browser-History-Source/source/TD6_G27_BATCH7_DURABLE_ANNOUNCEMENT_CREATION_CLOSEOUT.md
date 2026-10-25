# TD6 G27 Batch 7 | Durable Communications Creation and Authorization Freshness

## Implemented

- Studio announcement create and duplicate now carry a UUID `createIntentId` across ambiguous request failures. The renderer retains the same intent while the payload remains unchanged; an explicit new action after success uses a fresh intent.
- Canonical `StudioAnnouncement` persists the create intent and SHA-256 fingerprint. The new PostgreSQL compound unique constraint on `(createdById, createIntentId)` prevents concurrent create duplication across processes; the existing admin-authorized POST handler replays the previously committed row only if the original fingerprint matches. Reusing one intent with different content returns 409. A database uniqueness race is resolved by a fresh scoped lookup, never an unbounded retry.
- The request digest includes title, message, full frozen authoring audience selection, priority, acknowledgement/Discord flags, and original schedule timestamp. Internal fingerprints and intent IDs are stripped from serialized records.
- Replays re-run the existing server-side Settings edit authorization before finding a matching intent. A user cannot replay another actor's creation. An original scheduled draft remains recoverable even after its schedule time passes, including if the original record is now published.
- Admin announcement listing no longer uses the renderer `queryApi` cache. It makes an authorized fetch for each explicit load/query, consistent with server-side `private, no-store`. Search debounce and pagination stay bounded; no new background polling.
- Create/copy UI gives specific ambiguous-result retry guidance, instead of suggesting an accidental second create.
- Introduced migration `20261104000000_td6_g27_announcement_create_intents`; older records have nullable intent columns, and old programmatic callers still function but do not receive the new deduplication guarantee.

## Verification

- New executable digest, route, concurrent-conflict, authorization, migration-contract, and renderer tests: **14/14**.
- Inherited announcement navigation **13/13**, scheduled announcements **10/10**, cross-tool UX **12/12**.
- Inherited G27 configuration **16/16**, People **13/13**, applications **21/21**, member onboarding **12/12**, Operations access **21/21**, renewal **17/17**.
- Source scan: 1,108 TS/TSX parsed without syntax errors, 3,247 renderer-relative imports none unresolved, 110 CSS no delimiter errors.
- These are source tests and fixture-based route tests, not live PostgreSQL, full Node 24 compilation or browser certification. The database migration must be applied before enabling this route in a real server.

## Open work

Cross-resource Create idempotency and Search/action navigation coverage, Inbox acknowledgements and delivery outcome usability, shared Help/discoverability, G27 source reconciliation, G28 and TD7. G26 MSI/post-reboot, external credential revocation and provider-fenced physical disposal remain separately gated.
