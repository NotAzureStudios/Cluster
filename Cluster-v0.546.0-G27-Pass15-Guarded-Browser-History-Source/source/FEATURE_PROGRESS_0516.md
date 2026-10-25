# Cluster 0.516.0 | Native content selection + Packet PDF publication watermark

**Implementation work; not runtime or OS certification.** Based on the full
v0.515.0 source, retaining the authoritative Pass 15 integration.

## Implemented

1. **Two-step native Package lifecycle.** The Go package stager still requires an independent Ed25519/SPKI trust pin, signed JSON manifest, matching ZIP hash and supported platform. A separate opt-in `activate` selects only an already staged tree, byte-for-byte rechecked against its signed ZIP. A package-specific atomic JSON pointer tracks active/previous selections and local generation. `rollback` requires the original signed artifact for the recorded previous selection, revalidates it, then swaps the pointer. `status` gives an explicitly local/unattested view. No executable install or process switch occurs.
2. **Hardening.** Reject extra staged files, swapped contents, injected or symlinked stage metadata, forged pointer files, concurrent pointer changes, malformed manifest fields, invalid package keys and unsafe rollback. Atomic pointer updates use fsynced temp files; a package lock fails closed on crash until manual recovery.
3. **Device receipt distinction.** Added `content_selected` between `staged` and device-claimed `activated` in the existing Package receipt policy. Content selection can also transition to `rolled_back`. No database schema change was necessary because stored state is a string. The admin UI explicitly differentiates local selection from OS installation.
4. **Detached Packet PDF label.** Authors may add an optional printable, bounded text watermark at publication. It is embedded into every new derived NOTE PDF below the standard derived-copy footer and hashed with the immutable artifact. The server rejects a watermark for metadata-only or text-only publication. Source PDFs/media and recipient-specific watermarks remain unsupported.

## Verification

- Existing inherited regression suites: 31/31.
- Native Go unit tests: 24/24 (12 inherited + 12 new).
- Node-produced signing and Go stage/select/status/rollback cross-language smoke: 4 pass cases, negative checks, no installation.
- PDF derivative tests with mocked renderer: 14/14; production pdf-lib rendering not verified.
- Receipt contract checks: 34/34.

## Not implemented / not claimed

Qt/Workstation agent integration, OS content activation, arbitrary program
installation, signed server policy proof for offline rollback, installer-owned
locks, health-checked rollback, independent hardware attestation, full
TypeScript compilation, live PostgreSQL migration/runtime, Windows or macOS
runtime, original PDF/media sanitization, recipient-personalized watermark.

Continue the roadmap on the v0.516 source without reintroducing deprecated
compatibility paths or calling source-level checks production certification.
