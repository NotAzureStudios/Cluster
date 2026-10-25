# G26 handoff: Audit integrity/export → provisioned runtime acceptance

**New baseline:** `Cluster-v0.546.0-TD6-G26-Audit-Integrity-Export-Authority-Source.zip`, derived solely from the prior `Cluster-v0.546.0-TD6-G26-Atomic-Vault-Audit-Source.zip`.

## Preserve these changes

- All security export responses are **v2** and digest their final parsed-metadata projection, never a raw-strings surrogate.
- Do not return audit exports when persisted `security.audit_exported` evidence cannot be positively confirmed.
- A global audit integrity `ok: true` must account for every audit record, including unexpected integrity versions and unchained rows. Do not restore an `integrityVersion=1` read filter.
- Evidence exports must not silently parse malformed JSON metadata into `{}`.
- Keep independent reviewed Vault rotation and same-transaction Vault mutation/audit from prior checkpoint.
- Preserve G26 retention/Library media/Package/Inventory authorization guards and deliberate disabled-state for MSI auto-repair and physical storage deletion.

## Next high-value real runtime verification

1. On a disposable Windows or Linux staging server with **Node.js 24.20.x**, provision exact dependencies and Prisma client. Restore a pinned lockfile and capture actual `tsc` diagnostics, not just syntax scans.
2. With **PostgreSQL 18**, seed v1 chain + version0/unsupported rows, alter a final record's integrity version, delete a middle row and corrupt an event hash. Test integrity endpoint and operations health projection fail closed. Verify `totalEvents` and `uncheckedEvents` against independent SQL counts.
3. Execute full export with structured metadata, verify its digest using `node tools/scripts/verify-security-audit-export.mjs export.json`, then tamper with the metadata and confirm rejection. Inject audit table write failure and ensure no export data is returned.
4. Test concurrent audit append during export and explicitly document non-atomic consistency; decide if a repeatable-read snapshot/export job is required for compliance. Anchor signed chain tips outside the database if the studio requires evidence of tail deletion.
5. Verify independent Vault rotation under concurrent admin approvals/failed audit writes. Finish Windows MSI fault/reboot recovery, external credential-provider revocation and provider-generation-fenced disposal in provisioned environments. They remain **unimplemented or uncertified** here.

**No database migration or native executable changes. G26 is not release-certified.**
