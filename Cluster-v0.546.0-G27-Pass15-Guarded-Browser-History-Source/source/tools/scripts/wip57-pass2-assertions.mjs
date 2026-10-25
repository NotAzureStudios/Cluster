import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
const row = read("packages/renderer/src/features/projects/ProjectPortfolioItem.tsx");
const css = read("packages/renderer/src/features/projects/projects.css");
const shared = read("packages/shared/src/workstation-source-control-contracts.ts");
const sharedIndex = read("packages/shared/src/index.ts");
const unreal = JSON.parse(read("integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin"));
const discord = JSON.parse(read("integrations/discord-bot/package.json"));
const discordCommands = read("integrations/discord-bot/src/commands.mjs");
const discordRuntime = read("integrations/discord-bot/src/index.mjs");

const checks = [
  ["portfolio metric wall reduced", !page.includes('label: "Overdue"') && !page.includes('label: "Unscheduled"')],
  ["portfolio keeps primary attention signal", page.includes('label: "Needs attention"')],
  ["secondary filters use explicit disclosure", page.includes('className="projects-more-filters-v57"')],
  ["secondary filter badge exists", page.includes("secondaryFilterCount")],
  ["advanced data tools remain available", page.includes('className="projects-data-tools-v528"')],
  ["project rows use calmer v57 layout", row.includes("project-row-v57")],
  ["project rows removed board-count clutter", !row.includes("project.boards.length")],
  ["project rows expose setup readiness context", row.includes("Setup ready")],
  ["project rows retain pin action", row.includes("project-pin-v307")],
  ["project rows retain direct open action", row.includes('className="project-row-open-v310"')],
  ["portfolio responsive filter surface exists", css.includes("projects-more-filters-body-v57") && css.includes("@media(max-width:760px)")],
  ["workstation SCM protocol exists", shared.includes("CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL")],
  ["workstation SCM exposes LFS lock actions", shared.includes('"locks.acquire"') && shared.includes('"locks.release"')],
  ["workstation SCM exported from shared package", sharedIndex.includes("workstation-source-control-contracts")],
  ["Unreal plugin descriptor exists", exists("integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin")],
  ["Unreal plugin is editor-only", unreal.Modules?.some((module) => module.Type === "EditorNoCommandlet") === true],
  ["Unreal workstation client exists", exists("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterWorkstationClient.h")],
  ["Unreal client targets loopback workstation service", read("integrations/unreal/ClusterSourceControl/Config/DefaultClusterSourceControl.ini").includes("127.0.0.1:39741") && read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterWorkstationClient.cpp").includes("/v1/source-control/runtime")],
  ["Discord integration version follows Cluster", discord.version === "0.505.0"],
  ["Discord bot exposes cluster slash command", discordCommands.includes('name: "cluster"')],
  ["Discord bot reserves message-to-ticket context command", discordCommands.includes("Create Cluster Ticket")],
  ["Discord bot avoids privileged message-content intent", discordRuntime.includes("intents: 1")],
  ["Discord ticket write is gated pending Cluster identity authorization", discordRuntime.includes("not enabled yet") && discordRuntime.includes("linked Cluster identity")],
  ["reconstruction audit retained", exists("tools/scripts/reconstructed-source-audit.mjs")],
  ["integration audit retained", exists("tools/scripts/integration-foundation-audit.mjs")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 2 assertions passed.`);
if (failed.length) process.exit(1);
