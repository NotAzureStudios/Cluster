# Cluster v0.546.0 — TD6 G17: Native Package Transfer Integration

**Baseline:** G16 complete source. **Current:** G17 source implementation (not fully compiled or production certified). **Standing decision:** finish CD-01–CD-20 implementation first, then TD7 cleanup, then runtime certification. Continue grouping connected features rather than creating isolated passes.

## Implemented in this grouped pass

1. **Native Qt/Desktop checkpoint broker.** Four explicit `package.transfer.{begin,inspect,append,commit}` capabilities pass only bounded SHA-256/size/offset/chunk fields to the existing Go CLI. The Qt broker chooses an isolated app-owned per-server-profile directory, never a renderer-chosen path. Requires active authenticated native session, an active profile/epoch and the permitted renderer origin. All returned evidence is a schema-checked checkpoint, with no local absolute path or authorization bearer.
2. **Bounded WebChannel binary handoff.** Qt accepts canonical base64 chunks of up to 384 KiB with a dedicated request envelope ceiling and forwards them as Go stdin to the existing durable transfer helper. The helper alone verifies prefix checksums, disk lengths and final whole-archive SHA-256. No native grant or installer privilege is conferred. Current UI is bounded by existing signed release limits (32 MiB MSI, 4 MiB ordinary) even though the Go spool has a larger internal staging budget.
3. **New stream-to-sink HTTP downloader.** `downloadPackageSegmentsToSink` shares the existing 4 MiB signed Package range/lease/authorization checks. It emits bounded ordered segments to an async sink rather than accumulating one complete renderer ZIP. Existing in-memory `downloadPackageSegments` is retained for staging-kit compatibility and delegates to the common protocol logic.
4. **Restart-safe *local* checkpoint recovery.** Desktop inspects a native checkpoint by digest, validates expected size/state, and continues from a previously persisted byte offset. The next server session issues a fresh authenticated download offer and skips already-written content where allowed. Corrupt/tampered local evidence fails closed; only an explicitly absent checkpoint may be initialized. The native helper promotes the archive only after the complete hash matches.
5. **User-facing entry point.** The Desktop managed-Package panel gains **Retain verified archive in Desktop** with transfer progress, kept separate from native kit staging, installation and managed destination updates. No Package lease/challenge is written to native checkpoint or renderer persistence.
6. **Evidence.** New G17 tests exercise normal segmented writes, resume offsets, revocation, transport retry, invalid ranges, bounded Qt capability wiring and a compiled Go helper across separate independent processes. Existing G15/G16 and managed Package regressions retained.

## Open gaps (must not call complete)

- **Server-offer recovery after restart:** G17 obtains a new authorized offer rather than persisting the old bearer or invoking the existing `download/recover` endpoint. That can create a second delivery offer; new session continuations must remain authorized. Later unify native checkpoint with the *nonsecret* deployment ID and recoverable offer flow, with ownership fencing and honest issuance evidence.
- **Direct disk-backed staging kit creation:** Archived ZIP is **not** itself a signed kit and cannot be activated. Current kit builder still requires bounded bytes in renderer memory; native independent signed ZIP/manifest verifier remains the only activation authority. Extend native signed-kit assembly before using large archives for installation.
- **Streaming upload/signing:** Package publication still uses bounded base64/signed ZIP validation; ordinary 4 MiB and MSI 32 MiB limits remain. Avoid raising size ceilings without true stream verification, durable upload sessions and signed index validation.
- **Qt acceptance:** Qt source changes have not been compiled against the project's Qt toolchain or tested under Windows. G17's native Go helper has been built and tested separately; that is not Qt/WebChannel runtime certification.
- **Other CD gaps:** Calendar exception editing/delegation, Library/Packet expanded derivatives, broader transfers and native MSIs repair/uninstall, combined Package rollback, Help/UX, legal hold/retention and 1.0 ledger closeout remain open.

## Next grouped work

**G18:** unify authorized offer recovery with native checkpoints; construct signed staging kits directly from verified native archives, and strengthen transfer job status/pause/retry UI. Then move back across remaining CD categories instead of indefinite Package-only passes.
