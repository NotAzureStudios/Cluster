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
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.\n${result.stdout || ""}\n${result.stderr || ""}`);
}

async function waitForHealth(baseUrl: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Cluster server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Cluster security test server did not become healthy within 30 seconds.");
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0];
}

const integrationTest = basePostgresUrl && process.env.CLUSTER_SKIP_PRISMA_INTEGRATION !== "1" ? test : test.skip;

integrationTest("v0.305 rejects request-id spoofing, redacts incidents, and enforces abuse controls", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-security-v305-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("security_observability_v305");
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
    CLUSTER_RATE_LIMIT: "true",
    CLUSTER_RATE_LIMIT_MAX: "8",
    CLUSTER_AUTH_RATE_LIMIT_MAX: "4",
    CLUSTER_RATE_LIMIT_WINDOW_MS: "60000",
    CLUSTER_SECURITY_HEADERS: "true",
    CLUSTER_SECRET_KEY: "cluster-security-v305-secret-key",
    SESSION_SECRET: "cluster-security-v305-cookie-secret",
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
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");

    const spoofed = await fetch(`${baseUrl}/api/meta/contracts`, {
      headers: { "x-request-id": "attacker-controlled", "x-client-request-id": "desktop-flow-305" },
    });
    assert.equal(spoofed.status, 200);
    const requestId = spoofed.headers.get("x-request-id") || "";
    assert.notEqual(requestId, "attacker-controlled");
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(spoofed.headers.get("x-client-request-id"), "desktop-flow-305");

    const crossSite = await fetch(`${baseUrl}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(crossSite.status, 403);
    assert.match(String((await crossSite.json() as any).error), /Cross-site mutation/i);

    const login = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);

    const secret = "super-secret-token-should-never-export";
    const incident = await fetch(`${baseUrl}/api/security/client-incidents`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "client.render_error",
        severity: "error",
        route: "/projects/demo?token=hidden",
        requestId: "desktop-flow-305",
        message: `password=${secret} Bearer ${secret} /home/duckey/private/file.txt`,
      }),
    });
    assert.equal(incident.status, 202);

    const unauthorizedBundle = await fetch(`${baseUrl}/api/admin/diagnostics/bundle`);
    assert.equal(unauthorizedBundle.status, 401);

    const bundleResponse = await fetch(`${baseUrl}/api/admin/diagnostics/bundle`, { headers: { Cookie: cookie } });
    assert.equal(bundleResponse.status, 200);
    assert.match(bundleResponse.headers.get("content-disposition") || "", /cluster-diagnostics-/);
    const bundleText = await bundleResponse.text();
    assert.doesNotMatch(bundleText, new RegExp(secret));
    assert.doesNotMatch(bundleText, /\/home\/duckey/);
    assert.match(bundleText, /\[REDACTED\]/);
    const bundle = JSON.parse(bundleText) as any;
    assert.equal(bundle.clusterVersion, expectedVersion);
    assert.ok(bundle.security.total >= 1);

    const security = await fetch(`${baseUrl}/api/security/diagnostics`, { headers: { Cookie: cookie } });
    assert.equal(security.status, 200);
    const securityBody = await security.json() as any;
    assert.ok(securityBody.securityEvents.total >= 1);

    const backup = await fetch(`${baseUrl}/api/admin/backups/now`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin },
    });
    assert.equal(backup.status, 200);
    const backupBody = await backup.json() as any;
    assert.equal(typeof backupBody.fileName, "string");
    const backupName = encodeURIComponent(backupBody.fileName);

    const verified = await fetch(`${baseUrl}/api/admin/backups/${backupName}/verify`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin },
    });
    assert.equal(verified.status, 200);
    assert.equal(typeof (await verified.json() as any).ok, "boolean");

    const drillWithoutConfirmation = await fetch(`${baseUrl}/api/admin/backups/${backupName}/restore-drill`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin },
    });
    assert.equal(drillWithoutConfirmation.status, 412);

    const restoreDrill = await fetch(`${baseUrl}/api/admin/backups/${backupName}/restore-drill`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: webOrigin, "X-Cluster-Confirmation": "RUN RESTORE DRILL" },
    });
    assert.equal(restoreDrill.status, 200);
    const restoreBody = await restoreDrill.json() as any;
    assert.equal(restoreBody.drill, true);
    assert.equal(restoreBody.applied, false);

    let rateLimited = false;
    for (let index = 0; index < 12; index += 1) {
      const response = await fetch(`${baseUrl}/api/projects`);
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert.equal(rateLimited, true);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster v0.305 security integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
