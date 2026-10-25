import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");
const checks = [];
const failures = [];
function check(label, ok, detail = "") { checks.push({ label, ok, detail }); if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`); }

const versions = JSON.parse(await read("config/toolchain-versions.json"));
const contracts = await read("packages/shared/src/api-contracts.ts");
const schemas = await read("packages/shared/src/api-schemas.ts");
const prisma = await read("apps/server/prisma/schema.prisma");
const migration = await read("apps/server/prisma/migrations/20260820150000_operations_performance_overhaul/migration.sql");
const repository = await read("apps/server/src/domains/notifications/notification-repository.ts");
const service = await read("apps/server/src/domains/notifications/notification-service.ts");
const routes = await read("apps/server/src/domains/notifications/notification-routes.ts");
const inbox = await read("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const center = await read("packages/renderer/src/features/notifications/NotificationCenterPage.tsx");
const shell = await read("packages/renderer/src/features/application/modules/application-shell.tsx");
const retention = await read("apps/server/src/core/data-retention.ts");
const erasure = await read("apps/server/src/core/privacy-erasure.ts");
const privacyRoutes = await read("apps/server/src/domains/legal/privacy-data-routes.ts");
const privacyControl = await read("apps/server/src/core/privacy-data-control.ts");
const storage = await read("apps/server/src/core/storage-migrations.ts");
const budgets = await read("apps/server/src/core/performance-budgets.ts");
const telemetry = await read("apps/server/src/core/runtime-telemetry.ts");
const db = await read("apps/server/src/core/database-diagnostics.ts");
const opsRoutes = await read("apps/server/src/app/server-routes-health-operations.ts");
const perfPanel = await read("packages/renderer/src/features/operations/ServerPerformancePanel.tsx");
const adminOps = await read("packages/renderer/src/features/operations/modules/operations-admin.tsx");
const openapi = await read("apps/server/src/core/openapi.ts");
const app = await read("apps/server/src/app/cluster-server.ts");
const pkg = JSON.parse(await read("package.json"));
const packager = await read("tools/scripts/package-cluster-master.mjs");
const docs = await read("docs/OPERATIONS_PERFORMANCE_OVERHAUL.md");
const notes = await read("RELEASE_NOTES_v0.387.0.md");
const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");

check("Step 6 release evidence remains represented", notes.includes("Core Product & Architecture Roadmap Step 6 of 7") && changelog.includes('version: "v0.387.0"'));
check("Step 6 API contract is current", contracts.includes('version: "2026-08-02.63"'));
for (const capability of ["work-inbox-v2", "operations-observability-v2", "performance-budgets-v1", "postgresql-scalability-v2"]) check(`capability ${capability} is advertised`, contracts.includes(`"${capability}"`));
check("notifications domain is v2", contracts.includes("notifications: 2"));
check("diagnostics domain is v6", contracts.includes("diagnostics: 6"));
check("database domain is v3", contracts.includes("database: 3"));
check("privacy domain is v6", contracts.includes("privacy: 6"));

check("durable notification inbox model exists", prisma.includes("model NotificationInboxItem") && prisma.includes("notificationInboxItems NotificationInboxItem[]"));
check("notification delivery is idempotent per user/activity", prisma.includes("@@unique([userId, activityEventId])") && repository.includes("userId_activityEventId"));
for (const token of ["readAt", "dismissedAt", "snoozedUntil", "priority", "category", "projectId"]) check(`notification inbox stores ${token}`, prisma.includes(token));
check("notification inbox has user-state indexes", prisma.includes("@@index([userId, readAt, createdAt])") && prisma.includes("@@index([userId, snoozedUntil, createdAt])") && prisma.includes("@@index([userId, priority, createdAt])"));
check("notification migration creates the inbox table", migration.includes('CREATE TABLE "NotificationInboxItem"'));
check("notification migration creates ActivityEvent access indexes", migration.includes('ActivityEvent_cardId_createdAt_idx') && migration.includes('ActivityEvent_type_createdAt_idx') && migration.includes('ActivityEvent_entityType_createdAt_idx'));
check("startup schema verification requires notification indexes", storage.includes("NotificationInboxItem_userId_readAt_createdAt_idx") && storage.includes("ActivityEvent_cardId_createdAt_idx"));

check("notification service projects domain activity", service.includes('subscribe("activity.recorded"') && service.includes("materialize(domainEvent.payload)"));
check("historical notification backfill is marked read", service.includes("materialize(event, { historical: true })") && repository.includes("readAt: input.readAt"));
check("notification recipient projection supports card assignment", repository.includes("event.card?.assigneeId"));
check("notification recipient projection supports bounded mentions", repository.includes("mentionTokens") && repository.includes("take: 5_000"));
check("notification recipient projection supports explicit broadcast", repository.includes("meta.broadcast === true"));
check("notification service classifies critical priority", service.includes('priority = "critical"'));
check("notification API exposes durable summary", routes.includes('/api/notifications/summary'));
check("notification API exposes digest", routes.includes('/api/notifications/digest'));
check("notification API exposes read state", routes.includes('/api/notifications/read'));
check("notification API exposes dismiss and restore", routes.includes('/api/notifications/dismiss') && routes.includes('/api/notifications/restore'));
check("notification API exposes snooze", routes.includes('/api/notifications/snooze'));
check("notification snooze schema is bounded", schemas.includes("notificationSnoozeMutationSchema") && schemas.includes("datetime"));
check("live notification page is server-backed", inbox.includes('/api/notifications?') && inbox.includes('/api/notifications/read') && inbox.includes('/api/notifications/snooze'));
check("notification center delegates to v387 inbox", center.includes("<NotificationInboxPage"));
check("application shell badge uses summary-only endpoint", shell.includes('/api/notifications/summary'));
check("application shell no longer reconstructs notification feed", !shell.includes('makeNotificationRows') && !shell.includes('highestNotificationSeverity'));

check("notification inbox has retention policy", retention.includes('key: "notification_inbox"') && retention.includes("defaultDays: 180") && retention.includes("maximumDays: 730"));
check("notification inbox is erased with account privacy fulfillment", erasure.includes('"notificationInboxItem"'));
check("notification inbox appears in privacy inventory", privacyRoutes.includes('id: "notification-inbox"'));
check("notification inbox appears in privacy export", privacyRoutes.includes("notificationInboxItem.findMany") && privacyRoutes.includes("notificationInbox"));
check("privacy export schema advanced to v4", privacyControl.includes("PRIVACY_EXPORT_SCHEMA_VERSION = 4"));

for (const key of ["requestP95Ms", "requestP99Ms", "requestErrorRate", "eventLoopP95Ms", "databaseP95Ms", "databaseP99Ms", "postgresCacheHitRatio", "postgresIndexScanRatio", "postgresLockWaits", "postgresDeadRowRatio", "deadLetterJobs"]) check(`performance budget defines ${key}`, budgets.includes(`${key}:`));
check("performance budgets expose pass warn fail", budgets.includes('"pass" | "warn" | "fail" | "unknown"') && budgets.includes("failures") && budgets.includes("warnings"));
check("idle PostgreSQL statistics do not create fake failures", budgets.includes("blockSamples > 0 ? workload.cacheHitRatio : null") && budgets.includes("scanSamples > 0 ? workload.indexScanRatio : null"));
check("request telemetry records p50 p95 p99", telemetry.includes("p50Ms") && telemetry.includes("p95Ms") && telemetry.includes("p99Ms"));
check("database telemetry records p50 p95 p99", db.includes("p50Ms") && db.includes("p95Ms") && db.includes("p99Ms"));
check("database telemetry groups hot route queries", db.includes("const grouped = new Map") && db.includes("groups,"));
check("PostgreSQL diagnostics expose user table pressure", db.includes("pg_stat_user_tables") && db.includes("modifiedSinceAnalyze"));
check("PostgreSQL diagnostics expose index usage", db.includes("pg_stat_user_indexes") && db.includes("indexes:"));
check("PostgreSQL diagnostics generate recommendations", db.includes("recommendations.push") && db.includes("autovacuum"));
check("operations health includes performance budgets", opsRoutes.includes("performanceBudgets") && opsRoutes.includes("assessServerPerformance"));
check("operations exposes performance endpoint", opsRoutes.includes('/api/admin/operations/performance'));
check("operations exposes database endpoint", opsRoutes.includes('/api/admin/operations/database'));
check("performance endpoint requires admin", opsRoutes.includes("const admin = await requireAdminUserForRequest(request, reply)"));
check("performance endpoint is no-store", opsRoutes.includes('reply.header("Cache-Control", "no-store")'));
check("renderer has server performance panel", perfPanel.includes("Server performance") && perfPanel.includes('/api/admin/operations/performance'));
check("renderer shows budgets and query pressure", perfPanel.includes("server-performance-budgets-v387") && perfPanel.includes("Hot queries") && perfPanel.includes("Table pressure"));
check("admin operations owns server performance panel", adminOps.includes("<ServerPerformancePanel"));

for (const route of ["/api/notifications/summary", "/api/notifications/digest", "/api/notifications/snooze", "/api/admin/operations/performance", "/api/admin/operations/database"]) check(`OpenAPI documents ${route}`, openapi.includes(`"${route}"`));
check("notification service is registered in server composition", app.includes("createNotificationService") && app.includes("notificationService.initialize()"));

check("Step 6 documentation exists", docs.includes("Core Product & Architecture Roadmap Step 6 of 7"));
check("Step 6 release notes exist", notes.includes("Core Product & Architecture Roadmap Step 6 of 7"));
check("Step 6 changelog entry exists", changelog.includes('version: "v0.387.0"'));
check("Step 6 audit is release-blocking", String(pkg.scripts.audit || "").includes("operations-performance-audit.mjs"));
check("Step 6 audit has named script", pkg.scripts["audit:operations-performance"] === "node tools/scripts/operations-performance-audit.mjs");
check("master packager runs Step 6 audit", packager.includes("operations-performance-audit.mjs"));
check("master packager includes Step 6 documentation", packager.includes("docs/OPERATIONS_PERFORMANCE_OVERHAUL.md") && packager.includes("RELEASE_NOTES_v0.387.0.md"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster operations & performance audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
