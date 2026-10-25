import { readFile } from "node:fs/promises";
const root = process.cwd();
const read = (p) => readFile(`${root}/${p}`, "utf8");
const [pkgText, api, jobs, ui, launcher, notes, docs, changelog, packager] = await Promise.all([
  read("package.json"),
  read("packages/renderer/src/core/api.ts"),
  read("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx"),
  read("apps/server-launcher-go/launcher_ui_windows.go"),
  read("apps/server-launcher-go/main.go"),
  read("RELEASE_NOTES_v0.463.0.md"),
  read("docs/WINDOWS_SERVER_CONTROL_PANEL.md"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("tools/scripts/package-cluster-master.mjs"),
]);
const pkg = JSON.parse(pkgText);
const checks = [
  ["Pass G version lineage is preserved", Number(pkg.version.split(".")[1] || 0) >= 463],
  ["query cache has a bounded hot-set", api.includes("QUERY_CACHE_MAX_ENTRIES = 512") && api.includes("function setQueryCache")],
  ["query cache preserves in-flight work while pruning", api.includes("!cached.promise") && api.includes("cached.expiresAt <= now")],
  ["background jobs skip hidden/offline polling", jobs.includes('document.visibilityState !== "visible"') && jobs.includes("!navigator.onLine")],
  ["background jobs use a calmer 20 second cadence", jobs.includes("20_000")],
  ["background jobs refresh on recovery events", jobs.includes('window.addEventListener("online"') && jobs.includes('document.addEventListener("visibilitychange"')],
  ["npm bootstrap supports cancellation", launcher.includes("prepareApplicationContext") && launcher.includes("exec.CommandContext") && launcher.includes("runNpmContext")],
  ["native controller owns startup cancellation", ui.includes("startupCancel   context.CancelFunc") && ui.includes("Cancelling startup")],
  ["native controller has bounded readiness watchdog", ui.includes("armReadinessWatchdog") && ui.includes("75*time.Second") && ui.includes("Readiness timed out; stopping host")],
  ["readiness timeout retains graceful then forced shutdown", ui.includes('os.WriteFile(controlFile, []byte("stop\\n")') && ui.includes('exec.Command("taskkill.exe"')],
  ["native resource sampler cadence is five seconds", ui.includes("time.Since(ui.lastResourceAt) >= 5*time.Second") && ui.includes("lastResourceSnapshot")],
  ["Pass G is documented", notes.includes("Roadmap Pass G") && docs.includes("v0.463 production hardening")],
  ["Pass G is in changelog", changelog.includes('version: "v0.463.0"') && changelog.includes("Production hardening")],
  ["Pass G participates in master packaging", packager.includes("roadmap-pass-g-v463-audit.mjs")],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; }
console.log(`Roadmap Pass G v0.463: ${checks.length-failed}/${checks.length} passed.`);
if (failed) process.exit(1);
