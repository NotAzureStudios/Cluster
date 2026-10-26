import crypto from "node:crypto";import { createReadStream, createWriteStream } from "node:fs";

import fs from "node:fs/promises";
import path from "node:path";import { pipeline } from "node:stream/promises";import { FastifyReply, FastifyRequest } from "fastify";
import { syncEditableDataMirrors } from "../core/data-layout.js";

import { backupProviderFromPath, createDatabaseBackup, verifyDatabaseBackup } from "../core/database-backup.js";
import { databaseRecoverySnapshot, runDatabaseRestoreDrill } from "../core/database-recovery.js";
import { createFilesystemBackup, drillFilesystemRestore, verifyFilesystemBackup } from "../core/filesystem-backup.js";
import { signBackupManifest, verifyBackupManifestSignature } from "../core/backup-manifest.js";
import { deleteRecoveryEvidence, readRecoveryEvidence, recordRecoveryEvidence } from "../core/recovery-evidence.js";
import { encryptionKeyId, previousEncryptionKeyIds } from "../core/setting-crypto.js";
import { decryptClusterFile, encryptClusterFile } from "../core/crypto-service.js";
import { applyRetentionPolicies } from "../core/data-retention.js";
import { linkedAbortController, throwIfAborted } from "../core/operation-cancellation.js";
import { recordDeferredBackupMirrors } from "../core/storage/backup-mirror-retention.js";
import type { SettingPayload } from "./server-composition-types.js";
import { syncUserWorkforceAuthorities } from "../domains/workforce/workforce-normalization.js";


