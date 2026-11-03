import { CLUSTER_PROJECT_STATUSES, REVIEW_MEDIA, inferReviewMediumFromResource, normalizeClusterExternalPortalSections, resolveClusterProjectDefinitionForProfile, resolveClusterProjectType, type ReviewMedium } from "@cluster/shared";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { FastifyReply, FastifyRequest } from "fastify";
import { accountNextStep } from "../core/auth.js";

import { decodeDataUrl, detectedMimeType, isExecutablePayload, mimePatternAllowed, normalizeMimeType, resolvedUploadMime, safeFileName, safePathSegment } from "../core/uploads.js";
import { currentUploadMalwareScanner, inspectUploadSecurity } from "../core/upload-security.js";
import { createAuthorizationService } from "../domains/access/authorization.js";
import { createHttpError } from "../core/http-errors.js";
import { createRequestAuthorizationBoundary } from "../domains/access/request-authorization-boundary.js";
import { disabledConfigurableToolLabel } from "../domains/access/configurable-tool-availability.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE, workforceAuthorityProjection } from "../domains/workforce/workforce-user-authority.js";
import { createRequestSecurityServices } from "./server-request-security-services.js";
import { createClusterDataLayout, projectStorageDirectory, safeStorageSegment } from "../core/data-layout.js";
import {
  consumeCompletedUpload,
  copyCompletedUploadToFile,
  readCompletedUploadPrefix,
  resolveCompletedUpload,
} from "../domains/uploads/upload-session-runtime.js";

import { DatabaseDiagnostics } from "../core/database-diagnostics.js";
import { createClusterStorageRuntimeFromEnvironment, managedWorkspaceBlobStorageKey, storageLocatorForManagedFile } from "../core/storage/storage-runtime.js";
import { decryptContextPackStorageValue } from "../core/setting-crypto.js";
import { CONTEXT_PACK_SETTING_KEYS, containsContextPackSecrets, projectContextPackPayload } from "../core/context-pack-policy.js";
import type { SettingPayload } from "./server-composition-types.js";


