
import fs from "node:fs/promises";
import { assertNetworkDeploymentWritable, stageNetworkDeployment } from "../core/server-network-deployment.js";
import { NETWORK_REVIEW_KEYS } from "../core/server-network-change-review.js";
import { checkServerConfigPreconditions, type ServerConfigExpectedField } from "../core/server-config-preconditions.js";
import { SERVER_CONFIG_COMMIT_SETTING, durableReplaceFile, hasPublicationJournal, prepareConfigPublication, recoverConfigPublication, serializeConfigPublication } from "../core/server-config-publication-journal.js";
import { FastifyRequest } from "fastify";
import { CONFIGURABLE_TOOL_SETTING_FLAGS } from "../domains/access/configurable-tool-availability.js";
import { hashPassword, verifyPassword } from "../core/auth.js";
import { ensureClusterDataLayout } from "../core/data-layout.js";

import { databaseProviderFromUrl, redactDatabaseUrl } from "../core/database-provider.js";
import { verifyStorageSchema as verifyPostgresqlSchema } from "../core/storage-migrations.js";
import { BOOT_SECRET_SETTING_KEYS, decryptBootSettingStorageValue, decryptContextPackStorageValue, decryptSettingStorageValue, encryptedValueNeedsRotation, encryptionKeyConfigured, encryptionKeyId, encryptBootSettingStorageValue, encryptContextPackStorageValue, encryptSettingStorageValue, isEncryptedValue, previousEncryptionKeyIds, SENSITIVE_SETTING_KEYS, shouldEncryptSetting } from "../core/setting-crypto.js";
import { describeSecret } from "../core/secret-store.js";
import type { SettingPayload } from "./server-composition-types.js";


