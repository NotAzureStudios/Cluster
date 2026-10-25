import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const pkg = json("package.json");
const transfer = read("packages/renderer/src/features/shell/TaskbarTransferCenter.tsx");
const taskbar = read("packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx");
const shell = read("packages/renderer/src/features/shell/shell-v2.css");
const contracts = read("packages/shared/src/project-snapshot-contracts.ts");
const snapshotService = read("apps/server/src/domains/projects/project-snapshot-service.ts");
const overview = read("packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx");
const dashboard = read("packages/renderer/src/features/application/modules/ApplicationDashboard.tsx");
const myWork = read("packages/renderer/src/features/work/MyWorkPage.tsx");
const manifest = read("packages/shared/src/cluster-manifest.ts");

const checks = [
  ["Taskbar has a first-class Transfer Center component", transfer.includes("export function TaskbarTransferCenter") && taskbar.includes("<TaskbarTransferCenter />")],
  ["Transfer Center projects durable browser uploads", transfer.includes("useSyncExternalStore(subscribeOfflineSync") && transfer.includes("offline.uploads")],
  ["Transfer Center projects native Desktop transfers", transfer.includes("getNativeTransfers") && transfer.includes("subscribeNativeTransfers")],
  ["Transfer Center exposes browser pause/resume/retry/remove", ["pauseOfflineUpload", "resumeOfflineUpload", "retryOfflineUpload", "discardOfflineUpload"].every((token) => transfer.includes(token))],
  ["Transfer Center exposes native pause/resume/retry/cancel", ["pauseNativeTransfer", "resumeNativeTransfer", "retryNativeTransfer", "cancelNativeTransfer"].every((token) => transfer.includes(token))],
  ["Transfer Center supports retry-all across browser and native queues", transfer.includes("retryAllOfflineFailures") && transfer.includes("retryAllNativeTransfers") && transfer.includes("Promise.allSettled")],
  ["Transfer Center exposes upload/download counts in taskbar chrome", transfer.includes("↑{uploadingCount} ↓{downloadingCount}")],
  ["Transfer Center surfaces server-held posture", transfer.includes("serverHeld") && transfer.includes("held until the server is writable and reachable")],
  ["Transfer Center uses canonical Shell 2.0 styling", shell.includes(".cluster-transfer-center") && shell.includes(".cluster-transfer-popover")],
  ["Transfer Center styling avoids important overrides", !shell.split("/* Transfer Center:")[1]?.includes("!important")],

  ["Project health contract includes explicit at-risk state", contracts.includes('"healthy" | "attention" | "at_risk" | "blocked"')],
  ["Project health derivation separates attention, at-risk and blocked", snapshotService.includes('attentionScore >= 60') && snapshotService.includes('attentionScore >= 30') && snapshotService.includes('"at_risk"')],
  ["Home understands Project at-risk health", dashboard.includes('health.state === "at_risk"') && dashboard.includes('label: "At Risk"')],
  ["My Work understands Project at-risk health", myWork.includes('health.state === "at_risk"') && myWork.includes('label: "At Risk"')],
  ["Project Overview explicitly separates lifecycle, production phase, health, owner and integrations", ["Lifecycle", "Production phase", "Health", "Owner", "Integrations"].every((label) => overview.includes(`label: "${label}"`))],
  ["Project Overview derives production phase from Project Control phases", overview.includes('item.kind === "phase"') && overview.includes('item.status === "active"')],
  ["Project Overview derives integration count from canonical bindings", overview.includes("project.integrationBindings") && overview.includes("integrationCount")],
  ["Project Integrations action routes to canonical links tool", overview.includes('onOpenSection("links")') && !overview.includes('onOpenSection("connections")')],
  ["Project links tool is user-facing Integrations", manifest.includes('links: { label: "Integrations"')],
  ["Pass 12 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass12:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 12 Transfer + Projects assertions passed.`);
if (failed.length) process.exit(1);
