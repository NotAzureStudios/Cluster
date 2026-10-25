import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
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
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
}

async function waitForHealth(baseUrl: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Cluster server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return await response.json() as { ok: boolean; version: string };
    } catch {
      // Server is still starting.
    }
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

integrationTest("production server smoke flow enforces auth and persists a project", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-integration-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("server_smoke");
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
    CLUSTER_SECRET_KEY: "cluster-integration-test-secret-key",
    SESSION_SECRET: "cluster-integration-cookie-secret",
    SESSION_SECURE: "false",
    CLUSTER_LOG_LEVEL: "silent"
  };

  const npx = "npx";
  run(npx, ["prisma", "migrate", "deploy", "--config", prismaConfig], env);

  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: serverRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOutput = "";
  child.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  child.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });

  try {
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.ok, true);
    assert.equal(health.version, expectedVersion);

    const unauthorized = await fetch(`${baseUrl}/api/projects`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    assert.match(cookie, /^cluster_session=/);

    const me = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const meBody = await me.json() as { user?: { username?: string; isAdmin?: boolean } };
    assert.equal(meBody.user?.username, "duckey");
    assert.equal(meBody.user?.isAdmin, true);

    const created = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CI Production Project",
        description: "Created by the v0.204 integration test.",
        projectType: "unreal",
        status: "active",
        createDefaultBoard: true,
        createWhiteboard: true
      })
    });
    assert.equal(created.status, 200);
    const project = await created.json() as { id: string; name: string; boards?: unknown[]; whiteboards?: unknown[] };
    assert.equal(project.name, "CI Production Project");
    assert.ok(project.id);
    assert.ok((project.boards || []).length >= 1);
    assert.ok((project.whiteboards || []).length >= 1);

    const projectsResponse = await fetch(`${baseUrl}/api/projects`, { headers: { Cookie: cookie } });
    assert.equal(projectsResponse.status, 200);
    const projects = await projectsResponse.json() as Array<{ id: string }>;
    assert.ok(projects.some((item) => item.id === project.id));

    const stabilization = await fetch(`${baseUrl}/api/admin/stabilization`, { headers: { Cookie: cookie } });
    assert.equal(stabilization.status, 200);
    const stabilizationBody = await stabilization.json() as { ok?: boolean; checks?: Array<{ status: string }> };
    assert.equal(stabilizationBody.ok, true);
    assert.ok((stabilizationBody.checks || []).some((check) => check.status === "pass"));

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin }
    });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${baseUrl}/api/projects`, { headers: { Cookie: cookie } });
    assert.equal(afterLogout.status, 401);
  } catch (error) {
    if (serverOutput.trim()) process.stderr.write(`\nCluster integration server output:\n${serverOutput}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
