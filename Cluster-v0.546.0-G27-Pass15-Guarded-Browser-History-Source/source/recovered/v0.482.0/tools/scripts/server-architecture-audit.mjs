import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const serverRoot = path.join(root, "apps", "server", "src");
const checks = [];
const failures = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}
async function exists(relative) { try { await access(path.join(root, relative)); return true; } catch { return false; } }
async function text(relative) { return readFile(path.join(root, relative), "utf8"); }
async function filesUnder(directory) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else out.push(absolute);
    }
  }
  await walk(directory);
  return out;
}
function relativeServer(file) { return path.relative(serverRoot, file).replaceAll(path.sep, "/"); }

const required = [
  "apps/server/src/app/server-domain-catalog.ts",
  "apps/server/src/app/server-job-runtime.ts",
  "apps/server/src/domains/jobs/job-types.ts",
  "apps/server/src/domains/jobs/job-queue-service.ts",
  "apps/server/src/domains/jobs/job-worker.ts",
  "apps/server/src/domains/jobs/job-routes.ts",
  "apps/server/src/domains/admin/server-architecture-routes.ts",
  "apps/server/src/domains/library/library-routes.ts",
  "apps/server/src/domains/time/time-routes.ts",
  "apps/server/src/domains/admin/admin-tool-routes.ts",
  "apps/server/prisma/migrations/20260820080000_backend_architecture_jobs/migration.sql",
  "docs/BACKEND_ARCHITECTURE_OVERHAUL.md",
];
for (const file of required) check(`required ${file}`, await exists(file));

const serverEntry = await text("apps/server/src/app/cluster-server.ts");
const domainCatalog = await text("apps/server/src/app/server-domain-catalog.ts");
const jobRuntime = await text("apps/server/src/app/server-job-runtime.ts");
const jobQueue = await text("apps/server/src/domains/jobs/job-queue-service.ts");
const jobWorker = await text("apps/server/src/domains/jobs/job-worker.ts");
const jobRoutes = await text("apps/server/src/domains/jobs/job-routes.ts");
const architectureRoutes = await text("apps/server/src/domains/admin/server-architecture-routes.ts");
const schema = await text("apps/server/prisma/schema.prisma");
const storage = await text("apps/server/src/core/storage-migrations.ts");
const events = await text("apps/server/src/core/domain-events.ts");
const apiContracts = await text("packages/shared/src/api-contracts.ts");
const openapi = await text("apps/server/src/core/openapi.ts");

check("server entrypoint remains bounded", Buffer.byteLength(serverEntry, "utf8") <= 70 * 1024, `${Buffer.byteLength(serverEntry, "utf8")} bytes`);
check("server entrypoint remains composition-sized", serverEntry.split(/\r?\n/).length <= 1_800, `${serverEntry.split(/\r?\n/).length} lines`);
check("server entrypoint owns jobs through a composition module", serverEntry.includes('createServerJobRuntime') && serverEntry.includes('new BackgroundJobQueue') && !serverEntry.includes('new DurableJobWorker') && serverEntry.includes('queue: jobQueue'));
check("server entrypoint imports library time and admin from owned domains",
  serverEntry.includes('../domains/library/library-routes.js') &&
  serverEntry.includes('../domains/time/time-routes.js') &&
  serverEntry.includes('../domains/admin/admin-tool-routes.js'));

for (const [relative, target] of [
  ["apps/server/src/routes/library-routes.ts", "../domains/library/library-routes.js"],
  ["apps/server/src/routes/time-routes.ts", "../domains/time/time-routes.js"],
  ["apps/server/src/routes/admin-tool-routes.ts", "../domains/admin/admin-tool-routes.js"],
]) {
  const source = await text(relative);
  check(`${relative} remains a thin compatibility barrel`, Buffer.byteLength(source, "utf8") <= 160 && source.includes(target), `${Buffer.byteLength(source, "utf8")} bytes`);
}

