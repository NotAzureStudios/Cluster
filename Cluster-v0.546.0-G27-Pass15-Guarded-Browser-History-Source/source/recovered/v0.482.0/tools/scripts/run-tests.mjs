import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const target = path.resolve(process.argv.slice(2).find((value) => !value.startsWith("--")) || "tools/tests/unit");
const requireTsx = process.argv.includes("--require-tsx");
const requireIntegration = process.argv.includes("--require-integration") || process.env.CLUSTER_REQUIRE_INTEGRATION === "1";

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute));
    else if (/\.test\.(?:ts|tsx|mjs|js)$/.test(entry.name)) files.push(absolute);
  }
  return files.sort();
}

function runTests(files, extraArgs = []) {
  if (!files.length) return 0;
  const result = spawnSync(
    process.execPath,
    [...extraArgs, "--test", "--test-reporter=spec", ...files],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    }
  );
  return result.status ?? 1;
}

if (requireIntegration && target.endsWith(path.join("tools", "tests", "integration")) && !String(process.env.CLUSTER_TEST_DATABASE_URL || "").trim()) {
  console.error("Integration tests are required but CLUSTER_TEST_DATABASE_URL is not configured.");
  process.exit(1);
}

const files = await collect(target).catch(() => []);
if (!files.length) {
  console.error(`No tests found under ${target}`);
  process.exit(1);
}

const javascriptTests = files.filter((file) => /\.test\.(?:mjs|js)$/.test(file));
const typescriptTests = files.filter((file) => /\.test\.(?:ts|tsx)$/.test(file));

const tsxProbe = spawnSync(process.execPath, ["-e", "import('tsx')"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "ignore"
});
const hasTsx = tsxProbe.status === 0;

if (hasTsx) {
  process.exit(runTests(files, ["--import", "tsx"]));
}

const javascriptStatus = runTests(javascriptTests);
if (javascriptStatus !== 0) process.exit(javascriptStatus);

if (typescriptTests.length && requireTsx) {
  console.error(`TypeScript tests are required but the tsx runner is not installed.`);
  process.exit(1);
}

if (typescriptTests.length) {
  console.warn(
    `Skipped ${typescriptTests.length} TypeScript test file${typescriptTests.length === 1 ? "" : "s"} because the optional tsx runner is not installed.`
  );
}
process.exit(0);
