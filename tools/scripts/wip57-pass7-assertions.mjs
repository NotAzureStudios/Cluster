import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const workstation = read("apps/workstation-go/main.go");
const workstationTests = read("apps/workstation-go/main_test.go");
const qtHeader = read("apps/desktop-qt/src/WorkstationServiceManager.h");
const qt = read("apps/desktop-qt/src/WorkstationServiceManager.cpp");
const broker = read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const desktopCore = read("packages/renderer/src/core/desktop.ts");
const desktopPanel = read("packages/renderer/src/features/desktop/DesktopWorkstationPanel.tsx");
const discordRuntime = read("apps/server/src/app/server-discord-runtime.ts");
const discordService = read("apps/server/src/domains/integrations/discord-production-service.ts");
const discordReadme = read("integrations/discord-bot/README.md");
const goMod = read("apps/workstation-go/go.mod");
const pkg = json("package.json");

const checks = [
  ["Official Workstation toolchain remains Go 1.27", /^go 1\.27(?:\.\d+)?$/m.test(goMod)],
  ["Workstation operations expose a progress reporter", workstation.includes("type operationProgressReporter") && workstation.includes("func(ctx context.Context, report operationProgressReporter)")],
  ["Workstation progress is bounded before terminal completion", workstation.includes("if progress > 99") && workstation.includes('o.Progress = 100')],
  ["Clone reports planning/cloning/registering/finalizing stages", ["planning", "cloning", "registering", "finalizing"].every((stage) => workstation.includes(`report("${stage}"`))],
  ["Git sync operations report meaningful action stages", workstation.includes('report("fetching", "Fetching remote refs"') && workstation.includes('report("pulling", "Fast-forwarding from upstream"') && workstation.includes('report("pushing", "Publishing local commits"')],
  ["Commit operation reports staging/commit/push stages", workstation.includes('report("staging", "Staging selected files"') && workstation.includes('report("committing", "Creating commit"') && workstation.includes('report("pushing", "Publishing commit"')],
  ["Workstation unit test covers intermediate progress snapshots", workstationTests.includes("TestOperationProgressReporterPublishesMeaningfulStage")],
  ["Qt Workstation manager owns active-operation event monitoring", qtHeader.includes("operationSnapshotChanged") && qtHeader.includes("m_operationPollTimer")],
  ["Qt operation monitor is single-shot and idle-quiescent", qt.includes("setSingleShot(true)") && qt.includes("m_operationMonitorActive = false") && qt.includes("m_operationPollTimer->stop()")],
  ["Qt operation monitor uses short active cadence only", qt.includes("OperationPollIntervalMs = 750") && qt.includes("OperationPollFailureLimit = 3")],
  ["Qt operation polling is asynchronous rather than nested request loop", qt.includes("void WorkstationServiceManager::pollOperationSnapshots()") && qt.includes("connect(reply, &QNetworkReply::finished")],
  ["Qt monitor only starts around operation activity/list state", qt.includes('capability == QStringLiteral("git.local.operation.start")') && qt.includes('capability == QStringLiteral("git.local.operation.list")')],
  ["Native broker emits Workstation operation change events", broker.includes('QStringLiteral("workstation.operations.changed")') && broker.includes("operationSnapshotChanged")],
  ["Runtime advertises native Workstation operation events", broker.includes('QStringLiteral("workstationOperationEvents"), true')],
  ["Renderer native contract models Workstation operation events", desktopCore.includes('event: "workstation.operations.changed"') && desktopCore.includes("ClusterDesktopWorkstationOperationsEvent")],
  ["Renderer dispatches Workstation operation events to subscribers", desktopCore.includes("nativeWorkstationOperationListeners") && desktopCore.includes("subscribeNativeLocalGitOperations")],
  ["Desktop Workstation panel subscribes to native operation updates", desktopPanel.includes("subscribeNativeLocalGitOperations") && desktopPanel.includes("setOperations(event.operations")],
  ["Desktop active-operation safety polling reduced from 2s", desktopPanel.includes("intervalMs: 15_000") && !desktopPanel.includes("intervalMs: 2_000")],
  ["Desktop idle operation reconciliation is one minute", desktopPanel.includes("intervalMs: 60_000")],
  ["Discord relay accepts explicit previous token only for rotation", discordRuntime.includes("CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS") && discordRuntime.includes("relayTokens.some")],
  ["Discord relay still timing-safe compares tokens", discordRuntime.includes("timingSafeEqual")],
  ["Discord actions reject inactive linked Cluster accounts", discordService.includes('user.accountState !== "ACTIVE"') && discordService.includes("DISCORD_IDENTITY_INACTIVE")],
  ["Discord actions reject expired linked Cluster accounts", discordService.includes("accessExpired") && discordService.includes("user.accessExpiresAt")],
  ["Discord channel routes require an unarchived Project", discordService.includes('project: { archived: false }')],
  ["Discord relay rotation is documented without exposing old secret to bot", discordReadme.includes("CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS") && discordReadme.includes("server-side-only")],
  ["Pass 6 regression gate remains wired", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass6:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 7 assertions passed.`);
if (failed.length) process.exit(1);
