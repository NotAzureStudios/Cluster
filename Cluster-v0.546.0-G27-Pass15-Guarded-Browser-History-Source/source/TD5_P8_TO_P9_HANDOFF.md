# Cluster TD5 P8 → P9 continuation

**Canonical baseline:** `Cluster-v0.546.0-TD5-P8-Acceptance-Output-Security-Source.zip`, direct patch from TD5 P7. TD4 remains source-closed, TD5 active.

## Completed in P8

- Replaced unsanitized child-process output in TD5 disposable PostgreSQL/build acceptance with credential-filtered streaming stdout/stderr.
- Preserved timeout, process-tree shutdown, exit status and diagnostic visibility while preventing common URL/password leaks, even across chunk boundaries.
- Added ten executable P8 checks and reran seventy inherited TD4/TD5 scripts; source scan, integrity manifest and incremental patch verification are included.
- Corrected the formerly stale `CURRENT_CHECKPOINT.md` pointer.

## Mandatory next steps

1. On a controlled disposable test machine, restore and review Node 24.20.0, npm lockfile provenance, installed workspace dependencies and PostgreSQL 18.6. **Never create a guessed lockfile or aim this at a production database.**
2. Run `npm run techdebt:td5:p7:runtime-gate -- --run` with `TD5_CERT_DISPOSABLE=I_UNDERSTAND` and a private `TD5_CERT_DATABASE_URL` pointing to a newly created empty `cluster_td5_cert_*` DB. Review sanitized logs privately; the runner does not certify itself without a successful build and migrations.
3. Fix actual Prisma/TypeScript/migration failures, then run 2+ truly separate worker/server processes with lease contention, crash/restart, event delivery and upload recovery tests.
4. Independently certify Windows native Host/launcher/Qt and NTFS/SMB/NAS/S3. Keep physical disposal/quarantine/tier migration/GC disabled until generation ownership and restoration are proven.

**Uncertified:** full Node 24 compilation; Prisma client; live PostgreSQL 18; native Windows shutdown; S3/SMB/NTFS; destructive storage lifecycle. TD5 is NOT source-closed.
