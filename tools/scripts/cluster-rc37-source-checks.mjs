import { spawnSync } from "node:child_process";
const suites = ["cluster-rc36-source-checks.mjs", "cluster-rc37-discord-management-tests.mjs"];
for (const file of suites) {
  const result = spawnSync(process.execPath, [new URL(file, import.meta.url).pathname], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`RC37 source checks passed (${suites.length}/${suites.length} groups).`);
