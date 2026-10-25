# Cluster v0.546.0 | TD6 G26 Retention Mutation Authority Closeout

**Parent:** `Cluster-v0.546.0-TD6-G26-OneBatch-Reviewed-Vault-Retention-Evidence-Source.zip`.

## Connected security/consistency work

1. **Retention-preserving relocation.** New `library-retention-relocation.ts` resolves the effective before/after hold and active deadline in the same Serializable transaction. A move out of a held folder or to a weaker retention ancestry fails closed. Moving into equally/stronger protected destinations remains supported. Existing source and target chains are read afresh; damaged lineages, cycles and cross-Project ancestry are errors, not evidence of no protection. The common `revalidateLibraryBulkTreeWrite` guard covers interactive bulk and durable hierarchy move operations.
2. **Durable move snapshot.** The hierarchy move source fingerprint now includes every origin ancestor's revision, hold and retention evidence. Its destination fingerprint also includes hold/deadline fields, so changing either side of a preview invalidates the queued operation rather than silently changing a protection policy. A previously committed root remains committed if a later root becomes stale.
3. **Trash without bypasses.** Interactive bulk Trash checks effective inherited protection on each selected root and local protection on every descendant, within the mutation transaction. Single-item DELETE now performs a Serializable revision-pinned transaction with current ancestry, Personnel Records, children, edit locks and hierarchy provenance checks before updating Trash state. No physical file deletion is introduced.
4. **Metadata endpoint authority.** PATCH `/api/library/:id` no longer accepts direct hold/retention changes, relocations, Project reassignment, or Trash/restore transitions. Dedicated APIs handle these operations with their policy, authorization and revision guarantees. The Library inspector no longer advertises parent or Project reassignment as a metadata edit; use the existing previewed Library Move action for relocations. Title, description, tags, visibility, owner and ordinary status editing remain available.
5. **Repeatable fault/compatibility checks.** Added 24 executable retention-mutation assertions for inherited policies, equal/stronger destinations, stale/invalid chains, forbidden PATCH input, direct and bulk Trash wiring, and existing move authority. Re-ran the inherited G26 chain, R61/R62 hierarchy tests, R63/R66 independent disposition tests, TD5 source closeout and native Go helper tests.

## Intentional limits

- Project transfer in Library metadata is now **explicitly rejected**, not silently rewritten. Implementing a full authorized cross-Project transfer with descendant review, relationships, access and retention is distinct future work.
- The supplied tests simulate transactions and source mutations; they are **not** live Prisma/PostgreSQL race certification. Source scans are not a full dependency-backed TypeScript build.
- Universal retention inheritance still requires live mutation-surface and storage-provider audit. The change specifically closes the paths described above; it is not a claim that every historical write is safe.
- MSI repair/reboot recovery on Windows, externally verified credential revocation, generation-fenced storage quarantine/disposal, Node24/PostgreSQL18/Qt/browser acceptance and native packaged-binary replacement remain unverified or blocked.
- Do not enable physical deletion, automatic MSI retry/repair/uninstall or unfenced external credential claims.

## Commands

From `source/`:

```
npm run cluster:td6:g26:retention-mutation-closeout
npm run cluster:td6:g26:one-batch
node tools/scripts/cluster-td4-r61-hierarchy-move-tests.mjs
node tools/scripts/cluster-td4-r62-hierarchy-lifecycle-tests.mjs
node tools/scripts/cluster-td4-r63-disposition-tests.mjs
node tools/scripts/cluster-td4-r66-independent-disposition-tests.mjs
go -C tools/native/package-stager-go test ./...
go -C tools/native/package-stager-go vet ./...
```

**G26 status:** this security source layer is complete, but G26 runtime/safety certification is **OPEN**.
