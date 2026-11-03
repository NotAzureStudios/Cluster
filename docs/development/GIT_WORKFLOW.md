# Cluster Git and review workflow

This repository is the **private source repository** `NotAzureStudios/Cluster`. It is separate from Cluster's *built-in* Git/source-control features offered to studio users.

## Branch roles

- **`development`**: the authoritative **ongoing integration branch** for code work, cleanup and source imports.
- **`main`**: the reviewed source baseline, consolidated with `development` on November 2, 2026; retained as GitHub's default landing branch. Not automatically a certified release.
- **`feature/*`, `fix/*`, `chore/*`, `import/*`**: optional **temporary** work branches based on `development`, targeting `development` by pull request. Once their PR merges, the branch is automatically pruned by `.github/workflows/cluster-branch-housekeeping.yml`. **`main` and `development` are the only permanent working branches.** The one-time `archive/main-pre-development-consolidation-2026-11-02` backup is deliberately retained for historical recovery, not active development.

Prefer reviewable PRs. Normal development does **not** push to `main`; routine force updates to either long-lived branch are forbidden. On November 2, 2026, a specifically authorized source consolidation replaced the diverged `main` tip with the tested `development` revision using force-with-lease and preserved the previous tip under `archive/main-pre-development-consolidation-2026-11-02`. This is a historical exception, not a recurring workflow. Promote future changes only after focused review and passing checks. GitHub branch protection and required checks still require separate configuration; written policy alone does **not** enforce it.

## Working locally

```sh
git clone https://github.com/NotAzureStudios/Cluster.git
cd Cluster
git switch development
git pull --ff-only origin development
git switch -c fix/short-topic
# edit, verify, commit, push and open a PR into development
```

`main` may be read or compared as needed. Avoid merging `main` into `development` without inspecting what would change, especially during release-source reconciliation.

## Changes, verification and releases

Commit source code, scripts, tests, migration files, maintained configurations and useful documentation. Do not commit downloads, binaries, local PostgreSQL files, Library contents, secrets or entire server distributions. `.gitignore` is not retrospective and cannot prevent secrets embedded in a tracked file.

Use `node tools/scripts/cluster-repo-hygiene-check.mjs` and `node tools/scripts/cluster-rc-preflight.mjs` for dependency-free source checks. Full builds and Windows acceptance gates are separate. Record any tests that could not run.

Publish binaries and installer ZIPs as **version-matched, verified release artifacts**, never as routine source commits. No Git tag by itself certifies an installer.

## Cluster 1.0 release baseline

The private [`v1.0.0` tag](https://github.com/NotAzureStudios/Cluster/tree/v1.0.0) is the published source baseline. Its original Server and Desktop binaries were built from earlier reviewed branch commits and have their own checksums in [release notes](../releases/CLUSTER_1_0_0.md). The committed npm lockfile supports reproducible `npm ci` on pinned Node.

Bug fixes after this release belong in focused `1.0.x` changes on `development`. Preserve existing installed Server data, compatibility boundaries and updater safety. Do not move the published v1.0.0 tag or replace its assets while working on later fixes.

See [source snapshot hygiene](SOURCE_SNAPSHOT_HYGIENE.md) for import safeguards.
