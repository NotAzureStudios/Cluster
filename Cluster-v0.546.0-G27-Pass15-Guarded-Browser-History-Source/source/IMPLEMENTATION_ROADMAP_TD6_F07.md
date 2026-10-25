# Cluster TD6 Implementation Roadmap — F07 checkpoint

**Standing priority:** finish unfinished Cluster 1.0 source features before comprehensive runtime/release certification. F07 preserves all F01–F06 changes.

| Slice | Feature | Source status |
|---|---|---|
| F01 | Conditional Forms branching, hidden-answer enforcement | Implemented, not certified |
| F02 | Versioned Form deadlines, reminders, admin reporting | Implemented, not certified |
| F03 | Saved Board Card metadata Undo/Redo, conflict protection | Implemented, not certified |
| F04 | Persisted Whiteboard element-operation Undo/Redo | Implemented, not certified |
| F05 | Opt-in bounded Packet WAV excerpts, authorized delivery | Implemented, not certified |
| F06 | Managed Package signed file-update plan, conflict-safe sync | Implemented, not certified |
| **F07** | **Read-only managed destination integrity audit, drift detection, retained-file evidence, Desktop UI** | **Implemented, not certified** |

## F07 scope and contract

- A separate signed `audit-files` native operation checks a previously selected existing destination against a current signed, pinned managed release and the *private prior tracking ledger*. It never creates or modifies a destination ledger, copies files, deletes retained files, executes Package contents, or grants further permissions.
- Current tracked files are compared to their recorded per-file hashes. Missing and modified files are reported. Obsolete tracked files still preserved at the destination are counted separately, including locally edited or missing retired files. Signed-release files not in the tracking ledger are identified as not yet tracked, current-but-untracked, or untracked collisions.
- The verification requires the current managed selection, exact selected release identity, independent signer pin, safe existing native destination, and signed source bytes. State and managed-generation rechecks reduce inconsistent snapshots.
- Audits reject unsafe filesystem nodes, traversal, symlinks and unsafe tracking data; scans are bounded to 4,096 historical tracked names and 512 MiB total historical bytes read. An incomplete scan fails explicitly instead of returning success. Output issues are capped at 20 paths and sorted deterministically.
- Qt registers a separate `package.auditFiles` capability, restricts destination selection to native saved mapping or native folder picker, validates native evidence and passes a bounded projection to the authenticated Desktop UI. The new **Audit tracked destination files…** action uses the existing fresh server target check and separate native confirmation.
- Read-only audit status cannot update the old local `last updated` report. The renderer makes the non-attestation limitation visible. No platform installer, repair, execution, or OS-level health evidence is implied.

## Still unfinished in TD6

1. **CD-08**: Safe supervised system-software installation, version and dependency policies, service/process supervision, actual OS-level installed-state attestation, cancellation/reboot behavior, authorized rollback and interruption recovery. The current managed content system is not an OS installer.
2. **CD-04**: End-to-end People/engagement/contractor lifecycle and entitlement transitions, protected offboarding/return, expiry, approved access changes and revocation.
3. **CD-03**: Broader Board/Card/Whiteboard collaboration operations, comments, reviews, safe inverse operations for other mutation classes.
4. **CD-07**: Packet audio/video transcoding beyond bounded WAV excerpts, retention, watermark and derivative lifecycle.
5. The remainder of CD-01–CD-20. Required versus optional slices stay in the master ledger; do not silently mark them complete.

**Next preferred F08 source feature:** CD-04 People lifecycle/entitlement transitions. Resume CD-08 privileged native installer design only when its platform-specific source ownership and execution policy can be implemented without falsely declaring machine trust. TD7 source cleanup follows completed features, then external runtime/platform certification under the separate certification roadmap.
