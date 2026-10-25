# Cluster 0.515 → 0.516 source handoff

- **Base:** verified `Cluster-v0.515.zip`, not older isolated Pass 15 or 0.512 archives.
- **Current source:** `Cluster-v0.516.zip`, incremental unified patch inside archive and separate `Cluster-v0.516.patch`.
- **Changes:** Go signed offline content selection, reverified rollback, explicit `content_selected` receipt status, PDF publication-label watermark, UI, negative tests and cross-language smoke. See `FEATURE_PROGRESS_0516.md`.
- **Preserved:** all previous canonical Project, Library, People, Auth, Packet and Package systems, including the authoritative Pass 15 merge.
- **Next feature priorities:** authenticated Qt device-download/stager bridge; OS-service-owned install/activation and audited recovery; Package update policy reconciliation; Library/Calendar shared views; Work autosave/review/undo; source-PDF and media redaction/derivatives; Vault and People workflows. All subject to present permission and security architecture.
- **Certification:** deliberately deferred at user's instruction; Go tests and source inspections do not replace a full build, PostgreSQL or Windows runtime.
