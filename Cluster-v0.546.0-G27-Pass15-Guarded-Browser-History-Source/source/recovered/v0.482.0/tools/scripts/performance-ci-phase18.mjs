import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnPortableSync } from "./command-invocation.mjs";

const root = process.cwd();
const serverOrigin = "http://127.0.0.1:4000";
const webOrigin = "http://127.0.0.1:3000";
const reportDir = path.join(root, ".cluster", "performance");
const clientReportPath = path.join(reportDir, "client-phase18.json");
const serverReportPath = path.join(reportDir, "server-phase18.json");
const children = [];
let tempRoot = "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fail(message) { throw new Error(message); }
function run(command, args, env = process.env) {
  const result = spawnPortableSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed.\n${result.stdout || ""}\n${result.stderr || ""}`);
}
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(new Error(`Performance CI requires port ${port} to be free: ${error.message}`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
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
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (processChild.exitCode != null) fail(`${label} exited with ${processChild.exitCode}.`);
    try { const response = await fetch(url); if (response.status < 500) return; } catch {}
    await sleep(250);
  }
  fail(`${label} did not become ready.`);
}
function isolatedDatabaseUrl() {
  const raw = String(process.env.CLUSTER_TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!raw) fail("Performance CI requires CLUSTER_TEST_DATABASE_URL or DATABASE_URL.");
  const url = new URL(raw);
  url.searchParams.set("schema", `cluster_perf18_${process.pid}_${Date.now()}`);
  return url.toString();
}

async function main() {
  for (const file of ["apps/server/dist/index.js", "apps/web/dist/index.html"]) if (!existsSync(path.join(root, file))) fail(`Performance CI requires built output: ${file}`);
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { fail("Performance CI requires Playwright and an installed Chromium runtime."); }
  await portFree(4000); await portFree(3000);
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cluster-performance-ci-"));
  const databaseUrl = isolatedDatabaseUrl();
  const env = {
    ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: "4000", WEB_ORIGIN: webOrigin,
    DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl,
    CLUSTER_DATA_DIR: path.join(tempRoot, "data"), CLUSTER_CONFIG_FILE: path.join(tempRoot, "data", "config", "cluster.config.json"),
    CLUSTER_AUTO_SEED: "true", CLUSTER_REQUIRE_AUTH: "true", CLUSTER_DEV_LOGIN: "true", CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
    CLUSTER_RATE_LIMIT: "false", CLUSTER_SECURITY_HEADERS: "true", SESSION_SECURE: "false", CLUSTER_LOG_LEVEL: "silent",
    CLUSTER_SECRET_KEY: "cluster-performance-ci-secret-key-long-enough", SESSION_SECRET: "cluster-performance-ci-session-secret-long-enough", CLUSTER_AUTH_SECRET: "cluster-performance-ci-auth-secret-long-enough",
  };
  run(process.execPath, [path.join("tools", "scripts", "database-command.mjs"), "deploy"], env);
  const server = child(process.execPath, ["dist/index.js"], { cwd: path.join(root, "apps/server"), env, stdio: ["ignore", "pipe", "pipe"], label: "Cluster performance server" });
  await waitFor(`${serverOrigin}/health/ready`, server, "Cluster server");
  const web = child(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], { cwd: path.join(root, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"], label: "Cluster performance web" });
  await waitFor(webOrigin, web, "Cluster web preview");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(webOrigin, { waitUntil: "networkidle", timeout: 30_000 });
    const login = page.getByRole("button", { name: "Continue locally" });
    await login.waitFor({ state: "visible", timeout: 15_000 });
    await login.click();
    await page.waitForSelector("main.content-shell", { timeout: 20_000 });
    for (const route of ["projects", "tickets", "profiles", "notifications", "calendar", "knowledge", "settings", "projects"]) {
      await page.evaluate((value) => { window.location.hash = `#${value}`; }, route);
      await page.waitForTimeout(450);
    }
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.keyboard.type("project");
    await page.waitForTimeout(750);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1_200);
    const client = await page.evaluate(() => {
      const perf = globalThis.clusterPerformance;
      if (!perf?.export) throw new Error("Cluster performance export is unavailable.");
      return perf.export();
    });
    const serverReport = await page.evaluate(async (origin) => {
      const response = await fetch(`${origin}/api/admin/operations/performance`, { credentials: "include" });
      if (!response.ok) throw new Error(`Server performance HTTP ${response.status}`);
      return response.json();
    }, serverOrigin);
    await mkdir(reportDir, { recursive: true });
    await writeFile(clientReportPath, `${JSON.stringify(client, null, 2)}\n`);
    await writeFile(serverReportPath, `${JSON.stringify(serverReport, null, 2)}\n`);
  } finally {
    await browser.close();
  }
  const gateEnv = {
    ...process.env,
    CLUSTER_PERFORMANCE_REQUIRE_RUNTIME: "1",
    CLUSTER_CLIENT_PERFORMANCE_REPORT: clientReportPath,
    CLUSTER_SERVER_PERFORMANCE_REPORT: serverReportPath,
  };
  run(process.execPath, [path.join("tools", "scripts", "performance-runtime-gate-phase17.mjs")], gateEnv);
  const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
  console.log(`Performance Phase 18 CI passed for Cluster v${version}.`);
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
