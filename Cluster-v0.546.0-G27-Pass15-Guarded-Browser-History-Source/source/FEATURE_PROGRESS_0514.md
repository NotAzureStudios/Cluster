# Cluster v0.514.0 | Trusted device Package delivery and archive validation

**Feature development only.** Direct continuation of the authoritative Pass 15 merged v0.513 source. Native installers, workstation trust anchors and PostgreSQL runtime certification remain unimplemented/unverified by request.

## Implemented

1. **Device-bound signed Package target feed:** `/api/me/packages/targets` returns only active, platform-matched, cryptographically verified releases selected by the current rollout cohort or active device-specific pin. Requires an authenticated session, verified asymmetric request proof bound to the same Device Registration and matching proof fingerprint, and a nonrevoked desktop registration. No arbitrary device ID lookup or cross-user targeting, no archived/revoked packages, no disabled trusted signing keys, and no raw ZIP bytes in the feed.
2. **Verified device download:** `/api/me/packages/:id/releases/:releaseId/download` (POST) re-evaluates the current rollout, package/release/key status and revocation inside a Serializable database transaction. It re-verifies the stored signed ZIP bytes and manifests at delivery time, logs an audit event tagged to the registered device, and returns the content hash. **Download is not installation**. No native installation, execution or attestable installation receipts are implemented. The native agent must enforce its independently provisioned signing trust root, sandboxed extraction, activation, rollback and receipt verification.
3. **Managed ZIP validation:** central/local header consistency, actual bounded decompression for supported methods, CRC validation of every entry, duplicate/overlapping local record protection, rejection of unsafe/unsupported ZIP data descriptors and directory payloads. Existing limits continue to apply.
4. **Device lifecycle:** individual user/admin device revocation now revokes sessions, device registration and active Package pins atomically. Failed pin changes roll back the transaction; session invalidation notifications happen only after commit.
5. **Operator UX:** Packages panel displays recent server-side distribution audit evidence without claiming any installation occurred. Admin targeting preview now rejects archived packages.

## Verification

31/31 source/mocked-route regression suites passed. New 29/29 device feed/ZIP/security assertions and 3/3 device revocation transaction/UI assertions passed. The 40 older Package and 11 Packet PDF checks remain green. See `CLUSTER_0514_REGRESSION_RESULTS.txt` and `CLUSTER_0514_VALIDATION_RESULTS.md`.

**Certification deferred:** Node 24 dependency-backed TS compile, actual Prisma/Postgres transactions/migrations, running web client, Windows Desktop/native agent, device-proof replay behavior in production, real-world package download/install/rollback, multi-user threat testing, UI/DPI, backup/recovery. This is not a production-ready deployment mechanism.

## Next feature work

- Independently provisioned native device-agent trust and anti-replay device update handshake, hash-backed install/rollback receipts and controlled execution, without trusting arbitrary ZIP payloads.
- Full binary/PDF/media derivative processing with rights, metadata policy and watermarking.
- Collaboration undo/redo and review workflows, Library collections and Calendar overlays, Inventory/Vault and Git/LFS integrations.
