# Cluster v0.506 · Foundation work

## Implemented in the current source candidate

- Public versions and artifact names simplified: `0.506`, then `0.507`, `0.508` after separate verified packages. Node/npm remain `0.506.0` because semantic versioning requires three components.
- Removed the former additional owner recovery **password** route, database model, server config control, and setup form. Historical migrations remain intact; migration #90 drops the obsolete table on deployment.
- First-run owner session is restricted to authenticator enrollment. Owner accounts require phishing-resistant passkey/security-key authentication by policy, regardless of the Studio's normal MFA optional setting.
- Existing passkey registration now issues one-time hashed recovery codes when none exist. The first enrollment screen offers passkey/security key and shows codes to save.
- Existing local-host temporary-password administrator recovery remains available. Do not confuse it with a permanent shared master credential.
- Retained the P16A–P16C capability exposure work (Library lifecycle, access explanation, workforce availability, Project workflow graph, metadata preview and admin audit), as staged source.

## Continued first-run and administration work (source implemented)

- Guided, Quick, Import Configuration, and Skip Optional Settings are now distinct setup paths.
- Guided applies studio name/timezone after server validation. Quick and Skip keep the secure owner bootstrap while leaving optional studio setup for later.
- `.clusterconfig` schema 1 accepts **only** studio name, timezone, and starter Board/Whiteboard/Library defaults. Unknown keys, secret fields, server paths, security changes, malformed types and unsupported schema versions are rejected. Configuration export uses the same server allowlist.
- Administration → Command Center now projects an **authenticated, server-derived setup checklist** for owner passkey, issued recovery codes, studio identity, backups, second administrator and first Project. Only nonsecurity items can be deferred and later restored.
- New behavioral/structural regression gate: `npm run cluster:0506:setup:assertions` (10 assertions), included in `verify:source-foundation`.
- The checklist can prove only that hashed recovery codes **exist**, not that a human has physically stored them. UI text explicitly tells the owner to save the codes offline.

## Not complete / no certification claim

- **The authoritative P15 ZIP is not mounted.** This delta has been tested on P13+P16C staging and still requires a conflict-reviewed transplant into P15 preserving the P14/P15 UI changes.
- Full Node 24 dependency build, Prisma client generation/migration deploy, fresh PostgreSQL bootstrap, Windows server/Qt rebuild, passkey on actual browsers/devices, and DPI/process-tree tests are outstanding.
- The first-run four-mode UI, small safe .clusterconfig import/export and admin setup checklist are source-implemented. Full configuration domain coverage, configuration revisions/diffs, backup recovery and cross-tool authority unification remain roadmap items. Do not mark runtime certification done.

## Next work

1. Merge verified v0.506 source changes into the latest trusted P15/P16C lineage, resolving conflicts rather than overwriting P14/P15 files.
2. Run a fresh PostgreSQL bootstrap, Prisma generation, owner WebAuthn enrollment and one-time code verification, login/recovery and shutdown tests.
3. Expand .clusterconfig to more non-secret domains through an explicit review/impact engine, then configuration snapshots. Finish the full setup checklist and backup recovery runtime tests.
4. Begin subsequent roadmap foundation work as `0.507` **only after** a complete packaged 0.506 checkpoint is proven.

## Configuration review continuation (source implemented, not runtime certified)

- Added authenticated administrator `.clusterconfig` preview and explicit apply with field-level diff for the five existing safe studio settings.
- Preview ID incorporates the server-read previous values and the requested values; apply refreshes settings and rejects a stale preview instead of blindly overwriting reviewed state.
- No-change imports avoid writes; successful imports emit security audit evidence of changed field names/count.
- UI clears a rejected preview; new validation gate `cluster:0506:configuration:assertions` adds 12 targeted checks.
- **Still pending:** atomic/distributed configuration publication, full cross-domain configuration snapshots/revisions, real concurrent-admin runtime testing, and merge into the P15 authoritative source.

## Configuration publication + import revision continuation (source implemented)

