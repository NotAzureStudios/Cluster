# Cluster TD6 Implementation Roadmap — F08 checkpoint

**Standing priority:** complete unfinished Cluster 1.0 implementation before comprehensive runtime/release certification. F08 is based on F07 and preserves F01–F07 source changes.

| Slice | Feature | Source status |
|---|---|---|
| F01 | Conditional Forms branching and server-side hidden-answer filtering | Implemented, uncertified |
| F02 | Versioned Form deadlines, reminders, admin reporting | Implemented, uncertified |
| F03 | Saved Board Card metadata Undo/Redo and conflict checks | Implemented, uncertified |
| F04 | Persisted Whiteboard saved-operation Undo/Redo | Implemented, uncertified |
| F05 | Bounded, source-protected Packet WAV excerpts | Implemented, uncertified |
| F06 | Managed Package signed destination update plan and conflict guard | Implemented, uncertified |
| F07 | Native read-only tracked-destination integrity audit and Desktop presentation | Implemented, uncertified |
| **F08** | **Completed-offboarding return workflow, identity preservation, fresh security/permissions and audited Personnel Record** | **Implemented, uncertified** |

## F08: CD-04 governed People identity return

- A previously completed offboarding case can be **reviewed for return** in Studio Settings → Offboarding. The preview refuses stale, already-returned, nonfinal, superseded or competing active cases, as well as erased, already-unarchived or non-disabled identities.
- The authorized admin must explicitly select a new account type, supply a reason and use `RETURN` confirmation. Contractor, client and guest accounts require a future access expiry. The transactional commit repeats all eligibility checks and serializes on the existing User row.
- The same `User.id` and original Offboarding/Personnel history are retained, with a distinct confidential, finalized return Personnel Record (`sourceKind=studio_offboarding_return`, unique `sourceId`), one per completed case.
- The returning person's account is **unarchived but stays disabled**, with password, PIN, Discord link, sessions, MFA, recovery codes, device and challenge state invalidated. Authentication/profile generations advance; scoped JSON grants are cleared. Workspace/project/team/Inventory/Package accesses, employment and ownership handed off at exit **are not restored**.
- Case revision and return timestamp form an in-transaction one-time claim. Profile Archive/Restore toggles are retired, and archived/expired account credential issuance and activation are blocked in the other administrative paths. The Discord callback rechecks current lifecycle so a pending link cannot re-activate an unavailable identity.
- Source-based assertions include transaction rollback and duplicate/competing-case checks; they do not establish live PostgreSQL transaction isolation or native UI acceptance.

## Still unfinished

1. **CD-04:** automatic engagement/access-expiry transitions, approved grant/entitlement provisioning, renewal workflows, offboarding portfolio transition, broader contractor/service/device lifecycles. The return flow does not create employment or grant access.
2. **CD-08:** privileged supervised software install/update, dependencies and OS installation evidence, interruption handling. F06/F07 remain managed content, not an OS installer.
3. **CD-03:** fuller Card/Whiteboard collaboration and non-metadata Undo, review workflows.
4. **CD-07:** broader protected audio/video transcoding, retention and watermarking beyond the bounded preview adapters.
5. Remaining CD-01–CD-20 work items are retained in the master feature ledger, not assumed complete from this checkpoint.

**Next preferred F09:** engagement expiry governance, scoped access grants, and safe, evidence-backed renewal. Keep runtime certification tracked but deferred under the user's implementation-first directive.
