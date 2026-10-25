# Cluster 0.532 feature completion ledger

## Integrated source flow: Desktop Package download → destination update

1. Authenticate through renderer's registered device request to the server.
2. Verify the downloaded release size/digest and signed manifest metadata.
3. Build fixed-entry staging kit without receipt secrets or trust assertions.
4. Stream into native profile-isolated temporary file through bounded, offset-tracked native transfer capabilities.
5. Native Qt verifies full-kit checksum, reads separately pinned signing-key fingerprint, obtains user confirmation, starts Go signature/file verification.
6. Only after success, recheck latest device-authorized target; request native managed-file destination sync with separate confirmation, preserved local edits, tracked backups, guarded rollback.
7. Display a native operation state and refresh advisory destination history; retain offline/manual workflow.

**Status:** Source-implemented and cross-language Go tested. Qt runtime proof pending. Not unattended automatic file updates; not delta network transfer.

## Remaining before declaring updater fully done

- Run/compile Qt on Windows and check broker request chunk handling/confirmation in the real WebView2 transport.
- Add optional opt-in per-Package update policy (notify/manual/automatic); real unattended updates need offline/revocation semantics and user-consented destination policy.
- Add efficient network deltas for large Packages; 4 MiB release limit still exists.
- Add managed retention/backup policy and surfaced historical file-update timeline.

## Other outstanding 1.0 work

Work collaboration beyond Board moves, Whiteboards, Library 3.0, People/Admin lifecycle and Tool Config, shared Create/Undo/Redo, UI and Desktop integration closeout. User deferred full certification, not basic focused source tests.
