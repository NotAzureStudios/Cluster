# Safe import of historical Cluster source archives

Legacy RC bundles contain application snapshots and sometimes Windows installers. They are **not** Git working trees and must never be applied as an unconditional replacement for the GitHub repository.

The RC73 final-testing bundle contained 2,542 manifest-verified source files. RC74 is newer and exists outside this repository. **Neither source snapshot has been incorporated into the GitHub working branch** at the time of this document.

## Review steps

1. Confirm the source archive is the newest intended source candidate; record its name, SHA-256, release metadata and file manifest.
2. Verify every source file against the manifest, including unexpected/missing paths.
3. Start from the latest `development` and create an `import/*` branch.
4. Compare files and intended deletions by path against the Git tree. Preserve Git metadata, active docs, CI, tests and unrelated post-snapshot changes.
5. Exclude installer executables, generated source manifests, runtime data, secrets and local machine configuration. Review changes before staging.
6. Run focused source tests and security checks; separately record Node 24/npm, PostgreSQL/Prisma, Windows native and installer acceptance evidence where available.
7. Open a PR **into `development`** and review the full diff. Promote to `main` only after the required release verification.
8. Update current-source README and release metadata only after importing and verifying the matching contents.

A green static source scan is not a release certification. No commit should be force-pushed to `main` or `development` to make a ZIP look current.
