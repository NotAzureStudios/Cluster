import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("roadmap Step 2 owns one semantic style entry and bounded compatibility layers", async () => {
  const styles = await read("packages/renderer/src/styles.css");
  const index = await read("packages/renderer/src/index.tsx");
  const tokens = await read("packages/renderer/src/styles/design-system/tokens.css");
  const appBarrel = await read("packages/renderer/src/styles/application.css");
  const refinements = await read("packages/renderer/src/features/application/application-refinements.css");
  assert.ok(styles.trimStart().startsWith('@import "./styles/design-system/tokens.css";'));
  assert.ok(styles.trimEnd().endsWith('@import "./styles/design-system/phase-k-polish.css";'));
  assert.ok(styles.indexOf('@import "./styles/design-system/primitives.css";') < styles.indexOf('@import "./styles/design-system/phase-a-polish.css";'));
  assert.match(index, /import "\.\/styles\.css";/);
  assert.doesNotMatch(index, /styles\/visual-polish\.css/);
  assert.match(tokens, /--ds-bg:/);
  assert.match(tokens, /--cluster-font-sans:/);
  assert.match(tokens, /--space-7:/);
  assert.match(tokens, /data-theme="dark"/);
  assert.ok((await stat(path.join(root, "packages/renderer/src/styles/application.css"))).size <= 1_500);
  assert.ok((await stat(path.join(root, "packages/renderer/src/features/application/application-refinements.css"))).size <= 1_000);
  assert.equal((appBarrel.match(/@import/g) || []).length, 6);
  assert.equal((refinements.match(/@import/g) || []).length, 4);
});

test("design-system audit is release-blocking and currently passes", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts.audit, /design-system-audit\.mjs/);
  assert.equal(pkg.scripts["audit:design-system"], "node tools/scripts/design-system-audit.mjs");
  const { stdout } = await execFileAsync(process.execPath, ["tools/scripts/design-system-audit.mjs"], { cwd: root });
  assert.match(stdout, /Design-system audit: \d+\/\d+ passed/);
  assert.doesNotMatch(stdout, /^FAIL/m);
});

test("roadmap Step 2 preview documentation and release boundary are packaged", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const docs = await read("docs/DESIGN_SYSTEM.md");
  const notes = await read("RELEASE_NOTES_v0.383.0.md");
  const preview = await read("packages/renderer/src/components/DesignSystemPreview.tsx");
  const account = await read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(docs, /Core Product & Architecture Roadmap Step 2 of 20/);
  assert.match(docs, /150 KB and 4,000 lines/);
  assert.match(notes, /Core Product & Architecture Roadmap Step 2 of 20/);
  assert.match(preview, /design-system-preview-v383/);
  assert.match(account, /<DesignSystemPreview \/>/);
  assert.match(packager, /design-system-audit\.mjs/);
  assert.ok((packager.match(/docs\/DESIGN_SYSTEM\.md/g) || []).length >= 2);
});
