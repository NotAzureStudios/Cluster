# TD6 G09 → G10 continuation handoff

**Baseline:** `Cluster-v0.546.0-TD6-G09-Setup-Configuration-Guidance-Source.zip`. Apply the G08→G09 patch only to the *exact* G08 source. The complete ZIP is authoritative.

**Implementation priority:** grouped unfinished code first. Runtime certification intentionally deferred until after TD6 and TD7. Never present focused source checks as full Node/PostgreSQL/Qt certification.

**G09 changed:**
- `apps/server/src/core/setup-guidance.ts` new grouped admin help and per-Owner recovery evaluation.
- `apps/server/src/core/setup-configuration.ts` optional studio timezone checklist entry.
- `apps/server/src/app/server-routes-setup.ts` server-side readiness projections, per-Owner checks and no-store admin-only security details.
- `packages/renderer/src/features/admin/AdminSetupChecklist.tsx` stage groups, progress, explanations, selective import and explicitly reviewed pre-import values.
- `packages/renderer/src/features/admin/admin-workspace.css` guidance styling.
- `packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx` stale import-read prevention and post-setup guidance.
- `tools/scripts/cluster-td6-g09-setup-guidance-tests.mjs` focused route and pure logic checks; 0506 setup assertion updated to the stronger per-Owner rule.

**Do not undo:** server configuration, security secrets, and tool/studio policy continue to be separate authorities. `.clusterconfig` v1 imports exactly five non-secret settings. Importing selected fields still requires a fresh server preview and applies with the existing transactional recheck; the earlier values flow is never automatic.

**G10 priority:** Library advanced file delivery, additional secure derivatives / watermark options, retention-safe transfer orchestration. Inspect G09 source before deciding scope; do not reimplement existing text/PDF/image/audio adapters or Packet receipt ledger. Other CD-01–CD-20 gaps and global OOBE/Help/Config requirements remain open.
