import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function json(response: Response) {
  return await response.json() as any;
}

async function csrf(baseUrl: string, cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return String((await json(response)).token || "");
}

async function login(baseUrl: string, webOrigin: string) {
  const response = await fetch(`${baseUrl}/api/auth/dev-login`, {
    method: "POST",
    headers: { Origin: webOrigin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  const cookie = sessionCookie(response);
  assert.ok(cookie.includes("="));
  return { cookie, user: (await json(response)).user };
}

async function readSseUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: RegExp, timeoutMs = 5_000) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE read timeout")), remaining)),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
    if (pattern.test(text)) return text;
  }
  throw new Error(`Expected SSE pattern ${pattern} was not observed. Received: ${text.slice(-1200)}`);
}

const integrationTest = basePostgresUrl && process.env.CLUSTER_SKIP_PRISMA_INTEGRATION !== "1" ? test : test.skip;

integrationTest("logout and session revocation make captured cookies, CSRF tokens, and realtime streams unusable", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-session-replay-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("session_replay");
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
    CLUSTER_SECRET_KEY: "cluster-session-replay-storage-secret-key-0001",
    CLUSTER_AUTH_SECRET: "cluster-session-replay-credential-secret-key-0002",
    SESSION_SECRET: "cluster-session-replay-cookie-secret-key-0003",
    SESSION_SECURE: "false",
    CLUSTER_LOG_LEVEL: "silent",
  };

  run("npx", ["prisma", "migrate", "deploy", "--config", prismaConfig], env);
  const child = spawn(process.execPath, ["dist/index.js"], { cwd: serverRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });

  try {
    await waitForHealth(baseUrl, child);
    const first = await login(baseUrl, webOrigin);
    const firstCsrf = await csrf(baseUrl, first.cookie);
    const authHeaders = { Cookie: first.cookie, Origin: webOrigin, "Content-Type": "application/json", "X-Cluster-CSRF": firstCsrf };

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Session Replay Project", projectType: "generic", assignedUserIds: [first.user.id], createDefaultBoard: true, createLibraryFolder: false }),
    });
    assert.equal(projectResponse.status, 200);
    const project = await json(projectResponse);
    const boardId = String(project.boards?.[0]?.id || "");
    assert.ok(boardId);

    assert.equal((await fetch(`${baseUrl}/api/projects/${project.id}/dashboard`, { headers: { Cookie: first.cookie } })).status, 200);

    const stream = await fetch(`${baseUrl}/api/collaboration/stream?tool=board&resourceId=${encodeURIComponent(boardId)}&clientId=logout-regression`, { headers: { Cookie: first.cookie } });
    assert.equal(stream.status, 200);
    assert.ok(stream.body);
    const reader = stream.body!.getReader();
    await readSseUntil(reader, /event: ready/);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders,
      body: "{}",
    });
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers.get("clear-site-data") || ""), /cookies/);

    const revokedFrame = await readSseUntil(reader, /event: session[\s\S]*"state":"revoked"/);
    assert.match(revokedFrame, /"reason":"logout"/);
    await reader.cancel().catch(() => undefined);

    const meAfterLogout = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: first.cookie } });
    assert.equal(meAfterLogout.status, 200);
    assert.equal((await json(meAfterLogout)).user, null);

    const protectedReplay = await fetch(`${baseUrl}/api/projects/${project.id}/dashboard`, { headers: { Cookie: first.cookie } });
    assert.equal(protectedReplay.status, 401);
    assert.equal((await json(protectedReplay)).code, "AUTH_REQUIRED");

    const staleCsrfReplay = await fetch(`${baseUrl}/api/collaboration/heartbeat`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ tool: "board", resourceId: boardId, clientId: "stale-csrf" }),
    });
    assert.equal(staleCsrfReplay.status, 401);
    assert.equal((await json(staleCsrfReplay)).code, "AUTH_REQUIRED");

    const second = await login(baseUrl, webOrigin);
    const secondCsrf = await csrf(baseUrl, second.cookie);
    const third = await login(baseUrl, webOrigin);
    const sessionsResponse = await fetch(`${baseUrl}/api/me/sessions`, { headers: { Cookie: second.cookie } });
    assert.equal(sessionsResponse.status, 200);
    const sessions = (await json(sessionsResponse)).sessions as Array<{ id: string; current: boolean }>;
    const current = sessions.find((item) => item.current);
    const other = sessions.find((item) => !item.current);
    assert.ok(current?.id);
    assert.ok(other?.id);

    const revokeOther = await fetch(`${baseUrl}/api/me/sessions/${encodeURIComponent(other!.id)}`, {
      method: "DELETE",
      headers: { Cookie: second.cookie, Origin: webOrigin, "X-Cluster-CSRF": secondCsrf },
    });
    assert.equal(revokeOther.status, 200);
    assert.equal((await json(revokeOther)).currentSessionRevoked, false);
    const thirdReplay = await fetch(`${baseUrl}/api/projects/${project.id}/dashboard`, { headers: { Cookie: third.cookie } });
    assert.equal(thirdReplay.status, 401);

    const revokeCurrent = await fetch(`${baseUrl}/api/me/sessions/${encodeURIComponent(current!.id)}`, {
      method: "DELETE",
      headers: { Cookie: second.cookie, Origin: webOrigin, "X-Cluster-CSRF": secondCsrf },
    });
    assert.equal(revokeCurrent.status, 200);
    assert.equal((await json(revokeCurrent)).currentSessionRevoked, true);
    assert.match(String(revokeCurrent.headers.get("clear-site-data") || ""), /cookies/);
    assert.equal((await fetch(`${baseUrl}/api/projects/${project.id}/dashboard`, { headers: { Cookie: second.cookie } })).status, 401);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster logout/session regression integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
