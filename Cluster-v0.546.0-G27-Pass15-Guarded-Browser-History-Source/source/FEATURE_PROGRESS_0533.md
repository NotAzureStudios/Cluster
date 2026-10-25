# v0.533 feature completion ledger

| Workflow | Implementation | Source checks | Runtime certification |
|---|---|---|---|
| Bulk rename with full review and conflict handling | Added server + renderer + pure planning utility | Focused pass | Deferred |
| Selected Library metadata CSV export | Added renderer | Structural and syntax pass | Browser test deferred |
| Library file version comparison | Added renderer metadata/known-hash view | Structural and syntax pass | Browser test deferred |
| Library inspector expected-revision save | Wired actual body contract | Structural and syntax pass | PostgreSQL concurrency deferred |
| Version restore optimistic CAS | Server requires expected revision + confirmation + transactional conditional write | Structural and syntax pass | PostgreSQL concurrency deferred |
| Desktop signed file update (v0.532) | Preserved unchanged | Inherited suites passing | Qt/Windows deferred |

Next user-visible completion targets: complete Desktop opt-in update scheduling without unsafe unattended writes; finish shared Work editing/Undo/Redo and remaining Library asset workflows; keep expanding only grounded features already in the roadmap.
