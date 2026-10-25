# Cluster v0.521.0 | Packet publishing beyond notes

## Implemented in source

- Opt-in raster-image derivative publication from approved Library JPG/JPEG, PNG, static WebP items. Converts the verified **pixels** into fresh WebP with orientation correction, bounded dimensions, re-encoding, and default metadata stripping via `sharp@0.35.5`; original file is never returned to Packet recipients.
- Bounded inputs <=1 MiB each, max 12 image candidates, source <=20 megapixels and 8192 pixels per axis, per-output <=64 KiB, combined publication bytes <=1 MiB. Any invalid candidate rejects publication, without falling back to raw Library source bytes.
- Uses exact frozen source revision + SHA-256 comparison, controlled classification/mime/extension, regular-file and safe-root checks, no symlinks, private no-store recipient delivery, nosniff headers, and detached ZIP payloads. Frozen recipient eligibility, revocation and source ACLs remain authoritative.
- Adds image counts/bytes in author previews, an explicit `Publish + text & images` option, and WebP download links. Existing PDF, txt, ZIP release artifacts remain supported.
- PDF publication now creates fresh bounded/watermarked PDFs from **both** notes and checked plain-text uploaded Library files, not just note records.
- Moved expensive derivative generation out of `RepeatableRead` publication transaction, then re-reads canonical Packet/source objects, rechecks edit authorization, and rejects changed manifest fingerprints before insertion. No mutation or partial publication if stale.
- No Prisma schema change/migration for this pass. Reuses immutable PacketReleaseDerivative format and content fields.

## Deferred or not certified

- `sharp` is a new production Node dependency. Current archive is source-only, with no node_modules; test decoder is mocked, **not** a real Windows or image-decoder runtime pass.
- SVG, animated images, original PDFs, audio, video and arbitrary binary source files are **not** distributed. Original PDF safe rasterization/sanitization remains open.
- Device Package staging remains unprivileged verification only. Do not claim signed package activation/install/OS-health proof based on local pointer or device-authored receipt. Fresh server authorization at actual activation and supervised native OS rollback are still required.
- No real PostgreSQL serializable/concurrency, Qt6/MSVC/Windows runtime or full dependency-backed TypeScript/Prisma certification.
