# G26 Batch D → Continued Grouped Development Handoff

**Authoritative new source:** `Cluster-v0.546.0-TD6-G26-BatchD-Native-Package-Custody-Safety-Source.zip`.
**Source checkpoint only:** Batch D consists of native managed-file destination lock/foreign ownership/rollback preflight, desktop preview integration and bounded Inventory/Vault assigned-key custody review. The full G26 roadmap is **not closed**.

Preserve G25 closeout; G26 WS1–9, Batch A Packet compliance and large-audience workflows, Batch B Package+Inventory seat binding/readiness, Batch C Library subtree additive governance and provider inspection, and TD5 source closeout.

New important files:
- `tools/native/package-stager-go/file_update_preview.go`, `file_update_sync.go`, `file_update_destination_guard_test.go`
- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`, `packages/renderer/src/core/desktop.ts`, `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx`
- `apps/server/src/domains/inventory/inventory-key-readiness.ts`, `studio-inventory-vault-routes.ts`
- `packages/renderer/src/features/inventory/InventoryKeyCustodyReview.tsx`, `features/settings/StudioInventoryVaultPanel.tsx`
- `tools/scripts/cluster-td6-g26-batch-d-custody-tests.mjs`

Reproduce: `npm run cluster:td6:g26:batch-d`, `npm run techdebt:td5:source-closeout`, `go -C tools/native/package-stager-go test ./...`, `go -C tools/native/package-stager-go test -race ./...`, `go -C tools/native/package-stager-go vet ./...`. Some inherited Inventory mocks required adding the newly imported read-only route registrar stub.

Safety constraints: other-Package exact-destination ownership is never silently adopted; no automatic orphan-lock recovery; source/file copy and signed MSI process exit do not prove installation; no hidden key/Vault reveal from the new review API; no automatic destructive reconciliation. Cross-root folder overlap remains open.

Next larger group: cross-root native Package ownership proof and Windows installer recovery certification; Vault/Inventory expiring credential and offboarding fulfillment; finalize G26 outstanding CD ledger, then hand off to G27. Real Node24/PostgreSQL18/Prisma/Windows/Qt/browser/provider tests remain mandatory and NOT certified.
