import { readFileSync } from "node:fs";

function read(path) { return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"); }

const pkg = JSON.parse(read("package.json"));
const create = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const catalog = read("packages/renderer/src/features/create/create-mode-catalog.ts");
const readiness = read("packages/renderer/src/features/create/create-readiness.ts");
const models = read("packages/renderer/src/features/application/application-models.ts");
const settings = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const foundation = read("packages/renderer/src/features/operations/modules/operations-foundation.tsx");
const mainQml = read("apps/desktop-qt/qml/Main.qml");
const broker = read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const desktopReadme = read("apps/desktop-qt/README.md");
const nativeStatus = read("docs/DESKTOP_NATIVE_FEATURE_STATUS_V479.md");
const notes = read("RELEASE_NOTES_v0.479.0.md");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const packager = read("tools/scripts/package-cluster-master.mjs");
const verifier = read("tools/scripts/release-verify-artifacts.mjs");

const createModes = ["project","card","report","bug","build","timeline","calendar","time","sprint","whiteboard"];
const versionParts = String(pkg.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
const atLeast479 = versionParts[0] > 0 || versionParts[1] > 479 || (versionParts[1] === 479 && versionParts[2] >= 0);

const checks = [
  ["v0.479 product baseline is retained", atLeast479],
  ["Create catalog is extracted from the drawer", create.includes("CREATE_MODE_CATALOG") && catalog.includes("CREATE_MODE_GROUPS") && catalog.includes("CREATE_MODE_GUIDANCE")],
  ["all ten creator types are catalogued", createModes.every((mode) => catalog.includes(`id: "${mode}"`))],
  ["create search has semantic aliases", catalog.includes('keywords: ["qa"') && catalog.includes('keywords: ["artifact"') && catalog.includes('keywords: ["focus"')],
  ["local readiness validation is centralized", create.includes("createReadinessIssues") && readiness.includes("Timeline end must be after the start") && readiness.includes("Canvas width must be between 640 and 8000")],
  ["keyboard create submission is available", create.includes('(event.metaKey || event.ctrlKey)') && create.includes("void submitSharedCreate()")],
  ["readiness feedback is rendered before API submission", create.includes("shared-create-readiness-v479") && create.includes("if (readinessIssues.length > 0)")],
  ["draft snapshot covers project ownership and lifecycle", models.includes("projectLeadId?: string") && models.includes("projectStatus?: ProjectStatus") && create.includes("projectLeadId,") && create.includes("projectStatus,")],
  ["draft snapshot covers build review metadata", models.includes('buildQaStatus?: BuildArtifactRecord["qaStatus"]') && models.includes("buildMeta?: Record<string, string>") && create.includes("setBuildMeta(value.buildMeta || buildMeta)")],
  ["draft snapshot covers timeline and schedule colors", models.includes("timelineColor?: string") && models.includes("timeColor?: string") && create.includes("setTimelineColor(value.timelineColor || timelineColor)")],
  ["all creator types are available as the quick-create preference", createModes.every((mode) => settings.includes(`<option value="${mode}">`))],
  ["legacy qa preference remains compatible", foundation.includes('if (value === "qa") return "bug"')],
  ["Desktop signed-in path remains the shared renderer", mainQml.includes("? serverPage") && mainQml.includes(": sharedRendererPage")],
  ["Desktop runtime advertises active tray and deep-link advantages", broker.includes("system-tray-integration") && broker.includes("deep-link-shell-integration")],
  ["Desktop README identifies the shared renderer as the current product path", desktopReadme.includes("# Cluster Desktop v0.") && desktopReadme.includes("Normal signed-in product work runs through `SharedRendererPage.qml`")],
  ["Desktop native status explicitly distinguishes legacy workspace UI", nativeStatus.includes("legacy/dormant") && nativeStatus.includes("should not be revived as a second product implementation")],
  ["v0.479 is documented", notes.includes("Create workflow refinement") && changelog.includes('version: "v0.479.0"')],
  ["v0.479 gate participates in master packaging", packager.includes("create-refinement-v479-audit.mjs")],
  ["clean source packaging strips Git scaffolding", packager.includes(".github") && packager.includes(".gitignore") && packager.includes(".gitattributes")],
  ["release verifier rejects Git scaffolding in clean source", verifier.includes("Canonical source archive contains Git scaffolding") && verifier.includes(".gitmodules")],
];

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; }
console.log(`Create refinement v0.479: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
