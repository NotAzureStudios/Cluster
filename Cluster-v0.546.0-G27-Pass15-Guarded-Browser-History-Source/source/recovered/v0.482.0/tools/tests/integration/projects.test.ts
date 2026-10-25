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

integrationTest("v0.317 Project capabilities and custom fields behave end to end", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-v317-project-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("project_overhaul_v317");
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
    CLUSTER_SECRET_KEY: "cluster-v317-project-secret-key",
    SESSION_SECRET: "cluster-v317-project-cookie-secret",
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
    const mutationHeaders = { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" };

    const createdProjectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ name: "Project Overhaul Integration", projectType: "generic", status: "active", createDefaultBoard: true }),
    });
    assert.equal(createdProjectResponse.status, 200);
    const project = await createdProjectResponse.json() as { id: string; capabilities?: { level?: string; reason?: string } };
    assert.equal(project.capabilities?.level, "manage");
    assert.ok(project.capabilities?.reason);

    const fieldId = "project-release-confidence";
    const now = new Date().toISOString();
    const importedResponse = await fetch(`${baseUrl}/api/custom-fields/definitions/import`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ sourceKey: "integration-v317", records: [{
        id: fieldId,
        label: "Release confidence",
        slug: "release-confidence",
        entity: "project",
        fieldType: "select",
        options: ["Low", "Medium", "High"],
        enabled: true,
        filterable: true,
        viewAccess: "members",
        editAccess: "managers",
        createdAt: now,
        updatedAt: now,
      }] }),
    });
    assert.equal(importedResponse.status, 200);
    const imported = await importedResponse.json() as { records: Array<{ revision: number }> };
    assert.equal(imported.records[0]?.revision, 1);

    const valuePath = `/api/custom-fields/values/project/${encodeURIComponent(project.id)}/${fieldId}`;
    const initialPayload = { id: `project:${project.id}:${fieldId}`, entity: "project", entityId: project.id, projectId: project.id, fieldId, value: "Medium", updatedAt: now };
    const firstValueResponse = await fetch(`${baseUrl}${valuePath}`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: initialPayload }),
    });
    assert.equal(firstValueResponse.status, 200);
    const firstValue = await firstValueResponse.json() as { revision: number };
    assert.equal(firstValue.revision, 1);

    const secondValueResponse = await fetch(`${baseUrl}${valuePath}`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: { ...initialPayload, value: "High" }, expectedRevision: firstValue.revision }),
    });
    assert.equal(secondValueResponse.status, 200);
    assert.equal((await secondValueResponse.json() as { revision: number }).revision, 2);

    const staleValueResponse = await fetch(`${baseUrl}${valuePath}`, {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ payload: { ...initialPayload, value: "Low" }, expectedRevision: firstValue.revision }),
    });
    assert.equal(staleValueResponse.status, 409);
    assert.equal((await staleValueResponse.json() as { code?: string }).code, "REVISION_CONFLICT");

    const valuesResponse = await fetch(`${baseUrl}/api/custom-fields/values?entity=project&entityId=${encodeURIComponent(project.id)}&projectId=${encodeURIComponent(project.id)}`, { headers: { Cookie: cookie } });
    assert.equal(valuesResponse.status, 200);
    const values = await valuesResponse.json() as { records: Array<{ payload: { value: string } }> };
    assert.equal(values.records[0]?.payload.value, "High");

    const bulkValuesResponse = await fetch(`${baseUrl}/api/custom-fields/values/query`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ entity: "project", entries: [{ entityId: project.id, projectId: project.id }] }),
    });
    assert.equal(bulkValuesResponse.status, 200);
    const bulkValues = await bulkValuesResponse.json() as { records: Array<{ payload: { value: string } }>; deniedEntityIds: string[] };
    assert.equal(bulkValues.records[0]?.payload.value, "High");
    assert.deepEqual(bulkValues.deniedEntityIds, []);

    const usageResponse = await fetch(`${baseUrl}/api/custom-fields/usage/${fieldId}`, { headers: { Cookie: cookie } });
    assert.equal(usageResponse.status, 200);
    assert.equal((await usageResponse.json() as { count: number }).count, 1);

    const purgeResponse = await fetch(`${baseUrl}/api/custom-fields/definitions/${fieldId}?purge=true&expectedRevision=1`, { method: "DELETE", headers: mutationHeaders });
    assert.equal(purgeResponse.status, 200);
    assert.equal((await purgeResponse.json() as { deletedValues?: number }).deletedValues, 1);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster v0.317 integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