- Added immutable, admin-only history for the five allowlisted `.clusterconfig` fields. History shows the specific settings changed by an import and who applied it. No secrets or arbitrary server configuration are stored.
- Import publication uses a PostgreSQL Serializable transaction and import-specific advisory lock, rechecks requested field values before mutation, writes only changed keys, and inserts the revision record in the same commit. A conflicting import must be re-previewed (409).
- History offers **Review values**, which creates a fresh preview in the existing import flow, never an automatic rollback. Empty imports do not generate fake revisions.
- Migration #91 adds `StudioConfigurationRevision`. Runtime migration/deployment not yet certified.
- Remaining concurrency work: other Studio/Tool Configuration `saveSettings` writers still use broader read/modify/write updates; they must converge on the shared transactional authority before cross-surface concurrency guarantees are possible.
- A PostgreSQL two-administrator integration test, official Node 24 build, and P15 authoritative merge remain required before a release claim.

## Studio Settings concurrency convergence (new development increment)

- Added selected-key, Serializable, advisory-lock-backed settings mutation to the canonical service.
- Converted Studio Settings, Tool Configuration, People profile definitions, and optional Setup Checklist toggles to the new mutation path.
- Studio Settings UI sends only changed keys; its PUT endpoint now has explicit admin + mandatory PIN checks.
- Deterministic concurrent-update and unsafe-key tests were added to `verify:source-foundation`.
- **Still open:** concurrent same-field conflict/revision checking; Server Configuration/Discord/context-packs/security-policy cross-file publication; P15 authoritative merge; fresh PostgreSQL and Windows/authenticator runtime certification.
- See `VERSION_0506_SETTINGS_CONVERGENCE_HANDOFF.md` for exact lineage and safety boundaries.

## GPU metrics and hardware acceleration foundation (current 0.506 increment)

- Server Operations performance and health detail expose **admin-only GPU hardware/sensor telemetry**: vendor/name, driver, per-GPU utilization, VRAM usage/total, memory controller utilization when reported, temperature and power. Missing sensors are `null`, never fabricated idle percentages. Public health remains hardware-inventory-free.
- Host telemetry is non-shell command execution through a bounded, short-timeout `nvidia-smi` probe with a 20-second normal cache / 60-second unavailable cache, coalesced with the existing governor sampler. Windows CIM and Linux DRM enumerate AMD/Intel (or other) GPU identity when detailed counters are not accessible.
- Native Windows control panel includes asynchronous cached NVIDIA GPU summary in Performance mode; it does not block the Win32 UI thread. Other vendors fall back to unavailable summary there until a suitable metrics provider is certified.
- Media worker uses existing FFmpeg hardware encoders, now including AMD AMF in addition to NVIDIA NVENC, Intel QSV and Apple VideoToolbox. Proxy/review encoding defaults to one simultaneous hardware encode per media worker and falls back to software if the selected GPU is under heavy observed pressure or the encoder fails. CPU-only jobs remain concurrent.
- Not GPU accelerated: PostgreSQL, application route handling, security operations, general JavaScript workloads, and media jobs without a certified accelerated implementation. Later compute workloads must expose explicit device capability + CPU fallback and be benchmarked before GPU promotion.
- New gate: `npm run cluster:0506:gpu:assertions`. Real Windows/NVIDIA and AMD/Intel runtime validation, FFmpeg encode correctness, VRAM pressure and multiple GPU devices remain required before calling this certified.

## GPU frame acceleration continuation (v0.506 source checkpoint)

- Hardware video thumbnails now have a CUDA/`scale_cuda` attempt gated by actual NVIDIA device detection,
  FFmpeg filter capability, workload size, adaptive VRAM/utilization/temperature budget and a shared
  process-local media GPU semaphore. Software retry is mandatory on failure.
- Video proxy/review hardware-encoding concurrency remains adaptive (the old fixed-one-job note above
  is historical). `CLUSTER_MEDIA_GPU_MAX_CONCURRENT` is an optional cap, not a fixed default.
- New unit/admission/cancellation tests and a real-FFmpeg thumbnail fallback smoke are maintained.
- Still open: GPU still-image thumbnails only if benchmarks justify it, AMD/Intel video thumbnail paths,
  cross-process quotas, explicit multi-GPU binding, measured GPU-vs-CPU throughput, and Windows certification.
- Source remains based on the older reconstructed staging tree until the Pass 15 merge is done.

## Shared GPU processing governor continuation (development source)

