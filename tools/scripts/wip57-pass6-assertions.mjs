import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const json = (rel) => JSON.parse(read(rel));

const scm = read("packages/shared/src/workstation-source-control-contracts.ts");
const workstation = read("apps/workstation-go/main.go");
const workstationTests = read("apps/workstation-go/main_test.go");
const clientHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterWorkstationClient.h");
const client = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterWorkstationClient.cpp");
const providerHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlProvider.h");
const provider = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlProvider.cpp");
const stateHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlState.h");
const state = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlState.cpp");
const revisionHeader = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlRevision.h");
const revision = read("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlRevision.cpp");
const plugin = json("integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin");
const desktopHeader = read("apps/desktop-qt/src/WorkstationServiceManager.h");
const desktop = read("apps/desktop-qt/src/WorkstationServiceManager.cpp");
const pkg = json("package.json");

const checks = [
  ["SCM contract advertises revision.materialize", scm.includes('"revision.materialize"')],
  ["SCM contract defines revision materialization input/result", scm.includes("ClusterWorkstationRevisionMaterializeInput") && scm.includes("ClusterWorkstationRevisionMaterializeResult")],
  ["Workstation advertises revision.materialize", workstation.includes('"revision.materialize"') && workstation.includes("runtimeCapabilities")],
  ["Workstation dispatches revision materialization", workstation.includes('case "revision.materialize"') && workstation.includes("sourceRevisionMaterialize")],
  ["Revision materialization validates revision arguments", workstation.includes("validGitRevision(revision)") && workstation.includes('"GIT_REVISION_INVALID"')],
  ["Revision materialization is path-scoped", workstation.includes("Exactly one repository-relative path") && workstation.includes("safePaths(paths)")],
  ["Revision materialization writes to protected Workstation cache", workstation.includes('filepath.Join(stateDir, "revisions"') && workstation.includes("0o700") && workstation.includes("0o600")],
  ["Revision materialization uses structured git show without shell", workstation.includes('runGitCommandToFile(ctx, repo.RootPath, outputPath, "show"') && !workstation.includes('runCommandToFile(ctx, repo.RootPath, outputPath, "sh"')],
  ["Workstation tests exact revision materialization", workstationTests.includes("TestSourceRevisionMaterializeWritesExactRevision")],
  ["Workstation tests invalid materialization revisions", workstationTests.includes("TestSourceRevisionMaterializeRejectsInvalidRevision")],
  ["Runtime capability test includes revision materialization", workstationTests.includes('"revision.materialize"')],
  ["Unreal revision header exists", exists("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Public/ClusterSourceControlRevision.h")],
  ["Unreal revision cpp exists", exists("integrations/unreal/ClusterSourceControl/Source/ClusterSourceControl/Private/ClusterSourceControlRevision.cpp")],
  ["Unreal revision implements ISourceControlRevision", revisionHeader.includes("public ISourceControlRevision")],
  ["Unreal revision materializes through Workstation", revision.includes("MaterializeRevisionBlocking") && !revision.includes("git ")],
  ["Unreal revision does not own credentials", !revision.includes("Authorization") && !revision.includes("credential")],
  ["Source control state now owns revision history", stateHeader.includes("History") && stateHeader.includes("ReplaceHistory")],
  ["State history lookup supports numeric and string revisions", state.includes("FindHistoryRevision(int32") && state.includes("FindHistoryRevision(const FString&")],
  ["Provider declares file revision support", providerHeader.includes("UsesFileRevisions() const override { return true; }")],
  ["UE 5.8 provider exposes current FInitResult initialization contract", providerHeader.includes("virtual FInitResult Init(EInitFlags Flags) override;") && provider.includes("ISourceControlProvider::FInitResult FClusterSourceControlProvider::Init(EInitFlags Flags)") && provider.includes("Result.ConnectionSettings = GetStatus()")],
  ["Provider allows Unreal depot/revision diff surfaces", providerHeader.includes("AllowsDiffAgainstDepot() const override { return true; }")],
  ["Provider hydrates history from Workstation", provider.includes("HydrateHistoryBlocking") && provider.includes("RequestHistoryBlocking")],
  ["Update Status honors ShouldUpdateHistory", provider.includes("ShouldUpdateHistory()") && provider.includes("HydrateHistoryBlocking(InFiles)")],
  ["Unreal client exposes history and materialization APIs", clientHeader.includes("RequestHistoryBlocking") && clientHeader.includes("MaterializeRevisionBlocking")],
  ["Unreal client parses Workstation history", client.includes('TEXT("repository.history")') && client.includes("FClusterWorkstationHistoryEntry")],
  ["Unreal client requests revision materialization", client.includes('TEXT("revision.materialize")') && client.includes('TEXT("materializedPath")')],
  ["Provider owns async Workstation command queue", providerHeader.includes("FClusterAsyncSourceControlCommand") && providerHeader.includes("PendingCommands")],
  ["Async Check In and Sync route through Workstation operation lifecycle", provider.includes("QueueAsyncWorkstationOperation") && provider.includes('TEXT("operation.start")') === false && client.includes('TEXT("operation.start")')],
  ["Async worker starts/statuses/cancels Workstation operations", provider.includes("StartOperationBlocking") && provider.includes("GetOperationStatusBlocking") && provider.includes("CancelOperationBlocking")],
  ["Async provider completion is drained from Tick", provider.includes("void FClusterSourceControlProvider::Tick()") && provider.includes("Completion.Execute")],
  ["Provider exposes operation cancellation", provider.includes("CanCancelOperation") && provider.includes("CancelOperation") && provider.includes("bCancelRequested")],
  ["Async source-control worker never spawns Git", !provider.includes("CreateProc") && !provider.includes("FPlatformProcess::ExecProcess")],
  ["Plugin source version advanced for Pass 6", plugin.Version >= 3 && plugin.VersionName === "0.3.0"],
  ["Qt Workstation manager exposes canonical source-control action bridge", desktopHeader.includes("requestSourceControlAction") && desktop.includes("/v1/source-control/actions")],
  ["Qt source-control bridge uses the same protocol envelope", desktop.includes('QStringLiteral("protocol"), protocol()') && desktop.includes('QStringLiteral("requestId")')],
  ["Qt source-control bridge keeps bearer authentication", desktop.includes('QByteArray("Bearer ") + discovery.token.toUtf8()')],
  ["Pass 5 assertions remain wired", pkg.scripts?.["wip57:pass5:assertions"]?.includes("wip57-pass5-assertions.mjs")],
  ["Pass 6 source-foundation gate is wired", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass6:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 6 assertions passed.`);
if (failed.length) process.exit(1);
