# TD6 G10 → G11 source handoff

**Current trusted source:** `Cluster-v0.546.0-TD6-G10-Watermarked-Packet-Transfers-Source.zip`. This full ZIP is the authoritative checkpoint. Apply its incremental patch only to the exact G09 baseline.

**Standing direction:** Finish grouped TD6 features before TD7 cleanup and full runtime certification. Keep scoped implementation checks, but never misrepresent mocked Sharp, browser, Windows/Qt or PostgreSQL coverage as production acceptance.

## G10 code changes

- `apps/server/src/domains/library/packet-file-image-derivative.ts`: opt-in, decoded image burn-in watermark, XML-safe label, bounded output and tiny-image fail-closed.
- `apps/server/src/domains/library/packet-routes.ts`: PDF/image watermark eligibility, visual artifact requirement, image publication wiring and immutable manifest/preflight/commit watermark identity.
- `apps/server/src/domains/library/packet-publication.ts`: freeze watermark identity in manifest; recipient-safe catalogue displays label.
- `apps/server/src/domains/library/packet-bundle.ts`: ZIP manifest includes watermark policy identity.
- `packages/renderer/src/features/packets/PacketsPage.tsx`: shared PDF/image authoring label, recipient policy display and per-artifact/ZIP Transfer Center handoff.
- `tools/scripts/cluster-td6-g10-packet-watermark-transfer-tests.mjs`: G10 integration contract and mocked encoder tests.
- `tools/scripts/cluster-0513-packet-pdf-assertions.mjs`: corrected expected publication contract.
- `TD6_G10_REGRESSION_RESULTS.json`, `IMPLEMENTATION_ROADMAP_TD6_G10.md`, this handoff.

## Preserve

- Never serve Library source bytes or direct Library access to Packet recipients.
- Server-side frozen audience and current permission checks, revocation, derivative SHA-256/size verification and durable authorized issuance receipts.
- Safe files, safe publication, bounded image/PDF/audio decoders and ZIP limits.
- Default behavior with no watermark remains unchanged.
- Browser download handoff is **not** a completed download attestation.
- Do not treat CD-08 / desktop managed-content state as native MSI/EXE installation.

## G11 priorities

Supervised native installer framework with explicit elevated approval, signed-executable validation, declared install actions, dependency readiness, cancellation and crash recovery, and cross-package rollback. Inspect existing Go/Qt native stager first. Inherited G05 signed-dependency and audit code must not be bypassed.

**Open:** full video/AV derivatives, recipient-personalized watermarks, transfer/sync orchestration, broader Library and CD-01–CD-20 requirements. TD6 remains active.
