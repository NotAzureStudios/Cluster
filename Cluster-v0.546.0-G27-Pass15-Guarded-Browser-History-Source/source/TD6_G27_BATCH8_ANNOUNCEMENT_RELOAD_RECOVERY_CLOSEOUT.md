# G27 Batch 8 — Restart-Safe Announcement Intent Recovery

## Baseline and result

Parent is exactly G27 Batch 7 Durable Announcement Create. This pass extends the existing canonical Studio announcement author workflow; it does not add a second communications, audit, notification, or authorization service.

## Implemented

1. Read-only `GET /api/studio-systems/announcements/create-intents/:intentId`: rechecks current administrator Settings-edit authority, signed-in actor, UUID format, and creator identity; returns a sanitized canonical author record or a safe 404. It never creates, schedules, publishes, or duplicates an announcement, and responses are private/no-store.
2. Browser-tab recovery markers for Create and Duplicate. Markers contain an opaque UUID, SHA-256 digest of the submitted form's serialized request, and creation timestamp. **They contain no titles, bodies, audiences, license keys or account identifiers.** Markers expire after 24 hours and are discarded if malformed. Browser storage failure degrades to the prior component-memory retry behavior. If WebCrypto is unavailable but a stored marker exists, the editor blocks a different submission until the marker is inspected or explicitly discarded.
3. Successful Create/Duplicate clears its marker. Ambiguous failure preserves it. A new payload cannot silently replace an unresolved operation; the operator can query the original transaction's result or explicitly discard the marker after reviewing the announcement list.
4. After a reload, a Check Previous action retrieves an already-committed announcement without issuing another POST. The lookup is explicitly user-triggered, never background polling. If no commit exists yet, the marker is retained because 404 cannot prove the original request has stopped.
5. Current canonical server mutation supports replaying the same payload with the same UUID. This change preserves Batch 7's unique-constraint/digest behavior and avoids weakening author permissions on retry.

## Validation

- New UI-marker and integrity helper tests: 9/9.
- Updated route-level durable-create/recovery tests: 19/19.
- Inherited G27 announcement navigation, scheduling and shared cross-tool UX tests: passed.
- G27 Configuration Recovery, Application conversion, People Lifecycle, Admin Attention tests: passed separately.
- TypeScript source scan: 1,109 files with no syntax errors; 3,248 relative renderer imports resolved; 110 CSS files without delimiter errors.
- Source-manifest verification and independently replayed patch: recorded in the delivered integrity report.

## Limitations

- This is still a source-implemented workflow. No live PostgreSQL/Node 24/browser/Qt test certification is claimed.
- Browser-tab storage is intentionally ephemeral. A different tab, device, or browser won't share recovery markers. Admins can still use authorized announcement Search to locate records.
- The browser marker does not persist an unsent announcement draft's contents. Recreating a form for a retry requires reentering identical content or inspecting the server result first.
- An intent lookup returning 404 is not cancellation evidence. Explicitly discarding a marker does not cancel an in-flight server operation.
- Existing G26 native installer, third-party credential-provider revocation and destructive storage safety gates remain unchanged.
