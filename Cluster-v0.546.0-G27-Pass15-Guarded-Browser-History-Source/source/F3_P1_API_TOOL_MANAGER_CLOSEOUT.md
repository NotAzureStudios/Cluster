# Cluster 1.0 F3 P1: API Tool Manager integration

## Verified parent

Uploaded: `Cluster-v0.546.0-TD6-G27-Domain-OOBE-Studio-Server-Provisioning-Source(1).zip`, `CURRENT_CHECKPOINT.md` identifies G27 Batch 8 plus later Domain/OOBE provisioning. Original ZIP CRC checked. Source manifest: **3,303/3,303** hashes verified before modifications. Parent source ZIP contains **3,304 entries**. Do not confuse it with the older G27 Batch 3 source evidenced in previous chats.

## Actual implementation in this pass

- **Canonical inventory, not duplicate API registry:** `apps/server/src/core/api-tool-health.ts` projects passive measurements onto `SERVER_DOMAIN_CATALOG`. Most-specific route-root attribution; no overlapping double-counted traffic; unclassified requests reported only in aggregate.
- **Real server integration:** `GET /api/admin/operations/api-tools` is registered in `server-routes-health-operations.ts`, gated by `requireAdminUserForRequest`, marked `private, no-store`, and added to OpenAPI inventory. It reads the *existing* `RuntimeTelemetry.routeMetricsSnapshot()`; no request to database or every service on each admin read.
- **Bounded metrics:** Up to the existing 96 route buckets. Counts/5xx are since server start; percentiles are based on bounded per-route recent latency observations (normally 256). Classification requires 20 total requests. A single low-sample route cannot trigger whole-tool degraded status.
- **Visible UI:** Operations → Systems & Integrations presents sortable Tool Manager columns (name, observed posture, routes, request volume, HTTP 5xx, error rate, worst route p95, sampled route evidence) and independent search/filter. 30-second visible refresh reuses the panel's existing cadence. Individual API Manager fetch failure does not blank the other Systems sections.
- **Privacy fix:** Failed/unmatched routes are recorded as `/unmatched` rather than raw request URLs, preventing user-provided path segments/query strings from entering per-route telemetry via a fallback.

## Validation run

- `node tools/scripts/cluster-td6-g27-api-tool-manager-tests.mjs`: **40/40**.
- Domain connection network: **139** checks, Domain OOBE: **26**, Domain registry: **27**, Domain lifecycle: **32**, config recovery: **16**.
- G27 announcement: creation **19**, navigation **13**, reload recovery **9**.
- `node tools/scripts/cluster-td6-source-scan.mjs`: **1,117 TS/TSX syntax, 3,258 renderer imports, 110 CSS files; no detected errors**.
- Original source has no `node_modules`, and full TypeScript build/Prisma generation/real PostgreSQL/Windows and GUI smoke tests were NOT run. Code must be built and exercised in deployment environment.

## Does NOT claim

- HTTP success is not verified tool integrity. `no-observations` is not offline, `observed-healthy` is not readiness. This is traffic health, *not* active functional probes.
- No durable per-tool history, ownership/escalation, scheduled health probes, webhook/email/Discord delivery, restart automation, service supervision or Garnet operational validation yet.
- Previous F3/F4 stand-alone policy library remains **separate**, not copied blindly into the application.
- No service mutations, third-party installations, public port exposure or Windows firewall operations are performed by this endpoint.

## Acceptance boundary

An authenticated admin can inspect passive metrics for all registered tool domains in the existing Systems panel without causing diagnostic request fanout or showing user-provided URLs; a non-admin cannot retrieve the route. Live authentication, request telemetry and UI network behavior are **not yet certified**.
