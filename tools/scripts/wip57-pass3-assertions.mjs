import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const json = (rel) => JSON.parse(read(rel));

const prisma = read("apps/server/prisma/schema.prisma");
const projectRoutes = read("apps/server/src/domains/projects/project-routes.ts");
const provisioning = read("apps/server/src/domains/projects/project-provisioning.ts");
const createDrawer = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const createAdvanced = read("packages/renderer/src/features/create/SharedCreateProjectAdvancedOptions.tsx");
const planning = read("packages/renderer/src/features/projects/ProjectPlanningPanel.tsx");
const dataFields = read("packages/shared/src/domain-data-fields.ts");
const projectQuery = read("apps/server/src/domains/projects/project-data-query.ts");
const searchIndex = read("apps/server/src/domains/search/search-index-builder.ts");
const workstation = read("apps/workstation-go/main.go");
const workstationTest = read("apps/workstation-go/main_test.go");
const desktopManager = read("apps/desktop-qt/src/WorkstationServiceManager.cpp");
const nativeBroker = read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const unrealClient = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterWorkstationClient.cpp");
const unrealConfig = read("integrations/unreal/ClusterSourceControl/Config/DefaultClusterSourceControl.ini");
const discordService = read("apps/server/src/domains/integrations/discord-production-service.ts");
const discordRuntime = read("apps/server/src/app/server-discord-runtime.ts");
const discordRelay = read("integrations/discord-bot/src/index.mjs");
const discordClient = read("integrations/discord-bot/src/cluster-client.mjs");
const discordCommands = read("integrations/discord-bot/src/commands.mjs");
const requestPolicy = read("apps/server/src/domains/access/request-policy.ts");
const toolchain = json("config/toolchain-versions.json");
const cmake = read("apps/desktop-qt/CMakeLists.txt");
const launcher = read("apps/server-launcher-go/main.go");
const launcherWindows = read("apps/server-launcher-go/runtime_windows.go");

