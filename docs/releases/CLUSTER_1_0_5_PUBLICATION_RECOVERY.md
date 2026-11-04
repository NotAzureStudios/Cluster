# Cluster v1.0.5 publication status and recovery

## Verified evidence

- The pinned Server 1.0.5 Windows build passed: GitHub Actions run `41742439918`, source commit `6e3f05aac63697b05b530f35b05dd6ac1ceac858`.
- Publisher [run 41743562896](https://github.com/NotAzureStudios/Cluster/actions/runs/41743562896) verified the Server 1.0.5 installer and the Desktop 0.482.0 assets, then failed on `gh release create v1.0.5 --draft` with HTTP 403 `Resource not accessible by integration`.
- The run explicitly reported `Contents: write` for `GITHUB_TOKEN`. The cause of the authorization denial is not established, so changing the YAML permissions again is not a proven fix.

## User-selected one-time release plan

1. Keep publication on the built-in GitHub Actions `GITHUB_TOKEN`; **do not require a personal access token or any new secret**.
2. Do not require or attempt a Discord announcement. Version 1.0.5 can publish to GitHub independently.
3. Verify pinned source, build success, release identity `1.0.5` (sequence `55`), Server installer receipt and SHA-256, and all five preserved Desktop files.
4. Create a draft release, upload the expected eight assets, check their filenames, then promote the release to GitHub Latest.
5. **If GitHub still returns HTTP 403, fail clearly without claiming release success or bypassing repository policy.** A repository owner can then publish the verified files manually through GitHub's authorized release UI or resolve the workflow token restriction.

## Release constraints

- Never recompile or silently replace the pinned installer in `v1.0.5`.
- Server installer is **unsigned** and the signed Server automatic-update feed is **separate**.
- Desktop remains at **0.482.0**, byte-for-byte unchanged.
- Upgrade/rollback with populated PostgreSQL and Library remains not fully certified. Back up database, Library, credentials and configuration before manually upgrading.
- Separate application fixes in `development` belong in a later version; do not relabel them as already included in the pinned v1.0.5 binary.
