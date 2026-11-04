# Cluster 1.0.5 publication recovery

## Verified failure

The main-branch publisher [run 41743562896](https://github.com/NotAzureStudios/Cluster/actions/runs/41743562896) successfully verified the pinned Server 1.0.5 build (run `41742439918`, commit `6e3f05aac63697b05b530f35b05dd6ac1ceac858`) and SHA-256-checked the unchanged Desktop 0.482.0 files. It failed on `gh release create v1.0.5 --draft` with HTTP 403 `Resource not accessible by integration`. The runner explicitly reported `Contents: write` for `GITHUB_TOKEN`; repeating that YAML permission is not a remediation. GitHub release 1.0.5 did **not** exist after the failure.

The reason GitHub rejected the write-capable workflow installation token is not established by the log. This hotfix allows a separately authorized, repository-scoped publishing identity rather than weakening source provenance checks or replacing the validated installers.

## One-time operator setup

1. Under **GitHub → NotAzureStudios/Cluster → Settings → Secrets and variables → Actions**, add `CLUSTER_RELEASE_PUBLISH_TOKEN`. Use a short-lived fine-grained personal access token for **NotAzureStudios/Cluster only**, with **Contents: Read and write**. Do not commit it, paste it into logs, or grant access to other repositories. If GitHub account security or policy blocks the token, resolve authorization there instead of bypassing repository protections.
2. In the intended Discord announcements channel, create or select a webhook. Store its URL under the repository Actions secret `DISCORD_RELEASE_WEBHOOK_URL`. The release publisher accepts a standard `https://discord.com/api/webhooks/...` URL. The GitHub release may publish without this secret, but the workflow must warn explicitly that Discord was **not** notified.
3. Review and merge the narrowly scoped publishing fix to `main`. The publisher runs only for changes to its version-pinned workflow on `main` or by manual dispatch. It does not rebuild the binaries and refuses to replace an existing v1.0.5 release.
4. Verify the job's credential check, the eight expected assets, `/releases/latest` returning `v1.0.5`, and (when configured) the confirmed Discord message ID. If publication fails, inspect its latest job logs before retrying.
5. Remove or rotate the one-time publishing token after the release if it will not be used again.

## Invariants

- Server source commit: `6e3f05aac63697b05b530f35b05dd6ac1ceac858`
- Server build run: `41742439918`
- Product identity: `1.0.5`, release sequence `55`, stable
- Server installer and launcher: **unsigned**, verified against the build receipt
- Desktop: **0.482.0 unchanged**, SHA-256 verified before publication
- Publication: GitHub draft first, eight assets verified, promote to Latest last
- Discord: only **after** GitHub Latest verification; no misleading confirmation when the webhook is missing
- This is not the separate signed Server automatic-update feed.
- Existing-instance PostgreSQL upgrade/rollback remains not fully certified. Back up Server state before manual updates.

## Forward bugfix policy

Do not silently recompile or overwrite the immutable `v1.0.5` assets. New application changes should be built and verified under a new release identity (normally `1.0.6`), while `development` remains the default engineering branch. This hotfix is isolated to `main` because `development` currently does not yet contain the pinned v1.0.5 release workflow.
