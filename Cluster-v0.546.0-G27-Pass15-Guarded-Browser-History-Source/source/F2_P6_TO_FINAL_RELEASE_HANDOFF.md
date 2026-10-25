# Cluster 1.0 | F2 P6 continuation and acceptance gates

**Authoritative source parent for future passes:** `Cluster-v0.546.0-F2-P6-Network-Deployment-Auto-Rollback-Source.zip`. The prior F2 P5 file must not be used as a development parent after this pass.

## Next focused implementation work
1. Add an authorized, native offline recovery/cancel interface for a stuck staging record without bypassing operator permissions. Do not let a web app that is unreachable be the only way to recover its own configuration.
2. Validate real service-account ACLs, Windows 10 SCM boot/shutdown/recovery, transactional reconfiguration and native file replacement on Windows NTFS, including antivirus-lock behavior and actual Job Object descendant containment. Eliminate the inherited pointer vet warnings only with equivalent Windows runtime tests.
3. Implement network deployment service pre/postflight with a clearly separate operator-confirmed **external** TLS/DNS/firewall/client reachability gate (do not SSRF scan arbitrary URLs from the privileged service). Real dual-port checking and firewall preview must remain explicit and authorized.
4. Finish scheduled maintenance, bounded repairs, update policy, notification quiet hours, assigned on-call escalation, Garnet probe/fallback and full API Tool Manager readiness certification.
5. Source-close remaining CD-01–CD-20, TD7 cleanup and genuine release-blocking UI defects.

## Hard pre-1.0 certification
- Windows 10 22H2 / appropriate security update coverage and supported Windows edition, native Host/Service/Win32 + pinned Go1.27.1, Node24 runtime/Prisma, PostgreSQL 18 migrations and rollback fault injection. Ensure network service stops safely and can recover after corrupt/changed configs.
- Independent client HTTPS/TLS/domain reachability on the actual server, backups and restore drills, Postgres and Garnet local-only binding, and full network firewall exposure review.
- No production-ready claim until Windows-runtime tests, pinned toolchain builds, live database, storage fault injection and upstream dependency checks actually pass.
