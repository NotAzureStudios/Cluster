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

const integrationTest = basePostgresUrl && process.env.CLUSTER_SKIP_PRISMA_INTEGRATION !== "1" ? test : test.skip;

integrationTest("direct-resource authorization rejects cross-project IDs, logged-out replay, and exhausted share links", { timeout: 120_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-direct-auth-"));
  const dataRoot = path.join(temp, "data");
  const configFile = path.join(dataRoot, "config", "cluster.config.json");
  const databaseUrl = isolatedPostgresUrl("direct_resource_auth");
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
    CLUSTER_SECRET_KEY: "cluster-direct-auth-storage-secret-key-0001",
    CLUSTER_AUTH_SECRET: "cluster-direct-auth-credential-secret-key-0002",
    SESSION_SECRET: "cluster-direct-auth-cookie-secret-key-0003",
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
    const ownerLogin = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(ownerLogin.status, 200);
    const ownerCookie = sessionCookie(ownerLogin);
    const owner = (await json(ownerLogin)).user;
    const ownerHeaders = { Cookie: ownerCookie, Origin: webOrigin, "Content-Type": "application/json" };

    async function createProject(name: string) {
      const response = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ name, projectType: "generic", assignedUserIds: [owner.id], createDefaultBoard: true, createLibraryFolder: false }),
      });
      assert.equal(response.status, 200);
      return await json(response);
    }

    const allowedProject = await createProject("Direct Auth Allowed");
    const deniedProject = await createProject("Direct Auth Denied");

    const createdUserResponse = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        username: "directauthmember",
        displayName: "Direct Auth Member",
        role: "member",
        toolPermissions: { projects: "view", files: "view", video: "edit", boards: "view", tickets: "none" },
        projectPermissions: { [allowedProject.id]: "view", [deniedProject.id]: "none" },
      }),
    });
    assert.equal(createdUserResponse.status, 200);
    const createdUser = await json(createdUserResponse);
    assert.ok(createdUser.temporaryPassword);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { Origin: webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "directauthmember", password: createdUser.temporaryPassword }),
    });
    assert.equal(loginResponse.status, 200);
    const memberCookie = sessionCookie(loginResponse);
    const memberHeaders = { Cookie: memberCookie };
    const memberMutationHeaders = { Cookie: memberCookie, Origin: webOrigin, "Content-Type": "application/json" };

    const fileResponse = await fetch(`${baseUrl}/api/projects/${deniedProject.id}/files`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ title: "Denied file", originalName: "denied.txt", mimeType: "text/plain", dataUrl: "data:text/plain;base64,RGVuaWVk" }),
    });
    assert.equal(fileResponse.status, 200);
    const deniedFile = await json(fileResponse);

    const assetResponse = await fetch(`${baseUrl}/api/projects/${deniedProject.id}/video-assets`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ title: "Denied video", originalName: "denied.mp4", mimeType: "video/mp4", dataUrl: "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=" }),
    });
    assert.equal(assetResponse.status, 200);
    const deniedAsset = await json(assetResponse);

    const commentResponse = await fetch(`${baseUrl}/api/video-assets/${deniedAsset.id}/comments`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ body: "Owner-only project note", timecodeSeconds: 1 }),
    });
    assert.equal(commentResponse.status, 200);
    const deniedComment = await json(commentResponse);

    assert.equal((await fetch(`${baseUrl}/api/projects/${allowedProject.id}/dashboard`, { headers: memberHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/projects/${deniedProject.id}/dashboard`, { headers: memberHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/project-files/${deniedFile.id}/file`, { headers: memberHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/video-assets/${deniedAsset.id}/file`, { headers: memberHeaders })).status, 403);

    const commentAttack = await fetch(`${baseUrl}/api/video-comments/${deniedComment.id}`, {
      method: "PATCH",
      headers: memberMutationHeaders,
      body: JSON.stringify({ body: "cross-project overwrite attempt" }),
    });
    assert.equal(commentAttack.status, 403);
    assert.equal((await json(commentAttack)).code, "ACCESS_DENIED");

    const missingObject = await fetch(`${baseUrl}/api/project-files/not-a-real-object/file`, { headers: memberHeaders });
    assert.equal(missingObject.status, 404);
    assert.equal((await json(missingObject)).code, "RESOURCE_NOT_FOUND");

    const loggedOutReplay = await fetch(`${baseUrl}/api/projects/${allowedProject.id}/dashboard`);
    assert.equal(loggedOutReplay.status, 401);

    const allowedShareResponse = await fetch(`${baseUrl}/api/projects/${allowedProject.id}/share-links`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ allowedSections: ["overview"], maxUses: 1 }),
    });
    assert.equal(allowedShareResponse.status, 200);
    const allowedShare = await json(allowedShareResponse);

    const deniedShareResponse = await fetch(`${baseUrl}/api/projects/${deniedProject.id}/share-links`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ allowedSections: ["overview"] }),
    });
    assert.equal(deniedShareResponse.status, 200);
    const deniedShare = await json(deniedShareResponse);

    const crossProjectSharePatch = await fetch(`${baseUrl}/api/projects/${allowedProject.id}/share-links/${deniedShare.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ status: "revoked" }),
    });
    assert.equal(crossProjectSharePatch.status, 404);
    assert.equal((await json(crossProjectSharePatch)).code, "RESOURCE_NOT_FOUND");

    const firstShareOpen = await fetch(`${baseUrl}/api/public/share/${encodeURIComponent(allowedShare.token)}`);
    assert.equal(firstShareOpen.status, 200);
    const secondShareOpen = await fetch(`${baseUrl}/api/public/share/${encodeURIComponent(allowedShare.token)}`);
    assert.equal(secondShareOpen.status, 404);
    const guessedShare = await fetch(`${baseUrl}/api/public/share/${"A".repeat(40)}`);
    assert.equal(guessedShare.status, 404);
  } catch (error) {
    if (output.trim()) process.stderr.write(`\nCluster direct-resource authorization integration output:\n${output}\n`);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});
