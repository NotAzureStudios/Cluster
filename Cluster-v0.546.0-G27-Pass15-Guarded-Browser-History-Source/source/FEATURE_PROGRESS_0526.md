# Cluster v0.526 development: managed destination-file groundwork

## Implemented in source

- Native `--action preview-files --destination <existing-directory>`: signed, independently pinned, current managed release comparison against an ordinary destination folder. Reports missing/current/different files and SHA-256 hashes without modifying files.
- Native `--action copy-missing-files --destination <existing-directory>`: copies only files absent at destination from already verified current managed content. Uses an exclusive hard-link claim so a concurrently created destination file cannot be overwritten. Refuses any conflicting existing file, including an outdated version, rather than treating local changes as disposable.
- Rejects destination overlaps with the private managed root, filesystem roots, missing destination roots, symlinked parents, unsafe entries, and release identity mismatches. Previews refuse grants and do not consume signed deployment permissions.
- Native tests cover missing/current/different, symlink/path collisions, existing file preservation, duplicate-safe execution and exact byte copying.

## Deliberately unfinished

- Replacing out-of-date destination files is NOT implemented; safe backups, versioned rollback, locally modified-file conflict review and file removal require an explicit policy and coordination with Desktop before production use.
- Neither action is connected to the Qt UI. These are CLI-native helpers requiring an explicitly selected destination and a previously authorized, pinned, staged and managed release.
- No automatic updates, background write operations, executable launch or OS installation. No Windows execution, PostgreSQL or whole-client integration certification has been performed.
- The operation is not all-or-nothing across a multi-file directory. If copying fails partway, already newly copied files remain. Each single-file addition is exclusive and atomic, and rerunning can finish missing files.

## Example

`cluster-package-stager --action preview-files --kit release-staging-kit.zip --trusted-key-sha256 <independently-pinned-fingerprint> --root <private-cluster-root> --destination <existing-work-folder>`

`cluster-package-stager --action copy-missing-files --kit release-staging-kit.zip --trusted-key-sha256 <independently-pinned-fingerprint> --root <private-cluster-root> --destination <existing-work-folder>`

These operations require the release to be already selected in private managed content. The Package ZIP cannot authorize modifying unrelated destination files.
