import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("condensed roadmap Step 3 owns durable PostgreSQL jobs and admin operations", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260820080000_backend_architecture_jobs/migration.sql");
  const queue = await read("apps/server/src/domains/jobs/job-queue-service.ts");
  const worker = await read("apps/server/src/domains/jobs/job-worker.ts");
  const routes = await read("apps/server/src/domains/jobs/job-routes.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const openapi = await read("apps/server/src/core/openapi.ts");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model BackgroundJob \{/);
  assert.match(schema, /model BackgroundJobAttempt \{/);
  assert.match(migration, /BackgroundJob_status_runAfter_priority_idx/);
  assert.match(queue, /FOR UPDATE SKIP LOCKED/);
  assert.match(queue, /pg_advisory_xact_lock/);
  assert.match(queue, /DEAD_LETTER/);
  assert.doesNotMatch(queue, /"attempts" = 0/);
  assert.match(queue, /cancelled \? "CANCELLED" : terminal \? "DEAD_LETTER" : "QUEUED"/);
  assert.match(worker, /heartbeat\(job\.id/);
  assert.match(routes, /\/api\/admin\/operations\/jobs\/metrics/);
  assert.match(routes, /\/retry/);
  assert.match(routes, /\/cancel/);
  assert.match(contract, /durable-background-jobs-v1/);
  assert.match(contract, /server-domain-architecture-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(openapi, /\/api\/admin\/operations\/jobs/);
});

test("condensed roadmap Step 3 keeps legacy large routes behind domain-owned compatibility barrels", async () => {
  const server = await read("apps/server/src/app/cluster-server.ts");
  const catalog = await read("apps/server/src/app/server-domain-catalog.ts");
  const libraryBarrel = await read("apps/server/src/routes/library-routes.ts");
  const timeBarrel = await read("apps/server/src/routes/time-routes.ts");
  const adminBarrel = await read("apps/server/src/routes/admin-tool-routes.ts");
  assert.match(server, /domains\/library\/library-routes\.js/);
  assert.match(server, /domains\/time\/time-routes\.js/);
  assert.match(server, /domains\/admin\/admin-tool-routes\.js/);
  assert.doesNotMatch(server, /routes\/library-routes\.js/);
  assert.ok((await stat(path.join(root, "apps/server/src/routes/library-routes.ts"))).size <= 160);
  assert.ok((await stat(path.join(root, "apps/server/src/routes/time-routes.ts"))).size <= 160);
  assert.ok((await stat(path.join(root, "apps/server/src/routes/admin-tool-routes.ts"))).size <= 160);
  assert.match(libraryBarrel, /domains\/library/);
  assert.match(timeBarrel, /domains\/time/);
  assert.match(adminBarrel, /domains\/admin/);
  assert.match(catalog, /key: "jobs"/);
  assert.match(catalog, /key: "library"/);
  assert.match(catalog, /key: "time"/);
});

test("server architecture audit is release-blocking and Step 3 is documented", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const docs = await read("docs/BACKEND_ARCHITECTURE_OVERHAUL.md");
  const notes = await read("RELEASE_NOTES_v0.384.0.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.match(pkg.scripts.audit, /server-architecture-audit\.mjs/);
  assert.equal(pkg.scripts["audit:server-architecture"], "node tools/scripts/server-architecture-audit.mjs");
  const { stdout } = await execFileAsync(process.execPath, ["tools/scripts/server-architecture-audit.mjs"], { cwd: root });
  assert.match(stdout, /Cluster server architecture audit: \d+\/\d+ passed/);
  assert.doesNotMatch(stdout, /^FAIL/m);
  assert.match(docs, /Core Product & Architecture Roadmap Step 3 of 7/);
  assert.match(notes, /Core Product & Architecture Roadmap Step 3 of 7/);
  assert.match(packager, /server-architecture-audit\.mjs/);
});

test("condensed roadmap Step 3 exposes bounded administrator job monitoring", async () => {
  const panel = await read("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx");
  const admin = await read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
  const routes = await read("apps/server/src/domains/jobs/job-routes.ts");
  assert.match(panel, /\/api\/admin\/operations\/jobs\?limit=12/);
  assert.match(panel, /runAction\(job, "cancel"\)/);
  assert.match(panel, /runAction\(job, "retry"\)/);
  assert.match(admin, /<BackgroundJobsPanel \/>/);
  assert.doesNotMatch(routes, /app\.post\("\/api\/admin\/operations\/jobs"/);
});
