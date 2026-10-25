# Cluster v0.546.0 | G26 Native Archive Linear-I/O Append Pass 5

**Exact source parent:** `Cluster-v0.546.0-G26-MSI-Suspended-Job-Supervision-Pass4-Source.zip`. The single final master roadmap and work register remain authoritative. No new Prisma migration, background worker, installer operation, or update permission was introduced.

## Defect corrected

Desktop sends signed Package archive transport bytes to the short-lived native Go helper in 384 KiB chunks. The previous `appendTransfer` first rehashed the entire checkpointed payload to validate the offset and then rehashed the entire enlarged payload after appending. With N chunks, this read O(N²) previously received bytes. For 32 MiB at 384 KiB per segment, that could amount to gigabytes of redundant file reads, in addition to a final full verification.

## New durable implementation

- `transferCheckpointSchema=2` persists Go SHA-256 binary marshaled streaming state, the declared byte count, SHA-256 of the final 64 KiB (or less), and the persisted payload modification timestamp, with the existing transport/offer metadata. A streaming state must decode, report *exactly* the published byte count, and produce the published prefix hash.
- `appendTransfer` acquires the same exclusive, ownership-checked file lock; rejects incomplete `.pending` checkpoint publication; refuses alternate archive files; checks checkpointed length, timestamp, opened-file identity, and the bounded saved tail; then writes the next bounded chunk with append semantics and syncs it to disk. It updates the SHA-256 streaming state with only the newly written bytes, computes a new bounded tail, and atomically publishes the next checkpoint. This changes steady-state on-disk read work to O(total bytes + 64 KiB × number of chunks), excluding explicit full-verification actions.
- **The persisted hash state is not evidence that all prior disk bytes still match.** An out-of-band modification outside the bounded tail can pass an append preflight, including if an attacker restores metadata. `inspectTransfer`, `bindTransferOffer`, `commitTransfer`, and Package stage continue to require independent full-file verification; final commit also requires that the full SHA-256 matches the requested artifact digest. Corrupted transport bytes are never promoted by an incremental hash value alone.
- Explicit `recoverTransfer` still verifies the entire retained published prefix *and* all retained bytes, refuses conflicting files and stranded locks, and reconstructs SHA-256 state from independently read bytes. If the native hash state cannot decode after a helper/compiler change, normal writes fail closed; only this verified, operator-confirmed recovery can replace the state for both receiving and committed archives.
- An incomplete checkpoint publication cannot be silently ignored during append. Read-only `transfer-diagnose` never writes or cleans residue. The existing Qt confirmation, authenticated renderer capability bridge, server reauthorization for each HTTP segment, and signature/public-key pin remain separate authority gates.

## Schema and compatibility

The local private transport checkpoint has a deliberate schema update **1 → 2**. Cluster has no active production installations to migrate. There is no compatibility alias or automatic migration; old unsupported checkpoints must not be silently trusted. The native helper and renderer TS type are updated together. Older helper binaries must not be mixed with newer Desktop code; the pinned native helper-integrity manifest and release pairing must be checked on the deployment machine.

## Regression evidence

- New executable Go tests cover dozens of sequential helpers/chunks across the 64 KiB boundary; each incremental SHA-256 against the independent expected prefix; tampered hash state/byte count/timestamp; manipulated tail with restored timestamp; changed older bytes that *only final full SHA-256 rejects*; interrupted-write recovery; pending checkpoint residue; and manual reconstruction of unsupported streaming state on both receiving and committed archives.
- `tools/scripts/cluster-g26-linear-native-transfer-tests.mjs`: 11/11 source/wiring invariants.
- Native Go suite, `go test -race`, `go vet`, and Windows x64 cross-compilation passed with available Go 1.23.2. Pinned release Go 1.27.1, real Windows 10 file-identity semantics, Qt 6.11.2, Node 24, signed MSI, and full dependency-backed build have **not** been certified.
- Prior native transfer recovery, diagnostic, signed-kit and custody regressions continue to be required; see final integrity report for exact executed commands.

## Remaining closeout

`G26-08` and `G26-09` stay partially complete. The native capability bridge still spawns one helper per 384 KiB segment, and broader Transfer Center persistence/revocation across browser/mobile/multi-window sessions is not complete. Real Windows 10 long-transfer/crash/fault-injection runs remain mandatory. `G26-10` and `G26-11` still need native MSI installed-state evidence, repair/uninstall, service/custom-action behavior, reboot recovery and safe rollback, all on a disposable Windows 10 installation. No new privileged behavior is enabled in this pass.
