# Cluster v0.546.0 | G26 Pass 50 | One-use grant ledger and MSI journal filesystem durability

## Source implementation

Pass 50 addresses a source-level crash consistency gap across **mutation admission**, not certification: a file's `Sync` does not necessarily durably commit its directory entry on POSIX filesystems. The native helper now explicitly syncs the containing directory at the following custody boundaries when supported:

1. When the replay-ledger directory is created, it flushes the profile root before reporting a consumed grant.
2. When a nonce-keyed grant entry is exclusively created, it writes exactly the signed Package key and operation, syncs the file, independently checks its visible identity and size while retaining the exclusive-create file handle, and syncs its ledger directory before success. A replay attempt cannot replace the original record.
3. The first MSI repair/uninstall/upgrade/rollback lifecycle journal persists the initial non-replayable state and syncs its parent directory before consuming the one-use grant.
4. Subsequent atomic lifecycle journal replacements and initial MSI install receipt writes sync their parent directory after their file-synced write/rename.
5. Newly created admission/Package lock directories sync the parent before use. Failure leaves an unresolved lock for investigation instead of silently granting permission to run again.

The shared grant consumption path also protects managed-content deployments. It rejects malformed nonce/Package/operation identities before touching the ledger, unsafe symlinked ledger directories and concurrent/repeated nonce consumption. Existing signature/grant verification and exclusive-create constraints remain mandatory.

On **Windows**, `os.File.Sync` on opened directories is not consistently supported. The helper retains its file-fsynced, exclusive-create and atomic rename protections while treating unsupported Windows directory sync as a platform limitation. This is **not a claim of power-loss safety on Windows**; that requires separately controlled VM testing. On POSIX, an unexpected containing-directory flush failure aborts admission. No journal is automatically deleted or replayed. The externally hosted Windows Installer service still lies outside the native Job Object's complete control.

## Executable checks

- **32 new** portable/native-source assertions, including live Go unit tests for nonce replay and cross-operation reuse, symlinked ledger refusal, unlaunched/started MSI lifecycle journaling, strict initial-exclusive receipt creation, unsafe paths, and native installer lock custody.
- Inherited G26 Pass 49 **1,896** checks. Total **1,928/1,928**.
- `go test ./...`, `go test -race ./...`, `go vet ./...` and Windows amd64 native application/test cross-compilation pass. The inherited TS/TSX source syntax/import/CSS scans pass.
- Independently extracted source ZIP and replayed Pass 49 and Pass 48 overlays verified byte-for-byte.

## Explicit remaining work

No real Windows power-loss, reboot, MSI upgrade/rollback, linked Qt, PostgreSQL, or application-health certification is claimed. The incident queue from Pass 49 still does not authorize manual journal clearance, replay, repair or rollback. G26-10, G26-11 and CERT-12 are OPEN, as are release/runtime test gates. Continue other v1.0 source and cross-tool closeout work while preserving these certification items for later acceptance.
