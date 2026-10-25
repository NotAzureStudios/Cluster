# G26 Pass 15 | Truthful Qt transfer mutation acknowledgment

**Parent:** G26 Pass 14 post-admission queue journal write hold. **Source implementation only**, not a Qt 6.11.2 / Windows 10 build or live simulated-disk-full test.

## Failure mode

Even after Pass 14 stopped network work following a failed queue journal commit, Qt `TransferManager` returned `void` from its Pause, Resume, Retry, Cancel, Remove, and Retry All methods. `NativeCapabilityBroker` returned `{ updated: true }` for these actions even when the queue rejected the operation or `QSaveFile` failed, misleading Desktop users and masking work requiring manual review.

## Changes

- Each mutating queue method returns `bool`, reflecting a successfully committed per-transfer state transition, or an explicit failure for disallowed/missing states and disk errors.
- Pause and Cancel commit the intended state before aborting network traffic or deleting partial bytes. Cancel also refuses already complete/cancelled transfers.
- Remove confirms the journal transaction, restores the entry and invokes Pass 14's safety hold on failure, and delegates active cancellation with its actual result.
- Retry All filters intentionally non-retryable failures and stops on first failure. Earlier individual resumptions may already have committed: this is not misrepresented as an atomic batch.
- NativeCapabilityBroker preserves structured errors for failed writes or invalid state and only returns `updated: true` after the underlying operation confirms success. The renderer's existing native request rejection path continues to show errors.

## Verification and limitations

- `tools/scripts/cluster-g26-native-transfer-action-acknowledgments-tests.mjs`: 34/34 source integration assertions.
- `cluster-g26-transfer-journal-write-hold-tests.mjs`: 32/32 retained; prior source/cross-platform C++ download, queue retention, Qt bridge, and native custody checks pass.
- No new API endpoint, Prisma migration, elevated capability, or automatic journal repair. Source contracts plus portable C++ policy tests do **not** replace linked Qt/Windows 10 runtime tests for disk full, two-window locks, interrupted transfer and actual session revocation.
- `G26-08` / `G26-09` remain source-partial in the single final roadmap. Broader browser/mobile parity and real Windows acceptance are outstanding.
