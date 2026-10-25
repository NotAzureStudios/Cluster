import { readFile } from "node:fs/promises";

const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");
const [pkgText, footer, board, whiteboard, clientPerf, serverPerf, adminOps, workflows, integrations, notes, docs, changelog, packager] = await Promise.all([
  read("package.json"),
  read("packages/renderer/src/components/AppVersionFooter.tsx"),
  read("packages/renderer/src/features/boards/BoardWorkspacePage.tsx"),
  read("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx"),
  read("packages/renderer/src/features/operations/ClientPerformancePanel.tsx"),
  read("packages/renderer/src/features/operations/ServerPerformancePanel.tsx"),
  read("packages/renderer/src/features/admin/ServerAdminExperiencePanel.tsx"),
  read("packages/renderer/src/features/operations/modules/operations-workflows.tsx"),
  read("apps/server/src/app/server-routes-configuration-integrations.ts"),
  read("RELEASE_NOTES_v0.464.0.md"),
  read("docs/ROADMAP_PASS_H_RUNTIME_HYGIENE.md"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("tools/scripts/package-cluster-master.mjs"),
]);
const pkg = JSON.parse(pkgText);
const checks = [
  ["Pass H version is active", Number(pkg.version.split(".")[1] || 0) >= 464],
  ["server status polling skips hidden/offline state", footer.includes('document.visibilityState !== "visible" || !navigator.onLine')],
  ["server status uses a calmer cadence", footer.includes("60_000")],
  ["server status refreshes on focus and reconnect", footer.includes('window.addEventListener("focus"') && footer.includes('window.addEventListener("online"')],
  ["board fallback is single-flight", board.includes("let refreshInFlight = false") && board.includes("if (refreshInFlight || document.visibilityState")],
  ["board fallback cadence is 20 seconds", board.includes("window.setInterval(requestRefresh, 20_000)")],
  ["board fallback refreshes on focus and reconnect", board.includes('window.addEventListener("focus", requestRefresh)') && board.includes('window.addEventListener("online", requestRefresh)')],
  ["whiteboard fallback is single-flight", whiteboard.includes("let refreshInFlight = false") && whiteboard.includes("if (refreshInFlight || document.visibilityState")],
  ["whiteboard fallback cadence is 20 seconds", whiteboard.includes("window.setInterval(requestRefresh, 20_000)")],
  ["whiteboard fallback refreshes on focus and reconnect", whiteboard.includes('window.addEventListener("focus", requestRefresh)') && whiteboard.includes('window.addEventListener("online", requestRefresh)')],
  ["client performance sampling is calmer", clientPerf.includes("compact ? 20_000 : 10_000")],
  ["server performance refresh is single-flight", serverPerf.includes("const refreshingRef = useRef(false)") && serverPerf.includes("if (refreshingRef.current) return")],
  ["server performance skips hidden/offline polling", serverPerf.includes('document.visibilityState !== "visible" || !navigator.onLine')],
  ["server operations refresh is single-flight", adminOps.includes("const refreshingRef = useRef(false)") && adminOps.includes("if (refreshingRef.current) return")],
  ["server operations skips hidden/offline polling", adminOps.includes('document.visibilityState !== "visible" || !navigator.onLine')],
  ["production copy no longer contains roadmap-era jokes", !workflows.includes("Society limps forward") && !adminOps.includes("chosen peace today") && !integrations.includes("briefly behaved")],
  ["changelog array syntax is repaired", changelog.includes("readonly ClusterChangelogRelease[] = [") && !changelog.includes("readonly ClusterChangelogRelease[\n  {")],
  ["Pass H is documented", notes.includes("Roadmap Pass H") && docs.includes("Cluster v0.464")],
  ["Pass H is in changelog", changelog.includes('version: "v0.464.0"') && changelog.includes("Pass H runtime hygiene")],
  ["Pass H participates in master packaging", packager.includes("roadmap-pass-h-v464-audit.mjs")],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Roadmap Pass H v0.464: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
