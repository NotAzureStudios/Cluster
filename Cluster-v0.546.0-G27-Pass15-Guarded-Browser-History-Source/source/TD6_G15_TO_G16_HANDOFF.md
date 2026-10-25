# Cluster TD6 G15 → G16 handoff

**Current authoritative source:** Cluster-v0.546.0-TD6-G15-Segmented-Package-Transfer-Source.zip (supersedes G14).

- Latest code changes are in `apps/server/src/domains/inventory/managed-package-segments.ts`, `managed-package-routes.ts`, `packages/renderer/src/features/settings/package-segment-download.ts`, and `DesktopDevicePackagesPanel.tsx`. Read `IMPLEMENTATION_ROADMAP_TD6_G15.md` first.
- G15 completes **only** device-authenticated, session-bound 4 MiB chunk/retry support for the *currently capped* signed Package artifacts, plus accurate Transfer Center browser handoff. It is not true large-MSI streaming.
- Signer, server, Go native installer and Qt trust boundaries from G11–G14 must remain unchanged. One download offer/receipt chain; validate every continuation's device, nonce, entitlement and signed bytes. Keep 4 MiB/32 MiB caps until new immutable blob storage exists.
- Implement G16 as a grouped server blob authority + persistent transfer protocol + disk-backed native staging effort. Do not conflate source checks with live Windows/PostgreSQL/Qt certification. Keep TD6 feature completion before TD7 cleanup and runtime certification as the user's standing priority.
- Preserve all CD-01–CD-20 gaps. `TD6_G07_CD01_CD20_FEATURE_LEDGER.md` is the existing ledger; amend as new code genuinely lands.
