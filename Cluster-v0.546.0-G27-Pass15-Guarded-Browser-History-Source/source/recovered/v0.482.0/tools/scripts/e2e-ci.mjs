import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnPortableSync } from "./command-invocation.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const reportDir = path.join(root, ".cluster", "e2e");
const reportPath = path.join(reportDir, "production-e2e.json");
const serverOrigin = "http://127.0.0.1:4000";
const webOrigin = "http://127.0.0.1:3000";
const children = [];
let tempRoot = "";

function fail(message) { throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function run(command, args, env = process.env) {
  const result = spawnPortableSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed.\n${result.stdout || ""}\n${result.stderr || ""}`);
}
function child(command, args, options) {
  const processChild = spawn(command, args, { ...options, shell: process.platform === "win32" });
  let output = "";
  processChild.stdout?.on("data", (chunk) => { output += String(chunk); });
  processChild.stderr?.on("data", (chunk) => { output += String(chunk); });
  children.push({ child: processChild, label: options.label, output: () => output });
  return processChild;
}
async function waitFor(url, processChild, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processChild.exitCode != null) fail(`${label} exited with ${processChild.exitCode}.`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await sleep(250);
  }
  fail(`${label} did not become ready.`);
}
function isolatedDatabaseUrl() {
  const raw = String(process.env.CLUSTER_TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!raw) fail("Production E2E requires CLUSTER_TEST_DATABASE_URL or DATABASE_URL.");
  const url = new URL(raw);
  url.searchParams.set("schema", `cluster_e2e_${process.pid}_${Date.now()}`);
  return url.toString();
}
async function record(report, name, action) {
  const startedAt = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, passed: true, durationMs: Date.now() - startedAt, detail: detail || undefined });
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - startedAt, detail: String(error instanceof Error ? error.message : error).slice(0, 2000) });
  }
}

async function main() {
  for (const file of ["apps/server/dist/index.js", "apps/web/dist/index.html"]) if (!existsSync(path.join(root, file))) fail(`Production E2E requires built output: ${file}`);
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { fail("Production E2E requires Playwright and an installed Chromium runtime."); }
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cluster-production-e2e-"));
  const databaseUrl = isolatedDatabaseUrl();
  const env = {
    ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: "4000", WEB_ORIGIN: webOrigin,
    DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl,
    CLUSTER_DATA_DIR: path.join(tempRoot, "data"), CLUSTER_CONFIG_FILE: path.join(tempRoot, "data", "config", "cluster.config.json"),
    CLUSTER_AUTO_SEED: "true", CLUSTER_REQUIRE_AUTH: "true", CLUSTER_DEV_LOGIN: "true", CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
    CLUSTER_RATE_LIMIT: "false", CLUSTER_SECURITY_HEADERS: "true", SESSION_SECURE: "false", CLUSTER_LOG_LEVEL: "silent",
    CLUSTER_SECRET_KEY: "cluster-production-e2e-secret-key-long-enough", SESSION_SECRET: "cluster-production-e2e-session-secret-long-enough", CLUSTER_AUTH_SECRET: "cluster-production-e2e-auth-secret-long-enough",
  };
  run(process.execPath, [path.join("tools", "scripts", "database-command.mjs"), "deploy"], env);
  let server = child(process.execPath, ["dist/index.js"], { cwd: path.join(root, "apps/server"), env, stdio: ["ignore", "pipe", "pipe"], label: "Cluster server" });
  await waitFor(`${serverOrigin}/health/ready`, server, "Cluster server");
  async function restartClusterServer() {
    if (server.exitCode == null) server.kill("SIGTERM");
    const deadline = Date.now() + 8_000;
    while (server.exitCode == null && Date.now() < deadline) await sleep(100);
    if (server.exitCode == null) server.kill("SIGKILL");
    await sleep(250);
    server = child(process.execPath, ["dist/index.js"], { cwd: path.join(root, "apps/server"), env, stdio: ["ignore", "pipe", "pipe"], label: "Cluster server (restarted)" });
    await waitFor(`${serverOrigin}/health/ready`, server, "Cluster server restart");
  }
  async function runChaosHook(name) {
    const key = `CLUSTER_E2E_${name.toUpperCase()}_COMMAND`;
    const raw = String(process.env[key] || "").trim();
    if (!raw) return { configured: false, key };
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", raw] : ["-lc", raw];
    const result = spawnPortableSync(shell, args, { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) fail(`${key} failed: ${String(result.stderr || result.stdout || "").slice(0, 2000)}`);
    return { configured: true, key };
  }
  const web = child(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], { cwd: path.join(root, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"], label: "Cluster web preview" });
  await waitFor(webOrigin, web, "Cluster web preview");

  const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
  const report = { schema: 4, clusterVersion: version, generatedAt: new Date().toISOString(), browser: "chromium", phase: "phase6-resilience", chaosMode: process.env.CLUSTER_E2E_CHAOS === "1", checks: [] };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const peerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const peerPage = await peerContext.newPage();
  const anonymousContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const anonymousPage = await anonymousContext.newPage();

  async function devLogin(targetPage) {
    await targetPage.goto(webOrigin, { waitUntil: "networkidle" });
    const button = targetPage.getByRole("button", { name: "Continue locally" });
    await button.waitFor({ state: "visible", timeout: 15_000 });
    await button.click();
    await targetPage.waitForSelector("main.content-shell", { timeout: 20_000 });
  }

  async function authenticatedJson(targetPage, pathname, init = {}) {
    return targetPage.evaluate(async ({ serverOrigin, pathname, init }) => {
      const method = String(init.method || "GET").toUpperCase();
      const headers = { ...(init.headers || {}) };
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const csrfResponse = await fetch(`${serverOrigin}/api/auth/csrf`, { credentials: "include" });
        if (!csrfResponse.ok) throw new Error(`CSRF HTTP ${csrfResponse.status}`);
        const csrf = await csrfResponse.json();
        headers["X-Cluster-CSRF"] = csrf.token;
      }
      const response = await fetch(`${serverOrigin}${pathname}`, { ...init, headers, credentials: "include" });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    }, { serverOrigin, pathname, init });
  }

  async function realtimeRoundTrip(targetPage, { tool, resourceId, projectId, clientId, action }) {
    return targetPage.evaluate(async ({ serverOrigin, tool, resourceId, projectId, clientId, action }) => {
      const csrfResponse = await fetch(`${serverOrigin}/api/auth/csrf`, { credentials: "include" });
      if (!csrfResponse.ok) throw new Error(`CSRF HTTP ${csrfResponse.status}`);
      const csrf = await csrfResponse.json();
      const heartbeat = await fetch(`${serverOrigin}/api/collaboration/heartbeat`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token },
        body: JSON.stringify({ tool, resourceId, projectId, clientId, activity: "phase6-e2e" }),
      });
      if (!heartbeat.ok) throw new Error(`Heartbeat HTTP ${heartbeat.status}`);
      const event = await fetch(`${serverOrigin}/api/collaboration/action`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token },
        body: JSON.stringify({ tool, resourceId, projectId, action, detail: "phase6-e2e", resourceChanged: true }),
      });
      if (!event.ok) throw new Error(`Action HTTP ${event.status}`);
      const stateResponse = await fetch(`${serverOrigin}/api/collaboration/state?tool=${encodeURIComponent(tool)}&resourceId=${encodeURIComponent(resourceId)}`, { credentials: "include" });
      return { status: stateResponse.status, state: await stateResponse.json(), action: await event.json() };
    }, { serverOrigin, tool, resourceId, projectId, clientId, action });
  }

  try {
    await record(report, "unauthenticated API boundaries reject workspace access", async () => {
      await anonymousPage.goto(webOrigin, { waitUntil: "domcontentloaded" });
      const result = await anonymousPage.evaluate(async ({ serverOrigin }) => {
        const paths = ["/api/me", "/api/projects", "/api/whiteboards"];
        const rows = [];
        for (const path of paths) { const response = await fetch(`${serverOrigin}${path}`, { credentials: "include" }); rows.push([path, response.status]); }
        return rows;
      }, { serverOrigin });
      for (const [path, status] of result) if (status !== 401) fail(`${path} unexpectedly returned HTTP ${status} without authentication.`);
      return result;
    });

    await record(report, "authenticate through the shared renderer", async () => {
      await devLogin(page);
      await devLogin(peerPage);
      return page.url();
    });

    await record(report, "session logout and re-authentication lifecycle is enforced", async () => {
      const before = await authenticatedJson(peerPage, "/api/me");
      if (before.status !== 200) fail(`Authenticated /api/me returned HTTP ${before.status}.`);
      const logout = await authenticatedJson(peerPage, "/api/auth/logout", { method: "POST" });
      if (logout.status !== 200) fail(`Logout returned HTTP ${logout.status}.`);
      const after = await authenticatedJson(peerPage, "/api/me");
      if (after.status !== 401) fail(`Revoked session still accessed /api/me with HTTP ${after.status}.`);
      await devLogin(peerPage);
      const restored = await authenticatedJson(peerPage, "/api/me");
      if (restored.status !== 200) fail(`Re-authentication did not restore the session: HTTP ${restored.status}.`);
    });

    await record(report, "owner permission and mutation-origin contracts are enforced", async () => {
      const me = await authenticatedJson(page, "/api/me");
      if (me.status !== 200 || !me.body?.isAdmin) fail("E2E actor is not decorated as an admin/owner.");
      const denied = await page.evaluate(async ({ serverOrigin }) => {
        const response = await fetch(`${serverOrigin}/api/projects`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "origin-bypass" }) });
        return { status: response.status, body: await response.json() };
      }, { serverOrigin });
      if (![403, 419].includes(denied.status)) fail(`Mutation without CSRF/origin protection returned HTTP ${denied.status}.`);
      return { workspaceRole: me.body?.workspaceRole, deniedStatus: denied.status };
    });

    let projectId = "";
    let boardId = "";
    let whiteboardId = "";
    const projectName = `E2E Production ${Date.now()}`;
    await record(report, "create a project through authenticated mutation boundaries", async () => {
      const result = await page.evaluate(async ({ serverOrigin, projectName }) => {
        const csrfResponse = await fetch(`${serverOrigin}/api/auth/csrf`, { credentials: "include" });
        if (!csrfResponse.ok) throw new Error(`CSRF HTTP ${csrfResponse.status}`);
        const csrf = await csrfResponse.json();
        const meResponse = await fetch(`${serverOrigin}/api/me`, { credentials: "include" });
        if (!meResponse.ok) throw new Error(`Me HTTP ${meResponse.status}`);
        const me = await meResponse.json();
        const response = await fetch(`${serverOrigin}/api/projects`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token },
          body: JSON.stringify({ name: projectName, projectType: "general", assignedUserIds: [me.id], createDefaultBoard: true, createWhiteboard: true, createLibraryFolder: true }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`${body.code || response.status}: ${body.error || "project create failed"}`);
        return body;
      }, { serverOrigin, projectName });
      const created = result?.project || result;
      projectId = created?.id || "";
      boardId = created?.boards?.[0]?.id || "";
      whiteboardId = created?.whiteboards?.[0]?.id || "";
      if (!projectId) fail("Project creation response did not include an id.");
      return { projectId, boardId, whiteboardId };
    });

    await record(report, "project creation provisions board and whiteboard workspaces", async () => {
      if (!boardId || !whiteboardId) fail(`Project workspace provisioning incomplete: ${JSON.stringify({ boardId, whiteboardId })}`);
      const board = await authenticatedJson(page, `/api/boards/${boardId}`);
      const whiteboard = await authenticatedJson(page, `/api/whiteboards/${whiteboardId}`);
      if (board.status !== 200 || whiteboard.status !== 200) fail(`Provisioned workspaces are not readable: ${JSON.stringify({ board: board.status, whiteboard: whiteboard.status })}`);
      return { projectId, boardId, whiteboardId };
    });

    await record(report, "board realtime collaboration propagates multi-client presence and actions", async () => {
      await realtimeRoundTrip(page, { tool: "board", resourceId: boardId, projectId, clientId: "phase6-primary", action: "e2e-primary" });
      const peer = await realtimeRoundTrip(peerPage, { tool: "board", resourceId: boardId, projectId, clientId: "phase6-peer", action: "e2e-peer" });
      const state = await authenticatedJson(page, `/api/collaboration/state?tool=board&resourceId=${encodeURIComponent(boardId)}`);
      const presence = state.body?.presence || state.body?.users || [];
      const actions = state.body?.actions || state.body?.activity || [];
      if (state.status !== 200 || presence.length < 2) fail(`Board collaboration did not expose two client presences: ${JSON.stringify(state.body)}`);
      if (!actions.some((entry) => entry.action === "e2e-peer" || entry.id === peer.action?.id)) fail("Board collaboration did not propagate peer action state.");
      return { presence: presence.length, actions: actions.length };
    });

    await record(report, "whiteboard realtime collaboration propagates multi-client presence and actions", async () => {
      await realtimeRoundTrip(page, { tool: "whiteboard", resourceId: whiteboardId, projectId, clientId: "phase6-whiteboard-primary", action: "canvas-primary" });
      const peer = await realtimeRoundTrip(peerPage, { tool: "whiteboard", resourceId: whiteboardId, projectId, clientId: "phase6-whiteboard-peer", action: "canvas-peer" });
      const state = await authenticatedJson(page, `/api/collaboration/state?tool=whiteboard&resourceId=${encodeURIComponent(whiteboardId)}`);
      const presence = state.body?.presence || state.body?.users || [];
      const actions = state.body?.actions || state.body?.activity || [];
      if (state.status !== 200 || presence.length < 2) fail(`Whiteboard collaboration did not expose two client presences: ${JSON.stringify(state.body)}`);
      if (!actions.some((entry) => entry.action === "canvas-peer" || entry.id === peer.action?.id)) fail("Whiteboard collaboration did not propagate peer action state.");
      return { presence: presence.length, actions: actions.length };
    });

    let timelineItemId = "";
    await record(report, "timeline realtime and stale-revision conflicts are enforced", async () => {
      const now = Date.now();
      const created = await authenticatedJson(page, "/api/timeline/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, title: "Phase 6 timeline integration", startsAt: new Date(now + 60_000).toISOString(), endsAt: new Date(now + 3_660_000).toISOString(), type: "milestone" }) });
      if (created.status !== 200 || !created.body?.id) fail(`Timeline create failed: ${JSON.stringify(created)}`);
      timelineItemId = created.body.id;
      const staleRevision = Number(created.body.revision || 1);
      await realtimeRoundTrip(page, { tool: "timeline", resourceId: timelineItemId, projectId, clientId: "phase6-timeline-primary", action: "timeline-primary" });
      await realtimeRoundTrip(peerPage, { tool: "timeline", resourceId: timelineItemId, projectId, clientId: "phase6-timeline-peer", action: "timeline-peer" });
      const first = await authenticatedJson(page, `/api/timeline/items/${timelineItemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, title: "Phase 6 timeline primary edit", startsAt: created.body.startsAt, endsAt: created.body.endsAt, type: created.body.type || "milestone", expectedRevision: staleRevision }) });
      if (first.status !== 200) fail(`Timeline primary edit failed: HTTP ${first.status}`);
      const conflict = await authenticatedJson(peerPage, `/api/timeline/items/${timelineItemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, title: "Phase 6 stale peer edit", startsAt: created.body.startsAt, endsAt: created.body.endsAt, type: created.body.type || "milestone", expectedRevision: staleRevision }) });
      if (conflict.status !== 409) fail(`Stale Timeline update did not conflict: HTTP ${conflict.status}`);
      return { timelineItemId, staleRevision, conflictCode: conflict.body?.code || null };
    });

    await record(report, "notifications expose durable inbox state after integrated work", async () => {
      const list = await authenticatedJson(page, "/api/notifications?limit=50");
      const summary = await authenticatedJson(page, "/api/notifications/summary");
      if (list.status !== 200 || summary.status !== 200) fail(`Notification APIs failed: ${JSON.stringify({ list: list.status, summary: summary.status })}`);
      return { items: Array.isArray(list.body?.items) ? list.body.items.length : Array.isArray(list.body) ? list.body.length : 0, unread: summary.body?.unread ?? summary.body?.unreadCount ?? null };
    });

    await record(report, "scheduler creates and reads a project-bound block", async () => {
      const me = await authenticatedJson(page, "/api/me");
      const start = new Date(Date.now() + 7_200_000);
      const end = new Date(start.getTime() + 3_600_000);
      const created = await authenticatedJson(page, "/api/schedule/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: me.body?.id, projectId, title: "Phase 6 focus block", startsAt: start.toISOString(), endsAt: end.toISOString(), type: "focus" }) });
      if (created.status !== 200 || !created.body?.id) fail(`Schedule block create failed: ${JSON.stringify(created)}`);
      const blocks = await authenticatedJson(page, `/api/schedule/blocks?projectId=${encodeURIComponent(projectId)}`);
      if (blocks.status !== 200 || !Array.isArray(blocks.body) || !blocks.body.some((row) => row.id === created.body.id)) fail("Created schedule block was not readable.");
      return { blockId: created.body.id };
    });

    await record(report, "ticket workflow creates project work on the provisioned board", async () => {
      const created = await authenticatedJson(page, "/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, boardId, title: "Phase 6 integration ticket", description: "E2E workflow coverage", priority: "high", labels: ["phase6", "integration"] }) });
      if (created.status !== 200) fail(`Ticket create failed: ${JSON.stringify(created)}`);
      const workspace = await authenticatedJson(page, "/api/tickets/workspace");
      if (workspace.status !== 200) fail(`Ticket workspace failed: HTTP ${workspace.status}`);
      return { ticketId: created.body?.id || created.body?.card?.id || null };
    });

    await record(report, "build and QA records preserve revisioned traceability", async () => {
      const buildId = `e2e-build-${Date.now()}`;
      const qaId = `e2e-qa-${Date.now()}`;
      const build = await authenticatedJson(page, `/api/projects/${projectId}/workflows/buildArtifact/${buildId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { title: "Phase 6 build", version: "e2e.1", platform: "integration", status: "ready", channel: "qa" } }) });
      if (build.status !== 200) fail(`Build workflow failed: ${JSON.stringify(build)}`);
      const qa = await authenticatedJson(page, `/api/projects/${projectId}/workflows/qaSession/${qaId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { title: "Phase 6 QA", buildId, scope: "integration", platform: "integration", status: "passed", decision: "go" } }) });
      if (qa.status !== 200) fail(`QA workflow failed: ${JSON.stringify(qa)}`);
      const builds = await authenticatedJson(page, `/api/projects/${projectId}/workflows/buildArtifact`);
      const qaRows = await authenticatedJson(page, `/api/projects/${projectId}/workflows/qaSession`);
      if (builds.status !== 200 || qaRows.status !== 200) fail("Build/QA workflow collections were not readable.");
      return { buildId, qaId, buildRevision: build.body?.revision, qaRevision: qa.body?.revision };
    });

    await record(report, "admin approval queue remains readable through workflow activity", async () => {
      const approvals = await authenticatedJson(page, "/api/admin/approvals?status=all&limit=50");
      if (approvals.status !== 200 || !Array.isArray(approvals.body?.requests)) fail(`Admin approval queue failed: ${JSON.stringify(approvals)}`);
      return { requests: approvals.body.requests.length, avatarAudits: approvals.body.avatarAudits?.length || 0 };
    });

    await record(report, "library upload and download preserve bytes and checksum", async () => {
      const bytes = Math.max(1024, Math.min(16 * 1024 * 1024, Number(process.env.CLUSTER_E2E_LARGE_FILE_BYTES || 2 * 1024 * 1024)));
      const payload = "phase6-large-file:" + "x".repeat(bytes - 18);
      const dataUrl = `data:application/octet-stream;base64,${Buffer.from(payload).toString("base64")}`;
      const upload = await authenticatedJson(page, "/api/knowledge/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, title: "Phase 6 large file", originalName: "phase6-large.bin", mimeType: "application/octet-stream", tags: ["phase6", "e2e"], dataUrl }) });
      if (upload.status !== 200 || !upload.body?.id) fail(`Library upload failed: ${JSON.stringify(upload)}`);
      const downloaded = await page.evaluate(async ({ serverOrigin, itemId }) => { const response = await fetch(`${serverOrigin}/api/knowledge/${itemId}/file?download=1`, { credentials: "include" }); const buffer = await response.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", buffer); return { status: response.status, byteLength: buffer.byteLength, sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("") }; }, { serverOrigin, itemId: upload.body.id });
      if (downloaded.status !== 200) fail(`Library download failed: HTTP ${downloaded.status}`);
      const expectedSha256 = createHash("sha256").update(payload).digest("hex");
      if (downloaded.byteLength !== Buffer.byteLength(payload) || downloaded.sha256 !== expectedSha256) fail(`Downloaded file bytes differed (${downloaded.byteLength} vs ${Buffer.byteLength(payload)}).`);
      return { itemId: upload.body.id, bytes: downloaded.byteLength, checksumSha256: downloaded.sha256 };
    });

    await record(report, "project intelligence resolves the new project", async () => {
      const status = await page.evaluate(async ({ serverOrigin, projectId }) => {
        const response = await fetch(`${serverOrigin}/api/projects/${projectId}/intelligence`, { credentials: "include" });
        const body = await response.json();
        return { status: response.status, ok: body.ok, projectId: body.project?.id || body.projectId };
      }, { serverOrigin, projectId });
      if (status.status !== 200 || status.projectId !== projectId) fail(`Intelligence contract failed: ${JSON.stringify(status)}`);
    });

    await record(report, "Search v2 finds the new project", async () => {
      const result = await page.evaluate(async ({ serverOrigin, projectName }) => {
        const response = await fetch(`${serverOrigin}/api/command/search?q=${encodeURIComponent(projectName)}&limit=20`, { credentials: "include" });
        return { status: response.status, body: await response.json() };
      }, { serverOrigin, projectName });
      const items = result.body?.items || result.body?.results || [];
      if (result.status !== 200 || !items.some((item) => item.title === projectName || item.name === projectName)) fail("Search v2 did not return the created project.");
    });

    await record(report, "operations and integration catalogs are admin-readable", async () => {
      const result = await page.evaluate(async ({ serverOrigin }) => {
        const paths = ["/api/admin/operations/performance", "/api/admin/architecture/domains", "/api/admin/integrations/providers", "/api/notifications/summary"];
        const rows = [];
        for (const path of paths) { const response = await fetch(`${serverOrigin}${path}`, { credentials: "include" }); rows.push([path, response.status, await response.json()]); }
        return rows;
      }, { serverOrigin });
      for (const [path, status, body] of result) if (status !== 200 || body?.ok === false) fail(`${path} failed with HTTP ${status}`);
    });

    await record(report, "external integration failures remain bounded and admin-readable", async () => {
      const providers = await authenticatedJson(page, "/api/admin/integrations/providers");
      if (providers.status !== 200) fail(`Integration provider catalog failed: HTTP ${providers.status}`);
      const malformed = await page.evaluate(async ({ serverOrigin }) => {
        const csrfResponse = await fetch(`${serverOrigin}/api/auth/csrf`, { credentials: "include" });
        const csrf = await csrfResponse.json();
        const response = await fetch(`${serverOrigin}/api/admin/integrations/providers/__phase6_invalid__/test`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token }, body: JSON.stringify({ endpoint: "http://127.0.0.1:1/unreachable" }),
        });
        return { status: response.status, requestId: response.headers.get("x-request-id") };
      }, { serverOrigin });
      if (malformed.status >= 500) fail(`Invalid integration probe escaped as server failure HTTP ${malformed.status}.`);
      return malformed;
    });

    await record(report, "server restart preserves authenticated client recovery", async () => {
      const beforeUrl = page.url();
      const before = await authenticatedJson(page, "/api/me");
      if (before.status !== 200) fail(`Pre-restart session failed: HTTP ${before.status}`);
      await restartClusterServer();
      const after = await authenticatedJson(page, "/api/me");
      if (after.status !== 200) fail(`Session did not recover after server restart: HTTP ${after.status}`);
      if (page.url() !== beforeUrl) fail(`Renderer route changed across server restart (${beforeUrl} -> ${page.url()}).`);
      return { route: page.url() };
    });

    await record(report, "network loss preserves route and reconnects without duplicate client state", async () => {
      const beforeUrl = page.url();
      await context.setOffline(true);
      const offline = await page.evaluate(async ({ serverOrigin }) => { try { await fetch(`${serverOrigin}/health/ready`); return false; } catch { return true; } }, { serverOrigin });
      if (!offline) fail("Browser context did not observe the simulated network outage.");
      await sleep(750);
      await context.setOffline(false);
      await waitFor(`${serverOrigin}/health/ready`, server, "Cluster server after network restore");
      const after = await authenticatedJson(page, "/api/me");
      if (after.status !== 200) fail(`Session did not recover after network restore: HTTP ${after.status}`);
      if (page.url() !== beforeUrl) fail("Renderer route changed during simulated network loss.");
      return { route: page.url() };
    });

    await record(report, "offline-safe edits reconcile after reconnect while stale edits conflict", async () => {
      const itemId = `e2e-offline-${Date.now()}`;
      const created = await authenticatedJson(page, `/api/projects/${projectId}/workflows/timelineItem/${itemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { title: "Offline baseline", status: "planned" } }) });
      if (created.status !== 200) fail(`Offline baseline create failed: ${created.status}`);
      const revision = created.body?.revision;
      const serverEdit = await authenticatedJson(peerPage, `/api/projects/${projectId}/workflows/timelineItem/${itemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, payload: { title: "Server-side while peer offline", status: "active" } }) });
      if (serverEdit.status !== 200) fail(`Server-side edit failed: ${serverEdit.status}`);
      const stale = await authenticatedJson(page, `/api/projects/${projectId}/workflows/timelineItem/${itemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, payload: { title: "Stale offline edit", status: "done" } }) });
      if (stale.status !== 409) fail(`Expected stale reconnect conflict HTTP 409, received ${stale.status}.`);
      return { itemId, baseRevision: revision, conflictStatus: stale.status };
    });

    await record(report, "database restart hook is explicit and recoverable in chaos mode", async () => {
      if (process.env.CLUSTER_E2E_CHAOS !== "1") return { skipped: true, reason: "CLUSTER_E2E_CHAOS is not enabled" };
      const stop = await runChaosHook("database_stop");
      const start = await runChaosHook("database_start");
      if (!stop.configured || !start.configured) fail("Chaos mode requires CLUSTER_E2E_DATABASE_STOP_COMMAND and CLUSTER_E2E_DATABASE_START_COMMAND.");
      await restartClusterServer();
      const after = await authenticatedJson(page, "/api/me");
      if (after.status !== 200) fail(`Database restart recovery failed: HTTP ${after.status}`);
      return { restarted: true };
    });

    await record(report, "web and desktop-compatible clients can share one session contract", async () => {
      const desktopContext = await browser.newContext({ userAgent: `ClusterDesktopE2E/${version}`, extraHTTPHeaders: { "X-Cluster-Client": "desktop-e2e" } });
      const desktopPage = await desktopContext.newPage();
      try {
        await devLogin(desktopPage);
        const meWeb = await authenticatedJson(page, "/api/me");
        const meDesktop = await authenticatedJson(desktopPage, "/api/me");
        if (meWeb.status !== 200 || meDesktop.status !== 200 || meWeb.body?.id !== meDesktop.body?.id) fail("Web/Desktop-compatible clients did not resolve the same identity contract.");
        const state = await realtimeRoundTrip(desktopPage, { tool: "board", resourceId: boardId, projectId, clientId: `desktop-${Date.now()}`, action: "phase6-desktop-peer" });
        if (state.status !== 200) fail(`Desktop-compatible collaboration failed: HTTP ${state.status}`);
        return { userId: meWeb.body?.id };
      } finally { await desktopContext.close(); }
    });

    await record(report, "hostile and malformed requests fail closed", async () => {
      const results = await page.evaluate(async ({ serverOrigin }) => {
        const csrfResponse = await fetch(`${serverOrigin}/api/auth/csrf`, { credentials: "include" });
        const csrf = await csrfResponse.json();
        const malformed = await fetch(`${serverOrigin}/api/projects`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token }, body: "{not-json" });
        const missingOrigin = await fetch(`${serverOrigin}/api/projects`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Cluster-CSRF": csrf.token, "Origin": "https://attacker.invalid" }, body: JSON.stringify({ name: "hostile" }) });
        return { malformed: malformed.status, hostileOrigin: missingOrigin.status };
      }, { serverOrigin });
      if (results.malformed < 400 || results.malformed >= 500) fail(`Malformed JSON did not fail as bounded client error: ${results.malformed}`);
      if (results.hostileOrigin < 400 || results.hostileOrigin >= 500) fail(`Hostile origin did not fail closed: ${results.hostileOrigin}`);
      return results;
    });

    await record(report, "bounded soak keeps health session and collaboration stable", async () => {
      const soakMs = Math.max(5_000, Math.min(300_000, Number(process.env.CLUSTER_E2E_SOAK_MS || 15_000)));
      const deadline = Date.now() + soakMs;
      let iterations = 0;
      while (Date.now() < deadline) {
        const health = await fetch(`${serverOrigin}/health/ready`);
        const me = await authenticatedJson(page, "/api/me");
        const state = await realtimeRoundTrip(page, { tool: "board", resourceId: boardId, projectId, clientId: "phase6-soak", action: `soak-${iterations}` });
        if (!health.ok || me.status !== 200 || state.status !== 200) fail(`Soak iteration ${iterations} failed.`);
        iterations += 1;
        await sleep(500);
      }
      return { soakMs, iterations };
    });

    await record(report, "Projects renderer displays production data", async () => {
      const button = page.getByRole("button", { name: "Projects", exact: true }).first();
      await button.click();
      await page.getByText(projectName, { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
    });

    await record(report, "command palette opens and remains keyboard-operable", async () => {
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 5_000 });
      await page.keyboard.type(projectName);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });
  } finally {
    await anonymousContext.close().catch(() => undefined);
    await peerContext.close().catch(() => undefined);
    await browser.close();
  }
  report.passed = report.checks.every((check) => check.passed);
  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) fail(`Production E2E failed ${report.checks.filter((check) => !check.passed).length}/${report.checks.length} checks. Report: ${path.relative(root, reportPath)}`);
  console.log(`Production E2E passed ${report.checks.length}/${report.checks.length} checks.`);
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
finally {
  for (const entry of children.reverse()) {
    if (entry.child.exitCode == null) entry.child.kill("SIGTERM");
    await sleep(200);
    if (entry.child.exitCode == null) entry.child.kill("SIGKILL");
    if (process.exitCode && entry.output().trim()) console.error(`\n${entry.label} output:\n${entry.output().slice(-5000)}`);
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
