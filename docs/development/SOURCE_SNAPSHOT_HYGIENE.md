# Source snapshot hygiene

The packaged RC73 bundle includes a separate Windows installer and 2,542 source files covered by a SHA-256 manifest. Its `Source Code` directory does **not** include a Git history, a root README, `.gitignore`, `.gitattributes`, or a dependency lockfile. Never use the bundle as an unconditional replacement for the repository root.

The release metadata inside that archive is `1.0.0-rc.73` with `certification: candidate-unverified`. A later RC74 source archive is also known to exist, but has not been imported into GitHub as part of this source hygiene change.

## Before importing a new archive

1. Verify every source file against its source manifest and reject unlisted files.
2. Compare against the latest `main`, and preserve the existing Git history, metadata and historical release notes.
3. Import only source, configuration and tests. Exclude installer binaries, local runtime state and generated source manifests.
4. Inspect changed and deleted files, including file names containing secrets, before committing.
5. Use a separate import branch and PR. Do not force-push `main`.
6. Run Node 24 source gates and all relevant release tests. The Windows installer, PostgreSQL, backups and real media playback require separate acceptance evidence.
7. Publish a release tag or installer only after the matching revision is actually verified.

The development repo and packaged binaries are different artifacts. A green source-only check is not a stable release sign-off.
