import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { spawnPortableSync } from "../../scripts/command-invocation.mjs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const serverRoot = path.join(root, "apps/server");
const prismaConfig = path.join(root, "prisma.config.ts");
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

integrationTest("v0.318 client state and whiteboard production metadata are server authoritative", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-v318-client-state-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("client_state_v318");
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
    CLUSTER_SECRET_KEY: "cluster-v318-client-state-secret-key",
    SESSION_SECRET: "cluster-v318-client-state-cookie-secret",
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
    const login = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    const readHeaders = { Cookie: cookie };
    const mutationHeaders = { ...readHeaders, Origin: webOrigin, "Content-Type": "application/json" };

    const emptyResponse = await fetch(`${baseUrl}/api/client-state/user/dashboard.widgets`, { headers: readHeaders });
    assert.equal(emptyResponse.status, 200);
    assert.equal((await emptyResponse.json() as { record: unknown }).record, null);

    const createResponse = await fetch(`${baseUrl}/api/client-state/user/dashboard.widgets`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: [{ id: "health", size: "wide" }], expectedRevision: 0 }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { record: { revision: number; payload: Array<{ id: string }> } };
    assert.equal(created.record.revision, 1);
    assert.equal(created.record.payload[0]?.id, "health");

    const updateResponse = await fetch(`${baseUrl}/api/client-state/user/dashboard.widgets`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: [{ id: "health", size: "compact" }], expectedRevision: 1 }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json() as { record: { revision: number } }).record.revision, 2);

    const staleResponse = await fetch(`${baseUrl}/api/client-state/user/dashboard.widgets`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: [], expectedRevision: 1 }),
    });
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json() as { code?: string }).code, "REVISION_CONFLICT");

    const migrationResponse = await fetch(`${baseUrl}/api/client-state/migrate`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ records: [
        { scope: "user", key: "dashboard.widgets", payload: [{ id: "must-not-overwrite" }] },
        { scope: "user", key: "search.saved", payload: [{ id: "release" }] },
      ] }),
    });
    assert.equal(migrationResponse.status, 200);
    const migration = await migrationResponse.json() as { created: number; records: Array<{ key: string; revision: number }> };
    assert.equal(migration.created, 1);
    assert.equal(migration.records.find((record) => record.key === "dashboard.widgets")?.revision, 2);

    const studioResponse = await fetch(`${baseUrl}/api/client-state/studio/operations.maintenance`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: [{ id: "maintenance-1", summary: "Database vacuumed" }], expectedRevision: 0 }),
    });
    assert.equal(studioResponse.status, 201);

    const oversizedResponse = await fetch(`${baseUrl}/api/client-state/user/oversized.test`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: "x".repeat(257 * 1024), expectedRevision: 0 }),
    });
    assert.equal(oversizedResponse.status, 413);
    assert.equal((await oversizedResponse.json() as { code?: string }).code, "CLIENT_STATE_TOO_LARGE");

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ name: "Server Authority Integration", projectType: "generic", status: "active", createDefaultBoard: false }),
    });
    assert.equal(projectResponse.status, 200);
    const project = await projectResponse.json() as { id: string };

    const productionLinks = {
      elementA: {
        elementId: "elementA",
        reviewState: "in-review",
        linkedKind: "milestone",
        linkedId: "milestone-a",
        linkedLabel: "Vertical slice",
        updatedAt: new Date().toISOString(),
        comments: [],
      },
    };
    const whiteboardResponse = await fetch(`${baseUrl}/api/whiteboards`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ name: "Production map", projectId: project.id, elements: [], productionLinks }),
    });
    assert.equal(whiteboardResponse.status, 200);
    const whiteboard = await whiteboardResponse.json() as { id: string; revision: number; productionLinks: typeof productionLinks };
    assert.equal(whiteboard.productionLinks.elementA.linkedLabel, "Vertical slice");

    const whiteboardUpdate = await fetch(`${baseUrl}/api/whiteboards/${whiteboard.id}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({
        productionLinks: { ...productionLinks, elementA: { ...productionLinks.elementA, reviewState: "approved" } },
        expectedRevision: whiteboard.revision,
      }),
    });
    assert.equal(whiteboardUpdate.status, 200);
    const updatedWhiteboard = await whiteboardUpdate.json() as { revision: number; productionLinks: { elementA: { reviewState: string } } };
    assert.equal(updatedWhiteboard.revision, whiteboard.revision + 1);
    assert.equal(updatedWhiteboard.productionLinks.elementA.reviewState, "approved");

    const staleWhiteboardUpdate = await fetch(`${baseUrl}/api/whiteboards/${whiteboard.id}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ productionLinks: {}, expectedRevision: whiteboard.revision }),
    });
    assert.equal(staleWhiteboardUpdate.status, 409);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster v0.318 integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