export function createOperationsServices(deps: Record<string, any>) {
  const {
    BACKUP_VERIFY_AFTER_CREATE,
    CLUSTER_VERSION,
    CONFIG_FILE_PATH,
    DATABASE_URL,
    RECOVERY_DATABASE_URL,
    DATA_LAYOUT,
    DATA_ROOT,
    UPLOAD_ROOT,
    app,
    authorization,
    backgroundTasks,
    collaborationRuntime,
    ensureDataFolders,
    logActivity,
    prisma,
    rateLimiter,
    readSettings,
    safePersistenceRecordCount,
    storageRuntime
  } = deps;
  
  
  async function countFolderEntries(folderPath: string) {
    try {
      const entries = await fs.readdir(folderPath);
      return { exists: true, files: entries.length };
    } catch {
      return { exists: false, files: 0 };
    }
  }
  
  
  function slugStamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
  }
  
  
  async function sha256File(filePath: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const hash = crypto.createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => {
        if (signal?.aborted) {
          stream.destroy(signal.reason instanceof Error ? signal.reason : new Error("Backup inspection cancelled."));
          return;
        }
        hash.update(chunk);
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return hash.digest("hex");
  }
  
  
  async function backupArtifactInfo(filePath: string | null, kind: "database" | "config", signal?: AbortSignal) {
    if (!filePath)
      return {
        kind,
        exists: false,
        fileName: null,
        sizeBytes: 0,
        sha256: null,
        formatValid: false,
        quickCheck: null,
        error: "Artifact was not created.",
      };
    try {
      const resolved = path.resolve(filePath);
      const backupRoot = path.resolve(DATA_ROOT, "backups");
      if (!resolved.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Backup artifact points outside the backup directory.");
      throwIfAborted(signal);
      const stat = await fs.stat(resolved);
      let formatValid = true;
      let quickCheck: { ok: boolean; result: unknown } | null = null;
      if (kind === "database") {
        const provider = backupProviderFromPath(resolved);
        quickCheck = await verifyDatabaseBackup(resolved, provider, DATABASE_URL, signal);
        formatValid = quickCheck.ok;
      } else {
        JSON.parse(await fs.readFile(resolved, "utf8"));
      }
      return {
        kind,
        exists: true,
        fileName: path.basename(resolved),
        sizeBytes: stat.size,
        sha256: await sha256File(resolved, signal),
        formatValid,
        quickCheck,
        error: formatValid ? null : `Invalid ${kind} file format or integrity check.`,
      };
    } catch (error) {
      return {
        kind,
        exists: false,
        fileName: filePath ? path.basename(filePath) : null,
        sizeBytes: 0,
        sha256: null,
        formatValid: false,
        quickCheck: null,
        error: error instanceof Error ? error.message : `Unable to inspect ${kind} artifact.`,
      };
    }
  }
  
  
  function resolveManifestArtifact(manifestPath: string, value: unknown) {
    if (!value) return null;
    const manifestDirectory = path.dirname(manifestPath);
    const backupRoot = path.resolve(DATA_LAYOUT.backupsRoot);
    const raw = String(value);
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(manifestDirectory, raw);
    if (resolved === backupRoot || !resolved.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Backup artifact points outside the backup directory.");
    return resolved;
  }


  function backupMirrorPlan(fileBase: string, filePaths: string[]) {
    const provider = storageRuntime?.providerForTier?.("archive");
    if (!provider || provider.id === "local") return null;
    return {
      provider: provider.id,
      tier: "archive",
      prefix: `system/backups/${fileBase}`,
      objects: filePaths.map((filePath) => ({
        fileName: path.basename(filePath),
        key: `system/backups/${fileBase}/${path.basename(filePath)}`,
      })),
    };
  }

  async function mirrorBackupGeneration(plan: any, files: Array<{ fileName: string; filePath: string }>, signal?: AbortSignal) {
    if (!plan) return { enabled: false, mirrored: 0 };
    let mirrored = 0;
    // Never unlink remote objects on failure: the key may already belong to a
    // different writer, and this provider exposes no generation-fenced delete.
    for (const file of files) {
      throwIfAborted(signal);
      const object = plan.objects.find((item: any) => item.fileName === file.fileName);
      if (!object) continue;
      const locator = { provider: plan.provider, tier: "archive", key: object.key } as const;
      const localStat = await fs.stat(file.filePath);
      const remoteStat = await storageRuntime.putFile(locator, file.filePath, signal);
      if (remoteStat.size !== localStat.size) throw new Error(`Backup mirror verification failed for ${file.fileName}.`);
      mirrored += 1;
    }
    return { enabled: true, mirrored };
  }

  async function deferMirroredBackup(manifest: any, reason: "failed-generation" | "manual-backup-removal" | "retention-expired") {
    const plan = manifest?.storageMirror;
    if (!plan) return false;
    return recordDeferredBackupMirrors({
      backupsRoot: DATA_LAYOUT.backupsRoot,
      generationId: String(manifest.generationId || ""),
      plan,
      reason,
    });
  }

  async function materializeManifestArtifact(manifestPath: string, manifest: any, value: unknown, signal?: AbortSignal) {
    throwIfAborted(signal);
    const localPath = resolveManifestArtifact(manifestPath, value);
    if (!localPath) return null;

    const fileName = path.basename(localPath);
    const cacheRoot = path.join(DATA_LAYOUT.backupsRoot, ".restore-cache", String(manifest.generationId || path.basename(manifestPath, ".json")));
    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    let materializedPath = localPath;
    const localExists = await fs.stat(localPath).then(() => true).catch(() => false);

    if (!localExists) {
      const plan = manifest?.storageMirror;
      const object = Array.isArray(plan?.objects) ? plan.objects.find((item: any) => item?.fileName === fileName) : null;
      if (!plan?.provider || !object?.key) return localPath;

      const encryptedCacheRoot = path.join(cacheRoot, "artifacts");
      await fs.mkdir(encryptedCacheRoot, { recursive: true, mode: 0o700 });
      const cachedPath = path.join(encryptedCacheRoot, fileName);
      const locator = { provider: String(plan.provider), tier: "archive", key: String(object.key) } as const;
      const expected = await storageRuntime.stat(locator);
      const cached = await fs.stat(cachedPath).catch(() => null);
      if (!cached?.isFile() || cached.size !== expected.size) {
        if (cached) await fs.rm(cachedPath, { force: true }).catch(() => undefined);
        const partial = `${cachedPath}.partial-${process.pid}-${Date.now()}`;
        try {
          const stream = await storageRuntime.openRead(locator);
          throwIfAborted(signal);
          const output = createWriteStream(partial, { flags: "wx", mode: 0o600 });
          const onAbort = () => {
            stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error("Backup materialization cancelled."));
            output.destroy(signal?.reason instanceof Error ? signal.reason : new Error("Backup materialization cancelled."));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          try { await pipeline(stream, output); }
          finally { signal?.removeEventListener("abort", onAbort); }
          const actual = await fs.stat(partial);
          if (actual.size !== expected.size) throw new Error(`Mirrored backup materialization size mismatch for ${fileName}.`);
          await fs.rename(partial, cachedPath);
        } catch (error) {
          await fs.rm(partial, { force: true }).catch(() => undefined);
          throw error;
        }
      }
      materializedPath = cachedPath;
    }

    const encryption = manifest?.artifactEncryption?.[fileName];
    if (!encryption?.purpose) return materializedPath;
    const plainRoot = path.join(cacheRoot, "plaintext");
    await fs.mkdir(plainRoot, { recursive: true, mode: 0o700 });
    const plainName = path.basename(String(encryption.plaintextFileName || `${fileName}.plain`));
    const decryptedPath = path.join(plainRoot, plainName);
    if (await fs.stat(decryptedPath).then((row) => row.isFile()).catch(() => false)) return decryptedPath;
    const partialPlain = `${decryptedPath}.partial-${process.pid}-${Date.now()}`;
    try {
      await decryptClusterFile(String(encryption.purpose), materializedPath, partialPlain);
      await fs.rename(partialPlain, decryptedPath);
      return decryptedPath;
    } catch (error) {
      await fs.rm(partialPlain, { force: true }).catch(() => undefined);
      throw error;
    }
  }


  async function filesystemArtifact(filePath: string | null, metadata: any, required: boolean, signal?: AbortSignal) {
    if (!filePath) {
      return { ok: !required, files: 0, bytes: 0, sha256: null, mismatches: required ? ["filesystem archive missing"] : [] };
    }
    return verifyFilesystemBackup(filePath, {
      files: Number.isFinite(Number(metadata?.contentFiles)) ? Number(metadata.contentFiles) : undefined,
      bytes: Number.isFinite(Number(metadata?.contentBytes)) ? Number(metadata.contentBytes) : undefined,
      sha256: metadata?.sha256 || null,
    }, signal);
  }


  async function createFilesystemArtifact(root: string, destination: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const archive = await createFilesystemBackup(root, destination, signal);
    const stat = await fs.stat(destination);
    const verified = await verifyFilesystemBackup(destination, archive, signal);
    if (!verified.ok) throw new Error(`Filesystem backup verification failed for ${path.basename(destination)}: ${verified.mismatches.join(", ")}`);
    return {
      exists: true,
      fileName: path.basename(destination),
      sizeBytes: stat.size,
      sha256: archive.sha256,
      contentFiles: archive.files,
      contentBytes: archive.bytes,
      formatValid: true,
    };
  }


  async function protectBackupArtifact(fileBase: string, kind: string, filePath: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const purpose = `backup-artifact:v1:${fileBase}:${kind}`;
    const encryptedTemp = `${filePath}.encrypted-${process.pid}-${Date.now()}`;
    const verificationTemp = `${filePath}.decrypt-check-${process.pid}-${Date.now()}`;
    const expectedSha256 = await sha256File(filePath, signal);
    try {
      const encryption = await encryptClusterFile(purpose, filePath, encryptedTemp);
      await decryptClusterFile(purpose, encryptedTemp, verificationTemp);
      const decryptedSha256 = await sha256File(verificationTemp, signal);
      if (decryptedSha256 !== expectedSha256) throw new Error(`Encrypted backup verification failed for ${path.basename(filePath)}.`);
      await fs.rm(filePath, { force: true });
      await fs.rename(encryptedTemp, filePath);
      await fs.chmod(filePath, 0o600).catch(() => undefined);
      return { ...encryption, plaintextFileName: path.basename(filePath), plaintextSha256: expectedSha256 };
    } finally {
      await fs.rm(encryptedTemp, { force: true }).catch(() => undefined);
      await fs.rm(verificationTemp, { force: true }).catch(() => undefined);
    }
  }


  async function readBackupManifest(fileName: string) {
    const safeName = path.basename(fileName);
    if (!safeName.startsWith("cluster-backup-") || !safeName.endsWith(".json") || safeName.endsWith(".config.json")) throw new Error("Invalid backup manifest name.");
    const manifestPath = path.join(DATA_LAYOUT.backupsRoot, safeName);
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Backup manifest must contain a JSON object.");
    const manifest = parsed as Record<string, any>;
    const schemaVersion = Number(manifest.schemaVersion);
    if (schemaVersion !== 3) throw new Error(`Cluster only supports backup manifest schema 3; received ${manifest.schemaVersion}.`);
    if (!verifyBackupManifestSignature(manifest)) throw new Error("Backup manifest signature is invalid or requires an unavailable Cluster secret key.");
    return { manifestPath, manifest, schemaVersion };
  }


  async function verifyBackupManifest(fileName: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const { manifestPath, manifest, schemaVersion } = await readBackupManifest(fileName);
    const databasePath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.database?.fileName || null, signal);
    const configPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.config?.fileName || null, signal);
    const uploadsPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.uploads?.fileName || null, signal);
    const brandingPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.branding?.fileName || null, signal);
    const projectsPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.projects?.fileName || null, signal);
    const libraryPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.library?.fileName || null, signal);
    const usersPath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.users?.fileName || null, signal);
    const database = await backupArtifactInfo(databasePath, "database", signal);
    const config = await backupArtifactInfo(configPath, "config", signal);
    const expectedDatabaseChecksum = manifest.files?.database?.sha256 || null;
    const expectedConfigChecksum = manifest.files?.config?.sha256 || null;
    const databaseChecksumValid = !expectedDatabaseChecksum || expectedDatabaseChecksum === database.sha256;
    const configChecksumValid = !expectedConfigChecksum || expectedConfigChecksum === config.sha256;
    const uploads = await filesystemArtifact(uploadsPath, manifest.files?.uploads, true, signal);
    const branding = await filesystemArtifact(brandingPath, manifest.files?.branding, true, signal);
    const projects = await filesystemArtifact(projectsPath, manifest.files?.projects, true, signal);
    const library = await filesystemArtifact(libraryPath, manifest.files?.library, true, signal);
    const users = await filesystemArtifact(usersPath, manifest.files?.users, true, signal);
    const ok = database.exists && database.formatValid && databaseChecksumValid
      && config.exists && config.formatValid && configChecksumValid
      && uploads.ok && branding.ok && projects.ok && library.ok && users.ok;
    const result = {
      ok,
      schemaVersion,
      signatureValid: true,
      generationId: manifest.generationId || path.basename(manifestPath, ".json"),
      fileName: path.basename(manifestPath),
      version: manifest.version || "unknown",
      createdAt: manifest.createdAt || null,
      verifiedAt: new Date().toISOString(),
      database: { ...database, checksumValid: databaseChecksumValid },
      config: { ...config, checksumValid: configChecksumValid },
      uploads,
      branding,
      projects,
      library,
      users,
      counts: manifest.recovery?.counts || {},
      migrations: manifest.recovery?.migrations || [],
      reason: manifest.reason || "unknown",
    };
    await recordRecoveryEvidence({
      backupsRoot: DATA_LAYOUT.backupsRoot,
      generationId: result.generationId,
      manifestFileName: result.fileName,
      verification: { checkedAt: result.verifiedAt, ok: result.ok, schemaVersion },
    });
    return result;
  }


  async function runServerRestoreDrill(fileName: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const verification = await verifyBackupManifest(fileName, signal);
    if (!verification.ok) throw new Error("Backup verification must pass before a restore drill can run.");
    const { manifestPath, manifest } = await readBackupManifest(fileName);
    const databasePath = await materializeManifestArtifact(manifestPath, manifest, manifest.files?.database?.fileName || null, signal);
    if (!databasePath) throw new Error("Backup does not contain a PostgreSQL dump.");
    const expectedCounts = (manifest.recovery?.snapshotStableDuringBackup === false ? {} : (manifest.recovery?.counts || {})) as Record<string, number>;
    const expectedMigrations = Array.isArray(manifest.recovery?.migrations) ? manifest.recovery.migrations.map(String) : undefined;
    const database = await runDatabaseRestoreDrill({
      databaseUrl: RECOVERY_DATABASE_URL || DATABASE_URL,
      dumpPath: databasePath,
      expected: { counts: expectedCounts, migrations: expectedMigrations },
      signal,
    });
    const filesystemArtifacts = ["uploads", "branding", "projects", "library", "users"].map((key) => ({ key, required: true }));
    const filesystem: Record<string, any> = {};
    for (const artifact of filesystemArtifacts) {
      throwIfAborted(signal);
      const metadata = manifest.files?.[artifact.key];
      const archivePath = await materializeManifestArtifact(manifestPath, manifest, metadata?.fileName || null, signal);
      if (!archivePath) {
        filesystem[artifact.key] = { ok: false, skipped: true, reason: "required filesystem archive missing" };
        continue;
      }
      const drillRoot = path.join(DATA_LAYOUT.backupsRoot, "drills", `${path.basename(manifestPath, ".json")}-${artifact.key}-${Date.now()}`);
      try {
        filesystem[artifact.key] = await drillFilesystemRestore(archivePath, drillRoot, {
          files: Number(metadata?.contentFiles),
          bytes: Number(metadata?.contentBytes),
          sha256: metadata?.sha256 || null,
        }, signal);
      } finally {
        await fs.rm(drillRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    const result = {
      ok: verification.ok && database.ok && Object.values(filesystem).every((entry: any) => entry?.ok !== false),
      verification,
      database,
      filesystem,
      drill: true,
      applied: false,
      note: "Restore drill used an isolated temporary PostgreSQL database and temporary filesystem extraction. Live Cluster data was not replaced.",
    };
    const mismatchCount = database.mismatches.length + Object.values(filesystem).reduce((total: number, entry: any) => total + (Array.isArray(entry?.mismatches) ? entry.mismatches.length : entry?.ok === false ? 1 : 0), 0);
    await recordRecoveryEvidence({
      backupsRoot: DATA_LAYOUT.backupsRoot,
      generationId: verification.generationId,
      manifestFileName: verification.fileName,
      restoreDrill: { checkedAt: new Date().toISOString(), ok: result.ok, databaseOk: database.ok, filesystemOk: Object.values(filesystem).every((entry: any) => entry?.ok !== false), mismatchCount },
    });
    return result;
  }


  async function deleteBackupGeneration(fileName: string) {
    const { manifestPath, manifest } = await readBackupManifest(fileName);
    const artifacts = [
      manifest.files?.database?.fileName,
      manifest.files?.config?.fileName,
      manifest.files?.uploads?.fileName,
      manifest.files?.branding?.fileName,
      manifest.files?.projects?.fileName,
      manifest.files?.library?.fileName,
      manifest.files?.users?.fileName,
    ].filter(Boolean);
    // Persist remote cleanup evidence before removing local recovery material.
    // An unavailable journal leaves the backup intact instead of losing remote pointers.
    await deferMirroredBackup(manifest, "manual-backup-removal");
    for (const artifact of artifacts) {
      const resolved = resolveManifestArtifact(manifestPath, artifact);
      if (resolved) await fs.rm(resolved, { force: true });
    }
    await fs.rm(manifestPath, { force: true });
    await deleteRecoveryEvidence(DATA_LAYOUT.backupsRoot, manifest.generationId || path.basename(manifestPath, ".json"));
    return { ok: true, deletedArtifacts: artifacts.length + 1, remoteMirrorsRetained: Boolean(manifest.storageMirror) };
  }


  async function listBackupManifests() {
    const backupDir = DATA_LAYOUT.backupsRoot;
    try {
      const names = (await fs.readdir(backupDir))
        .filter((name) => name.startsWith("cluster-backup-") && name.endsWith(".json") && !name.endsWith(".config.json"))
        .sort()
        .reverse();
      const rows = await Promise.all(
        names.slice(0, 100).map(async (name) => {
          try {
            const { manifest, schemaVersion } = await readBackupManifest(name);
            const generationId = manifest.generationId || path.basename(name, ".json");
            const evidence = await readRecoveryEvidence(DATA_LAYOUT.backupsRoot, generationId);
            return {
              fileName: name,
              generationId,
              schemaVersion,
              signatureValid: true,
              version: manifest.version || "unknown",
              reason: manifest.reason || "unknown",
              createdAt: manifest.createdAt || null,
              sourceInstance: manifest.sourceInstance || null,
              counts: manifest.recovery?.counts || {},
              recovery: manifest.recovery || null,
              files: {
                database: manifest.files?.database ? { exists: manifest.files.database.exists, sizeBytes: manifest.files.database.sizeBytes } : null,
                uploads: manifest.files?.uploads ? { exists: manifest.files.uploads.exists, sizeBytes: manifest.files.uploads.sizeBytes, contentFiles: manifest.files.uploads.contentFiles, contentBytes: manifest.files.uploads.contentBytes } : null,
                branding: manifest.files?.branding ? { exists: manifest.files.branding.exists, sizeBytes: manifest.files.branding.sizeBytes, contentFiles: manifest.files.branding.contentFiles, contentBytes: manifest.files.branding.contentBytes } : null,
                projects: manifest.files?.projects ? { exists: manifest.files.projects.exists, sizeBytes: manifest.files.projects.sizeBytes, contentFiles: manifest.files.projects.contentFiles, contentBytes: manifest.files.projects.contentBytes } : null,
                library: manifest.files?.library ? { exists: manifest.files.library.exists, sizeBytes: manifest.files.library.sizeBytes, contentFiles: manifest.files.library.contentFiles, contentBytes: manifest.files.library.contentBytes } : null,
                users: manifest.files?.users ? { exists: manifest.files.users.exists, sizeBytes: manifest.files.users.sizeBytes, contentFiles: manifest.files.users.contentFiles, contentBytes: manifest.files.users.contentBytes } : null,
              },
              verification: manifest.verification || null,
              evidence,
              recoveryReady: Boolean(evidence?.verification?.ok && evidence?.restoreDrill?.ok),
            };
          } catch (error) {
            return {
              fileName: name,
              version: "unknown",
              reason: "unreadable",
              createdAt: null,
              counts: {},
              verification: {
                ok: false,
                error: error instanceof Error ? error.message : "Unreadable manifest",
              },
            };
          }
        }),
      );
      return rows;
    } catch {
      return [];
    }
  }
  
  
  async function recoveryReadiness() {
    const [backups, settings] = await Promise.all([listBackupManifests(), readSettings()]);
    const latest = backups[0] || null;
    const currentInstanceId = String(settings.serverInstanceId || "").trim() || null;
    const provenGenerations = backups.filter((row: any) => row.recoveryReady);
    const recoveryGeneration = provenGenerations.find((row: any) => {
      const sourceInstanceId = String(row?.sourceInstance?.serverInstanceId || "").trim() || null;
      return currentInstanceId ? sourceInstanceId === currentInstanceId : Boolean(sourceInstanceId);
    }) || null;
    const foreignRecoveryGeneration = provenGenerations.find((row: any) => {
      const sourceInstanceId = String(row?.sourceInstance?.serverInstanceId || "").trim() || null;
      return Boolean(currentInstanceId && sourceInstanceId && sourceInstanceId !== currentInstanceId);
    }) || null;
    const now = Date.now();
    const backupAgeMs = latest?.createdAt ? now - new Date(latest.createdAt).getTime() : null;
    const drillAgeMs = recoveryGeneration?.evidence?.restoreDrill?.checkedAt ? now - new Date(recoveryGeneration.evidence.restoreDrill.checkedAt).getTime() : null;
    const availableKeyIds = new Set([encryptionKeyId(), ...previousEncryptionKeyIds()].filter(Boolean));
    let secretKeyAvailable: boolean | null = null;
    if (recoveryGeneration?.fileName) {
      try {
        const { manifest } = await readBackupManifest(recoveryGeneration.fileName);
        const requiredKeyId = manifest.secretRecovery?.encryptionKeyId || null;
        secretKeyAvailable = requiredKeyId ? availableKeyIds.has(requiredKeyId) : null;
      } catch { secretKeyAvailable = false; }
    }
    const checks = {
      generationPresent: Boolean(recoveryGeneration),
      completeSchema: Boolean(recoveryGeneration && Number(recoveryGeneration.schemaVersion) >= 3),
      verificationPassed: Boolean(recoveryGeneration?.evidence?.verification?.ok),
      restoreDrillPassed: Boolean(recoveryGeneration?.evidence?.restoreDrill?.ok),
      latestGenerationVerified: Boolean(latest?.evidence?.verification?.ok),
      backupFresh: backupAgeMs != null && Number.isFinite(backupAgeMs) && backupAgeMs <= 72 * 60 * 60_000,
      drillFresh: drillAgeMs != null && Number.isFinite(drillAgeMs) && drillAgeMs <= 30 * 24 * 60 * 60_000,
      secretKeyAvailable,
      instanceIdentityPresent: Boolean(currentInstanceId),
      generationMatchesInstance: Boolean(recoveryGeneration && currentInstanceId && recoveryGeneration?.sourceInstance?.serverInstanceId === currentInstanceId),
      foreignRecoveryGenerationPresent: Boolean(foreignRecoveryGeneration),
    };
    const critical = !checks.instanceIdentityPresent || !checks.generationPresent || !checks.completeSchema || !checks.verificationPassed || !checks.restoreDrillPassed || !checks.generationMatchesInstance || secretKeyAvailable === false;
    const warning = !critical && (!checks.latestGenerationVerified || !checks.backupFresh || !checks.drillFresh);
    return {
      ok: !critical, state: critical ? "critical" : warning ? "warning" : "ready", generatedAt: new Date().toISOString(),
      checks, latest, recoveryGeneration, foreignRecoveryGeneration, currentInstanceId, backupAgeMs, restoreDrillAgeMs: drillAgeMs,
      note: "Ready means this Cluster instance has a stable instance identity and at least one matching signed schema-v3 generation that passed verification plus an isolated restore drill with the required Cluster secret key. Proven backups from another instance are surfaced separately and never satisfy this instance's readiness gate.",
    };
  }

  async function createPreUpgradeCheckpoint(signal?: AbortSignal) {
    throwIfAborted(signal);
    const manifest = await createServerBackup("pre-upgrade", signal);
    const drill = await runServerRestoreDrill(manifest.fileName, signal);
    if (!drill.ok) throw new Error("Pre-upgrade recovery checkpoint failed its restore drill. Upgrade must not continue.");
    return { ok: true, generationId: manifest.generationId, fileName: manifest.fileName, createdAt: manifest.createdAt, drill, readiness: await recoveryReadiness() };
  }

  async function pruneOperationalRecords() {
    const result = await applyRetentionPolicies(prisma, {
      trigger: "operational-maintenance",
    });
    return {
      expiredSessions: result.deletedByCategory.expired_sessions || 0,
      activityEvents: result.deletedByCategory.activity_events || 0,
      persistenceAuditLogs: result.deletedByCategory.persistence_audit_logs || 0,
      securityAuditEvents: 0,
      securityAuditEventsRetained: true,
      discordLinkChallenges: 0,
      syncReceipts: result.deletedByCategory.sync_receipts || 0,
      resolvedSyncConflicts: result.deletedByCategory.resolved_sync_conflicts || 0,
      syncTombstones: result.deletedByCategory.sync_tombstones || 0,
      policyManaged: true,
      retentionDays: null,
      runId: result.runId,
      totalDeleted: result.totalDeleted,
    };
  }

  
  
  function parseBackupTime(settings: SettingPayload) {
    const source = String(settings.backupScheduleTime || "03:00");
    const [hourRaw, minuteRaw] = source.split(":");
    return {
      hour: Math.max(0, Math.min(23, Number(hourRaw) || 0)),
      minute: Math.max(0, Math.min(59, Number(minuteRaw) || 0)),
    };
  }
  
  
  const BACKUP_DAY_ALIASES: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  
  
  function parseBackupDays(value?: string) {
    return String(value || "")
      .split(/[,;]+/)
      .map((item) => item.trim().toLowerCase())
      .map((item) => BACKUP_DAY_ALIASES[item])
      .filter((item): item is number => typeof item === "number");
  }
  
  
  function backupClock(settings: SettingPayload, now = new Date()) {
    const timezone = String(settings.backupTimezone || "").trim();
    if (timezone) {
      try {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          weekday: "short",
          hourCycle: "h23",
        });
        const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
        const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[parts.weekday] ?? now.getDay();
        return {
          year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
          hour: Number(parts.hour), minute: Number(parts.minute), weekday, timezone,
        };
      } catch {
        // Invalid historical settings fall back to the server clock. New settings are validated by the API.
      }
    }
    return {
      year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes(), weekday: now.getDay(), timezone: "server-local",
    };
  }


  function backupWindowKey(settings: SettingPayload, now = new Date()) {
    const frequency = String(settings.backupFrequency || "daily");
    const { hour, minute } = parseBackupTime(settings);
    const clock = backupClock(settings, now);
    const date = `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
    if (frequency === "hourly") return `${date}-${String(clock.hour).padStart(2, "0")}`;
    if (frequency === "weekly") {
      const localDate = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
      localDate.setUTCDate(localDate.getUTCDate() - clock.weekday);
      return `week-${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}-${hour}-${minute}`;
    }
    if (frequency === "monthly") return `${clock.year}-${String(clock.month).padStart(2, "0")}-${hour}-${minute}`;
    return `${date}-${hour}-${minute}`;
  }


  function backupIsDue(settings: SettingPayload, now = new Date()) {
    if (!settings.backupEnabled) return false;
    if (String(settings.backupFrequency || "daily") === "custom") return false;
    const { hour, minute } = parseBackupTime(settings);
    const clock = backupClock(settings, now);
    const localDate = `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
    const startDate = String(settings.backupScheduleDate || "");
    if (startDate && (localDate < startDate || (localDate === startDate && (clock.hour < hour || (clock.hour === hour && clock.minute < minute))))) return false;
    const frequency = String(settings.backupFrequency || "daily");
    if (frequency === "hourly") return clock.minute === minute;
    if (frequency === "weekly") {
      const days = parseBackupDays(settings.backupScheduleDaysCsv);
      return (!days.length || days.includes(clock.weekday)) && clock.hour === hour && clock.minute === minute;
    }
    if (frequency === "monthly") return clock.day === 1 && clock.hour === hour && clock.minute === minute;
    return clock.hour === hour && clock.minute === minute;
  }


  async function backupAlreadyExistsForWindow(windowKey: string) {
    try {
      const backupDir = DATA_LAYOUT.backupsRoot;
      const entries = await fs.readdir(backupDir);
      return entries.some((entry) => entry.startsWith("cluster-backup-") && entry.endsWith(".json") && !entry.endsWith(".config.json") && entry.includes(windowKey));
    } catch {
      return false;
    }
  }
  
  
  let backupInFlight: Promise<any> | null = null;

  async function createServerBackup(reason = "manual", signal?: AbortSignal) {
    if (backupInFlight) throw new Error("A Cluster backup is already running.");
    const operation = (async () => {
      throwIfAborted(signal);
      await ensureDataFolders();
      const now = new Date();
      const settings = await readSettings();
      const backupDir = DATA_LAYOUT.backupsRoot;
      await fs.mkdir(backupDir, { recursive: true });
      const stamp = slugStamp(now);
      const windowKey = backupWindowKey(settings, now).replace(/[^a-z0-9_-]/gi, "-");
      const fileBase = `cluster-backup-${stamp}-${windowKey}`;
      const manifestPath = path.join(backupDir, `${fileBase}.json`);
      const generationPaths = [
        manifestPath,
        path.join(backupDir, `${fileBase}.dump`),
        path.join(backupDir, `${fileBase}.config.json`),
        path.join(backupDir, `${fileBase}.uploads.tar`),
        path.join(backupDir, `${fileBase}.branding.tar`),
        path.join(backupDir, `${fileBase}.projects.tar`),
        path.join(backupDir, `${fileBase}.library.tar`),
        path.join(backupDir, `${fileBase}.users.tar`),
      ];
      let mirrorPlanForCleanup: any = null;
      const linked = linkedAbortController(signal);
      try {
      const databaseSnapshotBefore = await databaseRecoverySnapshot(DATABASE_URL, linked.controller.signal);
      if (databaseSnapshotBefore.recovery) throw new Error("Refusing to back up from a PostgreSQL recovery replica. Cluster backups require the writable primary database.");
      const databaseBackup = await createDatabaseBackup({
        prisma: prisma as any,
        databaseUrl: DATABASE_URL,
        destinationBase: path.join(backupDir, fileBase),
        signal: linked.controller.signal,
      });
      const databaseCopyPath = databaseBackup.path;
      const databaseProvider: "postgresql" = databaseBackup.provider;
      const databaseQuickCheck = { ok: databaseBackup.integrity.ok, result: databaseBackup.integrity.detail };

      throwIfAborted(linked.controller.signal);
      const configCopyPath = path.join(backupDir, `${fileBase}.config.json`);
      const configTemp = `${configCopyPath}.partial-${process.pid}`;
      await fs.copyFile(CONFIG_FILE_PATH, configTemp);
      await fs.chmod(configTemp, 0o600).catch(() => undefined);
      await fs.rename(configTemp, configCopyPath);

      const uploadsCopyPath = path.join(backupDir, `${fileBase}.uploads.tar`);
      const brandingCopyPath = path.join(backupDir, `${fileBase}.branding.tar`);
      const projectsCopyPath = path.join(backupDir, `${fileBase}.projects.tar`);
      const libraryCopyPath = path.join(backupDir, `${fileBase}.library.tar`);
      const usersCopyPath = path.join(backupDir, `${fileBase}.users.tar`);
      const artifactTasks = [
        createFilesystemArtifact(UPLOAD_ROOT, uploadsCopyPath, linked.controller.signal),
        createFilesystemArtifact(DATA_LAYOUT.brandingRoot, brandingCopyPath, linked.controller.signal),
        createFilesystemArtifact(DATA_LAYOUT.projectsRoot, projectsCopyPath, linked.controller.signal),
        createFilesystemArtifact(DATA_LAYOUT.libraryRoot, libraryCopyPath, linked.controller.signal),
        createFilesystemArtifact(DATA_LAYOUT.usersRoot, usersCopyPath, linked.controller.signal),
      ];
      const [uploadsArtifact, brandingArtifact, projectsArtifact, libraryArtifact, usersArtifact] = await Promise.all(artifactTasks).catch((error) => {
        if (!linked.controller.signal.aborted) linked.controller.abort(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
      const databaseArtifact = await backupArtifactInfo(databaseCopyPath, "database", linked.controller.signal);
      const configArtifact = await backupArtifactInfo(configCopyPath, "config", linked.controller.signal);
      const databaseSnapshotAfter = await databaseRecoverySnapshot(DATABASE_URL, linked.controller.signal);
      const snapshotStable = JSON.stringify(databaseSnapshotBefore.counts) === JSON.stringify(databaseSnapshotAfter.counts)
        && JSON.stringify(databaseSnapshotBefore.migrations) === JSON.stringify(databaseSnapshotAfter.migrations);
      const verification = {
        ok: databaseQuickCheck.ok && databaseArtifact.exists && databaseArtifact.formatValid && configArtifact.exists && configArtifact.formatValid,
        verifiedAt: now.toISOString(),
        databaseQuickCheck,
        database: databaseArtifact,
        config: configArtifact,
        uploads: { ok: true, ...uploadsArtifact },
        branding: { ok: true, ...brandingArtifact },
        projects: { ok: true, ...projectsArtifact },
        library: { ok: true, ...libraryArtifact },
        users: { ok: true, ...usersArtifact },
        sourceSnapshotStable: snapshotStable,
      };
      if (!verification.ok) throw new Error("Cluster backup artifacts failed immediate verification; manifest was not committed.");

      const artifactEncryption: Record<string, any> = {};
      for (const [kind, filePath] of [
        ["database", databaseCopyPath], ["config", configCopyPath], ["uploads", uploadsCopyPath], ["branding", brandingCopyPath],
        ["projects", projectsCopyPath], ["library", libraryCopyPath], ["users", usersCopyPath],
      ] as const) {
        artifactEncryption[path.basename(filePath)] = await protectBackupArtifact(fileBase, kind, filePath, linked.controller.signal);
      }

      const mirrorPlan = backupMirrorPlan(fileBase, generationPaths);
      mirrorPlanForCleanup = mirrorPlan;
      const recoveryRelativeTarget = (target: string) => {
        const dataRoot = path.resolve(DATA_ROOT);
        const resolved = path.resolve(target);
        const prefix = dataRoot.endsWith(path.sep) ? dataRoot : `${dataRoot}${path.sep}`;
        if (resolved === dataRoot) return ".";
        return resolved.startsWith(prefix) ? path.relative(dataRoot, resolved).replaceAll("\\", "/") : null;
      };
      const layoutRecoveryTargets = {
        uploads: recoveryRelativeTarget(UPLOAD_ROOT),
        branding: recoveryRelativeTarget(DATA_LAYOUT.brandingRoot),
        projects: recoveryRelativeTarget(DATA_LAYOUT.projectsRoot),
        library: recoveryRelativeTarget(DATA_LAYOUT.libraryRoot),
        users: recoveryRelativeTarget(DATA_LAYOUT.usersRoot),
      };
      const layoutExternalRoots = Object.fromEntries(Object.entries(layoutRecoveryTargets).map(([key, value]) => [key, value === null]));
      const unsignedManifest = {
        schemaVersion: 3,
        generationId: fileBase,
        ok: true,
        version: CLUSTER_VERSION,
        databaseProvider,
        reason,
        createdAt: now.toISOString(),
        fileName: path.basename(manifestPath),
        sourceInstance: {
          serverInstanceId: String(settings.serverInstanceId || "").trim() || null,
          serverDataEpoch: String(settings.serverDataEpoch || settings.serverInstanceId || "").trim() || null,
          serverDisplayName: String(settings.serverDisplayName || "").trim() || null,
        },
        secretRecovery: {
          encryptionKeyId: encryptionKeyId(),
          keyIncluded: false,
          requirement: "Restore the matching CLUSTER_SECRET_KEY separately; Cluster backups never copy secret-key material.",
        },
        artifactEncryption,
        layoutRecovery: {
          dataRootPortable: true,
          targets: layoutRecoveryTargets,
          externalRoots: layoutExternalRoots,
          // Kept for schema-3 readers while all durable domains transition to externalRoots.
          externalUploadRoot: Boolean(layoutExternalRoots.uploads),
        },
        recovery: {
          sourceDatabase: databaseSnapshotBefore.database,
          sourceDatabaseOid: databaseSnapshotBefore.databaseOid,
          postgresVersionNumber: databaseSnapshotBefore.versionNumber,
          writablePrimary: !databaseSnapshotBefore.recovery,
          migrations: databaseSnapshotBefore.migrations,
          counts: databaseSnapshotBefore.counts,
          snapshotStableDuringBackup: snapshotStable,
        },
        settings: {
          backupEnabled: settings.backupEnabled,
          backupFrequency: settings.backupFrequency || "daily",
          backupScheduleDate: settings.backupScheduleDate || null,
          backupScheduleTime: settings.backupScheduleTime || null,
          backupScheduleDaysCsv: settings.backupScheduleDaysCsv || null,
          backupRetentionDays: settings.backupRetentionDays || null,
          backupTimezone: settings.backupTimezone || null,
          verifyAfterCreate: settings.backupVerifyAfterCreate ?? BACKUP_VERIFY_AFTER_CREATE,
        },
        storageMirror: mirrorPlan,
        files: {
          database: { ...databaseArtifact, fileName: path.basename(databaseCopyPath) },
          config: { ...configArtifact, fileName: path.basename(configCopyPath) },
          uploads: uploadsArtifact,
          branding: brandingArtifact,
          projects: projectsArtifact,
          library: libraryArtifact,
          users: usersArtifact,
        },
        verification: (settings.backupVerifyAfterCreate ?? BACKUP_VERIFY_AFTER_CREATE) ? verification : { ok: null, verifiedAt: null, skipped: true },
        counts: databaseSnapshotBefore.counts,
      };
      const manifest = signBackupManifest(unsignedManifest);
      const tempManifestPath = `${manifestPath}.partial-${process.pid}`;
      await fs.writeFile(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      // Mirror from the staged, signed manifest. Do not advertise a committed
      // generation until *all* configured mirror objects have been uploaded.
      await mirrorBackupGeneration(mirrorPlan, generationPaths.map((filePath) => ({
        fileName: path.basename(filePath),
        filePath: filePath === manifestPath ? tempManifestPath : filePath,
      })), linked.controller.signal);
      await fs.rename(tempManifestPath, manifestPath);
      await fs.chmod(manifestPath, 0o600).catch(() => undefined);
      // Post-commit evidence projection failure is not a failed backup.
      await recordRecoveryEvidence({
        backupsRoot: DATA_LAYOUT.backupsRoot, generationId: fileBase, manifestFileName: path.basename(manifestPath),
        verification: { checkedAt: verification.verifiedAt, ok: verification.ok, schemaVersion: 3 },
      }).catch((error) => app.log.warn({ error, generationId: fileBase }, "backup committed; recovery evidence projection failed"));
      await pruneOldBackups(settings);
      return manifest;
      } catch (error) {
        // Failure before commit may leave some remote objects. Journal their
        // possible identities before discarding local artifacts. Fail closed if
        // the journal is unavailable, preserving local recovery material.
        if (mirrorPlanForCleanup) {
          await deferMirroredBackup({ generationId: fileBase, storageMirror: mirrorPlanForCleanup }, "failed-generation");
        }
        for (const filePath of generationPaths) await fs.rm(filePath, { force: true }).catch(() => undefined);
        const entries = await fs.readdir(backupDir).catch(() => [] as string[]);
        await Promise.all(entries.filter((name) => name.startsWith(`${fileBase}.`) && name.includes(".partial-")).map((name) => fs.rm(path.join(backupDir, name), { force: true }).catch(() => undefined)));
        throw error;
      } finally {
        linked.dispose();
      }
    })();
    backupInFlight = operation;
    try {
      return await operation;
    } finally {
      if (backupInFlight === operation) backupInFlight = null;
    }
  }


  async function pruneOldBackups(settings: SettingPayload) {
    const retentionDays = Number(settings.backupRetentionDays || 0);
    const cutoff = retentionDays >= 1 ? Date.now() - retentionDays * 24 * 60 * 60 * 1000 : null;
    const orphanCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const backupDir = DATA_LAYOUT.backupsRoot;
    try {
      const allEntries = await fs.readdir(backupDir);
      const manifests = allEntries
        .filter((name) => name.startsWith("cluster-backup-") && name.endsWith(".json") && !name.endsWith(".config.json"))
        .sort()
        .reverse();
      const protectedManifests = new Set(manifests.slice(0, 3));
      const committedBases = new Set(manifests.map((name) => name.slice(0, -".json".length)));
      for (const entry of allEntries) {
        if (!entry.startsWith("cluster-backup-") || entry.endsWith(".json") && !entry.endsWith(".config.json")) continue;
        const base = entry.replace(/(?:\.config\.json|\.uploads\.tar|\.branding\.tar|\.projects\.tar|\.library\.tar|\.users\.tar|\.dump)(?:\.partial-.*)?$/, "").replace(/\.partial-.*$/, "");
        if (committedBases.has(base)) continue;
        const filePath = path.join(backupDir, entry);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat && stat.mtime.getTime() < orphanCutoff) await fs.rm(filePath, { force: true });
      }
      if (cutoff === null) return;
      for (const manifestName of manifests) {
        if (protectedManifests.has(manifestName)) continue;
        const manifestPath = path.join(backupDir, manifestName);
        const stat = await fs.stat(manifestPath);
        if (stat.mtime.getTime() >= cutoff) continue;
        try {
          const { manifest } = await readBackupManifest(manifestName);
          const artifacts = [
            manifest.files?.database?.fileName,
            manifest.files?.config?.fileName,
            manifest.files?.uploads?.fileName,
            manifest.files?.branding?.fileName,
            manifest.files?.projects?.fileName,
            manifest.files?.library?.fileName,
            manifest.files?.users?.fileName,
          ].filter(Boolean);
          // Retain remote copies until provider fencing + recovery is certified.
          // Never discard the only pointer manifest if evidence journaling fails.
          await deferMirroredBackup(manifest, "retention-expired");
          for (const artifact of artifacts) {
            const resolved = resolveManifestArtifact(manifestPath, artifact);
            if (resolved) await fs.rm(resolved, { force: true });
          }
          await fs.rm(manifestPath, { force: true });
          await deleteRecoveryEvidence(DATA_LAYOUT.backupsRoot, manifest.generationId || path.basename(manifestPath, ".json"));
        } catch (error) {
          app.log.warn({ error, manifestName }, "backup generation prune skipped unreadable manifest");
        }
      }
    } catch (error) {
      app.log.warn(error, "backup prune failed");
    }
  }


  async function runBackupSchedulerTick() {
    const settings = await readSettings();
    const now = new Date();
    const windowKey = backupWindowKey(settings, now).replace(/[^a-z0-9_-]/gi, "-");
    if (backupIsDue(settings, now) && !(await backupAlreadyExistsForWindow(windowKey))) {
      await createServerBackup("scheduled");
      app.log.info({ windowKey }, "scheduled backup created");
    }
  }
  
  
  async function runOperationalMaintenance() {
    const result = await pruneOperationalRecords();
    const rateLimitPrune = rateLimiter.prune();
    app.log.info({ ...result, rateLimitPrune }, "operational retention maintenance completed");
  }
  
  
  function startBackgroundTasks() {
    backgroundTasks.scheduleInterval("collaboration-maintenance", 5_000, () => collaborationRuntime.runMaintenance(), { slowTaskMs: 1_000, workloadClass: "interactive" });
    backgroundTasks.scheduleAdaptive("backup-scheduler", 60_000, runBackupSchedulerTick, {
      runImmediately: true,
      maxBackoffMs: 15 * 60_000,
      slowTaskMs: 10_000,
      workloadClass: "maintenance",
    });
    backgroundTasks.scheduleAdaptive("operational-maintenance", 24 * 60 * 60 * 1000, runOperationalMaintenance, {
      runImmediately: true,
      maxBackoffMs: 7 * 24 * 60 * 60 * 1000,
      slowTaskMs: 60_000,
      workloadClass: "maintenance",
    });
    backgroundTasks.scheduleAdaptive(
      "editable-data-mirrors",
      60_000,
      async () => {
        const result = await syncEditableDataMirrors(prisma, DATA_LAYOUT);
        if (result.changed > 0) app.log.debug(result, "editable data mirrors synchronized");
        return { activity: result.changed > 0 ? "active" : "idle" };
      },
      { runImmediately: true, maxBackoffMs: 5 * 60_000, slowTaskMs: 10_000, workloadClass: "background" },
    );
  }
  
  
  async function requireAdminUserForRequest(request: FastifyRequest, reply: FastifyReply) {
    return authorization.requireAdmin(request, reply);
  }
  
  
  async function stabilizationCounts() {
    const [projects, boards, lists, cards, users, sessions, whiteboards, timelineItems, libraryItems, timeEntries, scheduleBlocks, activityEvents, persistenceRecords] = await Promise.all([prisma.project.count(), prisma.board.count(), prisma.boardList.count(), prisma.card.count(), prisma.user.count(), prisma.session.count(), prisma.whiteboard.count(), prisma.timelineItem.count(), prisma.libraryItem.count(), prisma.timeEntry.count(), prisma.scheduleBlock.count(), prisma.activityEvent.count(), safePersistenceRecordCount()]);
    return {
      projects,
      boards,
      lists,
      cards,
      users,
      sessions,
      whiteboards,
      timelineItems,
      libraryItems,
      timeEntries,
      scheduleBlocks,
      activityEvents,
      persistenceRecords,
    };
  }
  
  
  async function seedProductionDemoWorkspace(adminUserId?: string | null) {
    const created: string[] = [];
    let workspace = await prisma.workspace.findFirst();
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          name: "Cluster Workspace",
          description: "Seeded workspace shell.",
        },
      });
      created.push("workspace");
    }
    const demoUsers = [
      {
        username: "maya.lead",
        displayName: "Maya Lead",
        email: "maya@example.local",
        title: "Project Lead",
        department: "Production",
        teamName: "Core",
        capacityHours: 36,
        role: "admin",
        availability: "focus",
        toolPermissions: JSON.stringify({
          projects: "manage",
          activity: "manage",
          scheduler: "manage",
          builds: "manage",
        }),
      },
      {
        username: "quinn.qa",
        displayName: "Quinn QA",
        email: "quinn@example.local",
        title: "QA Analyst",
        department: "QA",
        teamName: "QA",
        capacityHours: 32,
        role: "member",
        availability: "available",
        toolPermissions: JSON.stringify({
          qa: "edit",
          tickets: "edit",
          builds: "view",
          activity: "view",
        }),
      },
      {
        username: "sage.dev",
        displayName: "Sage Dev",
        email: "sage@example.local",
        title: "Gameplay Developer",
        department: "Engineering",
        teamName: "Gameplay",
        capacityHours: 38,
        role: "member",
        availability: "available",
        toolPermissions: JSON.stringify({
          boards: "edit",
          builds: "edit",
          timeline: "edit",
        }),
      },
      {
        username: "riley.external",
        displayName: "Riley External",
        email: "riley@example.partner",
        title: "External Reviewer",
        department: "Partner",
        teamName: "External",
        capacityHours: 8,
        role: "external",
        availability: "away",
        toolPermissions: JSON.stringify({
          projects: "view",
          activity: "view",
          library: "view",
          tickets: "view",
        }),
      },
    ];
    const userRecords: any[] = [];
    for (const demoUser of demoUsers) {
      const user = await prisma.user.upsert({
        where: { username: demoUser.username },
        update: { displayName: demoUser.displayName, email: demoUser.email, toolPermissions: demoUser.toolPermissions },
        create: { username: demoUser.username, displayName: demoUser.displayName, email: demoUser.email, toolPermissions: demoUser.toolPermissions },
      });
      await syncUserWorkforceAuthorities(prisma, {
        workspaceId: workspace.id, userId: user.id, create: true,
        input: { title: demoUser.title, department: demoUser.department, capacityHours: demoUser.capacityHours, availability: demoUser.availability },
      });
      const demoDepartment = await prisma.department.findFirst({ where: { workspaceId: workspace.id, name: demoUser.department, archived: false }, select: { id: true } });
      const studioTeam = await prisma.studioTeam.upsert({
        where: { workspaceId_name: { workspaceId: workspace.id, name: demoUser.teamName } },
        update: { archived: false, departmentId: demoDepartment?.id || null, department: demoUser.department },
        create: { workspaceId: workspace.id, name: demoUser.teamName, departmentId: demoDepartment?.id || null, department: demoUser.department },
      });
      await prisma.studioTeamMember.upsert({
        where: { teamId_userId: { teamId: studioTeam.id, userId: user.id } },
        update: { archived: false, primaryMembership: true, allocationPercent: 100 },
        create: { teamId: studioTeam.id, userId: user.id, primaryMembership: true, allocationPercent: 100 },
      });
      userRecords.push(user);
      await prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
        },
        update: { role: demoUser.role },
        create: {
          workspaceId: workspace.id,
          userId: user.id,
          role: demoUser.role,
        },
      });
    }
    const [lead, qa, dev, external] = userRecords;
  
    async function seedProject(name: string, externalProject: boolean) {
      let project = await prisma.project.findFirst({
        where: { workspaceId: workspace!.id, name },
      });
      if (!project) {
        project = await prisma.project.create({
          data: {
            workspaceId: workspace!.id,
            name,
            description: externalProject ? "External partner review project for permissions and delivery testing." : "Internal sample production project for stabilization QA.",
            projectType: externalProject ? "general" : "game",
            productionProfile: externalProject ? "generic" : "unreal",
            source: externalProject ? "external" : "manual",
            status: "active",
            productionTracks: JSON.stringify(externalProject ? ["client", "review"] : ["game", "qa", "builds"]),
            memberships: { create: (externalProject ? [lead, external] : [lead, qa, dev]).map((member: any) => ({ userId: member.id, roleKey: member.id === lead.id ? "lead" : member.id === qa?.id ? "qa" : "contributor", roleLabel: member.id === lead.id ? "Project Lead" : (member.id === qa?.id ? "QA" : "Contributor"), isLead: member.id === lead.id, accessLevel: member.id === lead.id ? "manage" : (externalProject ? "view" : "contribute"), allocationPercent: 100, status: "active" })) },
          },
        });
        created.push(`project:${name}`);
      }
      let board = await prisma.board.findFirst({
        where: {
          projectId: project.id,
          name: externalProject ? "Partner Review" : "Production Board",
        },
      });
      if (!board) {
        board = await prisma.board.create({
          data: {
            projectId: project.id,
            name: externalProject ? "Partner Review" : "Production Board",
            description: externalProject ? "External deliverable review queue." : "Internal meeting and QA board.",
          },
        });
        const backlog = await prisma.boardList.create({
          data: {
            boardId: board.id,
            title: "Backlog",
            position: 0,
            color: "#3b82f6",
          },
        });
        const doing = await prisma.boardList.create({
          data: {
            boardId: board.id,
            title: externalProject ? "Client review" : "In Progress",
            position: 1,
            color: "#60a5fa",
            wipLimit: 5,
          },
        });
        const done = await prisma.boardList.create({
          data: {
            boardId: board.id,
            title: "Done",
            position: 2,
            color: "#94a3b8",
            isDone: true,
          },
        });
        await prisma.card.create({
          data: {
            listId: backlog.id,
            title: externalProject ? "Review latest milestone capture" : "Wire save/load checkpoint test",
            description: externalProject ? "External reviewer needs a clean build note and screenshot pass." : "Validate save/load flow and document any repro steps.",
            position: 0,
            priority: externalProject ? "medium" : "high",
            labels: JSON.stringify(externalProject ? ["external", "review"] : ["qa", "bug", "stabilization"]),
            assigneeId: externalProject ? external.id : qa.id,
          },
        });
        await prisma.card.create({
          data: {
            listId: doing.id,
            title: externalProject ? "Prepare partner notes" : "Build artifact smoke test",
            description: externalProject ? "Summarize approved and blocked items for the partner." : "Run latest artifact through install/startup smoke test.",
            position: 0,
            priority: "medium",
            labels: JSON.stringify(externalProject ? ["notes"] : ["build", "qa"]),
            assigneeId: externalProject ? lead.id : dev.id,
          },
        });
        await prisma.card.create({
          data: {
            listId: done.id,
            title: externalProject ? "Access confirmed" : "Project intake complete",
            description: "Seed task used for demo state and UI QA.",
            position: 0,
            priority: "low",
            labels: JSON.stringify(["seeded"]),
            assigneeId: lead.id,
          },
        });
      }
      if (
        !(await prisma.whiteboard.findFirst({
          where: {
            projectId: project.id,
            name: externalProject ? "Partner feedback map" : "Production flow map",
          },
        }))
      ) {
        await prisma.whiteboard.create({
          data: {
            projectId: project.id,
            name: externalProject ? "Partner feedback map" : "Production flow map",
            description: "Seeded production whiteboard for review, linking, and snapshot testing.",
            elements: JSON.stringify([
              {
                id: "seed-note-1",
                type: "sticky",
                x: 220,
                y: 160,
                width: 260,
                height: 140,
                text: externalProject ? "External feedback lane" : "Feature to QA handoff",
                reviewState: "in-review",
                comments: [
                  {
                    id: "seed-comment",
                    body: "Seeded review note",
                    createdAt: new Date().toISOString(),
                  },
                ],
                links: [],
              },
            ]),
          },
        });
      }
      if (
        !(await prisma.libraryItem.findFirst({
          where: {
            projectId: project.id,
            title: externalProject ? "Partner delivery brief" : "Release QA checklist",
          },
        }))
      ) {
        await prisma.libraryItem.create({
          data: {
            projectId: project.id,
            ownerId: lead.id,
            reviewerId: qa.id,
            title: externalProject ? "Partner delivery brief" : "Release QA checklist",
            body: externalProject ? "External-facing delivery notes and review criteria." : "Smoke test, regression, release notes, artifact URL, and approval gate checklist.",
            type: externalProject ? "brief" : "checklist",
            status: externalProject ? "in-review" : "approved",
            priority: "medium",
            tags: JSON.stringify(externalProject ? ["external", "delivery"] : ["qa", "release"]),
            versionLabel: externalProject ? "v0.1" : "v1.0",
            visibility: externalProject ? "external" : "internal",
            lifecycleNotes: "Seeded for v0.132 command center review.",
            changelog: JSON.stringify([
              {
                at: new Date().toISOString(),
                note: "Seeded demo lifecycle item.",
              },
            ]),
          },
        });
      }
      if (
        !(await prisma.timelineItem.findFirst({
          where: {
            projectId: project.id,
            title: externalProject ? "Partner review window" : "QA stabilization window",
          },
        }))
      ) {
        await prisma.timelineItem.create({
          data: {
            projectId: project.id,
            userId: lead.id,
            title: externalProject ? "Partner review window" : "QA stabilization window",
            description: "Seeded timeline item for Activity + Status review.",
            startsAt: new Date(Date.now() + (externalProject ? 5 : 2) * 24 * 60 * 60 * 1000),
            endsAt: new Date(Date.now() + (externalProject ? 8 : 4) * 24 * 60 * 60 * 1000),
            type: externalProject ? "review" : "meeting",
            source: "seed",
          },
        });
      }
      return { project, board };
    }
  
    const internal = await seedProject("Cluster Demo: Internal Production", false);
    const partner = await seedProject("Cluster Demo: External Partner", true);
    await prisma.user.update({
      where: { id: external.id },
      data: {
        projectPermissions: JSON.stringify({
          [partner.project.id]: "contribute",
          [internal.project.id]: "none",
        }),
      },
    });
    await logActivity({
      userId: adminUserId || lead.id,
      projectId: internal.project.id,
      boardId: internal.board?.id,
      type: "seeded",
      entityType: "workspace",
      entityId: workspace.id,
      title: "Demo workspace seeded",
      message: "v0.132 command center sample data was created or refreshed.",
      metadata: { version: CLUSTER_VERSION, created },
    });
    return { created, counts: await stabilizationCounts() };
  }

  return {
    backupIsDue,
    backupWindowKey,
    countFolderEntries,
    createPreUpgradeCheckpoint,
    createServerBackup,
    deleteBackupGeneration,
    listBackupManifests,
    pruneOperationalRecords,
    readBackupManifest,
    recoveryReadiness,
    runServerRestoreDrill,
    requireAdminUserForRequest,
    seedProductionDemoWorkspace,
    sha256File,
    stabilizationCounts,
    startBackgroundTasks,
    verifyBackupManifest
  };
}
