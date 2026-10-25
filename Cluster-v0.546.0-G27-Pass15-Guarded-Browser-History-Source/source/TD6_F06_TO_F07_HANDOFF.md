# Cluster v0.546.0 — TD6 F06 → F07 handoff

1. **Use F06 archive as canonical source**, not F05, F04 or TD5 P13. F06 parent is F05.
2. The **implementation-first directive** remains controlling: keep completing unfinished TD6 features, preserve focused regressions, and defer full runtime/platform certification until after source completion. Do not label unrun certification checks as passed.
3. F01–F05 Forms branching/deadlines, persisted collaborative Card/Whiteboard history, protected Packet WAV preview delivery remain intact.
4. F06 builds on pre-existing native signed Package staging/managed copy and reversible folder sync. It adds a read-only **tracked-change plan**, separates safe tracked upgrades from local modifications/untracked collisions, surfaces conflicts in Desktop, blocks normal sync before creating backup journals and rejects symlinked local state/journals. Native Go tests and source integrations cover these branches.
5. Run `go -C tools/native/package-stager-go test ./...`, `npm run techdebt:td6:package-plan`, `npm run techdebt:td6:source-scan`, historical Desktop native source-contract tests, and F01–F05 development regressions.
6. **Never imply source staging is an OS-level installer.** CD-08 still needs supervised installer process, OS rollback, actual installed-state evidence, version/dependency policies and platform-specific operations. Do not bypass current signed target/grant checks, nor permit unsafe Library physical deletion/auto-GC.
7. Recommended F07 continues substantive CD-08 deployment/install/update/rollback integration if safe native source is available, otherwise CD-04 People lifecycle/entitlement closeout. CD-03 and CD-07 remain unfinished.
8. Archive/source manifests, patch replay, previous handoffs and the separate certification roadmap must be preserved.
