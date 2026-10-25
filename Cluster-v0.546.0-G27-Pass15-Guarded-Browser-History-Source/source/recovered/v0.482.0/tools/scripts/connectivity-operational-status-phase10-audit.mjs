import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [model, component, sync, footer, app, auth, planning, primitives, shellCss, docs, pkgText, packager, notes] = await Promise.all([
  text("packages/renderer/src/components/operational-status.ts"),
  text("packages/renderer/src/components/ClusterOperationalStatus.tsx"),
  text("packages/renderer/src/components/SyncStatusIndicator.tsx"),
  text("packages/renderer/src/components/AppVersionFooter.tsx"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"),
  text("packages/renderer/src/features/auth/AuthScreens.tsx"),
  text("packages/renderer/src/features/projects/ProjectPlanningPanel.tsx"),
  text("packages/renderer/src/styles/design-system/primitives.css"),
  text("packages/renderer/src/features/shell/shell.css"),
  text("docs/CONNECTIVITY_OPERATIONAL_STATUS_PHASE10.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.433.0.md"),
]);

for (const state of ["online", "syncing", "pending", "offline", "reconnecting", "server_unreachable", "auth_expired", "read_only", "degraded", "conflict"]) {
  check(`operational vocabulary includes ${state}`, model.includes(`"${state}"`));
}
check("operational states map onto interaction states", model.includes("operationalInteractionState") && model.includes('state === "server_unreachable"') && model.includes('return "conflict"'));
check("sync model distinguishes offline from server reachability", model.includes("!snapshot.online") && model.includes("!snapshot.serverReachable"));
check("sync model exposes reconnecting posture", model.includes('"reconnecting"') && model.includes("snapshot.consecutiveFailures") && model.includes("snapshot.nextSyncAt"));
check("sync model keeps pending explicit", model.includes('state: "pending"') && model.includes("stored locally"));
check("sync model requires conflict review", model.includes('state: "conflict"') && model.includes("need attention"));
check("server model distinguishes degraded health", model.includes('input.state === "degraded"') && model.includes('label: "Service degraded"'));
check("server model distinguishes version conflict", model.includes("input.mismatched") && model.includes('label: "Version conflict"'));

check("shared operational component exposes product and interaction states", component.includes("data-operational-state={model.state}") && component.includes("data-cluster-state={model.interactionState}"));
check("shared operational component exposes counts", component.includes("model.pendingCount") && component.includes("model.conflictCount"));
check("shared operational component exposes last check time", component.includes("Checked") && component.includes("lastCheckedAt"));
check("shared operational component announces severe states", component.includes('role={model.interactionState === "error" || model.interactionState === "conflict" ? "alert" : "status"}'));
check("operational status styling uses semantic tokens", primitives.includes("cluster-operational-status-v433") && !primitives.slice(primitives.indexOf("v0.433 operational status contract")).includes("!important"));
check("shell placement is responsive", shellCss.includes("navigation-operational-status-v433") && shellCss.includes("max-width:720px"));

check("sync center derives canonical operational status", sync.includes("deriveSyncOperationalStatus(state)") && sync.includes("operational.detail"));
check("sync center retains explicit conflict review", sync.includes("sync-conflict-review-v304") && sync.includes("resolveQueuedConflict"));
check("sync center retains last-sync and server-seen timestamps", sync.includes("Last sync") && sync.includes("Server seen"));
check("sync center retains pending/conflict metrics", sync.includes("<span>Pending</span>") && sync.includes("<span>Conflicts</span>"));

check("server footer derives canonical server posture", footer.includes("deriveServerOperationalStatus") && footer.includes("operational.label"));
check("server footer retains request diagnostics", footer.includes("requestId") && footer.includes("consecutiveFailures") && footer.includes("lastHealthyAt"));
check("server footer retains explicit refresh", footer.includes(">Refresh</ClusterButton>"));

check("application shell consumes compact operational projection", app.includes("getOfflineOperationalSnapshot") && app.includes("deriveSyncOperationalStatus(offlineOperational)") && !app.includes("getOfflineSyncSnapshot"));
check("shell only persists consequential operational states", app.includes('["offline", "reconnecting", "server_unreachable", "conflict"]'));
check("shell exposes retry connection action", app.includes(">Retry connection</ClusterButton>"));
check("shell routes conflicts to sync recovery settings", app.includes(">Review sync</ClusterButton>") && app.includes('setSettingsInitialSection("desktop")'));
check("taskbar does not restore the sync indicator", !app.includes("<SyncStatusIndicator") && !app.includes("SyncStatusIndicator"));

check("expired sessions use canonical auth state", auth.includes('state: "auth_expired"') && auth.includes('label: "Authentication expired"'));
check("read-only planning uses canonical operational state", planning.includes('state: "read_only"') && planning.includes('label: "Read only"'));
check("read-only planning retains permission explanation", planning.includes("detail: permissionReason"));

check("Phase 10 docs preserve server authority", docs.includes("server remains authoritative") && docs.includes("does not") && docs.includes("automatically resolve conflicts"));
check("Phase 10 docs preserve no-taskbar-sync decision", docs.includes("taskbar remains free of a permanent synchronization indicator"));
check("Phase 10 docs define release-blocking boundary", docs.includes("## Release-blocking boundary") && docs.includes("connectivity-operational-status-phase10-audit.mjs"));
check("Phase 10 release notes identify capability", notes.includes("connectivity-operational-status-phase10-v1") && notes.includes("API contract: unchanged from `2026-08-02.62`"));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 10 gate", String(pkg.scripts?.audit || "").includes("connectivity-operational-status-phase10-audit.mjs"));
check("named Phase 10 audit exists", String(pkg.scripts?.["audit:connectivity-operational-status-phase10"] || "").includes("connectivity-operational-status-phase10-audit.mjs"));
check("master packager invokes Phase 10 gate", packager.includes("connectivity-operational-status-phase10-audit.mjs"));
const docOccurrences = packager.split("docs/CONNECTIVITY_OPERATIONAL_STATUS_PHASE10.md").length - 1;
check("master and source packages carry Phase 10 docs", docOccurrences >= 2);

console.log(`\nConnectivity & operational status Phase 10 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
