# Cluster v0.521 → v0.522 handoff

Use `Cluster-v0.522.zip` as the source baseline. v0.521 remains in `Cluster-v0.521.zip` and `deltas/`. Read `FEATURE_PROGRESS_0522.md` and `CLUSTER_0522_VALIDATION_RESULTS.md` for exactly what was source-implemented and tested.

**Next connected batch:** Package server-issued short-lived activation authorization bound to the authenticated Desktop device, trusted native installer applying only to explicitly managed roots with OS-level repair/rollback, and actual Windows + PostgreSQL source-to-runtime certification. Add audio/video Packet derivatives only with safe, bounded transcoding and an actual runtime test matrix. Finish collaboration/Undo-Redo and Library/Admin feature ledger. Maintain source-vs-distribution authority. Do not add legacy aliases to compensate for missing clients.

**Important:** v0.522 adds opt-in source PDF rasterization with native PDF/canvas dependencies; the source tests mock them. Do not claim production PDF safety or functionality until the real native decoder and a hostile-file corpus have been exercised in sandboxed workers and Windows. Source-level Go stage auditing is not device attestation.