const checks = [
  ["Project identity schema has external/public naming", prisma.includes("externalName  String?") && prisma.includes("codename      String?") && prisma.includes('aliases       String   @default("[]")')],
  ["Project identity migration exists", exists("apps/server/prisma/migrations/20261006190000_rc17_wip57_project_identity/migration.sql")],
  ["Project provisioning stores modern identity fields", provisioning.includes("externalName") && provisioning.includes("codename") && provisioning.includes("aliases")],
  ["Project primary create flow keeps advanced configuration secondary", createDrawer.includes("SharedCreateProjectAdvancedOptions") && createDrawer.includes("Advanced")],
  ["Project advanced create surface owns external name/codename/aliases", createAdvanced.includes("External / public name") && createAdvanced.includes("Codename") && createAdvanced.includes("Aliases / previous names")],
  ["Project lifecycle endpoint exists", projectRoutes.includes('/api/projects/:projectId/lifecycle') && projectRoutes.includes('z.enum(["cancel", "reactivate"])')],
  ["Project terminal state mutation is not a generic PATCH dropdown", projectRoutes.includes("PROJECT_COMPLETION_CLOSEOUT_REQUIRED") && projectRoutes.includes("PROJECT_CANCELLATION_LIFECYCLE_REQUIRED")],
  ["Project cancellation requires a reason", projectRoutes.includes("Cancellation requires a reason")],
  ["Project planning exposes lifecycle surface", planning.includes("Project lifecycle") && planning.includes("onLifecycleAction")],
  ["Project data platform exposes external name and codename", dataFields.includes('id: "externalName"') && dataFields.includes('id: "codename"')],
  ["Project search includes aliases and external identity", projectQuery.includes("externalName") && projectQuery.includes("codename") && projectQuery.includes("aliases") && searchIndex.includes("projectAliases")],

  ["Workstation source service exists", exists("apps/workstation-go/main.go") && exists("apps/workstation-go/main_test.go")],
  ["Workstation uses ephemeral loopback port", workstation.includes('defaultListen   = "127.0.0.1:0"')],
  ["Workstation publishes authenticated discovery", workstation.includes('Token     string `json:"token"`') && workstation.includes("crypto/rand") && workstation.includes("Authorization")],
  ["Workstation native IPC reports raw path isolation", workstation.includes('"rawPathExposure": false')],
  ["Workstation does not shell Git through command strings", workstation.includes("exec.CommandContext") && !workstation.includes('exec.Command("cmd"') && !workstation.includes('exec.Command("sh"')],
  ["Workstation has real bounded secret scanning", workstation.includes("maxSecretScanBytes") && workstation.includes("nativeSecretScan") && workstation.includes("private-key") && !workstation.includes('"scannedAddedLines": 0, "scannedBytes": 0')],
  ["Secret scan response is tested for redaction", workstationTest.includes("TestSecretScanBlocksStagedPrivateKeyWithoutEchoingSecret") && workstationTest.includes("response leaked matched secret")],
  ["Outgoing secret scan requires an upstream", workstation.includes("GIT_UPSTREAM_REQUIRED") && workstationTest.includes("TestSecretScanRejectsOutgoingWithoutUpstream")],
  ["LFS availability checks git lfs itself", workstation.includes('s.git(repo, 5*time.Second, "lfs", "version")')],
  ["Desktop retires stale Workstation discovery after network failure", desktopManager.includes("retire the stale record") && desktopManager.includes("QFile::remove(discoveryPath())")],
  ["Desktop capability broker delegates Git to Workstation", nativeBroker.includes("git.local.secretScan") && nativeBroker.includes("requestCapability")],

  ["Unreal no longer pins a fixed Workstation port", !unrealConfig.includes("39741") && !unrealClient.includes("39741")],
  ["Unreal reads Workstation discovery", unrealClient.includes("source-control-endpoint.json")],
  ["Unreal authenticates local requests", unrealClient.includes("Authorization") && unrealClient.includes("Bearer")],
  ["Unreal validates source-control protocol", unrealClient.includes("Protocol") && unrealClient.includes("CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL")],

  ["Discord server remains production authority", discordService.includes("authorizeDiscordUser") && discordService.includes("createTicketFromInteraction") && discordService.includes("processVerifiedInteraction")],
  ["Discord supports server-owned gateway transport", discordService.includes("processGatewayInteraction") && discordRuntime.includes("/api/integrations/discord/gateway-relay")],
  ["Discord gateway relay uses separate 32+ char secret", discordRuntime.includes("CLUSTER_DISCORD_RELAY_TOKEN") && discordRuntime.includes("expected.length >= 32") && discordRuntime.includes("timingSafeEqual")],
  ["Discord relay endpoint self-authenticates before session middleware", requestPolicy.includes('/api/integrations/discord/gateway-relay')],
  ["Discord sidecar is transport-only", discordClient.includes("relayDiscordInteraction") && discordRelay.includes("relayDiscordInteraction") && !discordRelay.includes("getClusterStatus")],
  ["Discord Gateway uses zero privileged intents", discordRelay.includes("intents: 0")],
  ["Discord Gateway handles resume and heartbeat ACK", discordRelay.includes("op: 6") && discordRelay.includes("case 11") && discordRelay.includes("heartbeatAcked")],
  ["Discord commands converge on /cluster status + help", discordCommands.includes('name: "cluster"') && discordCommands.includes('name: "status"') && discordCommands.includes('name: "help"') && discordService.includes('name: "cluster"')],
  ["Discord message-to-ticket stays linked-identity authorized", discordService.includes("DISCORD_IDENTITY_NOT_LINKED") && discordService.includes('"tickets", "contribute"')],

  ["Active machine-readable toolchain manifest exists", exists("config/toolchain-versions.json") && toolchain.cluster === "0.505.0"],
  ["Toolchain requires Node 24.20.0", toolchain.node?.version === "24.20.0"],
  ["Toolchain requires Go 1.27 language line", String(toolchain.go?.minimum).startsWith("1.27")],
  ["Toolchain targets Qt 6.11.2", toolchain.qt?.version === "6.11.2"],
  ["Toolchain recommends CMake 4.4.4", toolchain.cmake?.recommended === "4.4.4"],
  ["Recovered Desktop version hold is explicit", toolchain.desktop?.parityVersionHold === "0.482.0" && cmake.includes("project(ClusterDesktop VERSION 0.482.0")],
  ["Desktop CMake declares modern policy range", cmake.includes("cmake_minimum_required(VERSION 3.31.0...4.4)")],
  ["Current launcher runtime versions are forward-ported", launcher.includes('privateNodeVersion = "24.20.0"') && launcherWindows.includes('postgresVersion = "18.6"') && launcherWindows.includes('postgresInstallerRevision = "1"')],
  ["Toolchain drift checker exists", exists("tools/scripts/toolchain-versions.mjs") && json("package.json").scripts?.["toolchain:check"]],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 3 assertions passed.`);
if (failed.length) process.exit(1);
