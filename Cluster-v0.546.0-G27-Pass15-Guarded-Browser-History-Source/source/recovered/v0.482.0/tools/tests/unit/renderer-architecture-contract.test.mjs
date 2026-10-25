import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const applicationEntry = "packages/renderer/src/features/application/ClusterApplication.tsx";
const appModules = "packages/renderer/src/features/application/modules";
const opsBarrel = "packages/renderer/src/features/operations/OperationsWorkspacePanels.tsx";
const settingsBarrel = "packages/renderer/src/features/settings/SettingsWorkspacePages.tsx";

test("roadmap Step 1 keeps the renderer decomposed", async () => {
  const app = await read(applicationEntry);
  const appInfo = await stat(path.join(root, applicationEntry));
  const ops = await read(opsBarrel);
  const settings = await read(settingsBarrel);
  const foundation = await read(`${appModules}/application-foundation.tsx`);

  assert.ok(appInfo.size <= 75_000, `ClusterApplication grew to ${appInfo.size} bytes`);
  assert.ok(app.split(/\r?\n/).length <= 1_500);
  assert.match(app, /\.\/modules\/application-foundation/);
  assert.match(app, /\.\/modules\/application-shell/);
  assert.match(app, /\.\/modules\/application-operations/);
  assert.match(app, /\.\/modules\/application-workspaces/);
  assert.match(ops, /modules\/operations-foundation/);
  assert.match(ops, /modules\/operations-workflows/);
  assert.match(ops, /modules\/operations-admin/);
  assert.match(ops, /modules\/operations-delivery/);
  assert.match(ops, /modules\/operations-dashboard/);
  assert.match(settings, /AccountSettingsPage/);
  assert.match(settings, /StudioSettingsPage/);
  assert.match(settings, /ServerConfigPage/);
  assert.doesNotMatch(foundation, /import\("\.\.\/\.\.\/settings\/SettingsWorkspacePages"\)/);
  assert.match(foundation, /import\("\.\.\/\.\.\/settings\/AccountSettingsPage"\)/);
  assert.match(foundation, /import\("\.\.\/\.\.\/settings\/StudioSettingsPage"\)/);
  assert.match(foundation, /import\("\.\.\/\.\.\/settings\/ServerConfigPage"\)/);
});

test("renderer architecture audit is release-blocking and currently passes", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts.audit, /renderer-architecture-audit\.mjs/);
  assert.equal(pkg.scripts["audit:renderer-architecture"], "node tools/scripts/renderer-architecture-audit.mjs");
  const { stdout } = await execFileAsync(process.execPath, ["tools/scripts/renderer-architecture-audit.mjs"], { cwd: root });
  assert.match(stdout, /Renderer architecture audit: \d+\/\d+ passed/);
  assert.doesNotMatch(stdout, /^FAIL/m);
});

test("roadmap Step 1 release boundary is documented and packaged", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const docs = await read("docs/RENDERER_ARCHITECTURE.md");
  const notes = await read("RELEASE_NOTES_v0.382.0.md");
  const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(docs, /Step 1: Renderer Architecture Decomposition/);
  assert.match(docs, /180 KB or 4,000 lines/);
  assert.match(notes, /Core Product & Architecture Roadmap Step 1 of 20/);
  assert.match(changelog, /version: "v0\.382\.0"/);
  assert.match(packager, /renderer-architecture-audit\.mjs/);
  assert.ok((packager.match(/docs\/RENDERER_ARCHITECTURE\.md/g) || []).length >= 2);
});
