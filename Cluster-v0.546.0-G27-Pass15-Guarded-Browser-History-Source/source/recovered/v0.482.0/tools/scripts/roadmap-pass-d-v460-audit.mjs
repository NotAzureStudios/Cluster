import { readFile } from "node:fs/promises";

const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");
const [styles, css, launcherUi, host, packageJson, packager] = await Promise.all([
  read("packages/renderer/src/styles.css"),
  read("packages/renderer/src/styles/responsive-v460.css"),
  read("apps/server-launcher-go/launcher_ui_windows.go"),
  read("apps/host-go/main.go"),
  read("package.json"),
  read("tools/scripts/package-cluster-master.mjs"),
]);

const checks = [
  ["Pass D responsive layer is imported", styles.includes('@import "./styles/responsive-v460.css";')],
  ["board lanes become touch snap targets", css.includes("scroll-snap-type: x mandatory") && css.includes("--board-column-width-v297: calc(100vw - 34px)")],
  ["whiteboard phone toolbar moves to thumb zone", css.includes(".whiteboard-toolbar.expanded") && css.includes("position: fixed") && css.includes("env(safe-area-inset-bottom)")],
  ["timeline map keeps useful mobile scale", css.includes("min-width: 760px") && css.includes("timeline-map-scroll-v153")],
  ["ticket filters compact without breaking inspector architecture", css.includes("tickets-control-bar-v184") && css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))")],
  ["calendar preserves seven-day scanability", css.includes("calendar-grid-v189") && css.includes("min-width: 770px")],
  ["packet reader prioritizes selected content on phone", css.includes("packet-reader-v248") && css.includes("min-height: calc(100dvh - 180px)")],
  ["build and QA workbenches get responsive convergence", css.includes("build-artifact-workbench-v309") && css.includes("qa-runs-workspace-v309")],
  ["Pass D adds no forced CSS styles", !css.includes("!important")],
  ["Pass D adds no raw hex CSS colors", !/#[0-9a-f]{3,8}\b/i.test(css)],
  ["host exposes authoritative readiness boundary", host.includes('log.Printf("Ready:     %s", h.origin)')],
  ["Windows panel waits for readiness instead of process spawn", launcherUi.includes('c.setActivity("Waiting for API and web readiness")') && !launcherUi.includes('c.transition(panelRunning, "")\n\tfmt.Printf("[%s] Cluster Host started')],
  ["Windows panel recognizes Ready log", launcherUi.includes('strings.HasPrefix(trimmed, "Ready:")') && launcherUi.includes("Cluster Server is ready")],
  ["repair and start recovery exists", launcherUi.includes('"Repair & Start"') && launcherUi.includes('case "repair"')],
  ["manual diagnostic tools are concurrency bounded", launcherUi.includes("updateInFlight") && launcherUi.includes("doctorInFlight")],
  ["Pass D audit participates in normal audit", packageJson.includes("roadmap-pass-d-v460-audit.mjs")],
  ["Pass D audit participates in packaging", packager.includes("roadmap-pass-d-v460-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Roadmap Pass D v0.460: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
