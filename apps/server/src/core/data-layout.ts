import fs from "node:fs/promises";
import { relocateLibraryStoredFile } from "./library-storage-relocation.js";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { normalizeClusterProjectTypeId, resolveClusterProductionProfile } from "@cluster/shared";
import { createClusterStorageManager, type ClusterStorageDomain, type ClusterStorageOverrides } from "./storage/storage-manager.js";

export type ClusterDataLayout = ReturnType<typeof createClusterDataLayout>;

const USER_EDITABLE_FIELDS = [
  "displayName", "email", "legalName", "preferredName", "pronouns",
  "phoneNumber", "alternatePhoneNumber", "alternateEmails", "addressLine1", "addressLine2", "city",
  "stateProvince", "postalCode", "country", "emergencyContactName", "emergencyContactPhone",
  "emergencyContactRelation", "accountType", "notes"
] as const;

const PROJECT_EDITABLE_FIELDS = [
  "name", "description", "source", "projectType", "productionProfile", "blueprintKey", "workspacePresetKey",
  "status", "productionTracks", "archived", "objective", "clientName", "startDate", "targetDate", "priority",
  "tags", "color", "healthNote"
] as const;

export function safeStorageSegment(value: unknown, fallback = "item") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 96);
  return cleaned || fallback;
}

export function entityDirectoryName(label: unknown, id: string) {
  return `${safeStorageSegment(label)}--${String(id).slice(-10)}`;
}


export function storageOverridesFromSettings(settings: Record<string, any> = {}): ClusterStorageOverrides {
  return {
    projects: settings.projectsRootOverride,
    library: settings.libraryRootOverride,
    users: settings.usersRootOverride,
    backups: settings.backupsRootOverride,
    logs: settings.logsRootOverride,
    runtime: settings.runtimeRootOverride,
    exports: settings.exportsRootOverride,
    uploads: settings.uploadRootOverride,
    branding: settings.brandingRootOverride,
  };
}

export function createClusterDataLayout(
  dataRoot: string,
  options: { configFile?: string; storageOverrides?: ClusterStorageOverrides } = {},
) {
  const storage = createClusterStorageManager(dataRoot, options.storageOverrides);
  const root = storage.root;
  const configFile = path.resolve(
    options.configFile || path.join(path.dirname(root), "cluster.config.json"),
  );
  const libraryRoot = storage.get("library");
  const projectsRoot = storage.get("projects");
  const usersRoot = storage.get("users");
  return {
    storage,
    root,
    configRoot: path.dirname(configFile),
    configFile,
    systemRoot: storage.get("system"),
    backupsRoot: storage.get("backups"),
    logsRoot: storage.get("logs"),
    runtimeRoot: storage.get("runtime"),
    runtimeCacheRoot: storage.get("cache"),
    exportsRoot: storage.get("exports"),
    libraryRoot,
    libraryFilesRoot: libraryRoot,
    libraryIndexFile: path.join(libraryRoot, "Library Index.json"),
    projectsRoot,
    // RepositoryMirrors is only for provider-backed mirrors. Cluster-native Git
    // lives inside the owning project's .cluster/source capsule.
    repositoriesRoot: storage.get("repositoryMirrors"),
    sourceWorkspacesRoot: storage.get("gitWorktrees"),
    thumbnailsRoot: storage.get("thumbnails"),
    transcodesRoot: storage.get("transcodes"),
    uploadStagingRoot: storage.get("uploadStaging"),
    tempRoot: storage.get("temp"),
    postgresDataRoot: storage.get("postgresData"),
    redisDataRoot: storage.get("redisData"),
    usersRoot,
    userAvatarsRoot: path.join(usersRoot, "Avatars"),
    brandingRoot: storage.get("branding"),
    uploadsRoot: storage.get("uploads")
  };
}

