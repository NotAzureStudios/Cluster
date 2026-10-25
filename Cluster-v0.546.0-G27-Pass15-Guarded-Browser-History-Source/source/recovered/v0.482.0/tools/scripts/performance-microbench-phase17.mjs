import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const reportPath = path.resolve(process.env.CLUSTER_SEARCH_BENCH_REPORT || path.join(root, ".cluster", "performance", "search-microbench.json"));
const require = createRequire(import.meta.url);
function loadTypeScript() {
  try { return require("typescript"); } catch {}
  try {
    const globalRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
    if (globalRoot) return require(path.join(globalRoot, "typescript"));
  } catch {}
  return null;
}
const ts = loadTypeScript();
if (!ts) {
  const message = "Phase 17 search microbenchmark unavailable: TypeScript runtime was not found.";
  if (process.env.CLUSTER_PERFORMANCE_REQUIRE_RUNTIME === "1") { console.error(message); process.exit(1); }
  console.log(message);
  process.exit(0);
}

const workerPath = path.join(root, "packages", "renderer", "src", "features", "search", "search-worker.ts");
const source = fs.readFileSync(workerPath, "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const messages = [];
const workerSelf = { postMessage: (payload) => messages.push(payload) };
const context = vm.createContext({ self: workerSelf, performance, Date, Map, Set, Array, Math, String, Number, Boolean, RegExp, Object, JSON });
vm.runInContext(output, context, { filename: "search-worker.phase17.js" });
if (typeof workerSelf.onmessage !== "function") throw new Error("Search worker did not install an onmessage handler.");

const DOCUMENT_COUNT = Number(process.env.CLUSTER_SEARCH_BENCH_DOCUMENTS || 10_000);
const INDEX_BUDGET_MS = Number(process.env.CLUSTER_SEARCH_BENCH_INDEX_MS || 2_500);
const P95_BUDGET_MS = Number(process.env.CLUSTER_SEARCH_BENCH_P95_MS || 250);
const MAX_BUDGET_MS = Number(process.env.CLUSTER_SEARCH_BENCH_MAX_MS || 400);
const queries = ["project", "proejct", "qa", "pa", "build 42", "production release", "owner team", "milestone 5", `alpha ${DOCUMENT_COUNT - 1}`];
const documents = Array.from({ length: DOCUMENT_COUNT }, (_, index) => ({
  key: `bench-${index}`,
  title: `Project Alpha ${index}`,
  detail: `Build QA ticket milestone ${index % 100}`,
  text: `production release ${index % 7} owner team ${index % 13}`,
  kind: index % 3 === 0 ? "project" : "card",
  updatedAt: new Date(Date.now() - (index % 30) * 86_400_000).toISOString(),
}));

const indexStartedAt = performance.now();
workerSelf.onmessage({ data: { type: "index", version: 1, documents } });
const indexMs = performance.now() - indexStartedAt;
const indexedMessage = messages.at(-1);
if (indexedMessage?.type !== "indexed" || indexedMessage.count !== DOCUMENT_COUNT) throw new Error("Search worker index benchmark did not index the expected corpus.");

// Warm the JIT and verify representative matching before collecting the timed sample.
for (const query of queries) {
  messages.length = 0;
  workerSelf.onmessage({ data: { type: "search", requestId: 0, version: 1, query, limit: 80 } });
  const result = messages.at(-1);
  if (result?.type !== "results" || !Array.isArray(result.scores) || !result.scores.length) throw new Error(`Search benchmark query produced no results: ${query}`);
}

const timings = [];
for (let round = 0; round < 2; round += 1) {
  for (const query of queries) {
    messages.length = 0;
    const startedAt = performance.now();
    workerSelf.onmessage({ data: { type: "search", requestId: round + 1, version: 1, query, limit: 80 } });
    timings.push({ query, durationMs: performance.now() - startedAt, candidateCount: Number(messages.at(-1)?.candidateCount || 0) });
  }
}
const sorted = timings.map((item) => item.durationMs).sort((a, b) => a - b);
const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
const result = {
  corpus: DOCUMENT_COUNT,
  queryCount: timings.length,
  indexMs: Math.round(indexMs * 10) / 10,
  p50Ms: Math.round(percentile(0.5) * 10) / 10,
  p95Ms: Math.round(percentile(0.95) * 10) / 10,
  maximumMs: Math.round((sorted.at(-1) || 0) * 10) / 10,
  budgets: { indexMs: INDEX_BUDGET_MS, p95Ms: P95_BUDGET_MS, maximumMs: MAX_BUDGET_MS },
  slowest: [...timings].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5).map((item) => ({ ...item, durationMs: Math.round(item.durationMs * 10) / 10 })),
};
const failures = [];
if (result.indexMs > INDEX_BUDGET_MS) failures.push(`index ${result.indexMs}ms > ${INDEX_BUDGET_MS}ms`);
if (result.p95Ms > P95_BUDGET_MS) failures.push(`search p95 ${result.p95Ms}ms > ${P95_BUDGET_MS}ms`);
if (result.maximumMs > MAX_BUDGET_MS) failures.push(`search max ${result.maximumMs}ms > ${MAX_BUDGET_MS}ms`);
const report = { schema: 1, generatedAt: new Date().toISOString(), passed: failures.length === 0, ...result, failures };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length) { failures.forEach((failure) => console.error(`FAIL ${failure}`)); process.exit(1); }
console.log("Performance Phase 17 search microbenchmark: PASS");
