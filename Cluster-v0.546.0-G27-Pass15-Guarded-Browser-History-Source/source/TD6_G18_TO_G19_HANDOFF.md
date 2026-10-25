# Cluster TD6 G18 → G19 continuation handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G18-Durable-Offer-Recovery-Source.zip`. Do not restart from G17 or apply unverified patches to guessed source. Version remains v0.546.0. G18 is **source-implemented**, not fully certified.

## Facts to preserve

- The G16 `managed-package-routes.ts` `/download/recover` endpoint already existed; G18 **connects** it to the native checkpoint. Recovery rotates a short-lived challenge and checks user+device ownership, active entitlement, correct Package/release/channel/platform and immutable SHA. No fallback to a new offer on recovery denial.
- Native helper `durable_transfer.go` now stores an optional immutable nonsecret `offer` identity; Go CLI accepts only bounded `transfer-bind` identity flags for that operation. The Qt broker adds `package.transfer.bindOffer` under the active profile and authenticated session. No challenge/bearer is written to disk.
- `package-segment-download.ts` supports recovered lease flows and cancellation. Only verified segments are written, and native hash/offset checks remain authoritative. `resumeBodySchema` now accepts start=0.
- `DesktopDevicePackagesPanel.tsx` binds new offers before accepting archive bytes, recovers previous offers, shows checkpoint status, and exposes a manual Pause action. No install privilege or automatic retry after MSI interruption.
- Tests: `tools/scripts/cluster-td6-g18-offer-recovery-tests.mjs`, `cluster-td6-g18-native-cli-smoke.mjs`, native `durable_transfer_test.go`; plus inherited G11, G15–G17 suites. `npm run cluster:td6:g18` is the focused command.

## Open gaps and priorities

1. Directly construct independently verified five-member staging kits **from already verified disk archives**, without sending entire ZIP bytes into renderer memory. Retain independent trust pin and explicit native confirmation. Never equate local transport archive with staged content.
2. G16 Package store supports bounded provider-backed artifacts, but publication/signing still uses bounded in-memory ZIPs (4 MiB normal / 32 MiB MSI). Large uploads require streaming hash/signature verification, immutable provider commit, and safe upload sessions.
3. Paused transfers are not automatically rescheduled; expired or denied offers need deliberate recovery, never a silent reset. Qt needs real compile/Windows acceptance; this checkpoint does not make runtime-certified claims.
4. Broader CD-01–CD-20 feature ledger remains open; avoid weeks of Package-specific instrumentation while Calendar, collaboration, Library, and admin flows remain unfinished.

**Standing directive:** grouped implementation first, TD7 cleanup second, full runtime certification after unfinished code is addressed.
