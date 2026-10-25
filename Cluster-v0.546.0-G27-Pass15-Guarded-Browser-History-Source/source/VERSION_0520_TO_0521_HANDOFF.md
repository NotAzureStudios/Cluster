# v0.520.0 -> v0.521.0 | Connected Packet binary-media and PDF delivery handoff

**Input:** `Cluster-v0.520.zip`, full verified source with v0.520 native Go staging helper.
**Output:** `Cluster-v0.521.zip`, full updated source, unchanged v0.520 unprivileged Windows Go helper, versioned docs and validation; `Cluster-v0.521.patch` is a text-source patch from the exact v0.520 baseline.

## Changes

1. New `apps/server/src/domains/library/packet-file-image-derivative.ts`, dependency `sharp@0.35.5` in server. Checked `jpg/jpeg/png/webp` only, re-encoded to independent `webp`, rechecks exact file revisions/hashes/path/symlink policy, rejects classification and malformed images, applies strict resource and release-byte limits.
2. Packet author `releases/preview` and publication support `imageDerivatives` separately from `textDerivatives`/`pdfDerivatives`; PDF and image may be combined. No source delivery fallback. Personnel Records publication guard retained.
3. Recipient catalogue, individual download and detached ZIP support WebP MIME, generated filenames, integrity and existing frozen-audience/revocation safeguards.
4. PDF production refactored into shared safe renderer; uploaded verified `.txt` files are now accepted in PDF publication. Original uploaded PDFs remain blocked.
5. Expensive file conversion now runs before database transaction; repeatable-read transaction rehydrates Packet and source items, rechecks editor permission, and rejects stale source manifest hash.
6. New security-focused source tests for image selection/hash/path/classification and PDF verified uploaded text, plus inherited assertion fixture updates.

## Certification boundary

Source-level tests use a mock `sharp` image decoder and mock `pdf-lib` renderer; do **not** certify real media decoding, binary runtime on Windows, PostgreSQL locking, or installed Package delivery. `sharp` prebuilt optional dependencies must be present for Windows production startup. No Qt/Go changes in this pass.

## Next substantive development

- Secure original source PDF rasterization, media derivatives where warranted, and background job processing for expensive publication.
- Finish signed Package current-entitlement authorization at native activation time, authorized managed-root installer with conflict preservation and rollback, actual Windows verification.
- Work collaboration/Undo/Redo, Library/Admin workflows, UX, full runtime/postgres certification.

Do not broaden MIME acceptance or offer original binary files as fallback if conversion fails. Preserve immutable source-vs-delivery authority and the no-production-legacy policy.
