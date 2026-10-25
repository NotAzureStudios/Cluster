import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reportPassed, safeReportSlug, summarizeAxeResult } from "./accessibility-ci-lib.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const reportRoot = path.resolve(process.env.CLUSTER_ACCESSIBILITY_REPORT_DIR || path.join(root, ".cluster", "accessibility"));
const screenshotRoot = path.join(reportRoot, "screenshots");
const reportPath = path.join(reportRoot, "accessibility-report.json");
const webOrigin = "http://127.0.0.1:3000";
const serverOrigin = "http://127.0.0.1:4000";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const childProcesses = [];
let tempRoot = "";

function fail(message) { throw new Error(message); }
async function exists(target) { try { await access(target); return true; } catch { return false; } }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(new Error(`Accessibility CI requires port ${port} to be free: ${error.message}`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); if (process.env.CLUSTER_ACCESSIBILITY_VERBOSE === "1") process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); if (process.env.CLUSTER_ACCESSIBILITY_VERBOSE === "1") process.stderr.write(chunk); });
  childProcesses.push({ child, output: () => output, label: options.label || `${command} ${args.join(" ")}` });
  return child;
}

async function waitForUrl(url, child, label) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) fail(`${label} exited before becoming ready (code ${child.exitCode}).`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Still starting.
    }
    await sleep(250);
  }
  fail(`${label} did not become ready within 45 seconds.`);
}

