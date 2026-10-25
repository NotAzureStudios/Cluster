# Cluster v0.522.0 | Connected Packet PDF / Package integrity / Admin UX pass

## Source changes

- **Packet Library PDF inputs**: Explicit opt-in `sourcePdfDerivatives` publication. Small, approved PDF uploads are read from a frozen Library revision using SHA-256 and no-follow path rules, decoded with PDF.js, rendered via @napi-rs/canvas, re-encoded through sharp into pixels, and assembled into a wholly new, detached PDF via pdf-lib. Existing source PDF structures, scripts, annotations, links, original fonts, and attachments are **not** passed on. Restricted sources never become derivatives. Publication retains its independent audience, immutable release, revocation, delivery and ZIP checks. Max 3 original PDFs, max 6 pages each, max 1 MiB input each; max 400 KB output per PDF and 1 MiB total release derivatives; render at <=640x820px and limit concurrent rasterization to two processes. *Mock-tested only. Runtime sandbox/cross-platform decode and adversarial PDF fuzzing remain mandatory before production.*
- **Shared verified source reader**: File-text and image derivatives now reuse a common safe, bounded file opener with frozen manifest revision/checksum validation, realpath confinement, symlink rejection and fstat-before-and-after checks.
- **Author workflow**: New `Publish + PDF & images` option, explicit per-request consent to source-PDF conversion, watermark path shared with generated PDF text, candidate PDF counts in preview with a clear warning that candidate counts are not decoded eligibility.
- **Native Package staged-content audit**: New `cluster-package-stager --action audit` independently checks signed ZIP, key fingerprint, stored activation pointer, and every staged file for active or recorded previous content. Returns `verified_selected_content_not_installed` with `osAttested=false`. No local install or network-entitlement claims.
- **Admin navigation bug**: Consolidated Systems and Reports specialist routes now render the correct parent panel, opening Maintenance/Persistence/Imports/Data Model/Templates/Changelog details when selected rather than leaving an empty page.

## Validation and limits

- Source-level PDF tests mock PDF.js, canvas, image encoding and PDF writing. Windows execution requires Node 24, pdfjs-dist, pdf-lib, sharp and the new @napi-rs/canvas dependency with working native binaries.
- `go test ./...` verifies native package audit. Windows executable cross-compiled, not tested on Windows.
- Real PostgreSQL and Qt/Windows clients remain untested; no OS-level Package activation, install, health attestation, or current-server-rollout signed authorization gate exists. Package selection/pointers are not execution permission. Audio/video derivatives also remain deferred.
- No Prisma migration required: immutable PacketReleaseDerivative already stores generic PDF format and content.