export async function ensureClusterDataLayout(layout: ClusterDataLayout, options: { includeBackups?: boolean } = {}) {
  const domains: ClusterStorageDomain[] = [
    "root", "system", "projects", "library", "users", "logs", "runtime", "exports", "uploads", "branding",
    "cache", "gitWorktrees", "thumbnails", "transcodes", "uploadStaging", "temp", "repositoryMirrors", "postgresData", "redisData",
  ];
  if (options.includeBackups) domains.push("backups");
  await layout.storage.ensure(domains);
  await Promise.all([layout.configRoot, layout.userAvatarsRoot].map((directory) => fs.mkdir(directory, { recursive: true })));
}

export function projectCapsuleLayout(projectDirectory: string) {
  const root = path.resolve(projectDirectory);
  const clusterRoot = path.join(root, ".cluster");
  const stateRoot = path.join(clusterRoot, "state");
  const sourceRoot = path.join(clusterRoot, "source");
  return {
    root,
    clusterRoot,
    manifestFile: path.join(clusterRoot, "manifest.json"),
    projectFile: path.join(clusterRoot, "project.json"),
    stateRoot,
    sourceRoot,
    repositoryRoot: path.join(sourceRoot, "repository.git"),
    integrityFile: path.join(clusterRoot, "integrity.json"),
    filesRoot: path.join(root, "Files"),
    libraryRoot: path.join(root, "Library"),
    mediaRoot: path.join(root, "Media"),
    buildsRoot: path.join(root, "Builds"),
    qaRoot: path.join(root, "QA"),
    exportsRoot: path.join(root, "Exports"),
  };
}

function comparisonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparisonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "exportedAt" && key !== "snapshotAt")
    .map(([key, entry]) => [key, comparisonValue(entry)]));
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const existing = await readJson(filePath);
  if (existing && comparable(comparisonValue(existing)) === comparable(comparisonValue(value))) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporaryPath, filePath);
  return true;
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

const PROJECT_STATE_FILES = ["files.json", "media.json", "timeline.json", "boards.json", "library.json"] as const;

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function writeProjectCapsuleIntegrity(capsule: ReturnType<typeof projectCapsuleLayout>) {
  const candidates = [
    capsule.manifestFile,
    capsule.projectFile,
    ...PROJECT_STATE_FILES.map((name) => path.join(capsule.stateRoot, name)),
  ];
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const filePath of candidates) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    files.push({
      path: path.relative(capsule.root, filePath).split(path.sep).join("/"),
      bytes: stat.size,
      sha256: await sha256File(filePath),
    });
  }
  await writeJsonAtomic(capsule.integrityFile, {
    format: "cluster-project-integrity",
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
  });
  return files;
}

