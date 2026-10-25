# Cluster TD6 G16 → G17 handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G16-Package-Blob-Durable-Transfer-Source.zip`, supersedes G15.

Read `IMPLEMENTATION_ROADMAP_TD6_G16.md` and `TD6_G07_CD01_CD20_FEATURE_LEDGER.md`. Maintain **code-first grouped development**, no full runtime certification until the unfinished implementation is done.

## Actual implementation completed at source level

- `apps/server/src/domains/inventory/managed-package-artifact-store.ts` provides verified, signed content-addressed Package storage over existing Cluster storage providers; publication uses it when `storageRuntime` is present. Legacy DB-byte releases are preserved.
- `managed-package-routes.ts`, `cluster-server.ts`, Prisma schema and the G16 migration connect CAS release publication, ranged/full device download and admin export. All paths keep device/recipient authorization. Database CHECK enforces one artifact authority.
- Device `POST .../download/recover` rotates an existing challenge after fresh identity and entitlement checks with age/attempt caps. Not a second offer. No renderer-side secret persistence.
- `tools/native/package-stager-go/durable_transfer.go` and `main.go` implement a **standalone** private-disk chunk checkpoint/verified commit CLI. Not yet wired to Qt native transfer or authenticated downloader. Tested through Go cases and Windows cross-compile, not Windows runtime.
- G16 regression tests, inherited Package/Go suites and integrity manifest exist; review the G16 integrity report and known limits.

## Avoid false completion and unsafe follow-ups

- Do not claim multi-GB Package support yet: signer upload still bounded 4/32 MiB and native ZIP verifier reads bytes. Provider-backed storage is now real, but complete HTTP streaming and large-archive signing/verification are still required.
- Do not treat a completed disk transfer as installed software. MSI ProductCode evidence is registration, not application-health attestation. Do not enable automatic executable installation, automatic retry after interrupted MSI, or cross-package deletion.
- No physical blob garbage collection or Library disposal until provider ownership/lifecycle and crash recovery are certified.
- Qt WebChannel transfer remains in-memory kit flow; next work should **connect** authenticated chunk reception, durable checkpoint inspection and renewed leases across Desktop restarts. Keep user/profile root isolation and challenge secrecy.
- Preserve all CD-01–CD-20 features and independently approved people/Package access models; not all rows are closed.
