# Cluster TD6 G17 → G18 handoff

**Use the complete G17 ZIP source, not G16 plus a guessed patch.** Base v0.546.0, TD6 implementation first, no full runtime certification until feature development closeout.

### G17 factual source changes

- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`: narrowly allowlisted and schema-limited `package.transfer.{begin,inspect,append,commit}`; per-profile private destination; native helper subprocess; canonical bounded base64, bounded request sizes; digest/offset/schema verification; explicit `PACKAGE_TRANSFER_NOT_FOUND` vs corrupt checkpoint. No local path or bearer given to renderer.
- `packages/renderer/src/core/desktop.ts`: native checkpoint API functions, append chunk validation, checksum-and-state commit checks, bounded capabilities.
- `packages/renderer/src/features/settings/package-segment-download.ts`: shared sink stream path with exact authorized 4 MiB segment validation, retry-only-transport and arbitrary resumed offset. Old array-returning API remains via the same stream protocol.
- `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx`: a separate **Retain verified archive in Desktop** path streams authorized segments to native spool, honors existing verified local progress, and keeps staging/update/install paths separate.
- `tools/native/package-stager-go/main.go`: missing checkpoint receives distinct nonsecret exit code 3; corrupted/inconsistent checkpoint remains a hard failure, never auto-reset.
- `tools/scripts/cluster-td6-g17-native-stream-assertions.mjs` and `...native-cli-smoke.mjs`: executable source-level stream/client/CLI integration checks; updated package command.

### Essential limitations

1. Qt not built/Windows-runtime-tested. Don't call the WebChannel integration certified.
2. Native verified archive is transport output, *not* a staging kit or installed Package.
3. Only local checkpoint offsets survive restart. A fresh server download offer is issued; no authorization challenge is persisted. The existing server `download/recover` route still needs to be attached using a nonsecret deployment identity and renewed challenge.
4. Existing publication format, signed ZIP and native installer budget remain 4/32 MiB. No multi-GB support claim.
5. No automatic deletion, retry of interrupted installers, ownership GC or cross-Package rollback.

### G18 recommendation

Complete authenticated offer recovery and build signed staging kits from the verified disk archive. Extend Transfer Center status, manual resume/cancel and resource-aware permissions where relevant. After this, prioritize unfinished CD-01–CD-20 work instead of more isolated MSI instrumentation.