import { verifySecurityPinCredential } from "../core/security-pin-credential.js";
export function createSettingsIntegrationServices(deps: Record<string, any>) {
  const {
    AUTH_SECRET,
    CONFIG_FILE_PATH,
    DATABASE_URL,
    DATA_LAYOUT,
    DATA_ROOT,
    DUMMY_PASSWORD,
    MASKED_SECRET,
    SERVER_MANAGED_SETTING_KEYS,
    UPLOAD_ROOT,
    activityService,
    app,
    auditService,
    dummyPasswordState,
    fetchWithTimeout,
    parseJsonObject,
    prisma,
    requestIpAddress,
    requestUserAgent,
    studioPermissionSettings,
    securityTelemetry,
    onStudioSettingsChanged,
  } = deps;
  
  
  function normalizePersonalAccent(value: unknown) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const color = String(value).trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Personal accent color must use #RRGGBB format.");
    return color.toLowerCase();
  }

  function serializeActivityEvent(event: any) {
    const { user, project, board, whiteboard, card, ...rest } = event || {};
    return {
      ...rest,
      metadata: parseJsonObject(event?.metadata),
      user: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            discordUserId: user.discordUserId,
            status: user.workforceStatus?.connectionVisibility === "invisible" ? "offline" : user.workforceStatus?.availability || "available",
            lastSeenAt: user.lastSeenAt,
          }
        : null,
      project: project ? { id: project.id, name: project.name, source: project.source, status: project.status, archived: project.archived } : null,
      board: board ? { id: board.id, projectId: board.projectId, name: board.name } : null,
      whiteboard: whiteboard ? { id: whiteboard.id, projectId: whiteboard.projectId, name: whiteboard.name } : null,
      card: card ? { id: card.id, title: card.title } : null,
    };
  }
  
  
  async function logActivity(input: { userId?: string | null; projectId?: string | null; boardId?: string | null; whiteboardId?: string | null; cardId?: string | null; type: string; entityType: string; entityId?: string | null; title: string; message?: string | null; metadata?: Record<string, unknown> }) {
    await activityService.record(input);
  }
  
  
  async function logSecurityEvent(input: { event: string; actorUserId?: string | null; targetUserId?: string | null; workspaceId?: string | null; result: "SUCCESS" | "FAILURE"; reasonCode: string; request?: FastifyRequest | null; metadata?: Record<string, unknown> }) {
    securityTelemetry?.record(input.event, input.result);
    const result = await auditService.recordSecurity({
      ...input,
      request: undefined,
      requestId: input.request?.id || null,
      requestMethod: input.request?.method || null,
      requestPath: input.request ? String(input.request.url || "").split("?")[0] : null,
      ipAddress: input.request ? requestIpAddress(input.request) : null,
      userAgent: input.request ? requestUserAgent(input.request) : null,
    });
    if (!result.ok) securityTelemetry?.record("security.audit_write_failed", "FAILURE");
    return result;
  }
  
  
  async function verifyUserPin(user: any, pin: string, purpose: string, request?: FastifyRequest | null) {
    if (!user?.id) throw new Error("Login required.");
    return verifySecurityPinCredential({
      prisma,
      userId: user.id,
      pin,
      purpose,
      request,
      logSecurityEvent,
    });
  }


  async function dummyPasswordHash() {
    const hash = dummyPasswordState.promise ?? hashPassword(DUMMY_PASSWORD);
    dummyPasswordState.promise = hash;
    return hash;
  }
  
  
  type ConfigReadResult = {
    settings: SettingPayload;
    needsCompaction: boolean;
  };

  function configSettingsForDisk(payload: SettingPayload) {
    const result: Record<string, unknown> = {};
    for (const key of SERVER_MANAGED_SETTING_KEYS as Set<string>) {
      if (!(key in payload) || SENSITIVE_SETTING_KEYS.has(key)) continue;
      const value = (payload as Record<string, unknown>)[key];
      result[key] = BOOT_SECRET_SETTING_KEYS.has(key)
        ? encryptBootSettingStorageValue(key, JSON.stringify(value ?? ""))
        : value;
    }
    return result;
  }

  async function readConfigFileSettings(): Promise<ConfigReadResult> {
    try {
      const raw = await fs.readFile(CONFIG_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (Number((parsed as any).version) !== 2 || (parsed as any).secretPolicy !== "server-managed-only" || !(parsed as any).settings || typeof (parsed as any).settings !== "object" || Array.isArray((parsed as any).settings)) {
          throw new Error("Cluster server config must use schema version 2 with server-managed-only secret policy.");
        }
        const source = (parsed as any).settings as Record<string, unknown>;
        const settings: SettingPayload = {};
        let needsCompaction = false;
        for (const [key, value] of Object.entries(source)) {
          if (!(SERVER_MANAGED_SETTING_KEYS as Set<string>).has(key)) {
            throw new Error(`Unsupported setting ${key} in Cluster server config.`);
          }
          if (SENSITIVE_SETTING_KEYS.has(key)) throw new Error(`Sensitive setting ${key} must be stored through Cluster's protected settings store, not cluster.config.json.`);
          if (BOOT_SECRET_SETTING_KEYS.has(key) && typeof value === "string" && value) {
            if (!isEncryptedValue(value)) throw new Error(`Protected boot setting ${key} must be encrypted in cluster.config.json.`);
            try {
              const decrypted = decryptBootSettingStorageValue(key, value);
              (settings as Record<string, unknown>)[key] = JSON.parse(decrypted);
              if (encryptedValueNeedsRotation(value)) needsCompaction = true;
            } catch (error) {
              throw new Error(`Protected boot setting ${key} could not be decrypted. Restore the matching CLUSTER_SECRET_KEY before starting Cluster.`, { cause: error });
            }
          } else {
            (settings as Record<string, unknown>)[key] = value;
          }
        }
        return { settings, needsCompaction };
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        app.log.error({ err: error }, "server config file read failed");
        throw error;
      }
    }
    return { settings: {}, needsCompaction: false };
  }


  async function ensureDataFolders() {
    await ensureClusterDataLayout(DATA_LAYOUT);
  }


  async function verifyConfiguredStorageSchema(): Promise<void> {
    await verifyPostgresqlSchema(prisma as any, app.log);
  }


  function serializedConfigFileSettings(payload: SettingPayload): string {
    return serializeConfigPublication(configSettingsForDisk(payload), encryptionKeyId());
  }

  async function recoverPendingConfigPublication(): Promise<"none" | "committed" | "rolled_back"> {
    if (!(await hasPublicationJournal(CONFIG_FILE_PATH))) return "none";
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(506, 1)`;
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(506, 2)`;
      return recoverPendingConfigPublicationUnderLock(tx);
    }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
    settingsCache = null;
    return result;
  }

  async function recoverPendingConfigPublicationUnderLock(tx: any): Promise<"none" | "committed" | "rolled_back"> {
    if (!(await hasPublicationJournal(CONFIG_FILE_PATH))) return "none";
    const markerRows = await tx.appSetting.findMany({ where: { key: SERVER_CONFIG_COMMIT_SETTING } });
    const marker = markerRows[0]?.value || null;
    const result = await recoverConfigPublication(CONFIG_FILE_PATH, marker);
    settingsCache = null;
    if (result === "rolled_back") app.log.warn({ result }, "aborted server configuration publication rolled back");
    else if (result === "committed") app.log.info?.({ result }, "server configuration publication confirmed");
    return result;
  }

  function stripServerManagedSettings<T extends Record<string, unknown>>(payload: T) {
    const copy = { ...payload } as Record<string, unknown>;
    for (const key of SERVER_MANAGED_SETTING_KEYS) delete copy[key];
    return copy as T;
  }


  async function persistDatabaseSettings(payload: SettingPayload, database: any = prisma) {
    const databasePayload = stripServerManagedSettings(payload as Record<string, unknown>) as SettingPayload;
    for (const [key, value] of Object.entries(databasePayload)) {
      const rawJsonValue = JSON.stringify(value ?? "");
      const storedValue = encryptSettingStorageValue(key, rawJsonValue);
      await database.appSetting.upsert({
        where: { key },
        update: { value: storedValue },
        create: { key, value: storedValue },
      });
    }
    const misplacedKeys = [...(SERVER_MANAGED_SETTING_KEYS as Set<string>)];
    if (misplacedKeys.length) await database.appSetting.deleteMany({ where: { key: { in: misplacedKeys } } });
  }


  let storageSecretRotationPromise: Promise<void> | null = null;
  let pendingRotationNotified = false;

  async function rotateContextPackEncryption() {
    const packs = await prisma.contextPack.findMany({ select: { id: true, payload: true } });
    for (const pack of packs) {
      if (!pack.payload || !encryptedValueNeedsRotation(pack.payload)) continue;
      const raw = decryptContextPackStorageValue(pack.payload);
      await prisma.contextPack.update({
        where: { id: pack.id },
        data: { payload: encryptContextPackStorageValue(raw) },
      });
    }
  }


  const SETTINGS_CACHE_TTL_MS = 5_000;

  let settingsCache: { value: SettingPayload; expiresAt: number } | null = null;

  let settingsReadPromise: Promise<SettingPayload> | null = null;


  async function readSettings(force = false): Promise<SettingPayload> {
    // Preserve the five-second cached read fast path (no disk stat per API
    // request). On refresh/forced reads, reconcile any interrupted publication
    // before accessing the config file. Startup always recovers before listen.
    if (!force && settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value;
    if (!force && settingsReadPromise) return settingsReadPromise;
    if (await hasPublicationJournal(CONFIG_FILE_PATH)) await recoverPendingConfigPublication();
    settingsReadPromise = (async () => {
      const rows = await prisma.appSetting.findMany();
      const result: SettingPayload = {};
      let databaseNeedsRotation = false;

      for (const setting of rows) {
        if (setting.key.startsWith("_internal.")) continue;
        try {
          const storedValue = decryptSettingStorageValue(setting.key, setting.value);
          (result as Record<string, unknown>)[setting.key] = JSON.parse(storedValue);
          if (shouldEncryptSetting(setting.key) && encryptedValueNeedsRotation(setting.value)) databaseNeedsRotation = true;
        } catch (error) {
          if (shouldEncryptSetting(setting.key)) {
            throw new Error(`Protected setting ${setting.key} could not be decrypted. Restore the matching CLUSTER_SECRET_KEY before changing settings.`, { cause: error });
          }
          (result as Record<string, unknown>)[setting.key] = "";
        }
      }

      const config = await readConfigFileSettings();
      const merged = { ...result, ...config.settings };
      // Reads never rewrite protected storage. Implicit key rewrap bypassed
      // the publication journal, could clobber a concurrent writer, and could
      // write to disk while PostgreSQL was unavailable. An administrator must
      // explicitly run the protected rewrap operation instead.
      if ((databaseNeedsRotation || config.needsCompaction) && !pendingRotationNotified) {
        pendingRotationNotified = true;
        app.log.warn("Protected settings require key rotation; use the administrative secret rewrap action.");
      }

      for (const key of Object.keys(studioPermissionSettings)) delete (studioPermissionSettings as Record<string, unknown>)[key];
      Object.assign(studioPermissionSettings, merged);
      settingsCache = { value: merged, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
      return merged;
    })().finally(() => {
      settingsReadPromise = null;
    });
    return settingsReadPromise;
  }


  /**
   * Converged writer for DATABASE-backed Studio defaults. Import publication uses
   * the same transaction lock (506, 1). Never use this for boot/server-managed
   * configuration, which requires a different database + file commit protocol.
   * The updater receives only the selected, freshly read fields under the lock.
   */
  type ExpectedStudioSetting = { exists: boolean; value?: unknown };
  // Internal deletion marker, never accepted from client payloads. Resetting an
  // AppSetting means removing its explicit row, not writing null/undefined or
  // a guessed default value that would block future default changes.
  const RESET_STUDIO_SETTING = Symbol("reset-studio-setting");

  async function mutateSettingsKeys(
    keys: string[],
    derive: (current: Record<string, unknown>) => Record<string, unknown>,
    expected?: Record<string, ExpectedStudioSetting>,
  ): Promise<{ changedKeys: string[] }> {
    const selected = [...new Set(keys)];
    if (!selected.length || selected.length > 256 || selected.some((key) => !key || key.startsWith("_internal.") || (SERVER_MANAGED_SETTING_KEYS as Set<string>).has(key))) {
      throw new Error("Studio setting patch contains unsupported or server-managed keys.");
    }
    if (expected && (Object.keys(expected).length !== selected.length || selected.some((key) => !Object.prototype.hasOwnProperty.call(expected, key)))) {
      throw new Error("Expected Studio Settings must identify every selected field exactly once.");
    }
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(506, 1)`;
      const rows = await tx.appSetting.findMany({ where: { key: { in: selected } }, select: { key: true, value: true } });
      const current: Record<string, unknown> = {};
      for (const row of rows) current[row.key] = JSON.parse(decryptSettingStorageValue(row.key, row.value));
      // Compare-and-swap is performed against DATABASE truth while holding the
      // same lock used by reviewed configuration imports and other Studio writers.
      // Absent keys differ from keys storing null, false, or an empty string.
      if (expected) {
        const conflicts: string[] = [];
        for (const key of selected) {
          const entry = expected[key];
          if (!entry || typeof entry.exists !== "boolean" || (entry.exists && !Object.prototype.hasOwnProperty.call(entry, "value"))) {
            throw new Error(`Expected Studio Setting ${key} must declare its existence and value.`);
          }
          const exists = Object.prototype.hasOwnProperty.call(current, key);
          if (exists !== entry.exists || (exists && JSON.stringify(current[key]) !== JSON.stringify(entry.value))) conflicts.push(key);
        }
        if (conflicts.length) {
          const error = new Error("Studio Settings changed while you were editing. Reload to review the current values before saving.") as Error & { code: string; conflictingKeys: string[] };
          error.code = "STUDIO_SETTINGS_CONFLICT";
          error.conflictingKeys = conflicts;
          throw error;
        }
      }
      const requested = derive({ ...current });
      if (!requested || typeof requested !== "object" || Array.isArray(requested)) throw new Error("Studio setting patch must be an object.");
      const changedKeys: string[] = [];
      for (const [key, value] of Object.entries(requested)) {
        if (!selected.includes(key) || value === undefined || key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new Error("Studio setting patch modified an unselected field.");
        }
        if (value === RESET_STUDIO_SETTING) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
          await tx.appSetting.deleteMany({ where: { key } });
          changedKeys.push(key);
          continue;
        }
        if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
        const valueJson = JSON.stringify(value ?? "");
        await tx.appSetting.upsert({
          where: { key },
          create: { key, value: encryptSettingStorageValue(key, valueJson) },
          update: { value: encryptSettingStorageValue(key, valueJson) },
        });
        changedKeys.push(key);
      }
      return { changedKeys };
    }, { isolationLevel: "Serializable" });
    if (result.changedKeys.length) {
      settingsCache = null;
      const effectiveSettings = await readSettings(true);
      // A committed setting must never be reported as a failed write merely
      // because an optional local runtime listener had an error.
      try { onStudioSettingsChanged?.(result.changedKeys, effectiveSettings); }
      catch (error) { app.log.error({ err: error }, "settings runtime change notification failed"); }
    }
    return result;
  }

  /** Return true database baselines, preserving absent-vs-null CAS semantics.
   * Never use resolved readSettings() defaults as optimistic write preconditions.
   */
  async function readSettingPreconditions(keys: string[]): Promise<Record<string, ExpectedStudioSetting>> {
    const selected = [...new Set(keys)];
    if (selected.length > 256 || selected.some((key) => !key || key.startsWith("_internal.") || (SERVER_MANAGED_SETTING_KEYS as Set<string>).has(key))) {
      throw new Error("Unsupported Studio setting precondition keys.");
    }
    const rows = selected.length ? await prisma.appSetting.findMany({ where: { key: { in: selected } }, select: { key: true, value: true } }) : [];
    const preconditions: Record<string, ExpectedStudioSetting> = Object.fromEntries(selected.map((key) => [key, { exists: false }]));
    for (const row of rows) preconditions[row.key] = { exists: true, value: JSON.parse(decryptSettingStorageValue(row.key, row.value)) };
    return preconditions;
  }

  /** Patch exactly the fields sent by a tool, without rewriting unrelated keys. */
  async function patchSettings(patch: SettingPayload, expected?: Record<string, ExpectedStudioSetting>): Promise<{ changedKeys: string[] }> {
    const keys = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
    if (!keys.length) return { changedKeys: [] };
    return mutateSettingsKeys(keys, () => Object.fromEntries(keys.map((key) => [key, (patch as Record<string, unknown>)[key]])), expected);
  }

  /** Delete explicit database-backed overrides under the same advisory lock,
   * DB-truth compare-and-swap, cache invalidation and runtime notification used
   * by ordinary Settings patches. The client must identify every selected key
   * and its original stored value, including explicit nulls.
   */
  async function resetSettingOverrides(
    keys: string[],
    expected: Record<string, ExpectedStudioSetting>,
  ): Promise<{ changedKeys: string[] }> {
    return mutateSettingsKeys(keys, () => Object.fromEntries(keys.map((key) => [key, RESET_STUDIO_SETTING])), expected);
  }

  /**
   * Publish a server config with a durable disk journal + DB transaction marker.
   * Journal replay distinguishes committed vs rolled-back database state, and
   * refuses to replace a file altered outside the recorded publication.
   * Startup must reconcile before accepting requests; if boot settings changed
   * while recovery ran, startup exits so the next boot reads the correct values.
   */
  async function saveSettings(
    payload: SettingPayload,
    options?: {
      changedFields: SettingPayload;
      expectedSettings: Record<string, ServerConfigExpectedField>;
    } | { rewrapOnly: true },
  ) {
    let committed: SettingPayload;
    try {
      committed = await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(506, 1)`;
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(506, 2)`;
        // Finish any previous killed writer before reading file/DB authority.
        await recoverPendingConfigPublicationUnderLock(tx);
        await assertNetworkDeploymentWritable(CONFIG_FILE_PATH);
        let stageNetworkChange = false;
        let next = payload;
        if (options) {
          const rows = await tx.appSetting.findMany();
          const current: SettingPayload = {};
          for (const row of rows) {
            if (row.key.startsWith("_internal.")) continue;
            (current as Record<string, unknown>)[row.key] = JSON.parse(decryptSettingStorageValue(row.key, row.value));
          }
          const boot = await readConfigFileSettings();
          Object.assign(current, boot.settings);
          if ("rewrapOnly" in options) {
            // Rewrap exactly the latest committed values, not a snapshot loaded
            // before the PostgreSQL publication locks were acquired.
            next = { ...current, appDisplayName: "Cluster" };
          } else {
            const conflicts = checkServerConfigPreconditions(
              settingsForClient(current),
              options.changedFields as Record<string, unknown>,
              options.expectedSettings,
            ).conflicts;
            if (conflicts.length) {
              const error = new Error("Server Configuration changed while you were editing. Refresh and review the changed fields.") as Error & { code: string; conflictingKeys: string[] };
              error.code = "SERVER_CONFIG_CONFLICT";
              error.conflictingKeys = conflicts;
              throw error;
            }
            next = { ...current, ...options.changedFields, appDisplayName: "Cluster" };
            stageNetworkChange = NETWORK_REVIEW_KEYS.some(key => key !== "lanDiscoveryEnabled" &&
              JSON.stringify((current as Record<string, unknown>)[key]) !== JSON.stringify((next as Record<string, unknown>)[key]));
            for (const key of ["databaseUrlOverride", "redisUrlOverride"] as const) {
              if ((options.changedFields as Record<string, unknown>)[key] === MASKED_SECRET) {
                (next as Record<string, unknown>)[key] = (current as Record<string, unknown>)[key];
              }
            }
          }
        }
        await persistDatabaseSettings(next, tx);
        await ensureDataFolders();
        const afterBytes = serializedConfigFileSettings(next);
        const journal = await prepareConfigPublication(CONFIG_FILE_PATH, afterBytes);
        // Stage the exact previous/next boot bytes while holding BOTH settings
        // publication locks, before exposing the new file. If the database
        // transaction aborts, the canonical publication journal rolls back and
        // the native service sees this rollout as an inert previous snapshot.
        if (stageNetworkChange) await stageNetworkDeployment(CONFIG_FILE_PATH, journal.before.bytes, afterBytes, journal.id);
        await durableReplaceFile(CONFIG_FILE_PATH, afterBytes);
        // Same transaction as all other AppSetting writes: this is the commit
        // decision used after a crash, never a separate post-commit update.
        await tx.appSetting.upsert({
          where: { key: SERVER_CONFIG_COMMIT_SETTING },
          create: { key: SERVER_CONFIG_COMMIT_SETTING, value: journal.id },
          update: { value: journal.id },
        });
        return next;
      }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
    } catch (error) {
      // Transaction rollback can leave the file at the new value. Reacquire the
      // two locks and reconcile. Startup recovery covers abrupt process death.
      try { await recoverPendingConfigPublication(); }
      catch (recoveryError) {
        app.log.error({ err: recoveryError }, "server configuration rollback requires manual recovery");
        throw new Error("Server configuration recovery failed; refusing new writes until repaired.", { cause: recoveryError });
      }
      throw error;
    }
    // Reconcile under the same publication locks. Never unlink the journal
    // outside those locks: a second process may already have a newer journal.
    try { await recoverPendingConfigPublication(); }
    catch (error) { app.log.warn({ err: error }, "committed server configuration journal awaits safe reconciliation"); }
    for (const key of Object.keys(studioPermissionSettings)) delete (studioPermissionSettings as Record<string, unknown>)[key];
    Object.assign(studioPermissionSettings, committed);
    settingsCache = { value: { ...committed }, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
    // Protected publications may alter any Studio tool flag, not just Calendar.
    try { onStudioSettingsChanged?.(CONFIGURABLE_TOOL_SETTING_FLAGS, committed); }
    catch (error) { app.log.error({ err: error }, "configuration runtime notification failed"); }
  }

  /** Explicit administrative key rewrap; all settings are freshly fetched
   * under both publication locks. Context-pack rewrap is safe to resume after
   * partial completion with the previous key still configured. */
  async function rewrapProtectedSettings() {
    await saveSettings({}, { rewrapOnly: true });
    if (!storageSecretRotationPromise) {
      storageSecretRotationPromise = rotateContextPackEncryption().finally(() => { storageSecretRotationPromise = null; });
    }
    await storageSecretRotationPromise;
    pendingRotationNotified = false;
  }

  function maskConfiguredSecret(value: string | undefined) {
    return value ? MASKED_SECRET : "";
  }


  function studioSettingsForClient(settings: SettingPayload) {
    return {
      ...stripServerManagedSettings({ ...settings } as Record<string, unknown>),
      appDisplayName: "Cluster",
    };
  }


  function settingsForClient(settings: SettingPayload) {
    return {
      ...settings,
      appDisplayName: "Cluster",
      discordWebhookUrlConfigured: Boolean(settings.discordWebhookUrl),
      discordWebhookUrl: maskConfiguredSecret(settings.discordWebhookUrl),
      discordWebhookUrlFingerprint: describeSecret(settings.discordWebhookUrl, "setting:discordWebhookUrl").fingerprint,
      discordBotTokenConfigured: Boolean(settings.discordBotToken),
      discordBotToken: maskConfiguredSecret(settings.discordBotToken),
      discordBotTokenFingerprint: describeSecret(settings.discordBotToken, "setting:discordBotToken").fingerprint,
      databaseUrlOverrideConfigured: Boolean(settings.databaseUrlOverride),
      databaseUrlOverride: maskConfiguredSecret(settings.databaseUrlOverride),
      databaseUrlOverrideFingerprint: describeSecret(settings.databaseUrlOverride, "boot-setting:databaseUrlOverride").fingerprint,
      redisUrlOverrideConfigured: Boolean(settings.redisUrlOverride),
      redisUrlOverride: maskConfiguredSecret(settings.redisUrlOverride),
      redisUrlOverrideFingerprint: describeSecret(settings.redisUrlOverride, "boot-setting:redisUrlOverride").fingerprint,
      secretsEncryptedAtRest: true,
      encryptionKeyConfigured: encryptionKeyConfigured(),
      encryptionKeyId: encryptionKeyId(),
      previousEncryptionKeyIds: previousEncryptionKeyIds(),
      encryptedSettingKeys: [...Array.from(SENSITIVE_SETTING_KEYS), ...Array.from(BOOT_SECRET_SETTING_KEYS)],
      settingsSource: "database+protected-boot-config",
      configPath: CONFIG_FILE_PATH,
      dataRoot: DATA_ROOT,
      uploadRoot: UPLOAD_ROOT,
      storageTopology: DATA_LAYOUT.storage.domains,
      databaseProvider: databaseProviderFromUrl(DATABASE_URL),
      databaseUrl: redactDatabaseUrl(DATABASE_URL),
      serverManagedSettingKeys: Array.from(SERVER_MANAGED_SETTING_KEYS),
    };
  }


  function requireDiscordBot(settings: SettingPayload) {
    if (!settings.discordBotToken || settings.discordBotToken === MASKED_SECRET) {
      throw new Error("No Discord bot token configured.");
    }
    return settings.discordBotToken.startsWith("Bot ") ? settings.discordBotToken : `Bot ${settings.discordBotToken}`;
  }
  
  
  async function discordRequest(settings: SettingPayload, path: string, options: { method?: string; body?: unknown } = {}) {
    const token = requireDiscordBot(settings);
    const headers: Record<string, string> = {
      Authorization: token,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
  
    const response = await fetchWithTimeout(`https://discord.com/api/v10${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }, undefined, { purpose: "Discord API", requireHttps: true, allowedHosts: ["discord.com"], maxResponseBytes: 8 * 1024 * 1024 });
  
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
  
    if (!response.ok) {
      throw new Error(json?.message || `Discord API failed: ${response.status}`);
    }
  
    return json;
  }
  
  


  return {
    discordRequest,
    dummyPasswordHash,
    ensureDataFolders,
    logActivity,
    logSecurityEvent,
    normalizePersonalAccent,
    readSettings,
    recoverPendingConfigPublication,
    saveSettings,
    rewrapProtectedSettings,
    patchSettings,
    readSettingPreconditions,
    resetSettingOverrides,
    mutateSettingsKeys,
    serializeActivityEvent,
    settingsForClient,
    studioSettingsForClient,
    stripServerManagedSettings,
    verifyStorageSchema: verifyConfiguredStorageSchema,
    verifyUserPin
  };
}
