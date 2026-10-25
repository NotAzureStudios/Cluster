# TD4 R72 | Source Commit Search and Navigation Audit

## Identity and correct placement

- Global source commits are repository-owned; Project Search displays a *placement* only when that Project's active primary-preferred Source binding selects the repository.
- Search placement key: `<projectId>:<commitId>`, not a repository-global commit ID. It is never passed as a commit route ID.
- Canonical navigation resource: `{ kind: "source_commit", id: commit.id, projectId }`. Existing Project Source UI handles `source-commit` inspect scope and fetches older commits through the authorized Project endpoint when absent from the recent-history page.
- Unbound, secondary-only, archived, or inaccessible Project records are not minted as navigable Search hits. A shared repository may correctly display one commit in two distinct authorized Project contexts.

## Admission and privacy

- Ranker data is not a permission grant. Every candidate must survive fresh Project revision, active binding ID/revision, repository state/name/revision, and commit ID/revision/message/author/revision checks.
- The existing Source Control tool and Project domain authorization checks run before the privileged-user shortcut. No actor-level Search result cache bypasses them.
- An unavailable database query rejects rather than serving old indexed commit data. The twelve-candidate admission limit remains enforced.
- No author emails, auth credentials, remote URLs, raw metadata or working-copy state are added to this corpus.

## Performance

- The Project binding projection loads once per bounded batch, with one active binding per Project. The separate commit fetch is limited; Project↔commit cardinality is handled in memory with a hard cap on resulting placements.
- Project delta indexing removes Project-specific commit placements, preserving unrelated Projects' placements of the same global commit.

## Evidence and limitations

- `tools/scripts/cluster-td4-r72-source-commit-search-tests.mjs`: 33 focused assertions covering loader behavior, placement identity, archival, stale title/revision, permission route ordering, negative cases, and navigation.
- Inherited TD4 regression scripts and source scans are recorded separately in checkpoint result files.
- No runtime PostgreSQL, browser, Windows native, or provider generation fencing was performed. Source-level verification does not certify those environments.