async function runCommand(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, shell: process.platform === "win32", stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}.`)));
  });
}

function isolatedDatabaseUrl() {
  const raw = String(process.env.CLUSTER_TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!raw) fail("Accessibility runtime CI requires CLUSTER_TEST_DATABASE_URL or DATABASE_URL.");
  const url = new URL(raw);
  url.searchParams.set("schema", `cluster_a11y_${process.pid}_${Date.now()}`);
  return url.toString();
}

async function injectAxe(page) {
  if (await page.evaluate(() => Boolean(globalThis.axe))) return;
  const axePath = require.resolve("axe-core/axe.min.js");
  await page.addScriptTag({ content: await readFile(axePath, "utf8") });
}

async function auditSurface(page, name, url, report) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForSelector("main", { timeout: 15_000 });
  await injectAxe(page);
  const raw = await page.evaluate(async (tags) => await globalThis.axe.run(document, {
    runOnly: { type: "tag", values: tags },
    resultTypes: ["violations", "incomplete", "passes"],
  }), wcagTags);
  const summary = summarizeAxeResult(raw);
  const surface = {
    name,
    url: page.url(),
    title: await page.title(),
    status: summary.blocking.length ? "failed" : "passed",
    blockingViolations: summary.blocking.length,
    totalViolations: summary.violations.length,
    incompleteChecks: summary.incomplete.length,
    passes: summary.passes,
    violations: summary.violations,
    incomplete: summary.incomplete,
  };
  report.surfaces.push(surface);
  if (summary.blocking.length) {
    await mkdir(screenshotRoot, { recursive: true });
    surface.screenshot = path.relative(root, path.join(screenshotRoot, `${safeReportSlug(name)}.png`)).replaceAll("\\", "/");
    await page.screenshot({ path: path.join(root, surface.screenshot), fullPage: true });
  }
  return surface;
}

async function keyboardCheck(report, name, action) {
  try {
    await action();
    report.keyboardChecks.push({ name, passed: true });
  } catch (error) {
    report.keyboardChecks.push({ name, passed: false, detail: String(error instanceof Error ? error.message : error).slice(0, 1200) });
  }
}

async function main() {
  await mkdir(reportRoot, { recursive: true });
  await runCommand(process.execPath, [path.join("tools", "scripts", "accessibility-static-audit.mjs")]);
  for (const target of [path.join(root, "apps", "server", "dist", "index.js"), path.join(root, "apps", "web", "dist", "index.html")]) {
    if (!(await exists(target))) fail(`Accessibility runtime CI requires built output: ${path.relative(root, target)}. Run npm run build first.`);
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
    require.resolve("axe-core/axe.min.js");
  } catch {
    fail("Accessibility runtime CI requires the Playwright and axe-core dev dependencies. Run npm install and npx playwright install chromium.");
  }

  await assertPortFree(4000);
  await assertPortFree(3000);
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cluster-a11y-ci-"));
  const databaseUrl = isolatedDatabaseUrl();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "4000",
    WEB_ORIGIN: webOrigin,
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: databaseUrl,
    CLUSTER_DATA_DIR: path.join(tempRoot, "data"),
    CLUSTER_CONFIG_FILE: path.join(tempRoot, "data", "config", "cluster.config.json"),
    CLUSTER_AUTO_SEED: "true",
    CLUSTER_REQUIRE_AUTH: "true",
    CLUSTER_DEV_LOGIN: "true",
    CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
    CLUSTER_RATE_LIMIT: "false",
    CLUSTER_SECURITY_HEADERS: "true",
    CLUSTER_SECRET_KEY: "cluster-accessibility-ci-secret-key-long-enough",
    SESSION_SECRET: "cluster-accessibility-ci-session-secret-long-enough",
    CLUSTER_AUTH_SECRET: "cluster-accessibility-ci-auth-secret-long-enough",
    SESSION_SECURE: "false",
    CLUSTER_LOG_LEVEL: "silent",
  };

  await runCommand(process.execPath, [path.join("tools", "scripts", "database-command.mjs"), "deploy"], env);
  const server = spawnChild(process.execPath, ["dist/index.js"], { cwd: path.join(root, "apps", "server"), env, label: "Cluster server" });
  await waitForUrl(`${serverOrigin}/health/ready`, server, "Cluster server");
  const web = spawnChild(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], { cwd: path.join(root, "apps", "web"), env, label: "Cluster web preview" });
  await waitForUrl(webOrigin, web, "Cluster web preview");

  const report = {
    schema: 1,
    clusterVersion: JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version,
    generatedAt: new Date().toISOString(),
    standard: "WCAG 2.x A/AA automated subset",
    blockingPolicy: "critical/serious axe violations and color-contrast violations",
    browser: "chromium",
    surfaces: [],
    keyboardChecks: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", colorScheme: "dark" });
  const page = await context.newPage();
  try {
    await auditSurface(page, "Sign in", `${webOrigin}/`, report);
    await keyboardCheck(report, "Skip link reaches main content", async () => {
      await page.goto(`${webOrigin}/`, { waitUntil: "networkidle" });
      await page.keyboard.press("Tab");
      const skipFocused = await page.evaluate(() => document.activeElement?.classList.contains("skip-link-v204"));
      if (!skipFocused) fail("First keyboard focus did not land on the global skip link.");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(100);
      const mainFocused = await page.evaluate(() => document.activeElement?.id === "cluster-main-content");
      if (!mainFocused) fail("Activating the skip link did not move focus to main content.");
    });

    await auditSurface(page, "Public copyright report", `${webOrigin}/legal/copyright/report`, report);

    await page.goto(`${webOrigin}/`, { waitUntil: "networkidle" });
    const devButton = page.getByRole("button", { name: "Continue locally" });
    await devButton.waitFor({ state: "visible", timeout: 15_000 });
    await devButton.click();
    await page.waitForSelector("main.content-shell", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await auditSurface(page, "Authenticated home", page.url(), report);

    await keyboardCheck(report, "Command palette traps and restores focus", async () => {
      const homeButton = page.getByRole("button", { name: "Home", exact: true }).first();
      await homeButton.focus();
      const before = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || "");
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 5_000 });
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest?.('[role="dialog"][aria-modal="true"]')));
      if (!inside) fail("Command palette did not move focus inside the modal dialog.");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5_000 });
      const after = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || "");
      if (!before || after !== before) fail(`Command palette focus restoration failed (${JSON.stringify(before)} -> ${JSON.stringify(after)}).`);
    });

    const projects = page.getByRole("button", { name: "Projects", exact: true }).first();
    if (await projects.count()) {
      await projects.click();
      const allProjects = page.getByRole("button", { name: "All projects", exact: true });
      if (await allProjects.count() && await allProjects.first().isVisible()) await allProjects.first().click();
      await page.getByRole("heading", { name: "Projects", exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
      await auditSurface(page, "Projects", page.url(), report);
    }

    await keyboardCheck(report, "Keyboard focus remains visible while tabbing", async () => {
      for (let index = 0; index < 18; index += 1) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) return null;
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        });
        if (!focus || focus.width <= 0 || focus.height <= 0) continue;
        if (focus.bottom < 0 || focus.top > (page.viewportSize()?.height || 1000)) fail(`Focused control moved outside the vertical viewport at tab ${index + 1}.`);
      }
    });

    await keyboardCheck(report, "Largest Cluster text scale reflows without page-level horizontal overflow", async () => {
      await page.evaluate(() => document.documentElement.setAttribute("data-text-scale", "largest"));
      await page.setViewportSize({ width: 960, height: 900 });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (overflow.scrollWidth > overflow.clientWidth + 4) fail(`Largest text scale introduced page-level horizontal overflow (${overflow.scrollWidth}px > ${overflow.clientWidth}px).`);
      await page.evaluate(() => document.documentElement.setAttribute("data-text-scale", "default"));
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    const settings = page.getByRole("button", { name: "Settings", exact: true }).first();
    if (await settings.count()) {
      await settings.click();
      await page.getByRole("heading", { name: /settings/i }).first().waitFor({ state: "visible", timeout: 10_000 });
      await auditSurface(page, "Settings", page.url(), report);
    }

    report.passed = reportPassed(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) {
      const blockers = report.surfaces.reduce((sum, surface) => sum + Number(surface.blockingViolations || 0), 0);
      const keyboardFailures = report.keyboardChecks.filter((check) => !check.passed).length;
      fail(`Accessibility CI failed: ${blockers} blocking automated violation(s), ${keyboardFailures} keyboard regression(s). Report: ${path.relative(root, reportPath)}`);
    }
    console.log(`Accessibility runtime CI passed across ${report.surfaces.length} surfaces and ${report.keyboardChecks.length} keyboard checks.`);
    console.log(`Report: ${path.relative(root, reportPath)}`);
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  try {
    await mkdir(reportRoot, { recursive: true });
    await writeFile(path.join(reportRoot, "runtime-error.txt"), `${message}\n`);
  } catch {
    // Preserve the original accessibility failure.
  }
  process.exitCode = 1;
} finally {
  for (const { child, output, label } of childProcesses.reverse()) {
    if (child.exitCode == null) child.kill("SIGTERM");
    await sleep(250);
    if (child.exitCode == null) child.kill("SIGKILL");
    if (process.exitCode && output().trim()) console.error(`\n${label} output:\n${output().slice(-6000)}`);
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
