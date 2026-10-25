# Cluster G19 → G20 continuation handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G19-Retained-Archive-Native-Staging-Source.zip`.
**G19 scope:** committed native disk archive → signed Go verifier → quarantined stage; Qt/renderer integrated as source, not Windows tested.

### Changes to preserve
- `tools/native/package-stager-go/transfer_stage.go`: bounded sidecars, immutable digest checkpoint, independent SPKI pin, existing `stage` verifier. `main.go` adds `transfer-stage` with strict flags and limited stdin.
- `NativeCapabilityBroker.cpp`: `package.transfer.stage` allowlist and payload schema, local pin, confirmation, profile safety, async native helper and verified staging events. **No renderer-selected native paths/pins or installer grants**.
- `packages/renderer/src/core/desktop.ts` and `features/settings/DesktopDevicePackagesPanel.tsx`: `stageRetainedNativePackageArchive` and user action with current entitlement and native checkpoint checks.
- Tests: `cluster-td6-g19-retained-stage-tests.mjs`, `cluster-td6-g19-native-cli-smoke.mjs`, Go `TestStageCommittedTransferRequiresIndependentSignatureAndPin`. `npm run cluster:td6:g19` runs new evidence.

### Important limits
- Go native stage loads bounded archive bytes internally; renderer does not. Existing size caps remain.
- No automatic install, deployment, stage redo or bypass of separate grants. No Qt executable compiled here.
- Persistent disk offer recovery from G18 remains intact, and separate trust roots are non-negotiable.

### G20 grouped feature recommendation
Stop tunneling on Package internals. Return to remaining CD-01–CD-20 work by grouping **Calendar recurrence exceptions + delegated editing + attendee authorization**. Audit the existing Calendar object authority before adding another calendar store; then implement UI, API, history, and targeted tests together. Keep Library media, config/Help, collaboration, and durable large-file uploads in the explicit open ledger.

### Permanent priority
Implementation first, TD7 cleanup second, full Windows/PostgreSQL/Qt certification after unfinished feature code is addressed.