export async function verifyProjectCapsule(projectDirectory: string) {
  const capsule = projectCapsuleLayout(projectDirectory);
  const manifest = await readJson(capsule.manifestFile);
  const projectState = await readJson(capsule.projectFile);
  const integrity = await readJson(capsule.integrityFile);
  const errors: string[] = [];
  if (manifest?.format !== "cluster-project") errors.push("Project capsule manifest is missing or invalid.");
  if (Number(manifest?.formatVersion || 0) !== 1) errors.push("Project capsule format version is not supported.");
  if (integrity?.format !== "cluster-project-integrity" || !Array.isArray(integrity?.files)) errors.push("Project capsule integrity manifest is missing or invalid.");
  const manifestProjectId = String(manifest?.projectId || "").trim();
  const stateProjectId = String(projectState?._cluster?.entityId || projectState?.id || "").trim();
  if (!manifestProjectId) errors.push("Project capsule manifest is missing project identity.");
  if (!projectState || projectState?._cluster?.entityType !== "project" || !stateProjectId) errors.push("Project capsule state manifest is missing or invalid.");
  if (manifestProjectId && stateProjectId && manifestProjectId !== stateProjectId) errors.push("Project capsule identity does not match project state.");

  const requiredRelativePaths = [
    path.relative(capsule.root, capsule.manifestFile).split(path.sep).join("/"),
    path.relative(capsule.root, capsule.projectFile).split(path.sep).join("/"),
    ...PROJECT_STATE_FILES.map((name) => path.relative(capsule.root, path.join(capsule.stateRoot, name)).split(path.sep).join("/")),
  ];
  const checks: Array<{ path: string; ok: boolean; reason?: string }> = [];
  if (Array.isArray(integrity?.files)) {
    const seen = new Set<string>();
    for (const entry of integrity.files) {
      const relative = String(entry?.path || "").replace(/\\/g, "/");
      if (seen.has(relative)) {
        checks.push({ path: relative || "(invalid)", ok: false, reason: "Duplicate integrity entry." });
        continue;
      }
      seen.add(relative);
      const target = path.resolve(capsule.root, relative);
      if (!relative || !pathInsideRoot(capsule.root, target)) {
        checks.push({ path: relative || "(invalid)", ok: false, reason: "Path escapes project capsule." });
        continue;
      }
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) { checks.push({ path: relative, ok: false, reason: "File is missing." }); continue; }
      const hash = await sha256File(target);
      const ok = hash === String(entry.sha256 || "") && stat.size === Number(entry.bytes || 0);
      checks.push({ path: relative, ok, ...(ok ? {} : { reason: "Size or SHA-256 does not match." }) });
    }
    for (const required of requiredRelativePaths) {
      if (!seen.has(required)) checks.push({ path: required, ok: false, reason: "Required capsule file is missing from integrity coverage." });
    }
  }
  const repositoryPresent = await fs.stat(path.join(capsule.repositoryRoot, "HEAD")).then((entry) => entry.isFile()).catch(() => false);
  if (checks.some((entry) => !entry.ok)) errors.push("One or more project capsule files failed integrity verification.");
  return {
    ok: errors.length === 0,
    errors,
    manifest,
    checks,
    repositoryPresent,
    repositoryRoot: capsule.repositoryRoot,
  };
}

export async function discoverProjectCapsules(layout: ClusterDataLayout) {
  const results: Array<{ directory: string; projectId: string | null; projectName: string | null; formatVersion: number; repositoryPresent: boolean }> = [];
  const entries = await fs.readdir(layout.projectsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(layout.projectsRoot, entry.name);
    const capsule = projectCapsuleLayout(directory);
    const manifest = await readJson(capsule.manifestFile);
    if (manifest?.format !== "cluster-project") continue;
    results.push({
      directory,
      projectId: manifest.projectId ? String(manifest.projectId) : null,
      projectName: manifest.projectName ? String(manifest.projectName) : null,
      formatVersion: Number(manifest.formatVersion || 0),
      repositoryPresent: await fs.stat(path.join(capsule.repositoryRoot, "HEAD")).then((stat) => stat.isFile()).catch(() => false),
    });
  }
  return results;
}

async function findEntityDirectory(root: string, id: string) {
  try {
    const suffix = `--${String(id).slice(-10)}`;
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.find((entry: { isDirectory(): boolean; name: string }) => entry.isDirectory() && entry.name.endsWith(suffix))?.name || null;
  } catch {
    return null;
  }
}

async function ensureEntityDirectory(root: string, label: unknown, id: string) {
  await fs.mkdir(root, { recursive: true });
  const desiredName = entityDirectoryName(label, id);
  const existingName = await findEntityDirectory(root, id);
  if (existingName && existingName !== desiredName) {
    const existingPath = path.join(root, existingName);
    const desiredPath = path.join(root, desiredName);
    try {
      await fs.rename(existingPath, desiredPath);
      return desiredPath;
    } catch {
      return existingPath;
    }
  }
  const directory = path.join(root, existingName || desiredName);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function comparable(value: unknown) {
  return JSON.stringify(value ?? null);
}

function pickFields(record: any, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, record?.[field] ?? null]));
}

function changedFields(record: any, manifest: any, fields: readonly string[]) {
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in (manifest || {}))) continue;
    if (comparable(record?.[field]) !== comparable(manifest[field])) changes[field] = manifest[field];
  }
  return changes;
}

function normalizeJsonStringField(value: unknown, fallback: unknown[] = []) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(Array.isArray(parsed) ? parsed : fallback);
    } catch {
      return JSON.stringify(fallback);
    }
  }
  return JSON.stringify(fallback);
}

