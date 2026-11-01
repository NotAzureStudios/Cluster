# Cluster source-control workflow

Cluster is a proprietary Azure Studios application. Keep the GitHub repository **private**.

## Repository and current migration state

- Repository: `NotAzureStudios/Cluster`, default branch `main`.
- The last existing `main` commit audited for this preparation is `62a4f45c64e4bfed286034b839de1f082e5e7f50` ("RC 50", October 2026).
- A newer **RC74 complete-source archive** exists outside this repository. **It has not been imported or verified against `main` by this preparation.**
- Do not treat this branch or this document as a release update or Windows certification.

## Development

1. Clone the private repository using your authorized Azure Studios GitHub account.
2. Create a short-lived branch from the latest `main` for each connected set of changes.
3. Commit source code, tests, tracked configuration templates, migrations and useful documentation.
4. Open a pull request; inspect the changed-file list, run relevant regression checks and merge without force-updating `main`.
5. Put installer binaries, full source snapshots and other large distribution ZIPs into a separately verified release artifact, not routine Git commits.
6. Preserve historical Git commits. Do not rewrite `main` merely to replace a snapshot.

## Exclusions and sensitive data

Never commit actual credentials, OAuth tokens, API keys, private certificates, production `.env` files, local PostgreSQL data, user-generated Library contents, caches, `node_modules`, native build products or entire portable server installations. `.gitignore` protects against common accidental additions, **not** data already committed or secrets embedded in source. Review changes for secrets before push.

Do not confuse Cluster's embedded Git/source-control feature with development of Cluster itself in this repository. They are separate systems.

## RC74 source import checklist (pending source access)

1. Obtain the **complete RC74 source ZIP** as readable raw bytes and verify its manifest/hashes; do not reconstruct it from release notes.
2. Compare the archive tree against current `main`, including the native Windows host/installer, Qt client, server, renderer, shared packages, migrations and test scripts.
3. Create an import branch; preserve any repository-only changes, classify deletions and identify secrets/build artifacts before staging.
4. Bring across the canonical source files. Review the diff and make a single clearly labeled source-update commit or a small set of reviewable commits.
5. Run the relevant source regression suites and a dependency-backed Node 24 / Windows / PostgreSQL validation where available. Record untested gates explicitly.
6. Update `README.md`, version metadata, release notes and the tracked handoff to reflect what was **actually** imported and tested.
7. Merge through review. Create a release tag only for a verified matching release candidate; a Git tag alone does not certify a working installer.

### Known baseline issue

The audited `main` tree has no `package-lock.json`. Do not invent a lockfile or claim `npm ci` reproducibility until dependency resolution has been performed and the lockfile is validated. Once generated correctly, `package-lock.json` should be committed (it is deliberately not ignored).
