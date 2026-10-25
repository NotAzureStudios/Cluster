# G26 | Native Archive Crash Recovery, Pass 1

**Parent:** `Cluster-v0.546.0-F4-P15-Final-Roadmap-Integrated-Source.zip`
**Output:** `Cluster-v0.546.0-G26-Native-Transfer-Crash-Recovery-Pass1-Source.zip`
**Change type:** integrated Go + Qt + renderer + UI + tests; **no migration**.

## Implemented

1. Added explicit `transfer-recover` to the existing local Go Package stager. A transferred archive is never an executable grant.
2. Verifies persisted checkpoint, SHA-256 of the already-published prefix and the entire retained file. Supports append-before-checkpoint crash, commit-rename-before-checkpoint crash and idempotent healthy results; preserves nonsecret offer identity.
3. Refuses missing checkpoint, symlinks, bad/temp metadata type, altered prefix, wrong full archive SHA-256, extra/truncated bytes, dual part/ZIP files, and an active or stranded lock. No automatic lock breaking or retained payload deletion. Explicitly removes only validated `.pending` metadata after checking the canonical checkpoint and payload under lock.
4. Go CLI returns an allowlisted checkpoint plus `recoveryAction` and `recoveredBytes`. Qt allowlists the action, has a native Yes/No confirmation and rechecks Desktop session/profile.
5. Desktop Packages panel revalidates current server-authorized Package target and offer identity before presenting recovered disk progress. Further download still requires a new current server-authorized offer; staging requires independent Ed25519/SPKI signature verification.
6. Updated **the same final roadmap and work register**, keeping G26-08/09 `source-partial`.

## Tests and constraints

- Native `go test ./...`, `go test -race ./...`, `go vet ./...`: pass on available Go 1.23 Linux runtime.
- Windows x64 cross-compile: pass; not a live Windows 10 run.
- New source bridge assertions: 25/25 pass.
- Source scanner: 1,132 TS/TSX, no syntax/missing relative renderer imports.
- Inherited Package/Transfer suites run. Repaired an inherited `cluster-0532` text assertion that matched an obsolete Qt confirmation expression; the current confirmation remains active and the complete signed-kit round-trip regression passes 13/13.
- No real Qt compile, Windows 10 process interruption, PostgreSQL 18, network lease revocation or native MSI installation tested.

## Next connected G26 work

- Add recovery integration for browser, mobile and two Desktop sessions with authoritative per-chunk server authorization and real flow tests; separate operator-safe stranded-lock intervention.
- Finish privileged MSI repair/uninstall/reboot evidence and OS-attested receipts only with Windows-certified ownership and explicit grants; never auto-execute arbitrary packages.
- Confirm Library provider retention, Packet delivery and Vault/Inventory cross-service acceptance against the master 1.0 register.
