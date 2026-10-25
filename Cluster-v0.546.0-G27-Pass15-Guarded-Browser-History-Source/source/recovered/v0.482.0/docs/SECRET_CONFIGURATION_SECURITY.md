# Cluster secret and configuration custody

Cluster treats configuration that can unlock external services, databases, sessions, or encrypted application data as secret material. Secret values are not ordinary studio preferences and are not considered safe merely because an endpoint is admin-facing.

## Secret classes

Cluster currently separates protected values into two storage classes:

- **database-only integration secrets**: Discord webhook URL, Discord bot token, and Git/Gitea access token;
- **protected boot secrets**: values that may be required before PostgreSQL is available, currently `databaseUrlOverride`.

Integration credentials are stored only in PostgreSQL as authenticated ciphertext. They are not duplicated into `cluster.config.json`. Protected boot secrets may be present in `cluster.config.json` only as authenticated ciphertext because Cluster may need them before it can open the database.

Ordinary studio appearance, workflow, and notification settings remain normal application data. Server-owned security and integration settings remain behind the server-configuration permission boundary and are not delegated merely through general settings access.

## Storage encryption

Protected values use AES-256-GCM with purpose-specific additional authenticated data and a key derived from `CLUSTER_SECRET_KEY` using HKDF-SHA-256. Current ciphertext uses the `enc:v2` format and records only a short non-secret key identifier alongside the IV, authentication tag, and ciphertext.

Production requires an explicit `CLUSTER_SECRET_KEY` containing at least 32 bytes. It must be distinct from `SESSION_SECRET` and `CLUSTER_AUTH_SECRET`. Encryption primitives themselves fail closed in production when the dedicated key is unavailable; they do not silently fall back to a session secret.

Cluster retains read compatibility with legacy `enc:v1` values solely for migration. Plaintext protected values and legacy/old-key ciphertext are rewritten under the active v2 key during normal settings/context-pack loading.

## Key rotation

Rotate the storage key without decrypting secrets into configuration files:

1. Preserve the current `CLUSTER_SECRET_KEY` securely outside Cluster.
2. Generate a new independent random key with at least 32 bytes of entropy-bearing material.
3. Set the new value as `CLUSTER_SECRET_KEY`.
4. Put the old value in `CLUSTER_SECRET_KEY_PREVIOUS`. Multiple previous keys may be supplied as a comma-separated list during a staged rotation.
5. Restart Cluster. Settings and context-pack ciphertext that use a previous key are transparently opened and rewritten with the active key.
6. Verify the server configuration diagnostics report the expected active key identifier and that normal integrations/context packs still work.
7. After all Cluster instances and retained data that require the old key have been migrated, remove the old value from `CLUSTER_SECRET_KEY_PREVIOUS`.

Previous keys are decryption-only migration material. They are never selected for new encryption.

## Boot configuration

`cluster.config.json` is a compact server-owned boot file rather than a mirror of the application settings table. Version 2 of the file:

- excludes database-backed integration credentials;
- encrypts protected boot secrets before writing;
- uses an atomic temporary-file/rename flow;
- requests owner-only `0600` permissions where the operating system supports POSIX-style modes;
- carries only a non-secret active key identifier for diagnostics/migration awareness.

When Cluster reads an older config file, it may temporarily consume legacy plaintext values so it can migrate them. The file is then compacted into the protected v2 representation. If an encrypted boot value cannot be decrypted, Cluster fails closed rather than silently replacing it with an empty credential.

## API and UI handling

Secret-bearing fields returned to the renderer are replaced with the existing configured-secret placeholder. `databaseUrlOverride` follows the same rule as integration credentials and is never returned as plaintext. The UI treats the override as a password-style input.

Updating a settings payload with the masked placeholder preserves the existing secret. A real replacement value is validated and then encrypted by the server before persistence.

Server configuration, context-pack mutations, and context-pack secret exports require the central authorization boundary. High-risk configuration operations and secret-bearing exports also require recent authentication.

## Logging and diagnostics

Request logging redacts known secret fields and database URLs. Diagnostics expose whether encryption is configured and may expose the short non-secret active/previous key identifiers, but never the key bytes or decrypted secret values.

Do not add new secret fields without adding them to the explicit secret classification, renderer masking, logger redaction, migration/storage path, release audit, and backup/recovery documentation.

## Backups and recovery

Cluster backups never contain `CLUSTER_SECRET_KEY` or previous storage keys. Database dumps therefore preserve encrypted settings/context packs but not the material required to decrypt them. Backup manifests record only the non-secret key identifier and state that the matching key must be restored separately.

A usable disaster-recovery plan must back up the storage key in an independent secret-management location. Losing every copy of a required storage key intentionally makes the associated encrypted values unrecoverable. Cluster cannot manufacture the missing cryptographic key from a database backup.

Database dumps, copied boot configuration, and backup manifests are written with owner-only permissions where supported. Release packaging explicitly excludes `.env` files and common private-key/container formats such as `.key`, `.pfx`, `.p12`, and `.jks`.

## Environment-file custody

The native server launcher creates the server environment directory with private permissions and writes the managed `.env` file as `0600` where supported. When it updates required Cluster keys it preserves other valid uppercase environment entries instead of reconstructing a narrow allowlist and accidentally deleting integration/runtime configuration.

The launcher may generate `SESSION_SECRET`, `CLUSTER_AUTH_SECRET`, and `CLUSTER_SECRET_KEY` for a new local server. Operators remain responsible for protecting the resulting environment file and for separately protecting any previous key retained during rotation.

## Boundary and non-goals

Cluster's application-layer encryption protects secret values from casual disclosure through database/config copies, application responses, logs, and release artifacts. It is not a hardware-backed secret vault and does not protect against an attacker who already controls the server account/process and can read both runtime environment variables and application memory.

For high-assurance hosting, protect the operating-system account, filesystem, host backups, CI secret store, and deployment environment. A future external KMS/HSM integration can strengthen key custody further without changing the rule that plaintext secrets must not become ordinary application configuration.
