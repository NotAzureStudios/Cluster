# Cluster v0.546.0 | TD6 G26 consolidated one-batch implementation

**Parent:** G26 Batch H offboarding/credential settlement source.  **Checkpoint scope:** One source-development batch with inherited regressions. **Not a certified Windows/PostgreSQL release.**

## Connected work completed in this batch

1. **Independently reviewed standalone Vault rotation.** A new `StudioVaultRotationReview` authority and additive SQL migration separate request, independent admin decision and requester-controlled final commit. An unexpired approval is revision-pinned, single-use and denied if the secret was revoked, reassigned to Inventory keys, or changed. The old `/rotate` single-actor shortcut now returns `VAULT_INDEPENDENT_REVIEW_REQUIRED`. The approval queue stores business reason, actors, disposition notes and timestamps, **never replacement plaintext, ciphertext or key fingerprint**. Replacement is encrypted only at commit. The admin Vault UI includes request/review/final-commit stages. Administrator statement of an external-provider change remains unverified by Cluster.
2. **Effective Library retention ancestry.** New bounded lineage resolver includes every parent folder's active hold and longest retention deadline. Missing parents, cycles, invalid dates, more than 128 ancestors and cross-Project paths fail closed. Disposition snapshot and fingerprint include ancestor revision evidence; the user-facing retention preview exposes effective protection. Hierarchy Trash checks inherited ancestor protection and revalidates lineage at its existing source-level commit checkpoint.
3. **Read-only S3 object-version evidence.** An S3 HEAD response may now supply an opaque version ID to the server storage contract; only an `observed_unfenced` boolean-style state is returned by upload recovery inspection. It is **not a generation lease, CAS precondition, Quarantine approval or disposal permit**. The background storage runtime still performs zero automatic physical deletions/tier migrations. No unconditionally destructive provider code was enabled.
4. **Reconciliation and executable checks.** Preserved all Batch A–H functionality, added rotation/lineage/provider tests, exercised inherited TD4 hierarchy/disposition and WS8 tests, TD5 closeout, native Go standard/race/vet, Windows x64 cross-compile and source parser/import scans.

## Still outside this source checkpoint (must not be marked finished)

- **Windows MSI recovery:** No actual Windows Installer installation/repair/uninstall, reboot continuation, consent/elevation or post-install attestation was performed. Existing read-only receipt and registration inspection is not an installation-health proof. Native shipped executables are unchanged; only a separate Go test binary was cross-compiled.
- **External credential disposition:** Approval and recorded operator assertion cannot independently confirm license-platform redemption/revocation or third-party credential replacement. Provider integrations/confirmation and physical key custody still require workflows.
- **Destructive storage reconciliation:** No provider-level conditional mutation, verified quarantine/restore, durable backup safety, two-person execution authority, NAS/S3 generation fencing or permission for physical deletion. Dynamic ancestry is integrated with disposition and hierarchy Trash, but all other mutation surfaces still need a full live consistency audit before claiming universal retention inheritance.
- **Runtime certification:** No Node 24 dependency-backed compile, Prisma migration against disposable PostgreSQL 18, multi-actor authenticated browser acceptance or Windows/Qt native tests. TD5 preflight reported BLOCKED for runtime/dependency/native gates in this container.

## Verification

Run `npm run cluster:td6:g26:one-batch` from `source/` for the source regression chain. The new focused suites intentionally use simulated database transactions. Node 22.16.0 and Go 1.23.2 were available here, not the project's required Node 24 and packaged native platform. The migration `20261103000000_td6_g26_reviewed_vault_rotation` has not been applied to a live database.

## G26 status decision

**Consolidated implementation batch complete; G26 production/runtime closeout remains OPEN.** Do not present G26 as certified or enable its intentionally blocked MSI/disposal capabilities. Before G27, use a provisioned Windows+PostgreSQL test environment to close the actual runtime gates and fix any discovered issues. G27 can proceed as a distinct source workstream only if those open risks remain explicitly tracked.
