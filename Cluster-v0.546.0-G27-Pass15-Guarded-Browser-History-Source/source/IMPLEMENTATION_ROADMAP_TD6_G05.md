# Cluster TD6 G05 | Packages + Desktop + Native deployment

**Baseline:** Cluster v0.546.0 TD6 G04. **Mode:** grouped source implementation; no full OS/PostgreSQL/Qt release certification claimed. The user's standing direction is feature code first, TD7 cleanup next, full certification after source completion.

## Implemented this grouped batch

| Surface | Implementation | Limit |
|---|---|---|
| Offline release authoring | Optional `deps.json` exact pins signed with the Ed25519 release manifest; bounded, distinct, no self/duplicate keys | No hook/command execution |
| Server signed releases | Schema and signature validation for dependency declarations, with publication-time existence/revocation checks under the release transaction | Cross-process revocation race acceptance still unverified |
| Entitled Desktop targets | Dependency graph built across **all** live recipient Package entitlements; verifies publisher trust, unrevoked releases and exact versions; cycles/missing/revoked dependencies fail closed | Package feed target graph, not OS-state attestation |
| Download/authorization | `packageId` narrowing occurs **after** full graph resolution, closing the common single-resource lookup bypass | Requires current live entitlements and registrations |
| Ordering | Device list topologically orders signed prerequisites ahead of dependent Packages | Ordering is guidance; no automatic installation |
| Go stager | Signed-JSON decoding of pins, native validation, selected-prerequisite check before consuming one-time grants | Local selected state, not OS installation proof |
| Destination updates | `sync-files`/`replace-files` and `copy-missing-files` refuse unmet prerequisites; rollback still requires safety checks | No process execution or system-wide installer |
| Desktop preview | Native/Qt exposes dependency readiness and blocker; renderer displays signed dependency requirements | Native Qt compiled runtime testing deferred |
| Admin | Release catalogue projects signed dependency identifiers with manifest-hash integrity check | Metadata preview only; device authorization remains server authoritative |

## Verified source evidence

- 9/9 new G05 Node integration checks, including actual offline JS signing and native Go signature verification.
- 58 Go test functions; Go suite passes and `go vet` clean. New native checks cover missing prerequisites, grant conservation, exact version, symlink state, and signed manifest shape.
- 40/40 inherited managed Package publication/policy tests; 45/45 device delivery checks; 22/22 reconciliation checks; 34/34 device receipt checks; 10/10 grant contracts; existing TypeScript→Go managed-deployment smoke test passed.
- 15/15 selected Forms, collaboration, Packet, People, Inventory, Project and Package F01–G04 regression suites passed.
- Source syntax/import/CSS checks passed separately, with explicit counts in G05 result evidence.
- Full dependency-backed Node24 typecheck, live PostgreSQL 18 transactions, Qt compilation, Windows native execution, and OS installer acceptance **not run**.

## Still unfinished and NOT to be silently closed

- Supervised OS software installer (MSI/EXE/PKG package policy, local user approval, process supervision, execution result and uninstall/reboot safety).
- Cross-package atomic install/rollback and independent OS-level dependency/elevation/service-health evidence; no existing local pointer is attestation.
- Resource-bounded admin dependency graph diagnostics across all entitlement/rollout scopes and dependency-safe retirement workflows.
- Full Desktop/Qt Windows certification and provisioned OS integration when runtime testing is resumed.
- Other TD6 items, including Library video/watermark, deeper collaboration, Project/QA follow-ups, advanced Inventory, G06 Admin/Calendar/Communications/OOBE, and G07 UX/feature-ledger closeout.

**Next grouped batch:** G06 Admin + Calendar + Communications + Config/OOBE. Preserve G05 source and continue unfinished feature ledger. Do not turn this release into an isolated bugfix pass or reopen runtime certification early.
