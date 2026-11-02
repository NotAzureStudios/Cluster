# RC73 media-viewer reconciliation against GitHub's RC50-lineage source

**Scope:** Selective, reviewed code port only. This does **not** import the
complete RC73 source snapshot, certify Windows installers, or relabel GitHub
source as `1.0.0-rc.73`.

## Source verification

- Archive: `Cluster-1.0.0-rc.73-Media-Viewer-Hardening-Final-Testing-Bundle(2).zip`
- Complete ZIP SHA-256:
  `92210b50c93cd5949856daef879a4b1f42443cb3ab5a3b6a49afbf8f5b37faa9`
- All **2,542** source manifest entries verified against file contents.
- All **2,561** outer manifest entries verified; `Verification.json`
  is a companion record outside that outer manifest.
- Embedded installer SHA-256 matched the verification record.
- Original RC73 focused source test: **10/10** passed in local verification.
- The original bundle explicitly records **full npm build: NOT_RUN**,
  **live browser viewer: NOT_RUN**, **actual Windows installation: NOT_RUN**,
  and **missing package-lock.json**.

## Verified source differences carried forward

- PDF viewer: measured page heights and cumulative virtual offsets,
  scroll-anchor stability, nonblocking text extraction and serialized canvas
  cancellation to avoid PDF.js double-render collisions.
- 3D viewer: per-account/per-model saved-view state and bounded streaming
  read before an oversized response is fully buffered.
- Two new pure helpers were sourced from the RC73 manifest:
  `pdf-page-layout.ts` and `bounded-viewer-blob.ts`.
- Matching CSS page geometry and focused CI regression tests.

Other GitHub changes newer than this archive remain authoritative,
including the 12-character member / privileged owner-admin password
policy, signed Server update staging, database restore safety, distribution
contracts, branch hygiene and transfer/request reliability. **Do not copy
the complete archive over the working tree.**

## Remaining blockers

- Full RC73/RC74 source diff and verified import of other changes, if any.
- Reproducible dependency lockfile and full npm/TypeScript build.
- Live authenticated browser PDF/3D tests, Windows installer acceptance,
  upgrade/rollback and multiuser session testing.
- Preserve current GitHub release identity `1.0.0-rc.50` until full source
  reconciliation and matching release artifacts have passed acceptance.

This targeted PR is **source-level hardening**, not release certification.
