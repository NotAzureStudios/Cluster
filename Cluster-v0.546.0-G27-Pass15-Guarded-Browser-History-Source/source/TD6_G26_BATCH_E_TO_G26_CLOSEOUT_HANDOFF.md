# Cluster TD6 G26 Batch E → Next Group Handoff

**Authoritative full source:** `Cluster-v0.546.0-TD6-G26-BatchE-Root-Isolation-Expiry-Governance-Source.zip`.
**Parent:** `Cluster-v0.546.0-TD6-G26-BatchD-Native-Package-Custody-Safety-Source.zip`.

Batch E adds a filesystem-global managed destination ownership registry lock, bounded parent/child root scan, Desktop conflict evidence and seven-day Inventory/Vault/recipient expiry warnings. Source verified; **G26 OPEN** and no production certification. See `TD6_G26_BATCH_E_ROOT_ISOLATION_EXPIRY_CLOSEOUT.md` and `TD6_G26_IMPLEMENTATION_STATUS_LEDGER.md`.

Core code: `tools/native/package-stager-go/file_update_registry.go` and `_test.go`, `file_update_sync.go`, `file_update_preview.go`; Qt `NativeCapabilityBroker.cpp`; renderer Desktop status and Package settings; server `inventory-key-readiness.ts`, `studio-inventory-vault-routes.ts`; Inventory settings and review panel; `tools/scripts/cluster-td6-g26-batch-e-expiry-tests.mjs`.

Reproduce `npm run cluster:td6:g26:batch-e`, `npm run techdebt:td5:source-closeout` and Go test/race/vet in `tools/native/package-stager-go`.

**Next grouped source priority:** fill genuinely missing MSI OS-attested lifecycle/reboot-resume safety and native installer recovery, then independent Vault expiry reminders/offboarding fulfillment if canonical notification/approval plumbing can be reused. Keep all destructive Library/provider operations disabled unless proven safe. Do not treat a Windows cross-compile or successful MSI process exit as runtime certification. The prebuilt native binaries were not changed.
