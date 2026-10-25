# G26 next-session handoff: credential reveal integrity

Canonical new source: `Cluster-v0.546.0-TD6-G26-Credential-Disclosure-Audit-Custody-Source.zip`; parent `Cluster-v0.546.0-TD6-G26-Managed-Preview-IO-Authority-Source.zip`.

Security authority added: Vault and Inventory plaintext delivery requires confirmed security-audit persistence. Re-evaluate assignment, recipient, pool, secret and current admin permission after logging, and require an ACTIVE recipient account for keys. Do not restore the old `audit()`-only shortcut. Full inherited G26 checks plus a new executable suite cover the changes. The historical Vault and key-pool tests are refreshed for current reviewed-rotation contracts.

Next high-value work is to run this with actual Node 24, live PostgreSQL 18 and at least two authenticated identities. Inject audit-store failure, account revocation, offboarding transactions, and mid-reveal Inventory/Vault changes while monitoring whether any plaintext can escape. Consider consolidating durable audit+authorization+reveal into a short guarded DB operation if the PostgreSQL concurrency tests show a residual gap. No test here authorizes actual Windows MSI repair, external key revocation or physical provider deletion. G26 is not certified.
