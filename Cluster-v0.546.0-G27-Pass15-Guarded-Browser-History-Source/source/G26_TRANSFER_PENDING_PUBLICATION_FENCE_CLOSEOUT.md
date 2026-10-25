# Cluster v0.546.0 | G26 Pass 8: Transfer Pending-Publication Fence

**Parent:** G26 Pass 7 Native Transfer Streaming Diagnostics. **Status:** source-tested; Windows 10/Qt runtime not certified.

A native append publishes its durable checkpoint through `checkpoint.json.pending` followed by rename. If a crash leaves that file, the previous `checkpoint.json` may still pass a full payload hash, but it is **not** evidence that the publication completed. Previously, `readTransferCheckpoint` ignored that residue, permitting inspect, bind and commit paths to treat the older checkpoint as authoritative. This could turn an interrupted checkpoint publication into a completed archive without the operator-confirmed recovery procedure.

The canonical verified reader now rejects any pending checkpoint publication, including malformed pending-file evidence, and directs operators to explicit recovery. Because `commitTransfer`, `bindTransferOffer` and `inspectTransfer` all call that reader, the same fence applies across their operations. The existing explicit `recoverTransfer` path verifies the published prefix/full payload and clears only safe pending metadata under the exclusive transfer lock, then verifies the checkpoint again. No automatic lock removal, payload deletion, installer execution or authorization renewal is introduced.

New executable test `TestTransferPendingCheckpointPublicationBlocksReadersAndCommit` covers inspect, verification, commit, offer binding, retention of pending evidence and recovery. `go test ./...`, `go test -race ./...`, `go vet ./...` and Windows amd64 cross-build passed in the available Go toolchain. Live Qt/Windows testing remains open, as do broader G26-08/09/10/11 workflow and MSI release gates. The final work register remains authoritative.
