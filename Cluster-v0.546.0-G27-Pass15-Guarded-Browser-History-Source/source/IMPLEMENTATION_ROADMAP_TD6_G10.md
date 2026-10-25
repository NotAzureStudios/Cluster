# Cluster TD6 G10 | Watermarked Packet media + transfer handoff

**Baseline:** Cluster v0.546.0 TD6 G09 full source. **State:** Scoped G10 implementation done; TD6 feature ledger remains open. **Delivery:** full source + G09→G10 patch, verified independently.

## Implemented in this grouped source checkpoint

1. **Image delivery watermarking:** Approved checked JPG/PNG/WebP source files can be published as freshly decoded, flattened, capped WebP derivatives with an opt-in visible watermark. A fresh raster stage precedes the watermark overlay; EXIF, embedded application/XMP metadata, source filenames and originals are never embedded in the delivery bytes. Watermark content is printable ASCII <=60 chars, XML-escaped, and rejected if not legible on the output dimensions. An image that can't safely be marked causes explicit publication failure. Inheritance: all earlier strict source checksum/revision, safe path, classification, 12-image, 65 KiB/output and 1 MiB/release safeguards are retained.
2. **PDF + image unified publication choice:** The author watermark input applies to selected PDF or image derivatives. Text-only, audio-only or metadata-only publications cannot claim to be marked. A selected watermark with zero eligible visual derivatives fails rather than producing misleading policy evidence.
3. **Immutable publishing provenance:** The selected public watermark label is included in the frozen source manifest's hash, so author preflight and transactional commit compare identical policy and source identities. The recipient-safe catalogue and bundled ZIP manifest disclose the watermark label. The server never projects source Library identities into the recipient catalogue.
4. **Packet Transfer Center wiring:** Individual detached artifacts and ZIP downloads use the existing browser-download handoff feed. Handoff is shown accurately as browser-managed with no claim of actual receipt, save completion or progress. This is separate from the server's durable Packet issuance receipts; the receipts still mean authorization and bytes prepared, not proof of delivery success.
5. **Regression maintenance:** Updated the inherited PDF-only watermark expectation to match the expanded PDF/image contract. Added a focused source/harness suite for overlay and output safety, publication provenance and Transfer Center integration.

## Intentionally NOT claimed complete

- Media video delivery, animated images, arbitrary AV transcoding or full-fidelity music delivery.
- Per-recipient overlays or personalized forensic watermarks. The G10 watermark label is shared at publication and fixed for all recipients.
- Guarantee that remote browser downloads finish, are saved, or are opened. No browser-managed progress is exposed.
- Broad Library transfer orchestration, archival safety or arbitrary NAS/S3 movement.
- Full image font/sharp behavior on Windows. Mocked source-level tests are not a substitute for live media validation.
- Other feature ledger requirements across CD-01–CD-20.

## Security and policy rules

- **Derived Delivery Only:** entitlement never grants Library source access. No original bytes or source path falls back to a recipient.
- Keep original files and older revisions immutable. A new publication creates a separately hashed derived asset.
- Changes to the watermark or any checked source require a NEW Packet release; don't mutate published assets.
- Watermark enforcement is *explicit opt-in* in G10; studio-wide mandatory watermark defaults and recipient-specific marks still require a governed Tool/Studio policy implementation.
- Reject unsupported formats, malformed/oversize watermarks and insufficiently sized marked images. Do not silently publish unmarked artifacts for a marked visual release.
- The publication manifest stores a recipient-visible label, not protected source metadata, credentials or identities.

## Development evidence

- `node tools/scripts/cluster-td6-g10-packet-watermark-transfer-tests.mjs` — 9/9 checks (Sharp mocked).
- 12 inherited Packet/Project/Package/Calendar/Setup suites also pass; result inventory in `TD6_G10_REGRESSION_RESULTS.json`.
- `node tools/scripts/cluster-td4-r73-source-scan.mjs` checks syntax, CSS and relative imports.
- Full Node 24 build, actual Sharp/Qt/Windows, authenticated PostgreSQL and browser integration remain **deferred** under the standing implementation-first directive.

## Next implementation-first priorities

1. **G11 supervised native installers and cross-package rollback** with strict OS execution policy, elevation boundaries, signed installers, recovery journals, dependency ordering and operational evidence. Do not equate managed file sync with software installation.
2. **CD feature backlog continuation:** video/media processing in a bounded isolated worker, recipient-specific watermark/audit policy, comprehensive transfer recovery, deeper Library explorer workflows, guided OOBE/Help and Calendar exception UX. Reconcile required-vs-later requirements before calling 1.0 code-complete.
3. **TD7**, then comprehensive runtime certification, only after remaining TD6 requirements are deliberately completed or deferred.
