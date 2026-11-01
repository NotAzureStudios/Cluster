# Cluster security policy

Cluster is a **private, self-hosted Azure Studios application**. This repository is not a public support forum or a vulnerability disclosure program.

## Reporting

If you find a potential vulnerability, **contact the Azure Studios repository maintainers privately through your existing authorized studio communication channel**. Do not publish credentials, exploits, database content, tokens, sensitive screenshots or security findings in a public GitHub issue or public discussion.

Include a concise description, affected component/branch/commit, reproducible steps, estimated impact, and any evidence redacted of personal information or secrets. Do not perform intrusive testing against someone else's server.

Maintainers should triage privately, revoke any exposed credentials as necessary, prepare a fix on a restricted development branch, and communicate patch/upgrade guidance to affected operators.

## Supported versions

No GitHub source revision is currently represented as a **certified stable Cluster 1.0 release**. The tracked release metadata is `1.0.0-rc.50` with `certification: candidate-unverified`; newer RC bundles have not yet been integrated into GitHub. Production security support and disclosure timing have not been established.

## Repository and runtime handling

Keep the repo private and access least-privileged. Do not commit secrets, certificate private keys, database files, local configuration or user Library data. Review auth, project/Library authorization, URL delivery, storage and updater changes carefully. Enable applicable GitHub security features and branch protection in repository settings.

This policy documents private reporting and safe handling; it is **not** proof of completed threat modeling, release signing or penetration testing.
