# Cluster 0.512.1 source validation

- Development-only source checkpoint, not production certification.
- 18/18 focused/inherited source suites completed using local TypeScript loading, including 17 new detached-note assertions and 7 behavioral authorization/integrity route checks.
- TS/TSX parser check: 949 application/package/integration files; 0 parse diagnostics.
- CSS brace check: 108 application files; 0 imbalances.
- New migration `20261008233000_packet_text_derivative_delivery` staged but not applied to live PostgreSQL.
- Full dependency-backed build not performed (lean source lacks dependencies/generated Prisma; local Node 22 is below project-required Node 24.20).
- Native Windows executable/Qt/Go/FFmpeg runtime unchanged. Pass 14/15 authoritative source merge remains open.

## Further validation needed

1. Reconcile authoritative Pass 14/15 sources and generate matching Prisma client using pinned Node/toolchain.
2. Apply migration to fresh PostgreSQL; test same-transaction publication, rollback, bytes streaming, and persistent hash/revision handling.
3. Exercise browsers/Desktop across authenticated sessions: allowed/denied guests, revoked accounts, edited source after publish, large/sensitive files and content tampering.
4. Profile preflight versus publishing races, audit durability and 1 MiB release cap under load.
5. Implement and certify PDF/image/video derivatives, worker retries and entitlement upgrades before general rollout.
