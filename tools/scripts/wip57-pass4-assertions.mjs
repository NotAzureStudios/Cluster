import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const json = (rel) => JSON.parse(read(rel));

const contract = read("packages/shared/src/workstation-source-control-contracts.ts");
const workstation = read("apps/workstation-go/main.go");
const workstationTest = read("apps/workstation-go/main_test.go");
const providerHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlProvider.h");
const provider = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlProvider.cpp");
const stateHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlState.h");
const state = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlState.cpp");
const client = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterWorkstationClient.cpp");
const module = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlModule.cpp");
const plugin = json("integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin");
const readme = read("integrations/unreal/ClusterSourceControl/README.md");
const primitives = read("packages/renderer/src/styles/design-system/primitives.css");
const pkg = json("package.json");
const toolchain = json("config/toolchain-versions.json");
const discordService = read("apps/server/src/domains/integrations/discord-production-service.ts");
const discordRelay = read("integrations/discord-bot/src/index.mjs");
const prisma = read("apps/server/prisma/schema.prisma");

const checks = [
  ["Pass 3 identity migration remains present", exists("apps/server/prisma/migrations/20261006190000_rc17_wip57_project_identity/migration.sql") && prisma.includes("externalName  String?") && prisma.includes("codename      String?")],
  ["Modern source toolchain contract is retained", toolchain.cluster === json("package.json").version && String(toolchain.go?.minimum).startsWith("1.27") && toolchain.qt?.version === "6.11.2"],
  ["Workstation contract exposes repository.resolve", contract.includes('"repository.resolve"')],
  ["Workstation file-state contract exposes tracked and ignored state", contract.includes("tracked: boolean") && contract.includes("ignored: boolean")],
  ["Workstation resolves a repository from project path", workstation.includes("resolveSourceRepository") && workstation.includes('projectPath')],
  ["Repository resolution prefers the most specific trusted root", workstationTest.includes("TestResolveSourceRepositoryPrefersDeepestTrustedRepository")],
  ["Requested clean tracked files remain visible", workstationTest.includes("TestSourceFileStatesReturnsCleanRequestedFiles") && workstation.includes('state = "clean"')],
  ["Workstation file state includes LFS lockability", workstation.includes('"lockable"') && workstation.includes('"binary"') && workstation.includes('"lock"')],
  ["Unreal provider implements ISourceControlProvider", providerHeader.includes("public ISourceControlProvider")],
  ["Unreal provider is registered as SourceControl modular feature", module.includes('RegisterModularFeature(TEXT("SourceControl")') && module.includes('UnregisterModularFeature(TEXT("SourceControl")')],
  ["Unreal provider resolves repository through Workstation", client.includes('TEXT("repository.resolve")') && provider.includes("ResolveRepositoryBlocking")],
  ["Unreal provider refreshes file state through Workstation", provider.includes('TEXT("files.status")')],
  ["Unreal provider maps checkout to Workstation LFS-aware checkout", provider.includes('TEXT("files.checkout")') && provider.includes('Input->SetBoolField(TEXT("lock"), true)')],
  ["Unreal provider maps check-in to Workstation commit", provider.includes('TEXT("changes.commit")') && provider.includes('GetDescription().ToString()')],
  ["Unreal provider maps sync to Workstation pull", provider.includes('TEXT("repository.sync")') && provider.includes('TEXT("pull")')],
  ["Unreal provider releases owned LFS locks after revert/check-in", provider.includes("ReleaseOwnedLocks(InFiles)") && provider.includes('TEXT("locks.release")')],
  ["Unreal provider has no direct Git process execution", !provider.includes("CreateProc") && !client.includes("CreateProc") && !provider.includes('TEXT("git ') && !client.includes('TEXT("git ')],
  ["Unreal provider has explicit file-state object", stateHeader.includes("public ISourceControlState") && state.includes("UpdateFromWorkstation")],
  ["Unreal state models conflicting files", stateHeader.includes('State == TEXT("conflicted")')],
  ["Unreal state models other-user locks", state.includes('LockOwnership == TEXT("theirs")') && state.includes("LockOwner")],
  ["UE 5.8 final-method break is guarded", providerHeader.includes("ENGINE_MINOR_VERSION < 8") && providerHeader.includes("UsesSoftRevertOnDelete")],
  ["UE 5.8 change-state methods are implemented", providerHeader.includes("HasChangesToSync") && providerHeader.includes("HasChangesToCheckIn") && provider.includes("HasChangesToCheckIn")],
  ["UE 5.7+ branch accessor is represented", providerHeader.includes("GetStateBranchAtIndex")],
  ["Unreal loopback discovery remains authenticated", client.includes("source-control-endpoint.json") && client.includes("Authorization") && client.includes("Bearer")],
  ["Unreal validates discovery protocol", client.includes("CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL")],
  ["Unreal provider plugin metadata retains or advances the Pass 4 baseline", plugin.Version >= 2 && Number.parseFloat(plugin.VersionName) >= 0.2],
  ["Unreal README does not overclaim certification", /not yet.*certif/i.test(readme) || /not.*runtime-certif/i.test(readme)],
  ["Unreal README records UE5.8 provider work", readme.includes("ISourceControlProvider") && readme.includes("5.8")],
  ["Discord production authority remains server-side", discordService.includes("authorizeDiscordUser") && discordService.includes("processVerifiedInteraction")],
  ["Discord relay remains zero-privileged-intent transport", discordRelay.includes("intents: 0")],
  ["Shared dialog footer wraps actions", primitives.includes(".cluster-dialog-v389 > footer { display: flex; justify-content: flex-end; flex-wrap: wrap")],
  ["Shared buttons are bounded by their container", primitives.includes("max-width: 100%; flex: 0 0 auto; display: inline-flex")],
  ["Shared action groups wrap within available width", primitives.includes(".cluster-action-group-v425 { display: flex; align-items: center; flex-wrap: wrap") && primitives.includes("max-width: 100%")],
  ["Shared toolbar is width-bounded and wrapping", primitives.includes(".cluster-toolbar-v425 { min-height: var(--cluster-control-height); width: 100%; max-width: 100%;")],
  ["Phone-width text buttons may wrap instead of collide", primitives.includes("@media (max-width: 520px)") && primitives.includes("white-space: normal")],
  ["Pass 4 source-foundation verification is wired", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass4:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 4 assertions passed.`);
if (failed.length) process.exit(1);
