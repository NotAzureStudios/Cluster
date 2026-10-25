import fs from "node:fs";

const clientPath = process.env.CLUSTER_CLIENT_PERFORMANCE_REPORT || process.argv[2] || "";
const serverPath = process.env.CLUSTER_SERVER_PERFORMANCE_REPORT || process.argv[3] || "";
const requireRuntime = process.env.CLUSTER_PERFORMANCE_REQUIRE_RUNTIME === "1";
if (!clientPath && !serverPath) {
  const message = "Phase 17 runtime performance gate unavailable: provide a client and/or server performance report.";
  if (requireRuntime) { console.error(message); process.exit(1); }
  console.log(message);
  process.exit(0);
}
const failures = [];
const warnings = [];
function readJson(file, label) {
  if (!file) return null;
  if (!fs.existsSync(file)) { failures.push(`${label} report not found: ${file}`); return null; }
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failures.push(`${label} report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); return null; }
}
const client = readJson(clientPath, "Client");
const server = readJson(serverPath, "Server");
if (client) {
  const health = client.health;
  if (!health || !Array.isArray(health.checks)) failures.push("Client report does not contain Phase 17 health checks.");
  else {
    const known = health.checks.filter((check) => check.status !== "unknown");
    if (known.length < Number(process.env.CLUSTER_CLIENT_MIN_KNOWN_CHECKS || 6)) failures.push(`Client report has only ${known.length} known performance checks.`);
    for (const check of known) {
      if (check.status === "fail") failures.push(`Client ${check.label || check.key} failed (${check.actual} ${check.unit || ""}).`);
      if (check.status === "warn") warnings.push(`Client ${check.label || check.key} warned (${check.actual} ${check.unit || ""}).`);
    }
  }
}
if (server) {
  const budgets = server.budgets || server.data?.budgets;
  if (!budgets || !Array.isArray(budgets.checks)) failures.push("Server report does not contain performance budgets.");
  else {
    for (const check of budgets.checks) {
      if (check.status === "fail") failures.push(`Server ${check.label || check.key} failed (${check.actual} ${check.unit || ""}).`);
      if (check.status === "warn") warnings.push(`Server ${check.label || check.key} warned (${check.actual} ${check.unit || ""}).`);
    }
  }
}
warnings.forEach((warning) => console.warn(`WARN ${warning}`));
if (failures.length) { failures.forEach((failure) => console.error(`FAIL ${failure}`)); process.exit(1); }
console.log(`Performance Phase 17 runtime gate: PASS (${warnings.length} warning${warnings.length === 1 ? "" : "s"})`);
