import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { verifyBackupManifestSignature } from "./backup-manifest.js";
import { decryptClusterFile } from "./crypto-service.js";
import { sha256File, verifyDatabaseBackup } from "./database-backup.js";
import { databaseRecoverySnapshot, replaceDatabaseFromBackup } from "./database-recovery.js";
import { drillFilesystemRestore, verifyFilesystemBackup } from "./filesystem-backup.js";

export type RecoveryGeneration = {
  manifestPath: string;
  directory: string;
  manifest: Record<string, any>;
  schemaVersion: number;
};

function inside(directory: string, filePath: string) {
  const root = path.resolve(directory);
  const resolved = path.resolve(filePath);
  return resolved !== root && resolved.startsWith(`${root}${path.sep}`);
}

export async function loadRecoveryGeneration(manifestPath: string, env: NodeJS.ProcessEnv = process.env): Promise<RecoveryGeneration> {
  const resolved = path.resolve(manifestPath);
  const directory = path.dirname(resolved);
  const manifest = JSON.parse(await fs.readFile(resolved, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Recovery manifest must contain a JSON object.");
  const schemaVersion = Number(manifest.schemaVersion);
  if (schemaVersion !== 3) throw new Error(`Cluster only supports recovery manifest schema 3; received ${manifest.schemaVersion}.`);
  if (!verifyBackupManifestSignature(manifest, env)) throw new Error("Recovery manifest signature is invalid or its Cluster secret key is unavailable.");

  const materialized = structuredClone(manifest) as Record<string, any>;
  const encryption = manifest.artifactEncryption && typeof manifest.artifactEncryption === "object" ? manifest.artifactEncryption : {};
  const cacheRoot = path.join(directory, ".cluster-recovery-cache", String(manifest.generationId || path.basename(resolved, ".json")));
  for (const key of ["database", "config", "uploads", "branding", "projects", "library", "users"]) {
    const metadata = materialized.files?.[key];
    const sourceName = metadata?.fileName ? String(metadata.fileName) : "";
    const protectedMetadata = sourceName ? encryption[sourceName] : null;
    if (!protectedMetadata?.purpose) continue;
    const source = path.resolve(directory, sourceName);
    if (!inside(directory, source)) throw new Error("Encrypted recovery artifact points outside its generation directory.");
    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const plainName = path.basename(String(protectedMetadata.plaintextFileName || `${sourceName}.plain`));
    const target = path.join(cacheRoot, `${key}-${plainName}`);
    const existing = await fs.stat(target).catch(() => null);
    if (!existing?.isFile()) {
      const partial = `${target}.partial-${process.pid}-${Date.now()}`;
      try {
        await decryptClusterFile(String(protectedMetadata.purpose), source, partial, env);
        await fs.rename(partial, target);
      } catch (error) {
        await fs.rm(partial, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    metadata.fileName = path.relative(directory, target).replaceAll("\\", "/");
  }
  return { manifestPath: resolved, directory, manifest: materialized, schemaVersion };
}

export function recoveryArtifactPath(generation: RecoveryGeneration, value: unknown) {
  if (!value) return null;
  const resolved = path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(generation.directory, String(value));
  if (!inside(generation.directory, resolved)) throw new Error("Recovery artifact points outside its generation directory.");
  return resolved;
}

function fsMetadata(generation: RecoveryGeneration, key: string) {
  return generation.manifest.files?.[key] || null;
}

function optionalCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function filesystemExpectation(metadata: any) {
  return { files: optionalCount(metadata?.contentFiles), bytes: optionalCount(metadata?.contentBytes), sha256: metadata?.sha256 || null };
}

export async function verifyRecoveryGeneration(generation: RecoveryGeneration, databaseUrl: string) {
  const manifest = generation.manifest;
  const databasePath = recoveryArtifactPath(generation, manifest.files?.database?.fileName);
  if (!databasePath) throw new Error("Recovery generation has no PostgreSQL dump.");
  const database = await verifyDatabaseBackup(databasePath, "postgresql", databaseUrl);
  const configPath = recoveryArtifactPath(generation, manifest.files?.config?.fileName);
  if (!configPath) throw new Error("Recovery generation has no Cluster server config.");
  const configHash = await sha256File(configPath);
  const configOk = Boolean(manifest.files?.config?.sha256) && configHash === manifest.files.config.sha256;
  const filesystem: Record<string, any> = {};
  for (const key of ["uploads", "branding", "projects", "library", "users"]) {
    const metadata = fsMetadata(generation, key);
    const archive = recoveryArtifactPath(generation, metadata?.fileName);
    if (!archive) { filesystem[key] = { ok: false, missing: true }; continue; }
    filesystem[key] = await verifyFilesystemBackup(archive, filesystemExpectation(metadata));
  }
  const ok = database.ok && configOk && Object.values(filesystem).every((row: any) => row.ok !== false);
  return { ok, databasePath, database, configPath, configOk, filesystem };
}

export type RecoveryFilesystemRoots = Partial<Record<"uploads" | "branding" | "projects" | "library" | "users", string>>;

export function recoveryTargets(
  generation: RecoveryGeneration,
  dataRoot: string,
  uploadRoot?: string | null,
  filesystemRoots: RecoveryFilesystemRoots = {},
  configFile?: string | null,
) {
  const root = path.resolve(dataRoot);
  const layoutRecovery = generation.manifest.layoutRecovery || {};
  const targets = layoutRecovery.targets || {};
  const externalRoots = layoutRecovery.externalRoots || {};
  const defaults: Record<"uploads" | "branding" | "projects" | "library" | "users", string> = {
    uploads: "Uploads", branding: "Branding", projects: "Projects", library: "Library", users: "Users",
  };
  const supplied: RecoveryFilesystemRoots = { ...filesystemRoots, ...(uploadRoot ? { uploads: uploadRoot } : {}) };
  const resolveTarget = (key: keyof typeof defaults) => {
    const external = externalRoots[key] === true || (key === "uploads" && Boolean(layoutRecovery.externalUploadRoot));
    if (external) {
      const configured = supplied[key];
      if (!configured) throw new Error(`This recovery generation used an external ${key} root. Supply --${key === "uploads" ? "upload" : key}-root for restore.`);
      return path.resolve(configured);
    }
    const relative = String(targets[key] || defaults[key]).trim() || defaults[key];
    if (path.isAbsolute(relative)) throw new Error(`Recovery ${key} target must be relative to the Data Root.`);
    const resolved = path.resolve(root, relative);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(prefix)) throw new Error(`Recovery ${key} target escapes the Data Root.`);
    return resolved;
  };
  return {
    uploads: resolveTarget("uploads"),
    branding: resolveTarget("branding"),
    projects: resolveTarget("projects"),
    library: resolveTarget("library"),
    users: resolveTarget("users"),
    config: path.resolve(configFile || path.join(path.dirname(root), "cluster.config.json")),
  };
}

async function stageFilesystem(generation: RecoveryGeneration, targets: ReturnType<typeof recoveryTargets>, token: string) {
  const staged: Array<{ key: string; target: string; stage: string; rollback: string }> = [];
  for (const key of ["uploads", "branding", "projects", "library", "users"] as const) {
    const metadata = fsMetadata(generation, key);
    const archive = recoveryArtifactPath(generation, metadata?.fileName);
    if (!archive) continue;
    const target = targets[key];
    const stage = `${target}.cluster-restore-stage-${token}`;
    const rollback = `${target}.cluster-restore-rollback-${token}`;
    await fs.rm(stage, { recursive: true, force: true });
    const result = await drillFilesystemRestore(archive, stage, filesystemExpectation(metadata));
    if (!result.ok) throw new Error(`Failed to stage ${key} recovery archive: ${(result.mismatches || []).join(", ")}`);
    staged.push({ key, target, stage, rollback });
  }
  return staged;
}

async function swapStagedFilesystem(staged: Awaited<ReturnType<typeof stageFilesystem>>) {
  const swapped: typeof staged = [];
  try {
    for (const item of staged) {
      await fs.mkdir(path.dirname(item.target), { recursive: true });
      await fs.rm(item.rollback, { recursive: true, force: true });
      const existing = await fs.stat(item.target).catch(() => null);
      if (existing) await fs.rename(item.target, item.rollback);
      await fs.rename(item.stage, item.target);
      swapped.push(item);
    }
    return swapped;
  } catch (error) {
    for (const item of swapped.reverse()) {
      await fs.rm(item.target, { recursive: true, force: true }).catch(() => undefined);
      if (await fs.stat(item.rollback).catch(() => null)) await fs.rename(item.rollback, item.target).catch(() => undefined);
    }
    throw error;
  }
}

export type RecoveryApplyJournal = {
  schemaVersion: 1;
  state: "preparing" | "database-replaced" | "filesystem-swapped" | "config-committed" | "complete" | "failed";
  generationId: string;
  updatedAt: string;
  safetyDumpPath?: string | null;
  error?: string | null;
};

function recoveryApplyJournalPath(checkpointRoot: string) {
  return path.join(checkpointRoot, "recovery-apply-state.json");
}

export async function readRecoveryApplyJournal(checkpointRoot: string): Promise<RecoveryApplyJournal | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(recoveryApplyJournalPath(checkpointRoot), "utf8"));
    return parsed && parsed.schemaVersion === 1 ? parsed as RecoveryApplyJournal : null;
  } catch {
    return null;
  }
}

async function writeRecoveryApplyJournal(checkpointRoot: string, journal: RecoveryApplyJournal) {
  await fs.mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  const target = recoveryApplyJournalPath(checkpointRoot);
  const temporary = `${target}.partial-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600).catch(() => undefined);
}

async function assertRecoveryApplyJournalClear(checkpointRoot: string, acknowledgeInterruptedRecovery: boolean) {
  const existing = await readRecoveryApplyJournal(checkpointRoot);
  if (!existing || existing.state === "complete") return existing;
  if (!acknowledgeInterruptedRecovery) {
    throw new Error(`An interrupted recovery journal is present in state ${existing.state}. Inspect the safety dump and filesystem targets before retrying, then use explicit interrupted-recovery acknowledgement.`);
  }
  const source = recoveryApplyJournalPath(checkpointRoot);
  const archived = path.join(checkpointRoot, `recovery-apply-state-acknowledged-${Date.now()}.json`);
  await fs.rename(source, archived);
  return existing;
}

async function commitRecoveredConfig(
  configSource: string,
  target: string,
  generationId: string,
  settingsPatch: Record<string, unknown> = {},
) {
  const parsed = JSON.parse(await fs.readFile(configSource, "utf8"));
  const settings = parsed && typeof parsed.settings === "object" && parsed.settings ? parsed.settings : {};
  const next = {
    ...parsed,
    updatedAt: new Date().toISOString(),
    settings: {
      ...settings,
      serverDataEpoch: randomUUID(),
      lastRecoveryGenerationId: generationId,
      lastRecoveryAppliedAt: new Date().toISOString(),
      ...settingsPatch,
    },
  };
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.cluster-restore-config-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600).catch(() => undefined);
}

export async function applyRecoveryGeneration(input: {
  generation: RecoveryGeneration;
  databaseUrl: string;
  dataRoot: string;
  uploadRoot?: string | null;
  filesystemRoots?: RecoveryFilesystemRoots;
  checkpointRoot: string;
  configFile?: string | null;
  configSettingsPatch?: Record<string, unknown>;
  acknowledgeInterruptedRecovery?: boolean;
}) {
  await assertRecoveryApplyJournalClear(input.checkpointRoot, input.acknowledgeInterruptedRecovery === true);
  const verified = await verifyRecoveryGeneration(input.generation, input.databaseUrl);
  if (!verified.ok) throw new Error("Recovery generation verification failed.");
  const token = `${Date.now()}-${process.pid}`;
  const generationId = String(input.generation.manifest.generationId || path.basename(input.generation.manifestPath, ".json"));
  const targets = recoveryTargets(input.generation, input.dataRoot, input.uploadRoot, input.filesystemRoots, input.configFile);
  const staged = await stageFilesystem(input.generation, targets, token);
  await fs.mkdir(input.checkpointRoot, { recursive: true, mode: 0o700 });
  await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "preparing", generationId, updatedAt: new Date().toISOString() });
  const safetyDumpPath = path.join(input.checkpointRoot, `pre-restore-${token}.dump`);
  const configRollback = `${targets.config}.cluster-restore-rollback-${token}`;
  const configSource = verified.configPath;
  let databaseReplaced = false;
  let swapped: Awaited<ReturnType<typeof swapStagedFilesystem>> = [];
  try {
    const databaseSnapshot = await replaceDatabaseFromBackup({ databaseUrl: input.databaseUrl, dumpPath: verified.databasePath, safetyDumpPath });
    databaseReplaced = true;
    await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "database-replaced", generationId, updatedAt: new Date().toISOString(), safetyDumpPath });
    swapped = await swapStagedFilesystem(staged);
    await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "filesystem-swapped", generationId, updatedAt: new Date().toISOString(), safetyDumpPath });
    if (configSource) {
      await fs.mkdir(path.dirname(targets.config), { recursive: true });
      if (await fs.stat(targets.config).catch(() => null)) await fs.copyFile(targets.config, configRollback);
      await commitRecoveredConfig(configSource, targets.config, generationId, input.configSettingsPatch);
      await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "config-committed", generationId, updatedAt: new Date().toISOString(), safetyDumpPath });
    }
    for (const item of swapped) await fs.rm(item.rollback, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(configRollback, { force: true }).catch(() => undefined);
    await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "complete", generationId, updatedAt: new Date().toISOString(), safetyDumpPath });
    return { ok: true, generationId, databaseSnapshot, safetyDumpPath, serverDataEpochRotated: true, recoveryJournalState: "complete" };
  } catch (error) {
    if (configSource && await fs.stat(configRollback).catch(() => null)) await fs.copyFile(configRollback, targets.config).catch(() => undefined);
    for (const item of swapped.reverse()) {
      await fs.rm(item.target, { recursive: true, force: true }).catch(() => undefined);
      if (await fs.stat(item.rollback).catch(() => null)) await fs.rename(item.rollback, item.target).catch(() => undefined);
    }
    if (databaseReplaced && await fs.stat(safetyDumpPath).catch(() => null)) {
      await replaceDatabaseFromBackup({ databaseUrl: input.databaseUrl, dumpPath: safetyDumpPath }).catch(() => undefined);
    }
    await writeRecoveryApplyJournal(input.checkpointRoot, { schemaVersion: 1, state: "failed", generationId, updatedAt: new Date().toISOString(), safetyDumpPath, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  } finally {
    for (const item of staged) await fs.rm(item.stage, { recursive: true, force: true }).catch(() => undefined);
  }
}
