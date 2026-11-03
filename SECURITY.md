# Cluster security policy

Cluster 1.0 is a **private, self-hosted Azure Studios product**. The `v1.0.0` release is the supported studio baseline, with subsequent security fixes handled as `1.0.x` maintenance updates.

## Report an issue privately

Contact authorized Azure Studios maintainers using existing internal studio channels. Do **not** disclose tokens, passwords, private signing keys, Library data, database contents, or exploit details in a public issue or chat. Report the release/component version, steps to reproduce, impact and sanitized diagnostics.

Maintainers should evaluate data exposure, revoke compromised credentials, patch in a restricted branch and distribute follow-up guidance to affected operators.

## Release security limits

The published Server and Qt Desktop installers were hash-verified and compiled from recorded commits, but **they are not code-signed**, and live installation, update/rollback and recovery acceptance have **not** been independently verified. See the [release notes](docs/releases/CLUSTER_1_0_0.md) and [installation guide](docs/INSTALLATION.md).

Keep Cluster behind the studio's trusted network or an appropriately secured HTTPS endpoint; use least-privileged accounts and strong credentials. Preserve external PostgreSQL and Library backups. Do not treat a successful source CI run or checksum as penetration-testing or runtime-security certification.

Protect the private repository, update trust roots, build credentials and installer distribution. Never commit database files, user data, populated `.env` files or signing keys.
