import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const shared = read("packages/shared/src/workstation-source-control-contracts.ts");
for (const required of ["repository.resolve", "repository.status", "files.status", "files.checkout", "changes.commit", "locks.acquire", "locks.release", "revision.materialize", "operation.start", "operation.status", "operation.cancel"]) {
  if (!shared.includes(`\"${required}\"`)) failures.push(`Workstation SCM contract missing ${required}.`);
}

const workstation = read("apps/workstation-go/main.go");
if (!workstation.includes('defaultListen   = "127.0.0.1:0"')) failures.push("Workstation must bind an ephemeral loopback port by default.");
if (!workstation.includes("nativeSecretScan")) failures.push("Workstation must provide the real local secret-scan implementation.");
if (!workstation.includes("Authorization")) failures.push("Workstation authenticated IPC guard is missing.");
if (!workstation.includes("sourceOperationStart") || !workstation.includes("sourceOperationStatus") || !workstation.includes("sourceOperationCancel")) failures.push("Workstation SCM background-operation lifecycle is incomplete.");
if (!workstation.includes("sourceRevisionMaterialize") || !workstation.includes("runGitCommandToFile")) failures.push("Workstation revision materialization is incomplete.");

const plugin = JSON.parse(read("integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin"));
if (plugin.Modules?.[0]?.Type !== "EditorNoCommandlet") failures.push("Unreal integration must remain EditorNoCommandlet during v1 source-control development.");
const unrealClient = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterWorkstationClient.cpp");
if (!unrealClient.includes("source-control-endpoint.json") || !unrealClient.includes("Authorization")) failures.push("Unreal client must discover and authenticate to the Workstation broker.");
if (unrealClient.includes("127.0.0.1:39741")) failures.push("Unreal client still pins the retired fixed Workstation endpoint.");
const unrealProvider = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlProvider.cpp");
const unrealProviderHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlProvider.h");
const unrealModule = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlModule.cpp");
if (!unrealProviderHeader.includes("public ISourceControlProvider") || !unrealModule.includes('RegisterModularFeature(TEXT("SourceControl")')) failures.push("Unreal integration is not registered as a real Source Control provider.");
if (!unrealProvider.includes('TEXT("files.status")') || !unrealProvider.includes('TEXT("files.checkout")') || !unrealProvider.includes('TEXT("changes.commit")')) failures.push("Unreal provider is missing Workstation-backed source-control operations.");
if (!unrealClient.includes('TEXT("repository.resolve")')) failures.push("Unreal provider cannot resolve the trusted repository containing the Unreal project.");
if (!unrealProviderHeader.includes("UsesFileRevisions() const override { return true; }") || !unrealProvider.includes("HydrateHistoryBlocking")) failures.push("Unreal provider revision/history adapter is incomplete.");
if (!unrealProvider.includes("QueueAsyncWorkstationOperation") || !unrealProvider.includes("StartOperationBlocking") || !unrealProvider.includes("GetOperationStatusBlocking") || !unrealProvider.includes("CancelOperationBlocking")) failures.push("Unreal provider asynchronous Workstation execution is incomplete.");

const discordService = read("apps/server/src/domains/integrations/discord-production-service.ts");
const discordRuntime = read("apps/server/src/app/server-discord-runtime.ts");
const discordRelay = read("integrations/discord-bot/src/index.mjs");
if (!discordService.includes("processVerifiedInteraction") || !discordService.includes("authorizeDiscordUser")) failures.push("Cluster server is not the canonical Discord interaction/authorization authority.");
if (!discordService.includes("deadLetter") || !discordService.includes("retrying")) failures.push("Discord delivery diagnostics do not distinguish retrying and terminal failures.");
if (!discordRuntime.includes("/api/integrations/discord/gateway-relay") || !discordRuntime.includes("CLUSTER_DISCORD_RELAY_TOKEN")) failures.push("Private-install Discord Gateway relay endpoint is missing.");
if (!discordRelay.includes("intents: 0") || !discordRelay.includes("relayDiscordInteraction")) failures.push("Discord sidecar must be a zero-privileged-intent transport relay.");

const commands = spawnSync(process.execPath, [path.join(root, "integrations/discord-bot/src/register-commands.mjs"), "--print"], { encoding: "utf8" });
if (commands.status !== 0) failures.push(`Discord command manifest failed to render: ${commands.stderr || commands.stdout}`);
else {
  const payload = JSON.parse(commands.stdout);
  const cluster = payload.find((command) => command.name === "cluster");
  if (!cluster) failures.push("Discord /cluster command is missing.");
  if (!cluster?.options?.some((option) => option.name === "status") || !cluster?.options?.some((option) => option.name === "help")) failures.push("Discord /cluster status/help subcommands are missing.");
  if (!payload.some((command) => command.name === "Create Cluster Ticket" && command.type === 3)) failures.push("Discord message context Ticket command is missing.");
}
for (const file of ["src/index.mjs", "src/register-commands.mjs", "src/cluster-client.mjs", "src/commands.mjs"]) {
  const checked = spawnSync(process.execPath, ["--check", path.join(root, "integrations/discord-bot", file)], { encoding: "utf8" });
  if (checked.status !== 0) failures.push(`Discord syntax check failed for ${file}: ${checked.stderr || checked.stdout}`);
}
if (failures.length) {
  console.error("Integration foundation audit failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Integration foundation audit passed.");
