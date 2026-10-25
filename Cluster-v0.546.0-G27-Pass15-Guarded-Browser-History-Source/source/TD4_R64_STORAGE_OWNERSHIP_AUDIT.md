# TD4 R64 | Storage ownership read-only audit

## Why this change is necessary

R63 deliberately disabled immediate Library destruction and preserved revisions, derivatives, retention and request evidence. However its pending request only counts version/derivative records; counts do not identify physical storage owners, and an orphan filesystem sample is not ownership proof. Local Library file pointers can be duplicated across versions and other Library items; an external provider can share bytes without sharing a local path.

R64 adds a **read-only ownership inspection**, not a quarantine or deletion implementation. That distinction is part of the security contract.

## Actual data authority scanned

- `LibraryItem.fileName` for the selected item and every potentially sharing item.
- `LibraryVersion.fileName` including historical stored versions.
- `LibraryDerivative.storagePath` including completed or pending derivatives with a pointer.
- Enumerated owner record IDs, source model and item identity; a shared pointer is classified conservatively.
- `lstat` and canonical realpath checks under `dataLayout.libraryFilesRoot` for locally addressable sources.

All three model inventories are keyset paginated by `id`, bounded, and fail on a stalled cursor, excessive size, or elapsed deadline. For safety, a database query failure is not interpreted as an empty result.

## Negative and concurrent conditions

- Shared local file bytes, duplicate retained versions, hard links, symlinked files/parents, traversal and external/unknown locators are blockers.
- Missing/unreadable content does **not** prove reclaimable space.
- A second read of the Library item detects changed revision, filename, status, hold or retention. A source pointer disappearing during the scan also blocks a trustworthy report.
- Read-only scans are **not** transactionally atomic across SQL and filesystem, and cannot stop a new upload, dedupe rewrite or off-system copy after inspection. Permanent conservative blockers remain in every report.
- Admin-only access and a capability-gated renderer protect metadata and file locations from non-admin Library managers. HTTP responses are private/no-store; no reusable cached authorization is accepted.
- UI only offers **Inspect storage ownership**, not *Quarantine*, *Purge* or *Delete*. A stale asynchronous inspector result is ignored after navigation.

## Hard caps and behavior

| Guard | R64 bound |
|---|---:|
| Candidate storage pointers per selected item | 128 |
| Database pointer records inspected | 250,000 |
| Matching owner pointers retained | 4,096 |
| Keyset page | 500 |
| Inspection deadline | 15 seconds |

The endpoint returns `OWNERSHIP_INCOMPLETE`/409 when a bound is exceeded. This is an administrative inspection aid; no storage mutation is issued and no partial response is considered a usable disposition report.

## Verification boundaries

R64 executable tests cover local ownership, shared files, version/derivative pointers, cursor pagination, multiple path-injection grammars (POSIX/Windows), missing content, symlinks, hardlinks, limit conditions, changing records and pointer loss. An additional source integration suite inspects auth, no-store, rendering, and fail-closed routing. Inherited TD4 source regressions are run separately. This is **not** a live PostgreSQL or NAS test; TypeScript/TSX parsing is **not** a dependency-backed Node 24 compilation.

## What cannot yet be claimed

No certified backup expiry, snapshot generations, provider-specific object ownership, physical isolation, quarantine restore, destructive worker recovery, or release certification. In particular `databaseInventoryComplete: true` means only that the three explicitly enumerated Library pointer models were traversed within the bounds. `providerInventoryComplete` remains `false`. Physical deletion and quarantine permissions remain `false` unconditionally.
