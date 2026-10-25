import fs from "node:fs";
import path from "node:path";

const requireBuilt = process.env.CLUSTER_BUNDLE_REQUIRE_BUILT === "1" || process.argv.includes("--require-built");
const distArg = process.argv.slice(2).find((item) => item !== "--require-built" && !item.startsWith("--"));
const dist = path.resolve(distArg || "apps/web/dist");
const reportPath = path.resolve(process.env.CLUSTER_BUNDLE_BUDGET_REPORT || path.join(".cluster", "performance", "bundle-budget.json"));
const limits = { jsChunkBytes: 650 * 1024, cssChunkBytes: 300 * 1024, totalJsBytes: 2.5 * 1024 * 1024, totalCssBytes: 700 * 1024, assetCount: 180 };
function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
if (!fs.existsSync(dist)) {
  const message = `Bundle budget: unavailable (no built web tree at ${dist}).`;
  writeReport({ schema: 1, generatedAt: new Date().toISOString(), available: false, passed: false, dist, limits, files: 0, js: { chunks: 0, bytes: 0 }, css: { chunks: 0, bytes: 0 }, failures: [message] });
  if (requireBuilt) { console.error(message); process.exit(1); }
  console.log(message);
  process.exit(0);
}
const files = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) walk(full); else files.push({ file: path.relative(dist, full), bytes: fs.statSync(full).size });
});
walk(dist);
const js = files.filter((item) => item.file.endsWith(".js"));
const css = files.filter((item) => item.file.endsWith(".css"));
const failures = [];
for (const item of js) if (item.bytes > limits.jsChunkBytes) failures.push(`${item.file} ${(item.bytes / 1024).toFixed(1)} KiB exceeds JS chunk budget`);
for (const item of css) if (item.bytes > limits.cssChunkBytes) failures.push(`${item.file} ${(item.bytes / 1024).toFixed(1)} KiB exceeds CSS chunk budget`);
const totalJs = js.reduce((sum, item) => sum + item.bytes, 0);
const totalCss = css.reduce((sum, item) => sum + item.bytes, 0);
if (totalJs > limits.totalJsBytes) failures.push(`total JS ${(totalJs / 1024 / 1024).toFixed(2)} MiB exceeds budget`);
if (totalCss > limits.totalCssBytes) failures.push(`total CSS ${(totalCss / 1024).toFixed(1)} KiB exceeds budget`);
if (files.length > limits.assetCount) failures.push(`${files.length} output assets exceed ${limits.assetCount} budget`);
writeReport({ schema: 1, generatedAt: new Date().toISOString(), available: true, passed: failures.length === 0, dist, limits, files: files.length, js: { chunks: js.length, bytes: totalJs }, css: { chunks: css.length, bytes: totalCss }, failures });
console.log(`Bundle budget: ${js.length} JS chunks, ${(totalJs / 1024 / 1024).toFixed(2)} MiB JS, ${css.length} CSS chunks, ${(totalCss / 1024).toFixed(1)} KiB CSS, ${files.length} assets.`);
if (failures.length) { failures.forEach((failure) => console.error(`FAIL ${failure}`)); process.exit(1); }
console.log("Bundle budget: PASS");