const legacyRouteDirectory = path.join(root, "apps", "server", "src", "routes");
const legacyRouteFiles = (await readdir(legacyRouteDirectory)).filter((file) => file.endsWith(".ts"));
for (const file of legacyRouteFiles) {
  const source = await readFile(path.join(legacyRouteDirectory, file), "utf8");
  check(`legacy route ${file} is compatibility-only`, Buffer.byteLength(source, "utf8") <= 180 && /^export \* from "\.\.\/domains\//.test(source.trim()), `${Buffer.byteLength(source, "utf8")} bytes`);
}

check("server domain catalog owns major product boundaries",
  ["auth", "access", "users", "projects", "boards", "library", "time", "search", "notifications", "automation", "jobs", "legal", "admin"]
    .every((key) => domainCatalog.includes(`key: "${key}"`)) && domainCatalog.includes("serverDomainCatalogSnapshot"));
check("admin architecture endpoint exposes domain event and job posture",
  architectureRoutes.includes('/api/admin/architecture/domains') && architectureRoutes.includes('eventBus.snapshot()') && architectureRoutes.includes('jobQueue.counts()'));

check("durable job schema stores leases retries cancellation progress and attempts",
  schema.includes("model BackgroundJob {") && schema.includes("leaseExpiresAt") && schema.includes("cancelRequestedAt") &&
  schema.includes("maxAttempts") && schema.includes("progressMessage") && schema.includes("model BackgroundJobAttempt {") &&
  storage.includes('"BackgroundJob"') && storage.includes('"BackgroundJobAttempt"'));
check("job claim is PostgreSQL lease based and concurrency safe",
  jobQueue.includes("FOR UPDATE SKIP LOCKED") && jobQueue.includes('"leaseExpiresAt"') && jobQueue.includes('"attempts" < "maxAttempts"'));
check("job queue has dedupe retry dead-letter cancellation and bounded payloads",
  jobQueue.includes("dedupeKey") && jobQueue.includes("DEAD_LETTER") && jobQueue.includes("retry(jobId") && jobQueue.includes("cancel(jobId") &&
  jobQueue.includes("MAX_PAYLOAD_BYTES") && jobQueue.includes("MAX_RESULT_BYTES"));
check("manual retries preserve monotonic attempt evidence and running cancellation wins",
  !jobQueue.includes('"attempts" = 0') &&
  jobQueue.includes('"maxAttempts" = LEAST(100, "attempts" + LEAST(5, GREATEST("maxAttempts", 1)))') &&
  jobQueue.includes('cancelled ? "CANCELLED" : terminal ? "DEAD_LETTER" : "QUEUED"') &&
  jobQueue.includes('cancelled ? "CANCELLED" : "FAILED"'));
check("durable worker heartbeats and exposes bounded concurrency metrics",
  jobWorker.includes("heartbeat(job.id") && jobWorker.includes("concurrency") && jobWorker.includes("snapshot(): DurableJobWorkerSnapshot") && jobWorker.includes("registeredTypes"));
check("existing automation work is migrated behind durable jobs",
  jobRuntime.includes('automation.project-overdue') && jobRuntime.includes('automation.studio-action') &&
  jobRuntime.includes('durable-job-worker') && jobRuntime.includes('system.job-history-prune'));
check("job administration is read inspect retry and cancel only",
  jobRoutes.includes('app.get("/api/admin/operations/jobs"') &&
  jobRoutes.includes('app.get("/api/admin/operations/jobs/:jobId"') &&
  jobRoutes.includes('/retry"') && jobRoutes.includes('/cancel"') &&
  !jobRoutes.includes('app.post("/api/admin/operations/jobs"'));
check("domain event bus exposes metrics without weakening strict publish semantics",
  events.includes("handlerInvocations") && events.includes("publishBestEffort") && events.includes("snapshot()") && events.includes("throw new AggregateError"));
check("API contract advertises backend architecture and durable jobs",
  apiContracts.includes('server-domain-architecture-v1') && apiContracts.includes('durable-background-jobs-v1') &&
  apiContracts.includes('jobs: 1') && apiContracts.includes('architecture: 1') && apiContracts.includes('2026-08-02.63'));
check("OpenAPI documents backend architecture and job operations",
  openapi.includes('/api/admin/operations/jobs') && openapi.includes('/api/admin/architecture/domains') && openapi.includes('{ name: "Jobs" }'));

const tsFiles = (await filesUnder(serverRoot)).filter((file) => file.endsWith(".ts"));
for (const file of tsFiles) {
  const info = await stat(file);
  const source = await readFile(file, "utf8");
  check(`server file budget ${relativeServer(file)}`, info.size <= 80 * 1024 && source.split(/\r?\n/).length <= 2_500, `${info.size} bytes / ${source.split(/\r?\n/).length} lines`);
}

const graph = new Map();
const resolveImport = (from, specifier) => {
  if (!specifier.startsWith(".")) return null;
  let absolute = path.resolve(path.dirname(from), specifier);
  if (absolute.endsWith(".js")) absolute = absolute.slice(0, -3) + ".ts";
  else if (!path.extname(absolute)) absolute += ".ts";
  return absolute;
};
const missingRelativeImports = [];
for (const file of tsFiles) {
  const source = await readFile(file, "utf8");
  const imports = [];
  for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
    const target = resolveImport(file, match[1]);
    if (!target) continue;
    if (tsFiles.includes(target)) imports.push(target);
    else if (!match[1].includes("/generated/prisma/")) missingRelativeImports.push(`${relativeServer(file)} -> ${match[1]}`);
  }
  graph.set(file, imports);
}
check("server relative imports resolve to source modules", missingRelativeImports.length === 0, missingRelativeImports[0] || "");
const visiting = new Set();
const visited = new Set();
const cycles = [];
function visit(file, stack = []) {
  if (visiting.has(file)) {
    const index = stack.indexOf(file);
    cycles.push([...stack.slice(index), file].map(relativeServer));
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) || []) visit(target, [...stack, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of tsFiles) visit(file);
check("server relative-import graph is cycle free", cycles.length === 0, cycles[0]?.join(" -> ") || "");

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster server architecture audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
