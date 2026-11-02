# Cluster Git and review workflow

This repository is the **private source repository** `NotAzureStudios/Cluster`. It is separate from Cluster's *built-in* Git/source-control features offered to studio users.

## Branch roles

- **`development`**: the authoritative **ongoing integration branch** for code work, cleanup and source imports.
- **`client/web`, `client/desktop-qt`, `server/windows`, `platform/shared`**: maintained client/platform work lanes. Base new work on the current `development` tip and submit reviewed PRs back to `development`; these are not permanent source forks.
- **`main`**: the reviewed integration/release baseline, retained as GitHub's default landing branch.
- **`feature/*`, `fix/*`, `chore/*`, `import/*`**: optional short-lived work branches based on `development`, targeting `development` by pull request.

Prefer reviewable PRs. Normal development does **not** push to `main`; do not force-update `development` or `main`. Promote changes from `development` to `main` only after relevant checks and review. GitHub branch protection and required checks should be configured in Settings separately; documenting a policy does **not** enforce it.

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

## Current source migration state

At the time of this workflow update, `config/release-candidate.json` identifies **1.0.0-rc.50**. Later RC73 and RC74 source bundles exist outside GitHub and **have not yet been integrated**. Do not automatically overwrite the repository with an archive. The absence of `package-lock.json` is a known reproducibility blocker.

See [client branch ownership and 1.0 gates](CLIENT_BRANCHES_1_0.md) and [source snapshot hygiene](SOURCE_SNAPSHOT_HYGIENE.md) for workflow and import safeguards.