function projectManifest(project: any) {
  return {
    _cluster: {
      entityType: "project",
      entityId: project.id,
      databaseUpdatedAt: new Date(project.updatedAt).toISOString(),
      exportedAt: new Date().toISOString(),
      editableFields: [...PROJECT_EDITABLE_FIELDS]
    },
    id: project.id,
    workspaceId: project.workspaceId,
    ...pickFields(project, PROJECT_EDITABLE_FIELDS),
    memberships: Array.isArray(project.memberships) ? project.memberships : [],
    productionTracks: parseJsonArray(project.productionTracks),
    tags: parseJsonArray(project.tags),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function userManifest(user: any) {
  return {
    _cluster: {
      entityType: "user",
      entityId: user.id,
      databaseUpdatedAt: new Date(user.updatedAt).toISOString(),
      exportedAt: new Date().toISOString(),
      editableFields: [...USER_EDITABLE_FIELDS],
      note: "Authentication, roles, permissions, and security fields are intentionally server-managed."
    },
    id: user.id,
    username: user.username,
    employeeNumber: user.employeeNumber,
    ...pickFields(user, USER_EDITABLE_FIELDS),
    alternateEmails: parseJsonArray(user.alternateEmails),
    archived: Boolean(user.archived),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function syncProjectMirror(prisma: any, layout: ClusterDataLayout, project: any) {
  const directory = await ensureEntityDirectory(layout.projectsRoot, project.name, project.id);
  const capsule = projectCapsuleLayout(directory);
  await Promise.all([capsule.clusterRoot, capsule.stateRoot, capsule.sourceRoot, capsule.filesRoot, capsule.mediaRoot, capsule.libraryRoot, capsule.buildsRoot, capsule.qaRoot, capsule.exportsRoot].map((target) => fs.mkdir(target, { recursive: true })));
  const filePath = capsule.projectFile;
  const currentManifest = await readJson(filePath);
  if (currentManifest?._cluster?.entityId === project.id && currentManifest?._cluster?.databaseUpdatedAt === new Date(project.updatedAt).toISOString()) {
    const comparableProject = {
      ...project,
      memberships: Array.isArray(project.memberships) ? project.memberships : [],
      productionTracks: parseJsonArray(project.productionTracks),
      tags: parseJsonArray(project.tags),
    };
    const changes = changedFields(comparableProject, currentManifest, PROJECT_EDITABLE_FIELDS);
    if ("projectType" in changes) {
      changes.projectType = normalizeClusterProjectTypeId(String(changes.projectType || "general"));
      if (!("productionProfile" in changes)) changes.productionProfile = resolveClusterProductionProfile(project.productionProfile || "generic", changes.projectType).id;
    }
    if ("productionProfile" in changes) changes.productionProfile = resolveClusterProductionProfile(String(changes.productionProfile || "generic"), String(changes.projectType || project.projectType || "general")).id;
    if ("productionTracks" in changes) changes.productionTracks = normalizeJsonStringField(changes.productionTracks);
    if ("tags" in changes) changes.tags = normalizeJsonStringField(changes.tags);
    if (Object.keys(changes).length) {
      project = await prisma.project.update({ where: { id: project.id }, data: changes });
    }
  }
  const projectStateChanged = await writeJsonAtomic(filePath, projectManifest(project));
  const capsuleManifestChanged = await writeJsonAtomic(capsule.manifestFile, {
    format: "cluster-project",
    formatVersion: 1,
    projectId: project.id,
    projectName: project.name,
    projectType: project.projectType || "general",
    productionProfile: project.productionProfile || "generic",
    snapshotRevision: new Date(project.updatedAt).toISOString(),
    sourceControl: { repositoryRelativePath: ".cluster/source/repository.git", lfsObjectsStoredWithRepository: true },
    portable: true,
    snapshotAt: new Date().toISOString(),
  });
  return { directory, capsuleDirty: projectStateChanged || capsuleManifestChanged };
}

async function syncUserMirror(prisma: any, layout: ClusterDataLayout, user: any) {
  const desiredName = `${safeStorageSegment(user.username, "user")}--${String(user.id).slice(-10)}.json`;
  let existingName: string | null = null;
  let renamed = false;
  try {
    const suffix = `--${String(user.id).slice(-10)}.json`;
    existingName = (await fs.readdir(layout.usersRoot)).find((name: string) => name.endsWith(suffix)) || null;
  } catch {}
  if (existingName && existingName !== desiredName) {
    try { await fs.rename(path.join(layout.usersRoot, existingName), path.join(layout.usersRoot, desiredName)); renamed = true; } catch {}
  }
  const filePath = path.join(layout.usersRoot, desiredName);
  const currentManifest = await readJson(filePath);
  let databaseChanged = false;
  if (currentManifest?._cluster?.entityId === user.id && currentManifest?._cluster?.databaseUpdatedAt === new Date(user.updatedAt).toISOString()) {
    const comparableUser = { ...user, alternateEmails: parseJsonArray(user.alternateEmails) };
    const changes = changedFields(comparableUser, currentManifest, USER_EDITABLE_FIELDS);
    if ("alternateEmails" in changes) changes.alternateEmails = normalizeJsonStringField(changes.alternateEmails);
    if (Object.keys(changes).length) {
      user = await prisma.user.update({ where: { id: user.id }, data: changes });
      databaseChanged = true;
    }
  }
  const manifestChanged = await writeJsonAtomic(filePath, userManifest(user));
  return renamed || databaseChanged || manifestChanged;
}

export async function syncEditableDataMirrors(prisma: any, layout: ClusterDataLayout) {
  await ensureClusterDataLayout(layout);
  const [projects, users, libraryItems, projectFiles, videoAssets, timelineItems, boards] = await Promise.all([
    prisma.project.findMany({ include: { memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.libraryItem.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { id: true, parentId: true, projectId: true, ownerId: true, title: true, type: true, status: true, tags: true, externalUrl: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, checksumSha256: true, metadata: true, createdAt: true, updatedAt: true }
    }),
    prisma.projectFile.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.reviewAsset.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.timelineItem.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.board.findMany({ include: { lists: { include: { cards: true }, orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" } })
  ]);

  const groupByProject = (items: any[]) => {
    const grouped = new Map<string, any[]>();
    for (const item of items) {
      const projectId = String(item?.projectId || "").trim();
      if (!projectId) continue;
      const bucket = grouped.get(projectId) || [];
      bucket.push(item);
      grouped.set(projectId, bucket);
    }
    return grouped;
  };
  const filesByProject = groupByProject(projectFiles);
  const mediaByProject = groupByProject(videoAssets);
  const timelineByProject = groupByProject(timelineItems);
  const boardsByProject = groupByProject(boards);
  const libraryByProject = groupByProject(libraryItems);
  let changed = 0;

  for (const project of projects) {
    const mirror = await syncProjectMirror(prisma, layout, project);
    const directory = mirror.directory;
    const capsule = projectCapsuleLayout(directory);
    const files = (filesByProject.get(project.id) || []).map((item: any) => ({ ...item, sizeBytes: Number(item.sizeBytes || 0) }));
    const reviewAssets = mediaByProject.get(project.id) || [];
    const timeline = timelineByProject.get(project.id) || [];
    const projectBoards = boardsByProject.get(project.id) || [];
    const projectLibrary = libraryByProject.get(project.id) || [];
    const snapshot = (kind: string, items: unknown) => ({
      _cluster: { format: `cluster-project-${kind}`, version: 1, projectId: project.id, exportedAt: new Date().toISOString() },
      items,
    });
    const stateChanges = await Promise.all([
      writeJsonAtomic(path.join(capsule.stateRoot, "files.json"), snapshot("files", files)),
      writeJsonAtomic(path.join(capsule.stateRoot, "media.json"), snapshot("media", reviewAssets)),
      writeJsonAtomic(path.join(capsule.stateRoot, "timeline.json"), snapshot("timeline", timeline)),
      writeJsonAtomic(path.join(capsule.stateRoot, "boards.json"), snapshot("boards", projectBoards)),
      writeJsonAtomic(path.join(capsule.stateRoot, "library.json"), snapshot("library", projectLibrary.map((item: any) => ({ ...item, tags: parseJsonArray(item.tags) })))),
    ]);
    const stateChangedCount = stateChanges.filter(Boolean).length;
    const integrityMissing = !(await fs.stat(capsule.integrityFile).catch(() => null))?.isFile();
    if (mirror.capsuleDirty || stateChangedCount || integrityMissing) {
      await writeProjectCapsuleIntegrity(capsule);
      changed += 1;
    }
    changed += stateChangedCount;
  }
  for (const user of users) if (await syncUserMirror(prisma, layout, user)) changed += 1;

  const reconciliation = await reconcileLibraryStoredFiles(prisma, layout, libraryItems.filter((entry: any) => entry.fileName));
  changed += reconciliation.normalized;
  const referenceItems = libraryItems.filter((item: any) => !item.fileName && item.type !== "folder");

  const libraryIndexChanged = await writeJsonAtomic(layout.libraryIndexFile, {
    _cluster: { format: "cluster-library-index", version: 2, exportedAt: new Date().toISOString(), note: "Library files are stored directly in this folder tree. External links and notes live in this index." },
    totals: {
      items: libraryItems.length,
      files: libraryItems.filter((item: any) => item.fileName).length,
      folders: libraryItems.filter((item: any) => item.type === "folder").length,
      references: referenceItems.length
    },
    items: libraryItems.map((item: any) => ({ ...item, tags: parseJsonArray(item.tags) }))
  });
  if (libraryIndexChanged) changed += 1;

  return { projects: projects.length, users: users.length, libraryItems: libraryItems.length, changed };
}

function pathInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rootComparable = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const candidateComparable = process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const prefix = rootComparable.endsWith(path.sep) ? rootComparable : `${rootComparable}${path.sep}`;
  return candidateComparable === rootComparable || candidateComparable.startsWith(prefix);
}

export async function reconcileLibraryStoredFiles(prisma: any, layout: ClusterDataLayout, suppliedItems?: any[]) {
  await ensureClusterDataLayout(layout);
  const items = suppliedItems || await prisma.libraryItem.findMany({
    where: { fileName: { not: null } },
    select: { id: true, parentId: true, fileName: true, checksumSha256: true }
  });
  let normalized = 0;
  let unresolved = 0;
  for (const item of items) {
    if (!item.fileName) continue;
    const directory = await libraryFolderRelativePath(prisma, item.parentId);
    const result = await relocateLibraryStoredFile({
      root: layout.libraryRoot, item, directory,
      ownedByOther: async (desired, id) => Boolean(await prisma.libraryItem.findFirst({
        where: { fileName: desired, id: { not: id } }, select: { id: true },
      })),
      claim: async (current, desired, parentId) => {
        const updated = await prisma.libraryItem.updateMany({
          where: { id: item.id, fileName: current, parentId }, data: { fileName: desired },
        });
        return updated.count === 1;
      },
    });
    if (result === "normalized") { item.fileName = path.join(directory, path.basename(String(item.fileName))); normalized++; }
    if (result === "unresolved") unresolved++;
  }
  return { inspected: items.length, normalized, unresolved };
}

export async function libraryFolderRelativePath(prisma: any, parentId?: string | null) {
  const segments: string[] = [];
  const visited = new Set<string>();
  let currentId = parentId || null;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = await prisma.libraryItem.findUnique({ where: { id: currentId }, select: { id: true, parentId: true, title: true, type: true } });
    if (!folder || folder.type !== "folder") break;
    segments.unshift(entityDirectoryName(folder.title, folder.id));
    currentId = folder.parentId || null;
  }
  return segments.length ? path.join(...segments) : "";
}

export async function projectStorageDirectory(prisma: any, layout: ClusterDataLayout, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  return project ? ensureEntityDirectory(layout.projectsRoot, project.name, project.id) : path.join(layout.projectsRoot, `_unassigned--${safeStorageSegment(projectId)}`);
}
