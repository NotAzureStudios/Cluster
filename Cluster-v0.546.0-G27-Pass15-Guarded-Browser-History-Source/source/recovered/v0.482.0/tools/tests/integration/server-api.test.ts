import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { spawnPortableSync } from "../../scripts/command-invocation.mjs";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const serverRoot = path.join(root, "apps/server");
const prismaConfig = path.join(root, "prisma.config.ts");
const expectedVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version as string;
const basePostgresUrl = process.env.CLUSTER_TEST_DATABASE_URL?.trim() || "";
function isolatedPostgresUrl(label: string) {
  const url = new URL(basePostgresUrl);
  url.searchParams.set("schema", `cluster_test_${label}_${process.pid}_${randomUUID().replaceAll("-", "")}`);
  return url.toString();
}


async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnPortableSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.\n${result.stdout || ""}\n${result.stderr || ""}`);
}

async function waitForHealth(baseUrl: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Cluster server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Cluster server did not become healthy within 30 seconds.");
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0];
}

const integrationTest = basePostgresUrl && process.env.CLUSTER_SKIP_PRISMA_INTEGRATION !== "1" ? test : test.skip;

integrationTest("v0.281 API contracts, pagination, sync conflicts, and diagnostics behave end to end", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-v281-integration-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("server_api_v281");
  await mkdir(path.dirname(configFile), { recursive: true });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const webOrigin = "http://localhost:3000";
  const env = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    WEB_ORIGIN: webOrigin,
    DATABASE_URL: databaseUrl,
    CLUSTER_DATA_DIR: dataRoot,
    CLUSTER_CONFIG_FILE: configFile,
    CLUSTER_AUTO_SEED: "true",
    CLUSTER_REQUIRE_AUTH: "true",
    CLUSTER_DEV_LOGIN: "true",
    CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
    CLUSTER_RATE_LIMIT: "false",
    CLUSTER_SECURITY_HEADERS: "true",
    CLUSTER_SECRET_KEY: "cluster-v281-integration-secret-key",
    SESSION_SECRET: "cluster-v281-cookie-secret",
    SESSION_SECURE: "false",
    CLUSTER_LOG_LEVEL: "silent",
  };

  const npx = "npx";
  run(npx, ["prisma", "migrate", "deploy", "--config", prismaConfig], env);

  const child = spawn(process.execPath, ["dist/index.js"], { cwd: serverRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });

  try {
    await waitForHealth(baseUrl, child);

    const openApi = await fetch(`${baseUrl}/api/meta/openapi.json`);
    assert.equal(openApi.status, 200);
    const openApiBody = await openApi.json() as any;
    assert.equal(openApiBody.openapi, "3.1.0");
    assert.equal(openApiBody.info["x-cluster-version"], expectedVersion);
    assert.ok(openApiBody.paths["/api/sync/conflicts"]);

    const compatibility = await fetch(`${baseUrl}/api/meta/compatibility?clientVersion=0.280.0`);
    assert.equal(compatibility.status, 200);
    assert.equal((await compatibility.json() as any).compatible, true);

    const login = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);

    const users = await fetch(`${baseUrl}/api/users?paged=true&limit=1`, { headers: { Cookie: cookie } });
    assert.equal(users.status, 200);
    const userPage = await users.json() as any;
    assert.equal(Array.isArray(userPage.items), true);
    assert.equal(typeof userPage.hasMore, "boolean");

    const deviceId = randomUUID();
    const registration = await fetch(`${baseUrl}/api/sync/devices/register`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, name: "Integration device", platform: process.platform, clientVersion: expectedVersion }),
    });
    assert.equal(registration.status, 200);

    const batch = await fetch(`${baseUrl}/api/sync/batch`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        clientVersion: expectedVersion,
        mutations: [{
          id: "unsupported-schema",
          idempotencyKey: "integration-unsupported-schema-0001",
          method: "PATCH",
          path: "/api/me/preferences",
          schemaVersion: 2,
          body: { theme: "dark" },
        }],
      }),
    });
    assert.equal(batch.status, 200);
    const batchBody = await batch.json() as any;
    assert.equal(batchBody.results[0].quarantined, true);
    assert.ok(batchBody.results[0].conflictId);

    const conflicts = await fetch(`${baseUrl}/api/sync/conflicts?deviceId=${deviceId}&status=QUARANTINED`, { headers: { Cookie: cookie } });
    assert.equal(conflicts.status, 200);
    const conflictPage = await conflicts.json() as any;
    assert.equal(conflictPage.items.length, 1);
    assert.equal(conflictPage.items[0].classification, "UNSUPPORTED_SCHEMA");

    const resolution = await fetch(`${baseUrl}/api/sync/conflicts/${conflictPage.items[0].id}/resolve`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discard" }),
    });
    assert.equal(resolution.status, 200);
    assert.equal((await resolution.json() as any).conflict.status, "RESOLVED");

    const diagnostics = await fetch(`${baseUrl}/api/admin/database/diagnostics`, { headers: { Cookie: cookie } });
    assert.equal(diagnostics.status, 200);
    const diagnosticsBody = await diagnostics.json() as any;
    assert.equal(diagnosticsBody.ok, true);
    assert.equal(diagnosticsBody.database.provider, "postgresql");
    assert.equal(Array.isArray(diagnosticsBody.queries.slowest), true);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster v0.281 integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