export function createRequestDomainServices(deps: Record<string, any>) {
  const {
    ALLOW_EXECUTABLE_UPLOADS,
    AUTH_REQUIRED,
    AUTH_SECRET,
    AVATAR_UPLOAD_LIMIT_BYTES,
    BOOT_SETTINGS,
    BOOT_CONFIG_FILE_PATH,
    CLUSTER_VERSION,
    CONFIGURED_CORS_ORIGINS,
    RATE_LIMIT_ENABLED,
    REQUEST_TIMEOUT_MS,
    REQUIRE_DISCORD_LINK,
    REQUIRE_MUTATION_ORIGIN,
    SECURITY_HEADERS_ENABLED,
    SESSION_COOKIE,
    SESSION_DAYS,
    SESSION_IDLE_HOURS,
    SESSION_MAX_PER_USER,
    SESSION_SECURE,
    UPLOAD_LIMIT_BYTES,
    prisma,
    rateLimiter,
    distributedRateLimiter,
    readSettings,
    onSessionRevoked = (_sessionId: string, _userId: string, _reason: string) => undefined,
    onUserSessionsRevoked = (_userId: string, _reason: string, _exceptSessionId?: string | null) => undefined,
  } = deps;
  
  
  const SERVER_MANAGED_SETTING_KEYS = new Set<keyof SettingPayload>([
    "serverInstanceId", "serverDataEpoch", "serverDisplayName", "lanDiscoveryEnabled",
    "discordWebhookUrl", "discordVoiceUrl", "discordMessagePrefix", "discordBotToken", "discordGuildId",
    "discordForumChannelId", "discordChatChannelId", "discordAdminRoleId", "discordApplicationId", "discordApplicationPublicKey",
    "serverHost", "serverPort", "webHost", "webPort", "allowInsecureLanHttp", "webTlsCertFile", "webTlsKeyFile", "publicApiUrl", "publicWebUrl", "corsOrigins",
    "requestBodyLimitMb", "uploadLimitMb", "requestTimeoutSeconds", "authRequired", "devLoginEnabled",
    "requireDiscordLink", "sessionDays", "sessionSecure", "rateLimitEnabled", "rateLimitMax",
    "rateLimitWindowMinutes", "authRateLimitMax", "sessionIdleHours", "sessionMaxPerUser",
    "securityHeadersEnabled", "requireMutationOrigin", "avatarUploadLimitMb", "allowExecutableUploads",
    "allowedUploadMimeCsv", "backupVerifyAfterCreate", "logLevel", "enableRequestLogs",
    "autoSeed", "backupEnabled", "backupRetentionDays", "backupScheduleDate",
    "backupScheduleTime", "backupFrequency", "backupScheduleDaysCsv", "backupScheduleRule", "backupTimezone",
    "trustedProxy", "dataRootOverride", "projectsRootOverride", "libraryRootOverride", "usersRootOverride", "backupsRootOverride", "logsRootOverride", "runtimeRootOverride", "exportsRootOverride", "uploadRootOverride", "brandingRootOverride", "configFileOverride", "databaseUrlOverride", "accelerationMode", "redisUrlOverride", "redisKeyPrefix",
  ]);
  
  const requestSecurity = createRequestSecurityServices({
    AUTH_SECRET,
    CONFIGURED_CORS_ORIGINS,
    RATE_LIMIT_ENABLED,
    REQUEST_TIMEOUT_MS,
    REQUIRE_MUTATION_ORIGIN,
    SECURITY_HEADERS_ENABLED,
    SESSION_COOKIE,
    SESSION_DAYS,
    SESSION_IDLE_HOURS,
    SESSION_MAX_PER_USER,
    SESSION_SECURE,
    prisma,
    rateLimiter,
    distributedRateLimiter,
    readSettings,
    onSessionRevoked,
  });
  const {
    clearCurrentSessionCache,
    clearRateLimitKey,
    clearSessionCookies,
    createSession,
    csrfTokenForSession,
    csrfTokenMatches,
    fetchWithTimeout,
    getClientKey,
    getCurrentSession,
    getCurrentUser,
    hashToken,
    mutationOriginAllowed,
    mutationOriginDecision,
    rateLimit,
    rateLimitKey,
    requestIpAddress,
    requestUserAgent,
    requireConfirmation,
    securityHeaders,
  } = requestSecurity;

  const studioPermissionSettings: SettingPayload = {};
  
  function serializeAccessRule(rule: any) {
    return {
      id: rule.id,
      targetKind: rule.targetKind,
      targetId: rule.targetId,
      projectId: rule.projectId,
      subjectKind: rule.subjectKind,
      subjectId: rule.subjectId,
      subjectName: rule.subjectName,
      effect: rule.effect,
      level: rule.level,
      sections: parseLabels(rule.sections),
      status: rule.status === "active" && rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now() ? "expired" : rule.status,
      expiresAt: rule.expiresAt?.toISOString?.() || rule.expiresAt || null,
      notes: rule.notes,
      createdAt: rule.createdAt?.toISOString?.() || rule.createdAt,
      updatedAt: rule.updatedAt?.toISOString?.() || rule.updatedAt,
    };
  }
  
  function hashShareToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
  
  function shareLinkExpired(link: any, now = new Date()) {
    if (link?.status !== "active") return true;
    if (link?.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return true;
    if (link?.maxUses != null && Number(link.useCount || 0) >= Number(link.maxUses)) return true;
    return false;
  }
  
  function serializeProjectShareLink(link: any) {
    return {
      id: link.id,
      projectId: link.projectId,
      tokenPreview: link.tokenPreview,
      accessLevel: link.accessLevel,
      allowedSections: normalizeClusterExternalPortalSections(parseLabels(link.allowedSections)),
      expiresAt: link.expiresAt?.toISOString?.() || link.expiresAt || null,
      maxUses: link.maxUses,
      useCount: link.useCount || 0,
      status: shareLinkExpired(link) && link.status === "active" ? "expired" : link.status,
      createdById: link.createdById,
      createdAt: link.createdAt?.toISOString?.() || link.createdAt,
      updatedAt: link.updatedAt?.toISOString?.() || link.updatedAt,
    };
  }
  
  async function canManageProjectAccess(request: FastifyRequest, project: any) {
    const user = await getCurrentUser(request);
    if (!user) return !AUTH_REQUIRED;
    const decorated = await decorateUserForClient(user);
    return Boolean(decorated?.isAdmin || hasProjectPermission(user, decorated?.workspaceRole, project, "manage"));
  }
  
  function isDiscordConfigured() {
    return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && (process.env.DISCORD_REDIRECT_URI || process.env.NODE_ENV !== "production"));
  }
  
  function setupIsComplete(settings: SettingPayload) {
    return settings.setupComplete === true || String(settings.setupComplete) === "true";
  }
  
  function cleanOptionalString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }
  
  function resolveWorkspaceRoot() {
    const cwd = process.cwd();
    if (path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === "apps") {
      return path.resolve(cwd, "../..");
    }
    return cwd;
  }
  
  const WORKSPACE_ROOT = resolveWorkspaceRoot();
  
  async function readQualityGateStatus() {
    const routeAuditPath = path.join(DATA_LAYOUT.runtimeRoot, "quality-reports", "route-audit.json");
    let routeAudit: any = null;
    try {
      routeAudit = JSON.parse(await fs.readFile(routeAuditPath, "utf8"));
    } catch {
      routeAudit = null;
    }
    return {
      workflowConfigured: existsSync(path.join(WORKSPACE_ROOT, ".github", "workflows", "quality.yml")),
      verificationCommand: "npm run verify",
      routeAudit: routeAudit
        ? {
            generatedAt: routeAudit.generatedAt || null,
            routeCount: Number(routeAudit.routeCount || 0),
            mutationCount: Number(routeAudit.mutationCount || 0),
            findings: Number(routeAudit.duplicateCount || 0) + Number(routeAudit.publicMutationCount || 0) + Number(routeAudit.invalidRootCount || 0) + Number(routeAudit.dangerousWildcardCount || 0) + Number((routeAudit.unclassifiedRoutes || []).length),
          }
        : null,
    };
  }
  
  const DATA_ROOT = path.resolve(process.env.CLUSTER_DATA_DIR || BOOT_SETTINGS.dataRootOverride || path.join(WORKSPACE_ROOT, "data"));
  
  const DATA_LAYOUT = createClusterDataLayout(DATA_ROOT, {
    configFile: BOOT_CONFIG_FILE_PATH,
    storageOverrides: {
      projects: BOOT_SETTINGS.projectsRootOverride,
      library: BOOT_SETTINGS.libraryRootOverride,
      users: BOOT_SETTINGS.usersRootOverride,
      backups: BOOT_SETTINGS.backupsRootOverride,
      logs: BOOT_SETTINGS.logsRootOverride,
      runtime: BOOT_SETTINGS.runtimeRootOverride,
      exports: BOOT_SETTINGS.exportsRootOverride,
      uploads: BOOT_SETTINGS.uploadRootOverride,
      branding: BOOT_SETTINGS.brandingRootOverride,
    },
  });
  const storageRuntime = createClusterStorageRuntimeFromEnvironment(DATA_ROOT);

  async function sha256StoredObject(locator: any) {
    const hash = crypto.createHash("sha256");
    const stream = await storageRuntime.openRead(locator);
    for await (const chunk of stream as any) hash.update(chunk);
    return hash.digest("hex");
  }
  
  const UPLOAD_ROOT = path.resolve(process.env.CLUSTER_UPLOAD_DIR || BOOT_SETTINGS.uploadRootOverride || DATA_LAYOUT.uploadsRoot);
  
  const CONFIG_FILE_PATH = path.resolve(process.env.CLUSTER_CONFIG_FILE || BOOT_SETTINGS.configFileOverride || DATA_LAYOUT.configFile);
  
  const DATABASE_URL = process.env.DATABASE_URL || BOOT_SETTINGS.databaseUrlOverride || "postgresql://cluster@127.0.0.1:5432/cluster";
  
  const databaseDiagnostics = new DatabaseDiagnostics(prisma as any, DATABASE_URL, { maxSamples: 512, slowQueryMs: 100 });
  
  (prisma as any).$on?.("query", (event: any) => databaseDiagnostics.recordQuery(event));
  
  const DATA_FOLDERS = Object.values(DATA_LAYOUT).filter((value) => typeof value === "string" && !path.extname(value));
  
  const PROJECT_STATUSES = new Set<string>(CLUSTER_PROJECT_STATUSES);
  
  function normalizeProjectType(value: unknown) {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "general";
    const slug = raw
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    return slug || "general";
  }
  
  function normalizeProjectStatus(value: unknown) {
    const status = typeof value === "string" ? value : "active";
    return PROJECT_STATUSES.has(status) ? status : "active";
  }
  
  async function configuredProjectType(type: string) {
    const settings = await readSettings();
    return resolveClusterProjectType(type, settings.projectTypePresets);
  }

  function defaultBoardColumnsForProjectType(type: string, productionProfile?: string | null) {
    const definition = resolveClusterProjectType(normalizeProjectType(type), (BOOT_SETTINGS as any).projectTypePresets);
    return [...resolveClusterProjectDefinitionForProfile(definition, productionProfile).boardColumns];
  }

  function productionTracksForType(type: string) {
    const definition = resolveClusterProjectType(normalizeProjectType(type), (BOOT_SETTINGS as any).projectTypePresets);
    return [...definition.tracks];
  }

  function requireReviewMedium(value: unknown): ReviewMedium {
    const medium = String(value || "");
    if (!(REVIEW_MEDIA as readonly string[]).includes(medium)) throw createHttpError("REVIEW_MEDIUM_INVALID", "A valid review medium is required for this resource.", 400);
    return medium as ReviewMedium;
  }

  function configuredStorageContains(candidate: string, roots: string[]) {
    const resolvedCandidate = path.resolve(candidate);
    const comparableCandidate = process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
    return roots.some((entry) => {
      const resolvedRoot = path.resolve(entry);
      const comparableRoot = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
      const prefix = comparableRoot.endsWith(path.sep) ? comparableRoot : `${comparableRoot}${path.sep}`;
      return comparableCandidate === comparableRoot || comparableCandidate.startsWith(prefix);
    });
  }

  async function writeUpload(projectId: string, kind: "review_asset" | "file" | "avatar" | "branding", originalName: string, dataUrl: string, clientMime?: string, destinationFolder?: string, reviewMedium?: ReviewMedium) {
    const settings = await readSettings();
    const id = crypto.randomBytes(12).toString("hex");
    let filename = `${id}-${safeFileName(originalName)}`;
    let folder = destinationFolder ? path.resolve(destinationFolder) : "";
    if (!folder) {
      if (kind === "avatar") {
        const user = await prisma.user.findUnique({
          where: { id: projectId },
          select: { id: true, username: true },
        });
        folder = path.join(DATA_LAYOUT.userAvatarsRoot, user ? `${safeStorageSegment(user.username, "user")}--${user.id.slice(-10)}` : safePathSegment(projectId));
      } else if (kind === "branding") {
        folder = DATA_LAYOUT.brandingRoot;
      } else {
        const projectDirectory = await projectStorageDirectory(prisma, DATA_LAYOUT, projectId);
        folder = kind === "review_asset"
          ? path.join(projectDirectory, "Media", requireReviewMedium(reviewMedium))
          : path.join(projectDirectory, "Files");
      }
    }
    const normalizedFolder = path.resolve(folder);
    const allowedStorageRoots = [DATA_LAYOUT.root, DATA_LAYOUT.projectsRoot, DATA_LAYOUT.libraryRoot, DATA_LAYOUT.usersRoot, DATA_LAYOUT.brandingRoot, DATA_LAYOUT.uploadsRoot, DATA_LAYOUT.exportsRoot];
    if (!configuredStorageContains(normalizedFolder, allowedStorageRoots)) {
      throw createHttpError("UPLOAD_PATH_INVALID", "Upload destination is outside configured Cluster storage.", 400);
    }
    folder = normalizedFolder;

    const maxBytes = kind === "avatar" || kind === "branding"
      ? Math.min(AVATAR_UPLOAD_LIMIT_BYTES, Number(settings.avatarUploadLimitMb || 5) * 1024 * 1024)
      : Math.min(UPLOAD_LIMIT_BYTES, Number(settings.uploadLimitMb || 512) * 1024 * 1024);
    let decoded: ReturnType<typeof decodeDataUrl>;
    try {
      decoded = decodeDataUrl(dataUrl, maxBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload payload is invalid.";
      if (/exceeds the .* limit/i.test(message)) throw createHttpError("UPLOAD_TOO_LARGE", message, 413);
      throw createHttpError("UPLOAD_INVALID_PAYLOAD", message, 400);
    }
    const { buffer, declaredMime } = decoded;
    const detectedMime = detectedMimeType(buffer);
    const requestedMime = normalizeMimeType(clientMime || declaredMime);
    let storedMime = resolvedUploadMime(buffer, originalName, requestedMime);

    if (kind === "avatar" || kind === "branding") {
      const avatarTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
      if (!avatarTypes.has(detectedMime) || requestedMime !== detectedMime) {
        throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", kind === "branding" ? "Studio logos must be valid PNG, JPEG, WEBP, or GIF image files." : "Profile icons must be valid PNG, JPEG, WEBP, or GIF image files.", 415);
      }
      const extension = detectedMime === "image/png" ? ".png" : detectedMime === "image/webp" ? ".webp" : detectedMime === "image/gif" ? ".gif" : ".jpg";
      filename = `${id}-${safeFileName(path.parse(originalName).name)}${extension}`;
      storedMime = detectedMime;
    } else if (kind === "review_asset") {
      if (!ALLOW_EXECUTABLE_UPLOADS && !settings.allowExecutableUploads && isExecutablePayload(buffer, originalName)) {
        throw createHttpError("EXECUTABLE_UPLOAD_DISABLED", "Executable uploads are disabled in Server Configuration.", 415);
      }
      const medium = requireReviewMedium(reviewMedium);
      const inferredMedium = inferReviewMediumFromResource(storedMime, originalName);
      if (inferredMedium !== medium) throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", `Review asset does not match the declared ${medium} medium.`, 415);
      if (medium === "image" && storedMime === "image/svg+xml") throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", "Active SVG content cannot be used directly as a review image; rasterize it first.", 415);
    } else {
      if (!mimePatternAllowed(storedMime, settings.allowedUploadMimeCsv)) throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", `Upload type ${storedMime} is not allowed by Server Config.`, 415);
      if (!ALLOW_EXECUTABLE_UPLOADS && !settings.allowExecutableUploads && isExecutablePayload(buffer, originalName)) {
        throw createHttpError("EXECUTABLE_UPLOAD_DISABLED", "Executable uploads are disabled in Server Configuration.", 415);
      }
    }

    const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const uploadSecurity = await inspectUploadSecurity({
      fileName: originalName,
      mimeType: storedMime,
      sizeBytes: buffer.length,
      checksumSha256,
      prefix: buffer.subarray(0, Math.min(buffer.length, 64 * 1024)),
      allowExecutable: Boolean(ALLOW_EXECUTABLE_UPLOADS || settings.allowExecutableUploads),
      allowActiveContent: true,
      scanner: currentUploadMalwareScanner(),
      scanBuffer: buffer,
    });
    if (!uploadSecurity.allowed) throw createHttpError(uploadSecurity.code, uploadSecurity.reason, uploadSecurity.quarantine ? 423 : 415);

    await fs.mkdir(folder, { recursive: true });
    const fullPath = path.join(folder, filename);
    await fs.writeFile(fullPath, buffer, { flag: "wx", mode: 0o640 });
    return {
      storedName: filename,
      fullPath,
      actualSize: buffer.length,
      detectedMime: storedMime,
      declaredMime,
      checksumSha256,
    };
  }

  async function storeCompletedUpload(ownerId: string, isAdmin: boolean, uploadId: string, projectId: string, kind: "review_asset" | "file", originalName: string, clientMime?: string, destinationFolder?: string, reviewMedium?: ReviewMedium) {
    const uploadRuntime = { prisma, storageRuntime, dataLayout: DATA_LAYOUT };
    const resolved = await resolveCompletedUpload(uploadRuntime, uploadId, ownerId, isAdmin);
    if (!resolved) throw createHttpError("UPLOAD_NOT_FOUND", "Completed upload session was not found.", 404);
    const settings = await readSettings();
    const maxBytes = Math.min(UPLOAD_LIMIT_BYTES, Number(settings.uploadLimitMb || 512) * 1024 * 1024);
    if (resolved.metadata.totalBytes > maxBytes) throw createHttpError("UPLOAD_TOO_LARGE", `Upload exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB server limit.`, 413);

    const header = await readCompletedUploadPrefix(uploadRuntime, resolved, 64 * 1024);
    const storedMime = resolvedUploadMime(header, originalName, clientMime || "application/octet-stream");
    if (!ALLOW_EXECUTABLE_UPLOADS && !settings.allowExecutableUploads && isExecutablePayload(header, originalName)) {
      throw createHttpError("EXECUTABLE_UPLOAD_DISABLED", "Executable uploads are disabled in Server Configuration.", 415);
    }
    if (kind === "review_asset") {
      const medium = requireReviewMedium(reviewMedium);
      const inferredMedium = inferReviewMediumFromResource(storedMime, originalName);
      if (inferredMedium !== medium) throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", `Review asset does not match the declared ${medium} medium.`, 415);
      if (medium === "image" && storedMime === "image/svg+xml") throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", "Active SVG content cannot be used directly as a review image; rasterize it first.", 415);
    } else if (!mimePatternAllowed(storedMime, settings.allowedUploadMimeCsv)) {
      throw createHttpError("UPLOAD_TYPE_NOT_ALLOWED", `Upload type ${storedMime} is not allowed by Server Config.`, 415);
    }

    const uploadSecurity = await inspectUploadSecurity({
      fileName: originalName,
      mimeType: storedMime,
      sizeBytes: resolved.metadata.totalBytes,
      checksumSha256: String(resolved.metadata.checksumSha256 || ""),
      prefix: header,
      allowExecutable: Boolean(ALLOW_EXECUTABLE_UPLOADS || settings.allowExecutableUploads),
      allowActiveContent: true,
      scanner: currentUploadMalwareScanner(),
      ...(resolved.filePath ? { filePath: resolved.filePath } : {}),
    });
    await prisma.uploadSession.update({
      where: { id: uploadId },
      data: uploadSecurity.allowed
        ? { scannedAt: new Date(), scanProvider: uploadSecurity.scanner?.id || null, scanVerdict: uploadSecurity.scanner?.verdict || "built-in-clean", quarantineCode: null, quarantineReason: null }
        : { status: "QUARANTINED", scannedAt: new Date(), scanProvider: uploadSecurity.scanner?.id || null, scanVerdict: uploadSecurity.scanner?.verdict || "blocked", quarantineCode: uploadSecurity.code, quarantineReason: uploadSecurity.reason },
    });
    if (!uploadSecurity.allowed) throw createHttpError(uploadSecurity.code, uploadSecurity.reason, 423);

    const storedName = `${crypto.randomBytes(12).toString("hex")}-${safeFileName(originalName)}`;
    if (kind === "file" && !destinationFolder) {
      const projectScope = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
      if (!projectScope?.workspaceId) throw createHttpError("PROJECT_NOT_FOUND", "Project storage scope is unavailable.", 404);
      const checksumSha256 = resolved.metadata.checksumSha256!;
      const existingBlob = await prisma.managedBlob.findUnique({
        where: { workspaceId_checksumSha256: { workspaceId: projectScope.workspaceId, checksumSha256 } },
      });
      if (existingBlob && existingBlob.gcState === "CLAIMED") {
        throw createHttpError("MANAGED_BLOB_GC_BUSY", "Identical managed content is being reclaimed. Retry this finalization shortly.", 409);
      }
      const storage = existingBlob
        ? { provider: existingBlob.storageProvider, tier: existingBlob.storageTier, key: existingBlob.storageKey }
        : storageRuntime.place(
            { purpose: "source", sizeBytes: resolved.metadata.totalBytes, activeProject: true },
            managedWorkspaceBlobStorageKey(projectScope.workspaceId, checksumSha256),
          );

      if (existingBlob) {
        const existingStat = await storageRuntime.stat(storage as any).catch(() => null);
        const existingHash = existingStat?.size === resolved.metadata.totalBytes
          ? await sha256StoredObject(storage as any).catch(() => null)
          : null;
        if (!existingStat || existingStat.size !== resolved.metadata.totalBytes || existingHash !== checksumSha256) {
          // Never delete/overwrite an existing managed destination during an
          // upload. Other project files or sessions may reference those bytes.
          // Mark the exact observed record corrupt and require governed repair.
          const quarantined = await prisma.managedBlob.updateMany({
            where: {
              id: existingBlob.id,
              storageProvider: existingBlob.storageProvider,
              storageTier: existingBlob.storageTier,
              storageKey: existingBlob.storageKey,
              gcState: existingBlob.gcState,
            },
            data: { gcState: "CORRUPT" },
          });
          if (quarantined.count !== 1) throw createHttpError("MANAGED_BLOB_CHANGED", "Managed content changed during verification. Retry after reconciliation.", 409);
          throw createHttpError("MANAGED_BLOB_INVALID", "Existing managed content failed verification and is held for administrator repair. Its stored bytes were preserved.", 409);
        }
      } else {
        const copied = resolved.storage
          ? await storageRuntime.copy(resolved.storage, storage as any, { checksumSha256 })
          : await storageRuntime.putFile(storage as any, resolved.filePath!);
        if (copied.size !== resolved.metadata.totalBytes) {
          // The attempted target copy might now belong to another writer.
          throw createHttpError("UPLOAD_COPY_INVALID", "Stored upload size failed integrity verification.", 500);
        }
      }

      const projectDirectory = await projectStorageDirectory(prisma, DATA_LAYOUT, projectId);
      const canonicalPath = path.join(projectDirectory, "Files", storedName);
      const materialized = await storageRuntime.materializeToFile(storage as any, canonicalPath);
      if (materialized.size !== resolved.metadata.totalBytes) {
        await fs.rm(canonicalPath, { force: true }).catch(() => undefined);
        // Do not unlink an unfenced managed target after materialization failed.
        throw createHttpError("UPLOAD_COPY_INVALID", "Portable project copy failed integrity verification.", 500);
      }

      return {
        uploadId,
        storedName,
        storage,
        fullPath: canonicalPath,
        actualSize: resolved.metadata.totalBytes,
        detectedMime: storedMime,
        declaredMime: normalizeMimeType(clientMime),
        checksumSha256,
        materialization: { method: materialized.method || "copy", portable: true },
        managedBlob: {
          workspaceId: projectScope.workspaceId,
          storageProvider: storage.provider,
          storageTier: storage.tier,
          storageKey: storage.key,
          reused: Boolean(existingBlob),
        },
      };
    }

    let folder = destinationFolder ? path.resolve(destinationFolder) : "";
    if (!folder) {
      const projectDirectory = await projectStorageDirectory(prisma, DATA_LAYOUT, projectId);
      folder = path.join(projectDirectory, "Media", requireReviewMedium(reviewMedium));
    }
    const normalizedFolder = path.resolve(folder);
    const allowedStorageRoots = [DATA_LAYOUT.root, DATA_LAYOUT.projectsRoot, DATA_LAYOUT.libraryRoot, DATA_LAYOUT.usersRoot, DATA_LAYOUT.brandingRoot, DATA_LAYOUT.uploadsRoot, DATA_LAYOUT.exportsRoot];
    if (!configuredStorageContains(normalizedFolder, allowedStorageRoots)) throw createHttpError("UPLOAD_PATH_INVALID", "Upload destination is outside configured Cluster storage.", 400);
    await fs.mkdir(normalizedFolder, { recursive: true });
    const fullPath = path.join(normalizedFolder, storedName);
    await copyCompletedUploadToFile(uploadRuntime, resolved, fullPath);
    const copied = await fs.stat(fullPath);
    if (copied.size !== resolved.metadata.totalBytes) {
      await fs.rm(fullPath, { force: true }).catch(() => undefined);
      throw createHttpError("UPLOAD_COPY_INVALID", "Stored upload size failed integrity verification.", 500);
    }
    return { uploadId, storedName, storage: null, fullPath, actualSize: resolved.metadata.totalBytes, detectedMime: storedMime, declaredMime: normalizeMimeType(clientMime), checksumSha256: resolved.metadata.checksumSha256! };
  }

  async function consumeUploadSession(uploadId: string) {
    await consumeCompletedUpload({ prisma, storageRuntime, dataLayout: DATA_LAYOUT }, uploadId);
  }

  async function resolveProjectStoredFile(projectId: string, kind: "review_asset" | "file", fileName: string, reviewMedium?: ReviewMedium) {
    const projectDirectory = await projectStorageDirectory(prisma, DATA_LAYOUT, projectId);
    return kind === "review_asset"
      ? path.join(projectDirectory, "Media", requireReviewMedium(reviewMedium), path.basename(fileName))
      : path.join(projectDirectory, "Files", path.basename(fileName));
  }

  function projectFileStorageLocator(file: any) { return storageLocatorForManagedFile(file); }

  async function discardStoredProjectFile(_storage: unknown) {
    // The managed locator is content-addressed and can have concurrent owners.
    // A failed project-file insert does not prove exclusive ownership of bytes.
    // Deferred cleanup belongs to the managed storage reconciliation protocol.
  }

  async function discardPreparedManagedBlob(_input: { workspaceId?: string; checksumSha256?: string; storage?: unknown }) {
    // Same ownership rule for a prepared but not yet committed ManagedBlob.
    // Keep ambiguous copies rather than deleting a concurrent writer's data.
  }

  async function resolveAvatarStoredFile(userId: string, fileName: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    const currentPath = path.join(DATA_LAYOUT.userAvatarsRoot, user ? `${safeStorageSegment(user.username, "user")}--${user.id.slice(-10)}` : safePathSegment(userId), path.basename(fileName));
    if (existsSync(currentPath)) return currentPath;
    return path.join(UPLOAD_ROOT, safePathSegment(userId), "avatar", path.basename(fileName));
  }
  
  function parseStoredLabels(value: string | undefined | null) {
    return parseLabels(value);
  }
  
  function serializeProjectSummary(project: any) {
    return {
      ...project,
      productionTracks: parseLabels(project.productionTracks),
      tags: parseLabels(project.tags),
      aliases: parseLabels(project.aliases),
      boards: (project.boards || []).map((board: any) => ({
        ...board,
        assignedUserIds: parseLabels(board.assignedUserIds),
        labelDefinitions: parseElements(board.labelDefinitions),
        lists: (board.lists || []).map((list: any) => ({
          ...list,
          assignedUserIds: parseLabels(list.assignedUserIds),
        })),
      })),
      libraryItems: (project.libraryItems || []).map(serializeLibraryItem),
      sourceBindings: (project.sourceBindings || []).map((binding: any) => ({
        ...binding,
        policyOverrides: (() => { try { return JSON.parse(binding.policyOverrides || "{}"); } catch { return {}; } })(),
        repository: binding.repository ? {
          ...binding.repository,
          metadata: (() => { try { return JSON.parse(binding.repository.metadata || "{}"); } catch { return {}; } })(),
          connection: binding.repository.connection ? {
            id: binding.repository.connection.id,
            providerId: binding.repository.connection.providerId,
            category: binding.repository.connection.category,
            displayName: binding.repository.connection.displayName,
            status: binding.repository.connection.status,
            healthState: binding.repository.connection.healthState,
          } : null,
        } : null,
      })),
      integrationBindings: (project.integrationBindings || []).map((binding: any) => ({
        ...binding,
        metadata: (() => { try { return JSON.parse(binding.metadata || "{}"); } catch { return {}; } })(),
        connection: binding.connection ? {
          id: binding.connection.id,
          providerId: binding.connection.providerId,
          category: binding.connection.category,
          displayName: binding.connection.displayName,
          status: binding.connection.status,
          healthState: binding.connection.healthState,
        } : null,
      })),
      versions: (project.versions || []).map((version: any) => ({
        ...version,
        components: (() => { try { return JSON.parse(version.components || "{}"); } catch { return {}; } })(),
      })),
    };
  }
  
  function serializeReviewAsset(asset: any) {
    const parseObject = (value: unknown) => {
      if (!value) return {};
      if (typeof value === "object" && !Array.isArray(value)) return value;
      try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
    };
    const { sensitiveMetadata: _sensitiveMetadata, ...safeAsset } = asset;
    return {
      ...safeAsset,
      metadata: parseObject(asset.metadata),
      metadataProvenance: parseObject(asset.metadataProvenance),
      comments: (asset.comments || []).map((comment: any) => ({
        ...comment,
        locator: parseObject(comment.locator),
        mentionedUserIds: parseLabels(comment.mentionedUserIds),
        user: serializeUserLite(comment.user),
      })),
    };
  }
  
  async function getSetupStatus() {
    const settings = await readSettings();
    const [workspaceCount, userCount, workspace] = await Promise.all([
      prisma.workspace.count(),
      prisma.user.count(),
      prisma.workspace.findFirst({ where: { archived: false }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      ok: true,
      version: CLUSTER_VERSION,
      studioName: cleanOptionalString(settings.studioName) || cleanOptionalString(workspace?.description) || "Cluster Studio",
      workspaceName: cleanOptionalString(settings.workspaceName) || cleanOptionalString(workspace?.name) || "Cluster Workspace",
      setupComplete: setupIsComplete(settings),
      setupCompletedAt: settings.setupCompletedAt || null,
      serverInstanceId: cleanOptionalString(settings.serverInstanceId) || null,
      serverDataEpoch: cleanOptionalString(settings.serverDataEpoch) || cleanOptionalString(settings.serverInstanceId) || null,
      serverDisplayName: cleanOptionalString(settings.serverDisplayName) || "Cluster Server",
      workspaceCount,
      userCount,
      discordOAuthConfigured: isDiscordConfigured(),
      discordLinkRequired: REQUIRE_DISCORD_LINK,
      hasDiscordSettings: Boolean(settings.discordWebhookUrl || settings.discordGuildId || settings.discordBotToken),
      hasSourceControlConnections: Boolean(await prisma.integrationConnection.count({ where: { category: "source-control", archived: false, status: { not: "disabled" } } })),
      hasContextPackReady: Boolean(settings.discordGuildId || settings.discordWebhookUrl),
    };
  }
  
  async function getWorkspaceMembership(userId: string) {
    return prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: [{ role: "asc" }, { workspaceId: "asc" }],
      select: { workspaceId: true, role: true },
    });
  }

  async function getWorkspaceRole(userId: string) {
    return (await getWorkspaceMembership(userId))?.role ?? null;
  }

  async function decorateUserForClient(user: any) {
    if (!user) return null;
    const canonicalUser = user.employment !== undefined && user.workforceStatus !== undefined && user.workingPattern !== undefined && user.personSkills !== undefined && user.studioTeamMemberships !== undefined
      ? user
      : await prisma.user.findUnique({ where: { id: user.id }, include: WORKFORCE_USER_AUTHORITY_INCLUDE });
    const membership = await getWorkspaceMembership(user.id);
    const workspaceRole = membership?.role ?? null;
    const workspaceAdmin = ["owner", "admin"].includes(String(workspaceRole));
    const workforce = workforceAuthorityProjection(canonicalUser || user);
    return {
      ...serializeUserPrivate(canonicalUser || user),
      ...workforce,
      status: canonicalUser?.workforceStatus?.availability || "available",
      connectionVisibility: canonicalUser?.workforceStatus?.connectionVisibility || "visible",
      workspaceId: membership?.workspaceId ?? null,
      workspaceRole,
      isAdmin: workspaceAdmin,
      adminSource: workspaceAdmin ? "workspace-role" : null,
    };
  }
  
  async function ensureDemoData() {
    // v0.7: only create the shell workspace and owner. No fake Azure Archipelago project.
    // Projects should come from the configured Git server instead of a hardcoded sample,
    // Keep setup status based on persisted instance configuration rather than seeded demo data.
    const user = await prisma.user.upsert({
      where: { username: "duckey" },
      update: {},
      create: {
        username: "duckey",
        displayName: "Duckey",
        email: "duckey@example.local",
      },
    });
    const workspace = await prisma.workspace.findFirst();
    if (!workspace) {
      await prisma.workspace.create({
        data: {
          name: "Cluster Workspace",
          members: {
            create: {
              userId: user.id,
              role: "owner",
            },
          },
        },
      });
      return;
    }
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      update: {},
      create: { workspaceId: workspace.id, userId: user.id, role: "owner" },
    });
  }
  
  function parseLabels(value: string | undefined | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [];
    } catch {
      return [];
    }
  }
  
  function parseJsonArray(value: string | undefined | null): any[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  
  function parseObject(value: string | undefined | null): Record<string, any> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  
  
  const authorization = createAuthorizationService({
    prisma,
    authRequired: AUTH_REQUIRED,
    getCurrentUser,
    decorateUserForClient,
    getStudioPermissionSettings: () => studioPermissionSettings,
    parseObject,
    parseLabels,
  });
  
  const authorizeRequestBoundary = createRequestAuthorizationBoundary({ prisma, authorization });

  const isUserAccessExpired = authorization.isUserAccessExpired;
  
  const isExternalCollaboratorRole = authorization.isExternalCollaboratorRole;
  
  const configuredToolPermissionsForRole = authorization.configuredToolPermissionsForRole;
  
  const getToolPermissionLevel = authorization.getToolPermissionLevel;
  
  const hasToolPermission = authorization.hasToolPermission;
  
  const getProjectPermissionLevel = authorization.getProjectPermissionLevel;
  
  const hasProjectPermission = authorization.hasProjectPermission;
  
  const isProjectLead = authorization.isProjectLead;
  
  const canArchiveProject = authorization.canArchiveProject;
  
  const accessSubjectMatchesUser = authorization.accessSubjectMatchesUser;
  
  const accessRulesForTarget = authorization.accessRulesForTarget;
  
  const resolveAccessRuleLevel = authorization.resolveAccessRuleLevel;
  
  const hasTargetAccess = authorization.hasTargetAccess;
  
  const enforceTargetAccess = authorization.requireTarget;
  
  const enforceListAccess = authorization.requireList;
  
  const enforceCardAccess = authorization.requireCard;
  
  
  function unique(values: string[]) {
    return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
  }
  
  function profilePreferences(user: any) {
    const preferences = parseObject(user?.preferences);
    const pinnedProjectIds = Array.isArray(preferences.profilePinnedProjectIds)
      ? unique(preferences.profilePinnedProjectIds.map((value: unknown) => String(value))).slice(0, 4)
      : [];
    return {
      showEmail: preferences.profileShowEmail === true,
      showPhone: preferences.profileShowPhone === true,
      showDiscord: preferences.profileShowDiscord === true,
      showTimezone: preferences.profileShowTimezone !== false,
      showStatus: preferences.profileShowStatus !== false,
      bio: typeof preferences.profileBio === "string" ? preferences.profileBio : "",
      website: typeof preferences.profileWebsite === "string" ? preferences.profileWebsite : "",
      discordUsername: typeof preferences.profileDiscordUsername === "string" ? preferences.profileDiscordUsername : "",
      preferredContact: typeof preferences.profilePreferredContact === "string" ? preferences.profilePreferredContact : "cluster",
      pinnedProjectIds,
    };
  }


  function parseJsonRecordSafe(value: unknown) {
    try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  }

  function serializeStudioTeamMemberships(user: any) {
    return Array.isArray(user?.studioTeamMemberships) ? user.studioTeamMemberships.filter((membership: any) => !membership.archived && membership.team && !membership.team.archived).map((membership: any) => ({
      id: membership.team.id, name: membership.team.name, department: membership.team.department || null, leadUserId: membership.team.leadUserId || null, roleLabel: membership.roleLabel || null, allocationPercent: membership.allocationPercent ?? 100, primaryMembership: Boolean(membership.primaryMembership),
    })) : [];
  }

  function serializeUserLite(user: any) {
    if (!user) return null;
    const profile = profilePreferences(user);
    const workforce = workforceAuthorityProjection(user);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      preferredName: user.preferredName,
      avatarUrl: user.avatarUrl,
      personalAccentColor: user.personalAccentColor || null,
      title: workforce.title,
      department: workforce.department,
      teamName: workforce.teamName,
      pronouns: user.pronouns,
      managerName: workforce.managerName,
      workLocation: user.hideLocation ? null : workforce.workLocation,
      timezone: profile.showTimezone ? workforce.timezone : null,
      status: profile.showStatus ? workforce.status : null,
      statusMessage: profile.showStatus ? workforce.statusMessage : null,
      skills: workforce.skills,
      expertise: workforce.expertise,
      profileRevision: Number(user.profileRevision || 1),
      managerUserId: workforce.managerUserId,
      studioTeams: workforce.studioTeams,
      capacityHours: workforce.capacityHours,
      minimumHours: workforce.minimumHours,
      archived: Boolean(user.archived),
      lastSeenAt: profile.showStatus ? user.lastSeenAt : null,
    };
  }

  function serializeUserPrivate(user: any) {
    if (!user) return null;
    const profile = profilePreferences(user);
    const workforce = workforceAuthorityProjection(user);
    return {
      id: user.id,
      username: user.username,
      employeeNumber: user.employeeNumber,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      personalAccentColor: user.personalAccentColor || null,
      pinConfigured: Boolean(user.pinHash),
      pinUpdatedAt: user.pinUpdatedAt || null,
      passwordConfigured: Boolean(user.passwordHash),
      passwordChangedAt: user.passwordChangedAt || null,
      firstLoginCompletedAt: user.firstLoginCompletedAt || null,
      discordUserId: user.discordUserId,
      discordUsername: user.discordUsername || null,
      discordDisplayName: user.discordDisplayName || null,
      discordAvatar: user.discordAvatar || null,
      discordLinkedAt: user.discordLinkedAt || null,
      discordLastVerifiedAt: user.discordLastVerifiedAt || null,
      accountState: user.accountState || "PASSWORD_CHANGE_REQUIRED",
      discordLinked: Boolean(user.discordUserId),
      discordLinkRequired: REQUIRE_DISCORD_LINK,
      nextAuthStep: accountNextStep(user.accountState, REQUIRE_DISCORD_LINK),
      title: workforce.title,
      department: workforce.department,
      teamName: workforce.teamName,
      legalName: user.legalName,
      preferredName: user.preferredName,
      pronouns: user.pronouns,
      phoneNumber: user.phoneNumber,
      alternatePhoneNumber: user.alternatePhoneNumber,
      alternateEmails: parseLabels(user.alternateEmails),
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      stateProvince: user.stateProvince,
      postalCode: user.postalCode,
      country: user.country,
      emergencyContactName: user.emergencyContactName,
      emergencyContactPhone: user.emergencyContactPhone,
      emergencyContactRelation: user.emergencyContactRelation,
      managerName: workforce.managerName,
      employmentType: workforce.employmentType,
      accountType: user.accountType || "employee",
      accessExpiresAt: user.accessExpiresAt,
      invitedById: user.invitedById,
      workLocation: workforce.workLocation,
      hideLegalName: Boolean(user.hideLegalName),
      hideLocation: Boolean(user.hideLocation),
      timezone: workforce.timezone,
      status: user?.workforceStatus?.availability || "available",
      statusMessage: workforce.statusMessage,
      connectionVisibility: user?.workforceStatus?.connectionVisibility || "visible",
      skills: workforce.skills,
      expertise: workforce.expertise,
      workingHours: workforce.workingHours,
      customProfileFields: parseJsonRecordSafe(user.customProfileFields),
      profileRevision: Number(user.profileRevision || 1),
      managerUserId: workforce.managerUserId,
      studioTeams: workforce.studioTeams,
      capacityHours: workforce.capacityHours,
      minimumHours: workforce.minimumHours,
      notes: user.notes,
      startDate: workforce.startDate,
      archived: user.archived || false,
      lastSeenAt: user.lastSeenAt,
      toolPermissions: parseObject(user.toolPermissions),
      projectPermissions: parseObject(user.projectPermissions),
      profileShowEmail: profile.showEmail,
      profileShowPhone: profile.showPhone,
      profileShowDiscord: profile.showDiscord,
      profileShowTimezone: profile.showTimezone,
      profileShowStatus: profile.showStatus,
      profileBio: profile.bio,
      profileWebsite: profile.website,
      profileDiscordUsername: profile.discordUsername,
      profilePreferredContact: profile.preferredContact,
      profilePinnedProjectIds: profile.pinnedProjectIds,
    };
  }

  function serializeUserPublicProfile(user: any) {
    if (!user) return null;
    const profile = profilePreferences(user);
    const workforce = workforceAuthorityProjection(user);
    const discordUsername = profile.discordUsername || user.discordUsername || null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: profile.showEmail ? user.email : null,
      phoneNumber: profile.showPhone ? user.phoneNumber : null,
      avatarUrl: user.avatarUrl,
      personalAccentColor: user.personalAccentColor || null,
      discordUserId: profile.showDiscord ? user.discordUserId : null,
      discordUsername: profile.showDiscord ? discordUsername : null,
      discordDisplayName: profile.showDiscord ? user.discordDisplayName || null : null,
      accountState: user.accountState || "PASSWORD_CHANGE_REQUIRED",
      discordLinked: Boolean(user.discordUserId),
      title: workforce.title,
      department: workforce.department,
      teamName: workforce.teamName,
      preferredName: user.preferredName,
      pronouns: user.pronouns,
      managerName: workforce.managerName,
      workLocation: user.hideLocation ? null : workforce.workLocation,
      hideLegalName: Boolean(user.hideLegalName),
      hideLocation: Boolean(user.hideLocation),
      timezone: profile.showTimezone ? workforce.timezone : null,
      status: profile.showStatus ? workforce.status : null,
      statusMessage: profile.showStatus ? workforce.statusMessage : null,
      skills: workforce.skills,
      expertise: workforce.expertise,
      workingHours: profile.showTimezone ? workforce.workingHours : {},
      profileRevision: Number(user.profileRevision || 1),
      managerUserId: workforce.managerUserId,
      studioTeams: workforce.studioTeams,
      capacityHours: workforce.capacityHours,
      minimumHours: workforce.minimumHours,
      archived: user.archived || false,
      lastSeenAt: profile.showStatus ? user.lastSeenAt : null,
      profileShowEmail: profile.showEmail,
      profileShowPhone: profile.showPhone,
      profileShowDiscord: profile.showDiscord,
      profileShowTimezone: profile.showTimezone,
      profileShowStatus: profile.showStatus,
      profileBio: profile.bio,
      profileWebsite: profile.website,
      profileDiscordUsername: profile.showDiscord ? discordUsername : "",
      profilePreferredContact: profile.preferredContact,
      profilePinnedProjectIds: profile.pinnedProjectIds,
      privateProfile: false,
      sensitiveProfileHidden: true,
    };
  }

  async function canViewPrivateUserProfile(viewer: any, targetUserId: string) {
    if (!viewer) return false;
    const decision = await authorization.authorize({ user: viewer }, "disclose-private", { kind: "user", ownerUserId: targetUserId, tool: "people" }, { minimum: "manage" });
    return decision.allowed;
  }
  
  function sendRevisionConflict(reply: FastifyReply, entityType: string, current: unknown) {
    return reply.code(409).send({
      ok: false,
      code: "revision_conflict",
      error: `The ${entityType} changed on the server. Refresh or resolve the queued edit before retrying.`,
      current,
    });
  }
  
  function serializeCard(card: any) {
    return {
      ...card,
      labels: parseLabels(card.labels),
      memberIds: parseLabels(card.memberIds),
      watcherIds: parseLabels(card.watcherIds),
      assignee: serializeUserLite(card.assignee),
    };
  }
  
  function serializeBoard(board: any) {
    return {
      ...board,
      assignedUserIds: parseLabels(board.assignedUserIds),
      labelDefinitions: parseElements(board.labelDefinitions),
      project: board.project
        ? {
            ...board.project,
            productionTracks: parseLabels(board.project.productionTracks),
          }
        : board.project,
      lists: board.lists.map((list: any) => ({
        ...list,
        assignedUserIds: parseLabels(list.assignedUserIds),
        cards: list.cards.map(serializeCard),
      })),
    };
  }
  
  function parseElements(value: string | undefined | null) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseRecord(value: string | undefined | null) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  
  function serializeWhiteboard(whiteboard: any) {
    return {
      ...whiteboard,
      elements: parseElements(whiteboard.elements),
      categories: parseElements(whiteboard.categories),
      labels: parseElements(whiteboard.labels),
      productionLinks: parseRecord(whiteboard.productionLinks),
    };
  }
  
  function serializeCalendarEvent(event: any) {
    let attendeeIds: string[] = [];
    try {
      attendeeIds = JSON.parse(event.attendeeIds || "[]");
    } catch {
      attendeeIds = [];
    }
    const meeting = event.meeting || null;
    const calendarPlacement = Array.isArray(event.scheduleBlocks)
      ? event.scheduleBlocks.find((block: any) => String(block.placementAuthority || "") === "calendar" && !block.occurrenceStartsAt) || null
      : null;
    const meetingView = meeting
      ? {
          id: meeting.id,
          organizerId: meeting.organizerId,
          agenda: meeting.agenda || null,
          rsvp: parseRecord(meeting.rsvpState),
          attendance: parseRecord(meeting.attendanceState),
          revision: Number(meeting.revision || 1),
          schedulerBlockId: calendarPlacement?.id || null,
          resources: Array.isArray(calendarPlacement?.resourceReservations)
            ? calendarPlacement.resourceReservations.map((reservation: any) => ({
                resourceId: reservation.resourceId,
                quantity: Math.max(1, Number(reservation.quantity || 1)),
                resource: reservation.resource
                  ? {
                      id: reservation.resource.id,
                      name: reservation.resource.name,
                      type: reservation.resource.type,
                      location: reservation.resource.location || null,
                      quantityTotal: Number(reservation.resource.quantityTotal || 1),
                      status: reservation.resource.status,
                    }
                  : null,
              }))
            : [],
        }
      : null;
    return {
      ...event,
      attendeeIds,
      delegateIds: parseElements(event.delegateIds),
      meetingOccurrenceResponses: Array.isArray(event.meetingOccurrenceResponses) ? event.meetingOccurrenceResponses
        .filter((row: any) => [String(meeting?.organizerId || event.ownerId || ""), ...attendeeIds].includes(String(row.userId)))
        .map((row: any) => ({ occurrenceStartsAt: new Date(row.occurrenceStartsAt).toISOString(), userId: row.userId,
          rsvp: row.rsvpStatus || null, attendance: row.attendanceStatus || null, revision: Number(row.revision || 1) })) : [],
      occurrenceExceptions: Array.isArray(event.occurrenceExceptions) ? event.occurrenceExceptions.map((row: any) => ({ occurrenceStartsAt: new Date(row.occurrenceStartsAt).toISOString(), status: row.status, movedStartsAt: row.movedStartsAt ? new Date(row.movedStartsAt).toISOString() : null, movedEndsAt: row.movedEndsAt ? new Date(row.movedEndsAt).toISOString() : null, reason: row.reason || null })) : [],
      attachmentIds: parseElements(event.attachmentIds),
      decisionIds: parseElements(event.decisionIds),
      actionItemIds: parseElements(event.actionItemIds),
      meeting: meetingView,
      scheduleBlocks: undefined,
      project: event.project
        ? {
            id: event.project.id,
            name: event.project.name,
            description: event.project.description,
          }
        : null,
    };
  }
  
  function serializeTimelineItem(item: any) {
    return {
      ...item,
      project: item.project
        ? {
            id: item.project.id,
            name: item.project.name,
            description: item.project.description,
          }
        : null,
      user: item.user
        ? {
            id: item.user.id,
            username: item.user.username,
            displayName: item.user.displayName,
            avatarUrl: item.user.avatarUrl,
          }
        : null,
    };
  }
  
  function serializeLibraryItem(item: any) {
    return {
      ...item,
      tags: parseLabels(item.tags),
      changelog: parseJsonArray(item.changelog),
      project: item.project
        ? {
            id: item.project.id,
            name: item.project.name,
            description: item.project.description,
          }
        : null,
      owner: item.owner ? serializeUserLite(item.owner) : null,
      reviewer: item.reviewer ? serializeUserLite(item.reviewer) : null,
    };
  }
  
  function parseContextPayload(value: string | undefined | null) {
    if (!value) return {};
    try {
      const raw = decryptContextPackStorageValue(value);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  
  function serializeContextPack(pack: any, includePayload = false, revealSecrets = false) {
    const payload = parseContextPayload(pack.payload);
    const settings = projectContextPackPayload(payload, revealSecrets).settings;
    return {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
      createdBy: pack.createdBy
        ? {
            id: pack.createdBy.id,
            username: pack.createdBy.username,
            displayName: pack.createdBy.displayName,
          }
        : null,
      summary: {
        hasDiscord: Boolean(settings.discordWebhookUrl || settings.discordBotToken || settings.discordGuildId),
        includesSecrets: containsContextPackSecrets(payload),
        keys: Object.keys(settings),
      },
      ...(includePayload ? { payload: projectContextPackPayload(payload, revealSecrets) } : {}),
    };
  }
  
  function buildContextPackPayload(settings: SettingPayload, includeSecrets: boolean) {
    const exportedSettings: SettingPayload = {
      discordWebhookUrl: includeSecrets ? settings.discordWebhookUrl || "" : "",
      discordVoiceUrl: settings.discordVoiceUrl || "",
      discordMessagePrefix: settings.discordMessagePrefix || "",
      discordBotToken: includeSecrets ? settings.discordBotToken || "" : "",
      discordGuildId: settings.discordGuildId || "",
      discordForumChannelId: settings.discordForumChannelId || "",
      discordChatChannelId: settings.discordChatChannelId || "",
      discordAdminRoleId: settings.discordAdminRoleId || "",
      fontFamily: settings.fontFamily || "system",
      accentColor: settings.accentColor || "#57c1ff",
      secondaryAccentColor: settings.secondaryAccentColor || "#60a5fa",
      backgroundStyle: settings.backgroundStyle || "grid",
      tagPresetCsv: settings.tagPresetCsv || "",
    };
    return {
      schemaVersion: 1,
      app: "Cluster",
      kind: "cluster.context-pack",
      exportedAt: new Date().toISOString(),
      includesSecrets: includeSecrets,
      settings: exportedSettings,
    };
  }
  
  function pickContextPackSettings(payload: any): SettingPayload {
    const source = payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;
    const allowed = CONTEXT_PACK_SETTING_KEYS;
    const next: Record<string, unknown> = {};
    for (const key of allowed) {
      const value = source?.[key];
      if (typeof value === "string" && value && value !== "********") next[key] = value;
    }
    return next as SettingPayload;
  }
  
  function parseJsonObject(value: string | undefined | null) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function disabledToolLabel(tool: string | null, settings: SettingPayload) {
    return disabledConfigurableToolLabel(tool, settings);
  }

  return {
    CONFIG_FILE_PATH,
    DATABASE_URL,
    DATA_FOLDERS,
    DATA_LAYOUT,
    DATA_ROOT,
    SERVER_MANAGED_SETTING_KEYS,
    UPLOAD_ROOT,
    authorization,
    authorizeRequestBoundary,
    buildContextPackPayload,
    canArchiveProject,
    canManageProjectAccess,
    canViewPrivateUserProfile,
    cleanOptionalString,
    clearRateLimitKey,
    clearCurrentSessionCache,
    clearSessionCookies,
    configuredProjectType,
    createSession,
    csrfTokenForSession,
    csrfTokenMatches,
    databaseDiagnostics,
    storageRuntime,
      discardStoredProjectFile,
    discardPreparedManagedBlob,
    projectFileStorageLocator,
    decorateUserForClient,
    defaultBoardColumnsForProjectType,
    disabledToolLabel,
    enforceCardAccess,
    enforceListAccess,
    enforceTargetAccess,
    ensureDemoData,
    fetchWithTimeout,
    getCurrentSession,
    getClientKey,
    getCurrentUser,
    getSetupStatus,
    getWorkspaceRole,
    hasProjectPermission,
    hasTargetAccess,
    hasToolPermission,
    hashShareToken,
    hashToken,
    isDiscordConfigured,
    isUserAccessExpired,
    mutationOriginAllowed,
    mutationOriginDecision,
    normalizeProjectStatus,
    normalizeProjectType,
    parseContextPayload,
    parseJsonObject,
    parseLabels,
    parseObject,
    pickContextPackSettings,
    productionTracksForType,
    rateLimit,
    rateLimitKey,
    readQualityGateStatus,
    requestIpAddress,
    requestUserAgent,
    requireConfirmation,
    resolveAvatarStoredFile,
    resolveProjectStoredFile,
    securityHeaders,
    sendRevisionConflict,
    serializeAccessRule,
    serializeBoard,
    serializeCalendarEvent,
    serializeCard,
    serializeContextPack,
    serializeProjectShareLink,
    serializeProjectSummary,
    serializeTimelineItem,
    serializeUserLite,
    serializeUserPrivate,
    serializeUserPublicProfile,
    serializeReviewAsset,
    serializeWhiteboard,
    setupIsComplete,
    shareLinkExpired,
    studioPermissionSettings,
    unique,
    writeUpload,
    storeCompletedUpload,
    consumeUploadSession
  };
}