- GPU encode/video-thumbnail admission is now coordinated by PostgreSQL-backed per-host/per-device expiring leases, rather than relying exclusively on per-process semaphores.
- Runtime GPU occupancy is available to authorized admins through the existing Server Performance refresh (no extra poll loop).
- Fixed a false multi-GPU capacity assignment: until FFmpeg accepts an explicit adapter binding, only the default device is budgeted.
- Migration #92, `cluster:0506:gpu:leases:assertions` and `VERSION_0506_GPU_SHARED_LEASES_HANDOFF.md` document the change and tests.
- **Not complete:** live PostgreSQL two-worker race/failure test, driver-backed GPU runtime, still-image GPU offload benchmarking, explicit multi-GPU routing, Pass 15 merge, and Windows certification.

## Studio Settings concurrency closeout (source-implemented)

- [x] Changed-field partial writes avoid unrelated-key loss.
- [x] Reviewed `.clusterconfig` imports use the canonical PostgreSQL lock.
- [x] Studio Settings now requires per-edited-field existence/value preconditions and rejects same-field races with HTTP 409, without losing unsaved drafts.
- [x] Conflict review reloads authoritative server settings and retains *only* user-changed fields.
- [ ] Extend per-field preconditions to the remaining relevant Tool Configuration and People configuration editors.
- [ ] Design and test safe PostgreSQL + on-disk Server Config publication/recovery.
- [ ] Conflict-reviewed merge into Pass 15, then real PostgreSQL/Windows certification.

Read `VERSION_0506_CONFLICTS_HANDOFF.md` for boundaries. GPU/media work remains on its own bounded line; **0.507 Company/Resource Graph and shared systems remain the next major program**, not another GPU release.

## Server Configuration edited-field safety (source continuation)

- [x] Server Config UI sends only changed keys, with original-value preconditions and a mandatory Security PIN.
- [x] API rejects unknown keys, missing PIN/preconditions and stale same-field edits (409). Conflicted drafts can be refreshed and reviewed.
- [x] On-disk writes stage under unique exclusive temporary paths, sync before rename, and clean up failed stages.
- [x] Added 13 targeted source assertions in `verify:source-foundation`.
- [x] Shared PostgreSQL advisory-lock ordering for `saveSettings` callers plus commit-time Server Config field conflict checks; 7 deterministic publication regression checks.
- [ ] Convert remaining whole-snapshot callers (Security Policy, integrations, setup, context packs, rewrap) to intentional changed-field publication with concurrency validation; the locks alone do not fix stale caller payloads.
- [ ] Durable database + config-file commit/recovery journal and Windows/PostgreSQL crash tests.
- [ ] Merge into authoritative Pass 15 source; certify migration, setup, Windows native and device/security paths.

See `VERSION_0506_SERVER_CONFIGURATION_HANDOFF.md` for precise scope and safety boundaries.

## Server configuration crash-recovery journal | current 0.506 slice

- [x] Durable before/after publication journal, SHA-256 integrity and owner-only staging.
- [x] Database commit marker in the same `saveSettings` transaction as AppSetting writes.
- [x] Recovery under shared advisory locks after interrupted/aborted publication.
- [x] Startup reconciliation before accepting traffic, fail-closed if boot config changed.
- [x] Real-filesystem recovery tests; existing publication/service source assertions remain green.
- [ ] Runtime certification on actual PostgreSQL, Windows NTFS and process-kill fault injection.
- [ ] Remove outstanding whole-object/direct-file writers; unify secret rotation/offline tools safely.
- [ ] Merge with authoritative Pass 15 and certify bootstrap/permissions/server lifecycle.

This does **not** change the upcoming 0.507–1.0 roadmap or justify another GPU-only diversion. See `VERSION_0506_CONFIG_CRASH_RECOVERY_HANDOFF.md`.

## Configuration writer + sensitive route convergence | v0.506 continuation

