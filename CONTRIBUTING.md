# Contributing to Cluster

Cluster is a **private Azure Studios project**. Contributions are limited to authorized studio collaborators. There is no public contribution process.

## Git workflow

1. Begin from the latest `development` branch, not `main`.
2. Use a small focused branch (`feature/<topic>`, `fix/<topic>`, `chore/<topic>`) when reviewing a larger change independently.
3. Make focused commits that explain *what* changed and *why*. Do not combine unrelated fixes or include generated distribution archives.
4. Run `node tools/scripts/cluster-repo-hygiene-check.mjs`, `node tools/scripts/cluster-rc-preflight.mjs`, and relevant focused source checks; record any unavailable environment gates.
5. Open a pull request into `development` with testing evidence and impact on data, security and installation behavior.
6. Promote `development` into `main` only after review and appropriate integration/release verification.

Use conventional, descriptive commit subjects when practical, for example `fix(library): preserve upload retry state` or `docs: update Windows build prerequisites`. No force pushes to the long-lived branches.

## Review standards

A PR should explain scope, affected systems, changed contracts, permissions, database migrations, and its tests. For schema, updater, or disk operations, describe rollback/recovery implications. Do not claim release certification from source-only checks.

Keep established conventions, file ownership boundaries and toolchain versions. Do not introduce new compatibility shims unless actually required; Cluster does not currently need to preserve production users or instances.

## Protect credentials and user data

Never commit access tokens, private keys, local `.env` files, test-user credentials, database snapshots, Library contents, build caches, installers or machine-specific configuration. The `.gitignore` is only a guardrail, not a secrets scanner.

Report suspected vulnerabilities privately. See [SECURITY.md](SECURITY.md). For installation and support questions, see [SUPPORT.md](SUPPORT.md).

## Development references

[README](README.md) · [Local setup](docs/development/LOCAL_SETUP.md) · [Git workflow](docs/development/GIT_WORKFLOW.md)
