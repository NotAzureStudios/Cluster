import "dotenv/config";
import path from "node:path";

import { createClusterDataLayout, storageOverridesFromSettings } from "../core/data-layout.js";
import { loadRuntimeConfig } from "../core/runtime-config.js";
import { applyRecoveryGeneration, loadRecoveryGeneration, readRecoveryApplyJournal, recoveryTargets, verifyRecoveryGeneration } from "../core/recovery-generation.js";
import { assertServerOffline } from "../core/server-runtime-marker.js";

function args(argv: string[]) {
  const parsed = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 2) parsed.set(token.slice(2, eq), token.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) parsed.set(token.slice(2), argv[++i]);
    else parsed.set(token.slice(2), true);
  }
  return parsed;
}

function required(value: string | true | undefined, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

const command = process.argv[2] || "plan";
const options = args(process.argv.slice(3));
const runtime = loadRuntimeConfig({ cwd: process.cwd() });
const configuredDataRoot = process.env.CLUSTER_DATA_DIR || runtime.bootSettings.dataRootOverride || path.join(runtime.bootWorkspaceRoot, "data");
const dataRoot = path.resolve(String(options.get("data-root") || configuredDataRoot));
const layout = createClusterDataLayout(dataRoot, {
  configFile: runtime.bootConfigFilePath,
  storageOverrides: storageOverridesFromSettings(runtime.bootSettings),
});

if (command === "status") {
  const checkpointRoot = path.join(layout.backupsRoot, "recovery-checkpoints");
  const journal = await readRecoveryApplyJournal(checkpointRoot);
  console.log(JSON.stringify({ command, checkpointRoot, recoveryApply: journal, requiresOperatorReview: Boolean(journal && journal.state !== "complete") }, null, 2));
} else {
const manifestPath = path.resolve(required(options.get("manifest"), "--manifest"));
const databaseUrl = required(options.get("database-url") || process.env.DATABASE_URL, "--database-url or DATABASE_URL");
const uploadRoot = typeof options.get("upload-root") === "string" ? path.resolve(String(options.get("upload-root"))) : process.env.CLUSTER_UPLOAD_DIR ? path.resolve(process.env.CLUSTER_UPLOAD_DIR) : layout.uploadsRoot;
const filesystemRoots = {
  uploads: uploadRoot,
  branding: typeof options.get("branding-root") === "string" ? path.resolve(String(options.get("branding-root"))) : layout.brandingRoot,
  projects: typeof options.get("projects-root") === "string" ? path.resolve(String(options.get("projects-root"))) : layout.projectsRoot,
  library: typeof options.get("library-root") === "string" ? path.resolve(String(options.get("library-root"))) : layout.libraryRoot,
  users: typeof options.get("users-root") === "string" ? path.resolve(String(options.get("users-root"))) : layout.usersRoot,
};
const configFile = path.resolve(String(options.get("config") || runtime.bootConfigFilePath));
const storageSettingKeys = [
  ["projectsRootOverride", "projects-root"], ["libraryRootOverride", "library-root"], ["usersRootOverride", "users-root"],
  ["backupsRootOverride", "backups-root"], ["logsRootOverride", "logs-root"], ["runtimeRootOverride", "runtime-root"],
  ["exportsRootOverride", "exports-root"], ["uploadRootOverride", "upload-root"], ["brandingRootOverride", "branding-root"],
] as const;
const configSettingsPatch: Record<string, unknown> = {
  // Physical storage topology belongs to the machine performing the restore,
  // not to the machine that created the backup. Preserve the current topology
  // (or explicit restore overrides) so recovery cannot resurrect stale drive letters.
  dataRootOverride: typeof options.get("data-root") === "string"
    ? dataRoot
    : runtime.bootSettings.dataRootOverride,
};
for (const [settingKey, optionKey] of storageSettingKeys) {
  const explicit = options.get(optionKey);
  configSettingsPatch[settingKey] = typeof explicit === "string"
    ? path.resolve(explicit)
    : runtime.bootSettings[settingKey];
}

const generation = await loadRecoveryGeneration(manifestPath);
const verification = await verifyRecoveryGeneration(generation, databaseUrl);
const targets = recoveryTargets(generation, dataRoot, uploadRoot, filesystemRoots, configFile);

if (command === "verify") {
  console.log(JSON.stringify({ command, generationId: generation.manifest.generationId, schemaVersion: generation.schemaVersion, verification }, null, 2));
  if (!verification.ok) process.exitCode = 1;
} else if (command === "plan") {
  const marker = await assertServerOffline(layout.runtimeRoot, { clearStaleMarker: Boolean(options.get("clear-stale-marker")) });
  console.log(JSON.stringify({ command, generationId: generation.manifest.generationId, schemaVersion: generation.schemaVersion, verification, targets, serverOffline: marker }, null, 2));
  if (!verification.ok) process.exitCode = 1;
} else if (command === "apply") {
  if (options.get("confirm") !== "RESTORE_CLUSTER") throw new Error("Destructive recovery requires --confirm=RESTORE_CLUSTER.");
  await assertServerOffline(layout.runtimeRoot, { clearStaleMarker: Boolean(options.get("clear-stale-marker")) });
  if (!verification.ok) throw new Error("Recovery generation verification failed. Nothing was applied.");
  const checkpointRoot = path.join(layout.backupsRoot, "recovery-checkpoints");
  const result = await applyRecoveryGeneration({ generation, databaseUrl, dataRoot, uploadRoot, filesystemRoots, configFile, configSettingsPatch, checkpointRoot, acknowledgeInterruptedRecovery: Boolean(options.get("acknowledge-interrupted-recovery")) });
  console.log(JSON.stringify({ command, ...result, targets, note: "Generation restored over the offline Cluster targets." }, null, 2));
} else {
  throw new Error(`Unknown recovery command ${command}. Use status, plan, verify, or apply.`);
}
}