- [x] All Context Pack routes explicitly enforce administrative authorization before data disclosure or mutation; exported payload responses are not cacheable.
- [x] Context Pack apply selects allowlisted changes only and uses server-config CAS / journal publication, including explicit stale conflict handling.
- [x] Security Policy updates use named-field publication, not a broad stale snapshot; MFA bootstrap and session revocation gates retained.
- [x] Discord configuration writes only named fields; tokens/webhooks are preserved unless explicitly set/cleared, with concurrency conflicts detected.
- [x] Regular settings reads no longer perform implicit secret rewrap writes. Explicit administrative secret rewrap uses fresh, locked and journaled publication before separate secret maintenance.
- [x] Targeted `cluster:0506:config:writers` gate and compiled Context Pack route behavior fixtures added to the full source suite.
- [ ] Test against live PostgreSQL, Windows managed-host crash/restart, real MFA and backup-recovery flows. Confirm sensitive Context Pack export step-up protections.
- [ ] Merge cleanly with Pass 15 before release certification and verify separate Discord Connection metadata reconciliation.

See `VERSION_0506_CONFIG_WRITERS_HANDOFF.md`. The full 0.507–1.0 roadmap remains unchanged.

## Context Pack secret-exposure and reauthentication closeout (current 0.506 increment)

- [x] Separate safe redacted Context Pack exports and responses from explicitly sensitive exports.
- [x] Add per-purpose, single-use passkey/security-key step-up for revealing server-stored Context Pack secrets, creating protected secret snapshots and applying protected settings.
- [x] Require an audit reason for sensitive operations and record metadata without credential values.
- [x] Reject unsupported/unknown Context Pack import settings instead of storing opaque transport data.
- [x] Extend shared reauthentication UI with a required reason and prevent credential downgrade for passkey-only operations.
- [x] Add targeted route, security-policy and safe-projection regression coverage.
- [ ] Certify WebAuthn single-use consumption and audit evidence against a live server/device.
- [ ] Merge all 0.506 deltas onto Pass 15 source and certify Windows/PostgreSQL crash recovery.

This is an incremental security closeout, **not** a new roadmap phase. The complete `CLUSTER_ROADMAP_CONTINUITY.md` remains the scope authority for 0.507–1.0.

## Cross-engine security, resource graph and search privacy (current 0.506 continuation)

- [x] Exclude single-use sensitive Context Pack operations from generic idempotency replay/persistent receipts.
- [x] Refuse to store `no-store` HTTP response bodies in idempotency receipts as defense in depth.
- [x] Graph subject/scope authorization and ACL-safe bounded pagination, without duplicate graph storage.
- [x] Project search consumes the canonical Calendar visibility policy before privileged shortcuts.
- [x] 9 executable behavior regression cases; full inherited source suite remains green.
- [ ] Live PostgreSQL/WebAuthn multi-user verification and real graph/search load measurements.
- [ ] Review/transplant reconstructed source against authoritative P15 before treating it as release source.

This completes a **cross-cutting 0.506 development slice**, not runtime certification or the whole 0.507 Company Graph program. See `VERSION_0506_CROSS_ENGINE_HANDOFF.md`.

## Search, Access Rules & Resource Graph security convergence (source implemented)

Global Search now authorizes matching results on every request and no longer caches permission decisions; ranking may be reused. Project access-rule refreshes preserve rules from unrelated scopes, and ACL database errors fail closed. Permission-change events refresh the full rule set and replay concurrent edits. Graph subject project scope and truncation are guarded. 13 new tests pass. **Live authorization revocation, multi-user/cache invalidation, Pass 15 integration and Windows/PostgreSQL runtime remain open.** See `VERSION_0506_SEARCH_GRAPH_PRIVACY_HANDOFF.md`.

### Access and Search consistency (source implemented)

Central Access Rule DB errors no longer turn into empty-rule implicit grants, Search rebuilds detect in-flight invalidations before publishing, and ACL event names normalize consistently. **13/13 focused tests passed**. This is an integrated source staging slice only: merge with Pass 15 and certify real PostgreSQL, change-stream delivery, and Windows runtime before marking as certified. See `VERSION_0506_ACCESS_STABILITY_HANDOFF.md`.

## Resource identity and Graph evidence continuation

Canonical global identity, explicit child-to-parent notification references and stale-endpoint filtering are implemented and source-tested. Graph scan and SQL frontier budgets are now bounded. This does not certify large-database performance, merge the authoritative Pass 15 source, or complete 0.507. See `VERSION_0506_RESOURCE_IDENTITY_HANDOFF.md`.
