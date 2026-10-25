# Cluster v0.506 | Studio Settings Convergence

**Checkpoint:** source-validated development continuation. **Not** a runtime-certified Windows build.

## Implemented in this increment

1. Introduced `patchSettings` and `mutateSettingsKeys` in the existing settings service. They use the **same PostgreSQL advisory transaction lock `(506, 1)`** and Serializable isolation as reviewed `.clusterconfig` imports. Only selected database-backed keys are written, and configured encryption-at-rest is retained. Attempts to patch `_internal.*`, server-managed settings, or unselected keys are rejected.
2. Converted ordinary **Studio Settings**, **Tool Configuration**, **People profile-field definitions**, and **Setup Checklist toggles** to selected-field updates. Checklist changes derive from the current persisted list *inside* the lock, preserving independent concurrent edits.
3. The Studio Settings editor now records its initially loaded defaults and submits only changed fields, instead of resending the entire stale settings payload. Recovered unsaved drafts remain supported.
4. The Studio Settings **PUT** now explicitly requires an administrator and validates a required Security PIN server-side before writing; the previous check was conditional on a PIN being included.
5. Added `npm run cluster:0506:settings:assertions` to the complete source validation chain. The new gate includes actual service execution against a deterministic in-memory Prisma test double: independent edits survive concurrent updates and unsafe keys fail before write.

## Scope and safety boundaries

- This resolves common **unrelated-key lost updates** between the converted Studio/Tool/People/Setup writers and reviewed configuration imports. **Same-key edits can still last-write-win**; a per-field expected-revision/CAS contract remains future work.
- **Full Server Configuration**, **Discord integration/credentials**, **context-pack application**, **security-policy updates**, **first-run bootstrap**, and **secret rewrap** continue using the existing `saveSettings` full-object path because these may touch server-managed configuration, encrypted secrets, or boot files. Their cross-surface atomicity must be designed and runtime-tested separately. Do not substitute the database-only patch API for them.
- Database Serializable transactions and advisory locks were exercised through test doubles, **not** a live PostgreSQL server. Prisma migration #91 remains untested in a fresh real database here.
- The staging source lineage remains **P13 reconstructed + P16C cumulative overlay + v0.506 continuations**. The **newer P15 master source could not be materialized** in this runtime. Changes must be conflict-reviewed and merged into P15, preserving its P14/P15 Library/Projects/Admin/Project Type work. Do not deploy this staged tree over P15.
- Official Node 24 dependencies, Windows launcher/process cleanup, Qt Desktop version parity, MFA on actual authenticators, Windows DPI, and fresh PostgreSQL setup still require certification.

## Testing and release contract

- Keep the package simply `Cluster-v0.506.zip`, with npm SemVer `0.506.0` where required.
- Incremental `Cluster-v0.506-Settings.patch` targets the **immediately previous 0.506 revisions checkpoint** in this conversation, not P15. The ZIP also retains a full staging source copy for inspection and future conflict-resolved integration.
- Source-level validation: inherited `verify:source-foundation`, new 9-assertion convergence gate, TypeScript syntax and renderer import sweep, CSS delimiter sweep, SHA-256 source manifest, ZIP structural integrity. No Windows binary certification claimed.

## Next integrated work

1. Recover/mount trusted Pass 15 source and transplant reviewed changes in order; verify no old navigation or project type authorities regress.
2. Implement expected-revision compare-and-swap for simultaneous edits to *the same* Studio setting, then unify the cross-file/DB Server Configuration writers in a safe publication protocol.
3. Fresh PostgreSQL/Prisma and two-admin integration tests, passkey enrollment, recovery and setup tests. Test changing Library/Tool/Studio settings while importing a `.clusterconfig`.
4. Only then graduate the authoritative integrated candidate and tackle 0.507 Company/Resource Graph and permission/shared-engine work.
