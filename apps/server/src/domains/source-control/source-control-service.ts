import type { ClusterOperation, ClusterOperationStatus } from "@cluster/shared";
import type { SourceProviderService } from "./source-provider-service.js";
import { createHttpError } from "../../core/http-errors.js";

type ProgressReporter = (progress: number, message: string) => Promise<void>;

type SourceControlServiceInput = {
  prisma: any;
  providerService: SourceProviderService;
  resolveManagedRepositoryPath?: (repository: any) => Promise<string | null>;
  gitRuntime?: {
    status: (repositoryId: string, repositoryPath?: string | null) => Promise<any>;
    syncMirror: (input: { repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null }) => Promise<any>;
    inspectWorkingCopy: (workingCopyId: string) => Promise<any>;
    prepareWorkingCopy: (input: { workingCopyId: string; repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null; branchName: string; baseBranch: string; createBranch?: boolean; lfs?: boolean }) => Promise<any>;
    commitWorkingCopy: (input: { workingCopyId: string; message: string; authorName: string; authorEmail?: string | null }) => Promise<any>;
    pushWorkingCopy: (input: { workingCopyId: string; branchName: string; token?: string | null; providerId?: string | null }) => Promise<any>;
    evaluateMerge: (input: { repositoryId: string; repositoryPath?: string | null; sourceBranch: string; targetBranch: string; token?: string | null; providerId?: string | null }) => Promise<any>;
    mergeReview: (input: { operationId: string; repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null; sourceBranch: string; targetBranch: string; expectedSourceRevision: string; expectedTargetRevision: string; authorName: string; authorEmail?: string | null; title: string }) => Promise<any>;
  };
  logActivity?: (input: any) => Promise<void>;
  logger?: {
    info?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
};

function parseObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanText(value: unknown, maximum = 2_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function optionalText(value: unknown, maximum = 2_000) {
  const text = cleanText(value, maximum);
  return text || null;
}

function safeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function repositoryCoordinates(repository: any) {
  const slug = cleanText(repository.slug, 400).replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (slug.includes("/")) {
    const [owner, ...rest] = slug.split("/").filter(Boolean);
    const repo = rest.join("/");
    if (owner && repo) return { owner, repo };
  }
  for (const candidate of [repository.remoteUrl, repository.cloneUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(String(candidate));
      const parts = url.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    } catch {}
  }
  throw createHttpError("SOURCE_REPOSITORY_COORDINATES", "Repository owner and name could not be resolved.", 409);
}

function normalizeBranch(row: any, defaultBranch: string) {
  const name = cleanText(row?.name, 200);
  if (!name) return null;
  const headRevision = optionalText(row?.commit?.id || row?.commit?.sha || row?.sha, 160);
  return {
    name,
    headRevision,
    upstreamName: optionalText(row?.upstream || row?.tracking || row?.upstream_name, 240),
    isDefault: name === defaultBranch,
    protected: Boolean(row?.protected),
  };
}

function normalizeCommit(row: any, branchName: string) {
  const revision = cleanText(row?.sha || row?.id || row?.commit?.sha, 160);
  if (!revision) return null;
  const commit = row?.commit || row || {};
  const author = commit.author || row?.author || {};
  const committer = commit.committer || row?.committer || {};
  const message = cleanText(commit.message || row?.message || "Commit", 8_000) || "Commit";
  const additions = Number.isFinite(Number(row?.stats?.additions)) ? Number(row.stats.additions) : null;
  const deletions = Number.isFinite(Number(row?.stats?.deletions)) ? Number(row.stats.deletions) : null;
  const filesChanged = Number.isFinite(Number(row?.files?.length)) ? Number(row.files.length) : null;
  return {
    revision,
    shortRevision: revision.slice(0, 12),
    message,
    authorName: optionalText(author?.name || row?.author?.full_name || row?.author?.login || row?.author?.username, 240),
    authorEmail: optionalText(author?.email, 320),
    authoredAt: safeDate(author?.date || row?.created),
    committedAt: safeDate(committer?.date || author?.date || row?.created),
    webUrl: optionalText(row?.html_url || row?.url, 2_048),
    additions,
    deletions,
    filesChanged,
    parentRevisions: JSON.stringify(Array.isArray(row?.parents) ? row.parents.map((parent: any) => cleanText(parent?.sha || parent?.id, 160)).filter(Boolean) : []),
    branchNames: JSON.stringify(branchName ? [branchName] : []),
    metadata: JSON.stringify({ verification: row?.verification || null }),
  };
}

type DiffChange = {
  path: string;
  previousPath: string | null;
  changeType: string;
  additions: number;
  deletions: number;
  binary: boolean;
};

function parseUnifiedDiff(value: unknown): DiffChange[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const output: DiffChange[] = [];
  let current: DiffChange | null = null;
  const push = () => {
    if (current?.path) output.push(current);
    current = null;
  };
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) {
      push();
      current = { path: match[2], previousPath: match[1] === match[2] ? null : match[1], changeType: "modified", additions: 0, deletions: 0, binary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode ")) current.changeType = "added";
    else if (line.startsWith("deleted file mode ")) current.changeType = "deleted";
    else if (line.startsWith("rename from ")) { current.changeType = "renamed"; current.previousPath = line.slice(12).trim(); }
    else if (line.startsWith("rename to ")) current.path = line.slice(10).trim();
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.binary = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  push();
  return output.slice(0, 2_000);
}

function cleanBranchName(value: unknown) {
  const branch = cleanText(value, 200);
  if (!branch || branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.includes("..") || branch.includes("@{") || /[~^:?*[\\\s\u0000-\u001f]/.test(branch) || /(^|\/)\./.test(branch) || /\.lock(?:\/|$)/i.test(branch)) {
    throw createHttpError("SOURCE_BRANCH_INVALID", "Branch name is not valid for Git.", 400);
  }
  return branch;
}

function wildcardMatches(value: string, pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function serializeWorkingCopy(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    projectId: row.projectId,
    ownerUserId: row.ownerUserId,
    purpose: row.purpose,
    branchName: row.branchName,
    baseBranch: row.baseBranch,
    baseRevision: row.baseRevision,
    headRevision: row.headRevision,
    upstreamName: row.upstreamName,
    status: row.status,
    dirtyFiles: row.dirtyFiles,
    stagedFiles: row.stagedFiles,
    conflictCount: row.conflictCount,
    aheadCount: row.aheadCount,
    behindCount: row.behindCount,
    mergeBaseRevision: row.mergeBaseRevision,
    lastScannedAt: row.lastScannedAt,
    lastUsedAt: row.lastUsedAt,
    metadata: parseObject(row.metadata),
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializePolicy(row: any, defaultBranch: string) {
  const protectedPatterns = Array.from(new Set([defaultBranch, ...parseArray(row?.protectedPatterns).map((item) => cleanText(item, 200)).filter(Boolean)]));
  return {
    id: row?.id || null,
    bindingId: row?.bindingId || null,
    protectedPatterns,
    branchPrefixes: parseArray(row?.branchPrefixes || '["feature/","fix/","hotfix/","release/"]').map((item) => cleanText(item, 80)).filter(Boolean),
    allowDirectPush: row?.allowDirectPush !== false,
    allowForcePush: Boolean(row?.allowForcePush),
    requireLinkedWorkItem: Boolean(row?.requireLinkedWorkItem),
    requiredApprovals: Math.max(0, Math.min(12, Number(row?.requiredApprovals ?? 1) || 0)),
    requireQa: Boolean(row?.requireQa),
    requireBuild: Boolean(row?.requireBuild),
  };
}

function serializeReview(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    projectId: row.projectId,
    workingCopyId: row.workingCopyId,
    title: row.title,
    description: row.description,
    sourceBranch: row.sourceBranch,
    targetBranch: row.targetBranch,
    sourceRevision: row.sourceRevision,
    targetRevision: row.targetRevision,
    status: row.status,
    eligibilityState: row.eligibilityState,
    eligibilityMessage: row.eligibilityMessage,
    changeSummary: parseObject(row.changeSummary),
    linkedWork: parseArray(row.linkedWork),
    reviewerIds: parseArray(row.reviewerIds),
    reviewerTeamIds: parseArray(row.reviewerTeamIds),
    createdById: row.createdById,
    mergedById: row.mergedById,
    mergedRevision: row.mergedRevision,
    mergedAt: row.mergedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    decisions: Array.isArray(row.decisions) ? row.decisions.map((decision: any) => ({ id: decision.id, userId: decision.userId, decision: decision.decision, comment: decision.comment, createdAt: decision.createdAt, updatedAt: decision.updatedAt })) : [],
  };
}

function changeTypeFromGitStatus(status: string) {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  return "modified";
}

function versionTemplateTokens(template: string) {
  return Array.from(template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g)).map((match) => match[1]);
}

function parseVersionLabel(template: string, label: string) {
  const tokens: string[] = [];
  let pattern = "^";
  let cursor = 0;
  for (const match of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g)) {
    const index = match.index || 0;
    pattern += template.slice(cursor, index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern += "(.+?)";
    tokens.push(match[1]);
    cursor = index + match[0].length;
  }
  pattern += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
  const result = label.match(new RegExp(pattern));
  if (!result) return {} as Record<string, string | number>;
  return Object.fromEntries(tokens.map((token, index) => {
    const raw = result[index + 1];
    const numeric = /^\d+$/.test(raw) ? Number(raw) : raw;
    return [token, numeric];
  }));
}

function formatVersionLabel(template: string, components: Record<string, unknown>) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (_match, token) => String(components[token] ?? 0));
}

function initialVersionComponents(policy: any) {
  const now = new Date();
  const configured = parseArray(policy?.components);
  const defaults: Record<string, unknown> = { stage: "A", major: policy?.presetKey === "game-development" ? 1 : 0, minor: policy?.presetKey === "semantic" ? 1 : 0, patch: 0, revision: 1, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  for (const component of configured) {
    if (!component || typeof component !== "object" || Array.isArray(component)) continue;
    const key = cleanText((component as any).key || (component as any).name, 80);
    if (!key) continue;
    const value = (component as any).initial ?? (component as any).defaultValue ?? (component as any).value;
    if (value !== undefined && value !== null && value !== "") defaults[key] = value;
  }
  return defaults;
}

function versionBumpFromMessages(messages: string[], rules: Record<string, unknown>) {
  const joined = messages.join("\n");
  const custom = (key: string) => parseArray((rules as any)[key]).map((item) => String(item)).filter(Boolean).some((pattern) => {
    try { return new RegExp(pattern, "i").test(joined); } catch { return joined.toLowerCase().includes(pattern.toLowerCase()); }
  });
  if (custom("majorPatterns") || /(^|\n)([^\n]+!)?:|BREAKING[ -]CHANGE/i.test(joined)) return "major" as const;
  if (custom("minorPatterns") || /(^|\n)feat(?:\([^)]*\))?:/i.test(joined)) return "minor" as const;
  if (custom("patchPatterns") || messages.length) return "patch" as const;
  return "none" as const;
}

function bumpVersionComponents(current: Record<string, unknown>, bump: "major" | "minor" | "patch" | "none", policy: any, initial: boolean) {
  const next = { ...current } as Record<string, unknown>;
  const now = new Date();
  const number = (key: string, fallback = 0) => Number.isFinite(Number(next[key])) ? Number(next[key]) : fallback;
  if (policy?.presetKey === "calendar") {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const samePeriod = number("year") === year && number("month") === month;
    next.year = year;
    next.month = month;
    next.revision = initial ? number("revision", 1) : samePeriod ? number("revision", 0) + 1 : 1;
    return next;
  }
  if (initial) return next;
  if (bump === "major") { next.major = number("major") + 1; if ("minor" in next) next.minor = 0; if ("patch" in next) next.patch = 0; }
  else if (bump === "minor") { next.minor = number("minor") + 1; if ("patch" in next) next.patch = 0; }
  else if (bump === "patch") {
    if ("patch" in next) next.patch = number("patch") + 1;
    else if ("revision" in next) next.revision = number("revision") + 1;
  }
  if ("revision" in next && !["calendar"].includes(String(policy?.presetKey || "")) && !["major", "minor", "patch"].some((key) => versionTemplateTokens(String(policy?.formatTemplate || "")).includes(key))) next.revision = number("revision") + 1;
  return next;
}

function serializeConnection(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.providerId,
    category: row.category,
    displayName: row.displayName,
    status: row.status,
    healthState: row.healthState,
    healthMessage: row.healthMessage,
    lastCheckedAt: row.lastCheckedAt,
    capabilities: parseArray(row.capabilities),
  };
}

export function serializeSourceRepository(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    connectionId: row.connectionId,
    name: row.name,
    slug: row.slug,
    hostingMode: row.hostingMode,
    providerRepositoryId: row.providerRepositoryId,
    remoteUrl: row.remoteUrl,
    cloneUrl: row.cloneUrl,
    defaultBranch: row.defaultBranch,
    headRevision: row.headRevision,
    syncState: row.syncState,
    lastSyncedAt: row.lastSyncedAt,
    lastFetchAt: row.lastFetchAt,
    lastPushAt: row.lastPushAt,
    healthState: row.healthState,
    healthMessage: row.healthMessage,
    metadata: parseObject(row.metadata),
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    connection: serializeConnection(row.connection),
    _count: row._count,
  };
}

function serializeCommit(row: any) {
  return {
    ...row,
    parentRevisions: parseArray(row.parentRevisions),
    branchNames: parseArray(row.branchNames),
    metadata: parseObject(row.metadata),
    changes: Array.isArray(row.changes) ? row.changes.map((change: any) => ({ ...change, metadata: parseObject(change.metadata) })) : undefined,
  };
}

function serializeOperation(row: any, workspaceId: string): ClusterOperation {
  const canonicalStatuses = new Set<ClusterOperationStatus>(["queued", "running", "succeeded", "failed", "dead-letter", "cancelled"]);
  const rawStatus = cleanText(row?.status, 40) as ClusterOperationStatus;
  const status: ClusterOperationStatus = canonicalStatuses.has(rawStatus) ? rawStatus : "failed";
  const createdAt = safeDate(row?.createdAt)?.toISOString() || new Date(0).toISOString();
  const updatedAt = safeDate(row?.updatedAt)?.toISOString() || createdAt;
  const startedAt = safeDate(row?.startedAt)?.toISOString() || null;
  const finishedAt = safeDate(row?.completedAt)?.toISOString() || null;
  const operationType = cleanText(row?.operationType, 80) || "unknown";
  return {
    id: String(row?.id || ""),
    type: `source.${operationType}`,
    queue: "source-control",
    status,
    workspaceId,
    createdById: optionalText(row?.requestedById, 200),
    trace: { correlationId: optionalText(row?.backgroundJobId, 200) || String(row?.id || ""), causationId: null, requestId: null },
    priority: 0,
    costUnits: 1,
    progress: Math.max(0, Math.min(100, Number(row?.progress || 0))),
    progressMessage: optionalText(row?.progressMessage, 500),
    attempts: Math.max(0, Number(row?.attempts || 0)),
    maxAttempts: operationType === "fetch" ? 5 : operationType === "workspace_prepare" ? 3 : 1,
    runAfter: createdAt,
    cancelRequestedAt: null,
    lastError: optionalText(row?.lastError, 1_000),
    createdAt,
    updatedAt,
    startedAt,
    finishedAt,
    payload: {
      sourceControl: {
        repositoryId: String(row?.repositoryId || ""),
        workingCopyId: optionalText(row?.workingCopyId, 200),
        operationType,
        branchName: optionalText(row?.branchName, 200),
        targetBranch: optionalText(row?.targetBranch, 200),
        backgroundJobId: optionalText(row?.backgroundJobId, 200),
        input: parseObject(row?.inputMetadata),
      },
    },
    result: parseObject(row?.resultMetadata),
  };
}

export function createSourceControlService(input: SourceControlServiceInput) {
  async function requireRepository(repositoryId: string) {
    const repository = await input.prisma.sourceRepository.findFirst({
      where: { id: repositoryId, archived: false },
      include: { connection: true },
    });
    if (!repository) throw createHttpError("SOURCE_REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    return repository;
  }

  /** Durable Git operations are not grandfathered across provider, Project,
   * or Studio revocation. A queued job may outlive the connection/binding that
   * authorized it. This is a pre-execution fence, not an external-operation
   * rollback guarantee once Git has already transferred bytes. */
  async function requireRunnableRepository(repositoryId: string, projectId?: string) {
    const repository = await requireRepository(repositoryId);
    if (repository.connectionId && (!repository.connection || repository.connection.archived ||
        repository.connection.status === "disabled" || repository.connection.workspaceId !== repository.workspaceId)) {
      throw createHttpError("SOURCE_PROVIDER_REVOKED", "The repository provider connection is no longer active for this Studio.", 409);
    }
    if (projectId) {
      const binding = await input.prisma.projectSourceBinding.findFirst({
        where: { repositoryId, projectId, archived: false, project: { archived: false, workspaceId: repository.workspaceId } },
        select: { id: true },
      });
      if (!binding) throw createHttpError("SOURCE_PROJECT_BINDING_REVOKED", "The repository is no longer linked to the active Project.", 409);
    }
    return repository;
  }

  async function managedRepositoryPath(repository: any) {
    if (repository?.hostingMode !== "cluster") return null;
    return input.resolveManagedRepositoryPath ? input.resolveManagedRepositoryPath(repository) : null;
  }

  async function resolveReviewAudience(projectId: string, reviewerIds: string[] = [], reviewerTeamIds: string[] = []) {
    const project = await input.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const normalizedUsers = Array.from(new Set(reviewerIds.map(String).map((value) => value.trim()).filter(Boolean))).slice(0, 50);
    const normalizedTeams = Array.from(new Set(reviewerTeamIds.map(String).map((value) => value.trim()).filter(Boolean))).slice(0, 25);
    const [users, workspaceMembers, teams] = await Promise.all([
      normalizedUsers.length ? input.prisma.user.findMany({ where: { id: { in: normalizedUsers }, archived: false }, select: { id: true } }) : [],
      normalizedUsers.length ? input.prisma.workspaceMember.findMany({ where: { workspaceId: project.workspaceId, userId: { in: normalizedUsers } }, select: { userId: true } }) : [],
      normalizedTeams.length ? input.prisma.studioTeam.findMany({ where: { id: { in: normalizedTeams }, workspaceId: project.workspaceId, archived: false }, select: { id: true } }) : [],
    ]);
    if (users.length !== normalizedUsers.length || workspaceMembers.length !== normalizedUsers.length) throw createHttpError("SOURCE_REVIEW_REVIEWER_INVALID", "One or more requested reviewers are unavailable in this workspace.", 400);
    if (teams.length !== normalizedTeams.length) throw createHttpError("SOURCE_REVIEW_TEAM_INVALID", "One or more requested reviewer teams are unavailable in this workspace.", 400);
    const teamMembers = normalizedTeams.length ? await input.prisma.studioTeamMember.findMany({ where: { teamId: { in: normalizedTeams }, archived: false, user: { archived: false } }, select: { userId: true } }) : [];
    const notificationUserIds = Array.from(new Set([...normalizedUsers, ...teamMembers.map((member: any) => String(member.userId))]));
    return { reviewerIds: normalizedUsers, reviewerTeamIds: normalizedTeams, notificationUserIds };
  }

  async function state(repositoryId: string) {
    const repository = await input.prisma.sourceRepository.findFirst({
      where: { id: repositoryId, archived: false },
      include: { connection: true, _count: { select: { projects: true, branches: true, commits: true, changes: true, operations: true } } },
    });
    if (!repository) throw createHttpError("SOURCE_REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    const [branches, commits, operations, runtime] = await Promise.all([
      input.prisma.sourceBranch.findMany({ where: { repositoryId, archived: false }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], take: 200 }),
      // File-level changes are intentionally lazy. The main repository state is
      // used by several project/build surfaces and should not drag up to 15,000
      // SourceChange rows across the database and wire on every refresh.
      input.prisma.sourceCommit.findMany({
        where: { repositoryId },
        select: { id: true, repositoryId: true, revision: true, shortRevision: true, message: true, authorName: true, authorEmail: true, authoredAt: true, committedAt: true, webUrl: true, additions: true, deletions: true, filesChanged: true, parentRevisions: true, branchNames: true, metadata: true, createdAt: true, updatedAt: true },
        orderBy: [{ committedAt: "desc" }, { createdAt: "desc" }],
        take: 60,
      }),
      input.prisma.sourceOperation.findMany({ where: { repositoryId }, orderBy: { createdAt: "desc" }, take: 30 }),
      input.gitRuntime ? managedRepositoryPath(repository).then((repositoryPath) => input.gitRuntime!.status(repositoryId, repositoryPath)) : Promise.resolve(null),
    ]);
    return {
      repository: serializeSourceRepository(repository),
      runtime,
      branches,
      commits: commits.map(serializeCommit),
      operations: operations.map((operation: any) => serializeOperation(operation, repository.workspaceId)),
    };
  }

  async function commitChanges(repositoryId: string, commitId: string) {
    const commit = await input.prisma.sourceCommit.findFirst({ where: { id: commitId, repositoryId }, select: { id: true, revision: true } });
    if (!commit) throw createHttpError("SOURCE_COMMIT_NOT_FOUND", "Source commit not found.", 404);
    const changes = await input.prisma.sourceChange.findMany({
      where: { repositoryId, commitId },
      select: { id: true, commitId: true, revision: true, path: true, previousPath: true, changeType: true, additions: true, deletions: true, binary: true, metadata: true, createdAt: true, updatedAt: true },
      orderBy: { path: "asc" },
      take: 2_000,
    });
    return { commitId: commit.id, revision: commit.revision, changes: changes.map((change: any) => ({ ...change, metadata: parseObject(change.metadata) })), truncated: changes.length >= 2_000 };
  }

  async function versionSuggestion(projectId: string, repositoryId: string, bumpOverride: "auto" | "major" | "minor" | "patch" = "auto") {
    const repository = await requireRepository(repositoryId);
    const project = await input.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const projectPolicy = await input.prisma.versionPolicy.findFirst({
      where: { workspaceId: project.workspaceId, projectId, archived: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    const policy = projectPolicy || await input.prisma.versionPolicy.findFirst({
      where: { workspaceId: project.workspaceId, projectId: null, archived: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!policy) return { configured: false, latest: null, suggestion: null };

    const latest = await input.prisma.projectVersion.findFirst({ where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const initial = initialVersionComponents(policy);
    const latestComponents = latest ? { ...initial, ...parseVersionLabel(policy.formatTemplate, latest.label), ...parseObject(latest.components) } : initial;
    const headRevision = optionalText(repository.headRevision, 160);
    const defaultBranch = repository.defaultBranch || "main";
    const recent = await input.prisma.sourceCommit.findMany({
      where: { repositoryId },
      orderBy: [{ committedAt: "desc" }, { createdAt: "desc" }],
      take: 250,
      select: { revision: true, shortRevision: true, message: true, committedAt: true, branchNames: true },
    });
    const defaultCommits = recent.filter((commit: any) => parseArray(commit.branchNames).includes(defaultBranch));
    let commitsSince: any[] = [];
    if (!latest) commitsSince = defaultCommits;
    else if (headRevision && latest.sourceRevision === headRevision) commitsSince = [];
    else {
      const marker = latest.sourceRevision ? defaultCommits.findIndex((commit: any) => commit.revision === latest.sourceRevision) : -1;
      commitsSince = marker >= 0 ? defaultCommits.slice(0, marker) : defaultCommits.filter((commit: any) => !latest.createdAt || !commit.committedAt || new Date(commit.committedAt).getTime() > new Date(latest.createdAt).getTime());
    }

    const bump = bumpOverride === "auto" ? versionBumpFromMessages(commitsSince.map((commit: any) => commit.message), parseObject(policy.bumpRules)) : bumpOverride;
    const hasChanges = !latest || commitsSince.length > 0 || Boolean(headRevision && latest.sourceRevision !== headRevision);
    const components = bumpVersionComponents(latestComponents, bump, policy, !latest);
    const label = formatVersionLabel(policy.formatTemplate, components);
    const rationale = !latest
      ? ["Initial version from the active project version policy."]
      : !hasChanges
        ? ["No new default-branch changes since the latest project version."]
        : [bump === "major" ? "Breaking changes suggest a major version." : bump === "minor" ? "Feature changes suggest a minor version." : `New source changes suggest a ${bump === "none" ? "revision" : "patch"} version.`];
    return {
      configured: true,
      policy: { id: policy.id, name: policy.name, presetKey: policy.presetKey, formatTemplate: policy.formatTemplate },
      latest: latest ? { id: latest.id, label: latest.label, status: latest.status, sourceRevision: latest.sourceRevision, createdAt: latest.createdAt } : null,
      suggestion: {
        label,
        components,
        bump,
        hasChanges,
        sourceRevision: headRevision || defaultCommits[0]?.revision || null,
        commitCount: commitsSince.length,
        rationale,
        commits: commitsSince.slice(0, 12).map((commit: any) => ({ revision: commit.revision, shortRevision: commit.shortRevision, message: commit.message, committedAt: commit.committedAt })),
      },
    };
  }

  async function createProjectVersion(projectId: string, repositoryId: string, requestedById: string | null, bumpOverride: "auto" | "major" | "minor" | "patch" = "auto") {
    const suggestionState = await versionSuggestion(projectId, repositoryId, bumpOverride);
    if (!suggestionState.configured || !suggestionState.policy || !suggestionState.suggestion) throw createHttpError("VERSION_POLICY_REQUIRED", "Configure a version policy before creating a project version.", 409);
    if (suggestionState.latest && !suggestionState.suggestion.hasChanges) throw createHttpError("PROJECT_VERSION_CURRENT", "The project version is already current with the default branch.", 409);
    const stage = optionalText((suggestionState.suggestion.components as any).stage, 80);
    let version;
    try {
      version = await input.prisma.projectVersion.create({ data: {
        projectId,
        policyId: suggestionState.policy.id,
        label: suggestionState.suggestion.label,
        stage,
        components: JSON.stringify(suggestionState.suggestion.components),
        sourceRevision: suggestionState.suggestion.sourceRevision,
        status: "draft",
        createdById: requestedById || null,
      } });
    } catch (error: any) {
      if (error?.code === "P2002") throw createHttpError("PROJECT_VERSION_EXISTS", `Project version ${suggestionState.suggestion.label} already exists.`, 409);
      throw error;
    }
    await recordWorkflowActivity({ projectId, userId: requestedById, type: "source_project_version_created", entityId: version.id, title: "Project version created", message: version.label, metadata: { repositoryId, sourceRevision: version.sourceRevision, bump: suggestionState.suggestion.bump, commitCount: suggestionState.suggestion.commitCount } });
    return { ...version, components: parseObject(version.components), suggestion: suggestionState.suggestion };
  }

  async function reviewForProject(projectId: string, repositoryId: string, reviewId: string) {
    const row = await input.prisma.sourceReview.findFirst({
      where: { id: reviewId, projectId, repositoryId },
      include: { decisions: { orderBy: { updatedAt: "asc" } } },
    });
    return serializeReview(row);
  }

  async function workflowState(repositoryId: string, projectId: string, ownerUserId: string | null, bindingId: string) {
    const repository = await requireRepository(repositoryId);
    const [workingCopies, policyRow, links, version, reviews] = await Promise.all([
      input.prisma.sourceWorkingCopy.findMany({
        where: { repositoryId, projectId, ownerUserId, archived: false },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      input.prisma.sourceBranchPolicy.findUnique({ where: { bindingId } }),
      input.prisma.sourceArtifactLink.findMany({ where: { repositoryId, projectId }, orderBy: { createdAt: "desc" }, take: 50 }),
      versionSuggestion(projectId, repositoryId),
      input.prisma.sourceReview.findMany({ where: { repositoryId, projectId }, include: { decisions: { orderBy: { updatedAt: "asc" } } }, orderBy: { updatedAt: "desc" }, take: 30 }),
    ]);
    return {
      policy: serializePolicy(policyRow, repository.defaultBranch || "main"),
      workingCopies: workingCopies.map(serializeWorkingCopy),
      links: links.map((row: any) => ({ ...row, metadata: parseObject(row.metadata) })),
      versionSuggestion: version,
      reviews: reviews.map(serializeReview),
    };
  }

  async function reviewEligibility(reviewId: string, refreshSnapshots = true) {
    const review = await input.prisma.sourceReview.findUnique({ where: { id: reviewId }, include: { decisions: true, workingCopy: true, project: { include: { memberships: { where: { status: "active" } } } } } });
    if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Source review not found.", 404);
    if (review.status !== "open") return serializeReview(review);
    const repository = await requireRepository(review.repositoryId);
    if (!input.gitRuntime) throw createHttpError("SOURCE_GIT_UNAVAILABLE", "Git runtime is unavailable.", 409);
    const binding = await input.prisma.projectSourceBinding.findFirst({ where: { projectId: review.projectId, repositoryId: review.repositoryId, archived: false }, include: { branchPolicy: true } });
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is no longer linked to this project.", 409);
    const token = repository.connection ? await input.providerService.tokenFor(repository.connection) : null;
    const repositoryPath = await managedRepositoryPath(repository);
    const mergeState = await input.gitRuntime.evaluateMerge({ repositoryId: review.repositoryId, repositoryPath, sourceBranch: review.sourceBranch, targetBranch: review.targetBranch, token, providerId: repository.connection?.providerId || null });
    const policy = serializePolicy(binding.branchPolicy, binding.defaultBranch || repository.defaultBranch || "main");
    const decisions = Array.isArray(review.decisions) ? review.decisions : [];
    const directReviewerIds = parseArray(review.reviewerIds).map(String);
    const reviewerTeamIds = parseArray(review.reviewerTeamIds).map(String);
    const teamReviewerRows = reviewerTeamIds.length ? await input.prisma.studioTeamMember.findMany({ where: { teamId: { in: reviewerTeamIds }, archived: false }, select: { userId: true } }) : [];
    const requestedReviewers = new Set([...directReviewerIds, ...teamReviewerRows.map((row: any) => String(row.userId))].filter(Boolean));
    const eligibleDecisions = requestedReviewers.size ? decisions.filter((row: any) => requestedReviewers.has(String(row.userId))) : decisions;
    const approvals = eligibleDecisions.filter((row: any) => row.decision === "approved" && row.userId !== review.createdById).length;
    const changesRequested = eligibleDecisions.some((row: any) => row.decision === "changes_requested");
    const artifactLinks = await input.prisma.sourceArtifactLink.findMany({ where: { repositoryId: review.repositoryId, projectId: review.projectId, OR: [{ workingCopyId: review.workingCopyId || "__none__" }, { commit: { revision: mergeState.sourceRevision } }] }, select: { targetType: true, targetId: true, linkRole: true } });
    const uniqueLinks = Array.from(new Map(artifactLinks.map((link: any) => [`${link.targetType}:${link.targetId}:${link.linkRole}`, link])).values());
    const hasWork = uniqueLinks.some((link: any) => !["build", "qa_plan", "qa_session", "release", "project_version"].includes(link.targetType));
    const hasQa = uniqueLinks.some((link: any) => ["qa_plan", "qa_session"].includes(link.targetType));
    const hasBuild = uniqueLinks.some((link: any) => link.targetType === "build");
    const sourceCommit = await input.prisma.sourceCommit.findFirst({ where: { repositoryId: review.repositoryId, revision: mergeState.sourceRevision }, include: { changes: { take: 500 } } });
    const fileTypes: Record<string, number> = {};
    for (const change of sourceCommit?.changes || []) {
      const path = cleanText(change.path, 2_000);
      const extension = path.includes(".") ? path.split(".").pop()?.toLowerCase() || "other" : "other";
      fileTypes[extension] = (fileTypes[extension] || 0) + 1;
    }
    const blockers: string[] = [];
    if (mergeState.conflicts) blockers.push("Resolve merge conflicts before merging.");
    if (mergeState.sourceAhead < 1) blockers.push("Source branch has no changes to merge.");
    if (changesRequested) blockers.push("Requested review changes are still open.");
    if (approvals < policy.requiredApprovals) blockers.push(`${policy.requiredApprovals - approvals} more approval${policy.requiredApprovals - approvals === 1 ? " is" : "s are"} required.`);
    if (policy.requireLinkedWorkItem && !hasWork) blockers.push("Linked project work is required.");
    if (policy.requireQa && !hasQa) blockers.push("Linked QA evidence is required.");
    if (policy.requireBuild && !hasBuild) blockers.push("A linked build is required.");
    const changeSummary = {
      commits: mergeState.sourceAhead,
      targetOnlyCommits: mergeState.targetAhead,
      files: mergeState.filesChanged || sourceCommit?.changes?.length || sourceCommit?.filesChanged || 0,
      additions: mergeState.additions || sourceCommit?.additions || 0,
      deletions: mergeState.deletions || sourceCommit?.deletions || 0,
      fileTypes,
      linkedWork: uniqueLinks.length,
      approvals,
      requiredApprovals: policy.requiredApprovals,
      qaLinked: hasQa,
      buildLinked: hasBuild,
      mergeBaseRevision: mergeState.mergeBaseRevision,
    };
    const eligibilityState = blockers.length ? (mergeState.conflicts ? "conflicted" : "blocked") : "ready";
    const updated = await input.prisma.sourceReview.update({ where: { id: reviewId }, data: {
      sourceRevision: refreshSnapshots ? mergeState.sourceRevision : review.sourceRevision,
      targetRevision: refreshSnapshots ? mergeState.targetRevision : review.targetRevision,
      eligibilityState,
      eligibilityMessage: blockers.join(" ") || "Review is ready to merge.",
      changeSummary: JSON.stringify(changeSummary),
      linkedWork: JSON.stringify(uniqueLinks),
    }, include: { decisions: { orderBy: { updatedAt: "asc" } } } });
    if (review.eligibilityState !== eligibilityState && ["ready", "blocked", "conflicted"].includes(eligibilityState)) {
      await recordWorkflowActivity({ projectId: review.projectId, type: eligibilityState === "ready" ? "source_review_ready" : "source_review_blocked", entityId: review.id, title: eligibilityState === "ready" ? "Source review ready" : "Source review blocked", message: blockers.join(" ") || `${review.sourceBranch} → ${review.targetBranch}`, metadata: { repositoryId: review.repositoryId, reviewId: review.id, notifyInbox: true, notificationSignal: eligibilityState === "ready" ? "review" : "blocked", requiresAction: true } });
    }
    return serializeReview(updated);
  }

  async function createReview(inputData: { projectId: string; repositoryId: string; workingCopyId: string; createdById: string | null; title: string; description?: string | null; targetBranch: string; reviewerIds?: string[]; reviewerTeamIds?: string[] }) {
    const workingCopy = await input.prisma.sourceWorkingCopy.findFirst({ where: { id: inputData.workingCopyId, projectId: inputData.projectId, repositoryId: inputData.repositoryId, archived: false } });
    if (!workingCopy) throw createHttpError("SOURCE_WORKING_COPY_NOT_FOUND", "Working copy not found.", 404);
    if (!workingCopy.headRevision) throw createHttpError("SOURCE_REVIEW_HEAD_REQUIRED", "Push the branch before opening a review.", 409);
    if (workingCopy.dirtyFiles || workingCopy.conflictCount) throw createHttpError("SOURCE_REVIEW_WORKSPACE_DIRTY", "Commit or resolve working-copy changes before opening a review.", 409);
    const audience = await resolveReviewAudience(inputData.projectId, inputData.reviewerIds || [], inputData.reviewerTeamIds || []);
    const reviewerIds = audience.reviewerIds;
    const reviewerTeamIds = audience.reviewerTeamIds;
    const sourceBranch = cleanBranchName(workingCopy.branchName);
    const targetBranch = cleanBranchName(inputData.targetBranch);
    if (sourceBranch === targetBranch) throw createHttpError("SOURCE_REVIEW_BRANCHES", "Source and target branches must be different.", 400);
    const existing = await input.prisma.sourceReview.findFirst({ where: { repositoryId: inputData.repositoryId, projectId: inputData.projectId, sourceBranch, targetBranch, status: "open" }, include: { decisions: true } });
    if (existing) return reviewEligibility(existing.id, true);
    const target = await input.prisma.sourceBranch.findUnique({ where: { repositoryId_name: { repositoryId: inputData.repositoryId, name: targetBranch } } });
    if (!target?.headRevision) throw createHttpError("SOURCE_REVIEW_TARGET", `Target branch ${targetBranch} is not synchronized.`, 409);
    const row = await input.prisma.sourceReview.create({ data: {
      repositoryId: inputData.repositoryId,
      projectId: inputData.projectId,
      workingCopyId: workingCopy.id,
      title: cleanText(inputData.title, 500) || `Review ${sourceBranch}`,
      description: optionalText(inputData.description, 8_000),
      sourceBranch,
      targetBranch,
      sourceRevision: workingCopy.headRevision,
      targetRevision: target.headRevision,
      reviewerIds: JSON.stringify(reviewerIds),
      reviewerTeamIds: JSON.stringify(reviewerTeamIds),
      createdById: inputData.createdById || null,
      status: "open",
      eligibilityState: "checking",
    } });
    await recordWorkflowActivity({ projectId: inputData.projectId, userId: inputData.createdById, type: "source_review_opened", entityId: row.id, title: "Source review opened", message: `${sourceBranch} → ${targetBranch}`, metadata: { repositoryId: inputData.repositoryId, sourceBranch, targetBranch, reviewId: row.id, reviewerIds: parseArray(row.reviewerIds), reviewerTeamIds: parseArray(row.reviewerTeamIds), userIds: audience.notificationUserIds.filter((userId) => userId !== inputData.createdById), notifyInbox: audience.notificationUserIds.some((userId) => userId !== inputData.createdById), notificationSignal: "review", requiresAction: true } });
    return reviewEligibility(row.id, true);
  }

  async function setReviewAssignments(reviewId: string, projectId: string, actorUserId: string | null, reviewerIds: string[], reviewerTeamIds: string[]) {
    const review = await input.prisma.sourceReview.findFirst({ where: { id: reviewId, projectId, status: "open" } });
    if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Open source review not found.", 404);
    const audience = await resolveReviewAudience(projectId, reviewerIds, reviewerTeamIds);
    const updated = await input.prisma.sourceReview.update({ where: { id: review.id }, data: { reviewerIds: JSON.stringify(audience.reviewerIds), reviewerTeamIds: JSON.stringify(audience.reviewerTeamIds) }, include: { decisions: { orderBy: { updatedAt: "asc" } } } });
    const notificationUserIds = audience.notificationUserIds.filter((userId) => userId !== actorUserId);
    await recordWorkflowActivity({ projectId, userId: actorUserId, type: "source_review_assignments_changed", entityId: review.id, title: "Source review assignments changed", message: `${audience.reviewerIds.length} reviewer${audience.reviewerIds.length === 1 ? "" : "s"} · ${audience.reviewerTeamIds.length} team${audience.reviewerTeamIds.length === 1 ? "" : "s"}`, metadata: { reviewId: review.id, reviewerIds: audience.reviewerIds, reviewerTeamIds: audience.reviewerTeamIds, userIds: notificationUserIds, notifyInbox: notificationUserIds.length > 0, notificationSignal: "review", requiresAction: notificationUserIds.length > 0 } });
    return serializeReview(updated);
  }

  async function setReviewDecision(reviewId: string, projectId: string, userId: string, decision: "approved" | "changes_requested" | "commented", comment?: string | null) {
    const review = await input.prisma.sourceReview.findFirst({ where: { id: reviewId, projectId, status: "open" } });
    if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Open source review not found.", 404);
    if (decision === "approved" && review.createdById === userId) throw createHttpError("SOURCE_REVIEW_SELF_APPROVAL", "Review authors cannot approve their own changes.", 409);
    const note = optionalText(comment, 4_000);
    if (decision === "changes_requested" && !note) throw createHttpError("SOURCE_REVIEW_REASON_REQUIRED", "Explain the changes requested.", 400);
    const existing = await input.prisma.sourceReviewDecision.findUnique({ where: { reviewId_userId: { reviewId, userId } } });
    if (existing?.decision === decision && (existing.comment || null) === (note || null)) return reviewEligibility(reviewId, false);
    await input.prisma.sourceReviewDecision.upsert({ where: { reviewId_userId: { reviewId, userId } }, create: { reviewId, userId, decision, comment: note }, update: { decision, comment: note } });
    await recordWorkflowActivity({ projectId, userId, type: `source_review_${decision}`, entityId: reviewId, title: decision === "approved" ? "Source review approved" : decision === "changes_requested" ? "Source changes requested" : "Source review comment added", message: optionalText(comment, 500), metadata: { reviewId, decision, notifyInbox: decision !== "commented", notificationSignal: decision === "changes_requested" ? "blocked" : "approval", requiresAction: decision === "changes_requested" } });
    return reviewEligibility(reviewId, false);
  }

  async function updateBranchPolicy(bindingId: string, defaultBranch: string, inputData: { protectedPatterns?: string[]; branchPrefixes?: string[]; allowDirectPush?: boolean; allowForcePush?: boolean; requireLinkedWorkItem?: boolean; requiredApprovals?: number; requireQa?: boolean; requireBuild?: boolean }) {
    const protectedPatterns = Array.from(new Set((inputData.protectedPatterns || []).map((item) => cleanBranchName(item.replace(/\*+$/, "placeholder")).replace(/placeholder$/, "*")).filter(Boolean))).slice(0, 32);
    const branchPrefixes = Array.from(new Set((inputData.branchPrefixes || []).map((item) => cleanText(item, 80)).filter((item) => item && !/[\s\u0000-\u001f]/.test(item)))).slice(0, 32);
    const row = await input.prisma.sourceBranchPolicy.upsert({
      where: { bindingId },
      create: {
        bindingId,
        protectedPatterns: JSON.stringify(protectedPatterns),
        branchPrefixes: JSON.stringify(branchPrefixes.length ? branchPrefixes : ["feature/", "fix/", "hotfix/", "release/"]),
        allowDirectPush: inputData.allowDirectPush !== false,
        allowForcePush: false,
        requireLinkedWorkItem: Boolean(inputData.requireLinkedWorkItem),
        requiredApprovals: Math.max(0, Math.min(12, Number(inputData.requiredApprovals ?? 1) || 0)),
        requireQa: Boolean(inputData.requireQa),
        requireBuild: Boolean(inputData.requireBuild),
      },
      update: {
        protectedPatterns: JSON.stringify(protectedPatterns),
        branchPrefixes: JSON.stringify(branchPrefixes.length ? branchPrefixes : ["feature/", "fix/", "hotfix/", "release/"]),
        allowDirectPush: inputData.allowDirectPush !== false,
        allowForcePush: false,
        requireLinkedWorkItem: Boolean(inputData.requireLinkedWorkItem),
        requiredApprovals: Math.max(0, Math.min(12, Number(inputData.requiredApprovals ?? 1) || 0)),
        requireQa: Boolean(inputData.requireQa),
        requireBuild: Boolean(inputData.requireBuild),
      },
    });
    return serializePolicy(row, defaultBranch || "main");
  }

  async function ensureWorkingCopy(inputData: { repositoryId: string; projectId: string; ownerUserId: string | null; branchName: string; baseBranch: string; createBranch: boolean }) {
    const branchName = cleanBranchName(inputData.branchName);
    const baseBranch = cleanBranchName(inputData.baseBranch);
    const existing = await input.prisma.sourceWorkingCopy.findFirst({
      where: { repositoryId: inputData.repositoryId, projectId: inputData.projectId, ownerUserId: inputData.ownerUserId, branchName, archived: false },
    });
    if (existing && inputData.createBranch) throw createHttpError("SOURCE_BRANCH_WORKSPACE_EXISTS", `A working copy for ${branchName} already exists.`, 409);
    if (existing) return existing;
    return input.prisma.sourceWorkingCopy.create({
      data: {
        repositoryId: inputData.repositoryId,
        projectId: inputData.projectId,
        ownerUserId: inputData.ownerUserId,
        branchName,
        baseBranch,
        status: "preparing",
        lastUsedAt: new Date(),
        metadata: JSON.stringify({ createBranch: inputData.createBranch }),
      },
    });
  }

  async function persistWorkingCopyState(workingCopyId: string, state: any) {
    return input.prisma.sourceWorkingCopy.update({
      where: { id: workingCopyId },
      data: {
        branchName: optionalText(state?.branchName, 200) || undefined,
        headRevision: optionalText(state?.headRevision, 160),
        upstreamName: optionalText(state?.upstreamName, 240),
        status: cleanText(state?.status || "ready", 40) || "ready",
        dirtyFiles: Math.max(0, Number(state?.dirtyFiles) || 0),
        stagedFiles: Math.max(0, Number(state?.stagedFiles) || 0),
        conflictCount: Math.max(0, Number(state?.conflictCount) || 0),
        aheadCount: Math.max(0, Number(state?.aheadCount) || 0),
        behindCount: Math.max(0, Number(state?.behindCount) || 0),
        mergeBaseRevision: optionalText(state?.mergeBaseRevision, 160),
        lastScannedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });
  }

  async function refreshWorkingCopy(workingCopyId: string, projectId: string, ownerUserId: string | null) {
    const row = await input.prisma.sourceWorkingCopy.findFirst({ where: { id: workingCopyId, projectId, ownerUserId, archived: false } });
    if (!row) throw createHttpError("SOURCE_WORKING_COPY_NOT_FOUND", "Working copy not found.", 404);
    if (!input.gitRuntime) throw createHttpError("SOURCE_GIT_UNAVAILABLE", "Git runtime is unavailable.", 409);
    const state = await input.gitRuntime.inspectWorkingCopy(row.id);
    return serializeWorkingCopy(await persistWorkingCopyState(row.id, state));
  }

  async function validateArtifactLinks(projectId: string, links: Array<{ targetType: string; targetId: string; linkRole?: string | null }>) {
    const normalized = links.slice(0, 12).map((link) => ({ targetType: cleanText(link.targetType, 80).toLowerCase(), targetId: cleanText(link.targetId, 240), linkRole: cleanText(link.linkRole || "implements", 80) || "implements" })).filter((link) => link.targetType && link.targetId);
    for (const link of normalized) {
      let valid = false;
      if (["card", "ticket"].includes(link.targetType)) {
        valid = Boolean(await input.prisma.card.findFirst({ where: { id: link.targetId, archived: false, list: { board: { projectId } } }, select: { id: true } }));
      } else if (link.targetType === "timeline") {
        valid = Boolean(await input.prisma.timelineItem.findFirst({ where: { id: link.targetId, projectId }, select: { id: true } }));
      } else if (link.targetType === "control") {
        valid = Boolean(await input.prisma.projectControlRecord.findFirst({ where: { id: link.targetId, projectId, archived: false }, select: { id: true } }));
      } else if (link.targetType === "project_version") {
        valid = Boolean(await input.prisma.projectVersion.findFirst({ where: { id: link.targetId, projectId }, select: { id: true } }));
      } else if (link.targetType === "build") {
        valid = Boolean(await input.prisma.deliveryBuild.findFirst({ where: { id: link.targetId, projectId, archived: false }, select: { id: true } }));
      } else if (link.targetType === "qa_plan") {
        valid = Boolean(await input.prisma.deliveryQaPlan.findFirst({ where: { id: link.targetId, projectId, archived: false }, select: { id: true } }));
      } else if (link.targetType === "qa_session") {
        valid = Boolean(await input.prisma.deliveryQaSession.findFirst({ where: { id: link.targetId, projectId, archived: false }, select: { id: true } }));
      } else if (link.targetType === "release") {
        valid = Boolean(await input.prisma.deliveryRelease.findFirst({ where: { id: link.targetId, projectId, archived: false }, select: { id: true } }));
      }
      if (!valid) throw createHttpError("SOURCE_LINK_TARGET_INVALID", `Linked ${link.targetType || "work item"} is not available in this project.`, 400);
    }
    return normalized;
  }

  async function createOperation(repositoryId: string, inputData: { operationType: "sync" | "fetch" | "clone" | "workspace_prepare" | "branch_create" | "commit" | "push" | "merge_review"; requestedById?: string | null; workingCopyId?: string | null; branchName?: string | null; targetBranch?: string | null; requestKey?: string | null; inputMetadata?: Record<string, unknown> }) {
    const repository = await requireRepository(repositoryId);
    const requestKey = optionalText(inputData.requestKey, 240);
    if (requestKey) {
      const existing = await input.prisma.sourceOperation.findFirst({ where: { repositoryId, requestKey } });
      if (existing) return { repository, operation: existing, reused: true };
    }
    const operation = await input.prisma.sourceOperation.create({
      data: {
        repositoryId,
        workingCopyId: inputData.workingCopyId || null,
        operationType: inputData.operationType,
        requestKey,
        requestedById: inputData.requestedById || null,
        branchName: inputData.branchName || null,
        targetBranch: inputData.targetBranch || null,
        inputMetadata: JSON.stringify(inputData.inputMetadata || {}),
        status: "queued",
        progress: 0,
        progressMessage: "Queued",
      },
    });
    return { repository, operation, reused: false };
  }

  async function attachBackgroundJob(operationId: string, backgroundJobId: string) {
    return input.prisma.sourceOperation.update({ where: { id: operationId }, data: { backgroundJobId } });
  }

  async function reportOperation(operationId: string, progress: number, message: string, reporter?: ProgressReporter) {
    const bounded = Math.max(0, Math.min(100, Math.round(progress)));
    await input.prisma.sourceOperation.update({ where: { id: operationId }, data: { progress: bounded, progressMessage: cleanText(message, 500) || null } });
    await reporter?.(bounded, message);
  }

  async function syncRepository(repository: any, operationId: string, reporter?: ProgressReporter) {
    if (!repository.connection) {
      if (repository.hostingMode !== "cluster" || !input.gitRuntime) throw createHttpError("SOURCE_ADAPTER_UNAVAILABLE", "This repository does not have an active Source Control connection.", 409);
      await reportOperation(operationId, 30, "Checking Cluster-managed repository", reporter);
      const repositoryPath = await managedRepositoryPath(repository);
      const mirror = await input.gitRuntime.syncMirror({ repositoryId: repository.id, repositoryPath, remoteUrl: null });
      const now = new Date();
      await input.prisma.sourceRepository.update({ where: { id: repository.id }, data: { syncState: "idle", healthState: mirror.mirrorState === "ready" ? "healthy" : "warning", healthMessage: mirror.message || "Cluster-managed repository checked.", lastSyncedAt: now } });
      await reportOperation(operationId, 100, "Cluster-managed repository ready", reporter);
      return { repositoryId: repository.id, native: true, mirror };
    }
    await reportOperation(operationId, 8, "Reading repository metadata", reporter);
    const snapshot = await input.providerService.repositorySnapshot(repository);
    const { defaultBranch, remoteUrl, cloneUrl, providerRepositoryId, branches, commits } = snapshot;
    let mirrorResult: any = null;
    if (input.gitRuntime && cloneUrl) {
      await reportOperation(operationId, 16, "Updating managed repository mirror", reporter);
      try {
        mirrorResult = await input.gitRuntime.syncMirror({ repositoryId: repository.id, remoteUrl: cloneUrl, token: await input.providerService.tokenFor(repository.connection), providerId: repository.connection?.providerId || null });
      } catch (error) {
        const message = cleanText(error instanceof Error ? error.message : error, 800) || "Managed repository mirror update failed.";
        mirrorResult = { mirrorState: "failed", action: "failed", message };
        input.logger?.warn?.({ repositoryId: repository.id, error: message }, "source-control managed mirror refresh failed");
      }
    }

    await reportOperation(operationId, 40, "Reading branches and recent commits", reporter);
    const headRevision = (branches as any[]).find((branch: any) => branch?.isDefault)?.headRevision || (commits as any[])[0]?.revision || null;
    await reportOperation(operationId, 54, "Updating branch and commit history", reporter);
    await input.prisma.$transaction(async (tx: any) => {
      const names = (branches as any[]).map((branch: any) => branch.name);
      if (names.length) await tx.sourceBranch.updateMany({ where: { repositoryId: repository.id, name: { notIn: names } }, data: { archived: true, isDefault: false } });
      else await tx.sourceBranch.updateMany({ where: { repositoryId: repository.id }, data: { archived: true, isDefault: false } });
      for (const branch of branches as any[]) {
        const commit = (commits as any[]).find((item: any) => item.revision === branch.headRevision);
        await tx.sourceBranch.upsert({
          where: { repositoryId_name: { repositoryId: repository.id, name: branch.name } },
          create: { repositoryId: repository.id, ...branch, lastCommitAt: commit?.committedAt || null, lastSyncedAt: new Date(), archived: false },
          update: { ...branch, lastCommitAt: commit?.committedAt || null, lastSyncedAt: new Date(), archived: false },
        });
      }
      for (const commit of commits as any[]) {
        const data = { ...commit, parentRevisions: JSON.stringify(commit.parentRevisions || []), branchNames: JSON.stringify(commit.branchNames || []), metadata: JSON.stringify(commit.metadata || {}) };
        await tx.sourceCommit.upsert({
          where: { repositoryId_revision: { repositoryId: repository.id, revision: commit.revision } },
          create: { repositoryId: repository.id, ...data },
          update: data,
        });
      }
    });

    const detailed = (commits as any[]).slice(0, 12);
    let detailedCount = 0;
    for (let index = 0; index < detailed.length; index++) {
      const commit = detailed[index];
      await reportOperation(operationId, 58 + Math.round((index / Math.max(1, detailed.length)) * 24), `Reading changes for ${commit.shortRevision}`, reporter);
      try {
        const changes = await input.providerService.commitChanges({ ...repository, providerRepositoryId, connection: repository.connection }, commit.revision);
        const storedCommit = await input.prisma.sourceCommit.findUnique({ where: { repositoryId_revision: { repositoryId: repository.id, revision: commit.revision } } });
        if (!storedCommit) continue;
        await input.prisma.$transaction(async (tx: any) => {
          await tx.sourceChange.deleteMany({ where: { repositoryId: repository.id, revision: commit.revision } });
          for (const change of changes as any[]) {
            await tx.sourceChange.create({ data: { repositoryId: repository.id, commitId: storedCommit.id, revision: commit.revision, ...change, metadata: "{}" } });
          }
          await tx.sourceCommit.update({ where: { id: storedCommit.id }, data: { filesChanged: changes.length || storedCommit.filesChanged, additions: changes.reduce((sum: number, row: any) => sum + Number(row.additions || 0), 0), deletions: changes.reduce((sum: number, row: any) => sum + Number(row.deletions || 0), 0) } });
        });
        detailedCount += 1;
      } catch (error) {
        input.logger?.warn?.({ repositoryId: repository.id, revision: commit.revision, error: error instanceof Error ? error.message : String(error) }, "source-control commit detail refresh failed");
      }
    }

    const now = new Date();
    const mirrorDegraded = mirrorResult && mirrorResult.mirrorState !== "ready";
    const updated = await input.prisma.sourceRepository.update({
      where: { id: repository.id },
      data: {
        name: cleanText(snapshot.repoInfo?.full_name || snapshot.repoInfo?.path_with_namespace || repository.name, 160) || repository.name,
        slug: snapshot.slug,
        providerRepositoryId,
        remoteUrl,
        cloneUrl,
        defaultBranch,
        headRevision,
        syncState: "idle",
        lastSyncedAt: now,
        lastFetchAt: mirrorResult?.mirrorState === "ready" ? now : repository.lastFetchAt,
        healthState: mirrorDegraded ? "degraded" : "healthy",
        healthMessage: mirrorDegraded ? `Repository metadata is synchronized. ${mirrorResult.message || "Managed repository mirror is unavailable."}` : `Repository synchronized through ${repository.connection.displayName}.`,
        metadata: JSON.stringify({ ...parseObject(repository.metadata), providerId: snapshot.providerId, managedMirror: mirrorResult ? { state: mirrorResult.mirrorState, action: mirrorResult.action || null, message: mirrorResult.message || null, runtimeVersion: mirrorResult.runtime?.version || null } : null }),
      },
      include: { connection: true, _count: { select: { projects: true, branches: true, commits: true, changes: true, operations: true } } },
    });
    await reportOperation(operationId, 96, "Repository state updated", reporter);
    if (input.logActivity) await input.logActivity({
      userId: null,
      projectId: null,
      type: "source_repository_synchronized",
      entityType: "source_repository",
      entityId: updated.id,
      title: "Source repository synchronized",
      message: updated.name,
      metadata: { repositoryId: updated.id, headRevision: updated.headRevision, branchCount: branches.length, commitCount: commits.length },
    });
    return { repository: serializeSourceRepository(updated), branches: branches.length, commits: commits.length, detailedCommits: detailedCount, mirror: mirrorResult };
  }

  function branchProtected(policy: any, branchName: string, defaultBranch: string) {
    return branchName === defaultBranch || (policy.protectedPatterns || []).some((pattern: string) => wildcardMatches(branchName, pattern));
  }

  async function recordWorkflowActivity(inputData: { projectId: string; userId?: string | null; type: string; entityId?: string | null; title: string; message?: string | null; metadata?: Record<string, unknown> }) {
    const repositoryId = cleanText(inputData.metadata?.repositoryId, 240) || null;
    const entityType = inputData.type.startsWith("source_review_")
      ? "source_review"
      : inputData.type === "source_commit_created"
        ? "source_commit"
        : "source_repository";
    const entityId = entityType === "source_repository" ? repositoryId || inputData.entityId || null : inputData.entityId || repositoryId;
    const activity = {
      userId: inputData.userId || null,
      projectId: inputData.projectId,
      type: inputData.type,
      entityType,
      entityId,
      title: inputData.title,
      message: inputData.message || null,
      metadata: inputData.metadata || {},
    };
    if (input.logActivity) await input.logActivity(activity);
    else await input.prisma.activityEvent.create({ data: { ...activity, metadata: JSON.stringify(activity.metadata) } }).catch(() => undefined);
  }

  async function executeWorkflowJob(payload: unknown, attempt: number, reporter?: ProgressReporter) {
    const repositoryId = cleanText((payload as any)?.repositoryId, 240);
    const operationId = cleanText((payload as any)?.operationId, 240);
    if (!repositoryId || !operationId) throw new Error("Source-control workflow job requires repositoryId and operationId.");
    const operation = await input.prisma.sourceOperation.findFirst({ where: { id: operationId, repositoryId } });
    if (!operation) throw createHttpError("SOURCE_OPERATION_NOT_FOUND", "Source-control operation not found.", 404);
    if (!operation.workingCopyId) throw createHttpError("SOURCE_WORKING_COPY_REQUIRED", "Source-control workflow operation requires a working copy.", 409);
    const workingCopy = await input.prisma.sourceWorkingCopy.findFirst({ where: { id: operation.workingCopyId, repositoryId, archived: false } });
    if (!workingCopy) throw createHttpError("SOURCE_WORKING_COPY_NOT_FOUND", "Working copy not found.", 404);
    const repository = await requireRunnableRepository(repositoryId, workingCopy.projectId);
    if (!input.gitRuntime) throw createHttpError("SOURCE_GIT_UNAVAILABLE", "Git runtime is unavailable.", 409);
    const metadata = parseObject(operation.inputMetadata);
    await input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "running", attempts: attempt, startedAt: operation.startedAt || new Date(), completedAt: null, lastError: null } });
    try {
      const token = repository.connection ? await input.providerService.tokenFor(repository.connection) : null;
      const remoteUrl = optionalText(repository.cloneUrl || repository.remoteUrl, 2_048);
      const repositoryPath = await managedRepositoryPath(repository);
      const repositoryMetadata = parseObject(repository.metadata);
      const lfs = Boolean(repositoryMetadata.lfs);
      let result: any;
      if (operation.operationType === "workspace_prepare" || operation.operationType === "branch_create") {
        await reportOperation(operationId, 15, operation.operationType === "branch_create" ? "Creating managed branch" : "Preparing managed working copy", reporter);
        const state = await input.gitRuntime.prepareWorkingCopy({
          workingCopyId: workingCopy.id,
          repositoryId,
          repositoryPath,
          remoteUrl,
          token,
          providerId: repository.connection?.providerId || null,
          branchName: workingCopy.branchName,
          baseBranch: cleanBranchName(metadata.baseBranch || workingCopy.baseBranch || repository.defaultBranch || "main"),
          createBranch: operation.operationType === "branch_create",
          lfs,
        });
        const persisted = await persistWorkingCopyState(workingCopy.id, state);
        result = { workingCopy: serializeWorkingCopy(persisted), createdBranch: operation.operationType === "branch_create" };
        await recordWorkflowActivity({ projectId: workingCopy.projectId, userId: operation.requestedById, type: operation.operationType === "branch_create" ? "source_branch_created" : "source_working_copy_prepared", entityId: workingCopy.id, title: operation.operationType === "branch_create" ? "Source branch created" : "Working copy prepared", message: workingCopy.branchName, metadata: { repositoryId, branchName: workingCopy.branchName } });
      } else if (operation.operationType === "commit") {
        const message = cleanText(metadata.message, 8_000);
        const links = await validateArtifactLinks(workingCopy.projectId, Array.isArray(metadata.links) ? metadata.links as any[] : []);
        const user = operation.requestedById ? await input.prisma.user.findUnique({ where: { id: operation.requestedById }, select: { username: true, displayName: true, preferredName: true, email: true } }) : null;
        await reportOperation(operationId, 20, "Staging working-copy changes", reporter);
        const commitResult = await input.gitRuntime.commitWorkingCopy({ workingCopyId: workingCopy.id, message, authorName: user?.preferredName || user?.displayName || user?.username || "Cluster User", authorEmail: user?.email || null });
        const state = commitResult.state;
        const persisted = await persistWorkingCopyState(workingCopy.id, state);
        const revision = cleanText(state?.headRevision, 160);
        if (!revision) throw new Error("Git commit completed without a readable revision.");
        const now = new Date();
        const commit = await input.prisma.sourceCommit.upsert({
          where: { repositoryId_revision: { repositoryId, revision } },
          create: { repositoryId, revision, shortRevision: revision.slice(0, 12), message, authorName: user?.preferredName || user?.displayName || user?.username || null, authorEmail: user?.email || null, authoredAt: now, committedAt: now, branchNames: JSON.stringify([workingCopy.branchName]), metadata: JSON.stringify({ local: true, workingCopyId: workingCopy.id }) },
          update: { message, authorName: user?.preferredName || user?.displayName || user?.username || null, authorEmail: user?.email || null, committedAt: now, branchNames: JSON.stringify([workingCopy.branchName]), metadata: JSON.stringify({ local: true, workingCopyId: workingCopy.id }) },
        });
        const committedPaths = Array.isArray(commitResult.committedPaths) ? commitResult.committedPaths.slice(0, 5_000) : [];
        await input.prisma.$transaction(async (tx: any) => {
          await tx.sourceChange.deleteMany({ where: { repositoryId, revision } });
          if (committedPaths.length) await tx.sourceChange.createMany({ data: committedPaths.map((item: any) => ({ repositoryId, commitId: commit.id, revision, path: cleanText(item.path, 2_000), previousPath: optionalText(item.previousPath, 2_000), changeType: changeTypeFromGitStatus(cleanText(item.status, 4)), additions: null, deletions: null, binary: false })) });
          await tx.sourceCommit.update({ where: { id: commit.id }, data: { filesChanged: committedPaths.length } });
          if (links.length) await tx.sourceArtifactLink.createMany({ data: links.map((link) => ({ repositoryId, projectId: workingCopy.projectId, commitId: commit.id, workingCopyId: workingCopy.id, targetType: link.targetType, targetId: link.targetId, linkRole: link.linkRole, metadata: JSON.stringify({ source: "commit" }) })) });
        });
        result = { workingCopy: serializeWorkingCopy(persisted), revision, shortRevision: revision.slice(0, 12), filesChanged: committedPaths.length, links: links.length };
        await recordWorkflowActivity({ projectId: workingCopy.projectId, userId: operation.requestedById, type: "source_commit_created", entityId: commit.id, title: "Source changes committed", message: `${revision.slice(0, 12)} · ${message.split("\n")[0]}`, metadata: { repositoryId, branchName: workingCopy.branchName, revision, filesChanged: committedPaths.length, linkedWork: links.length } });
      } else if (operation.operationType === "push") {
        const binding = await input.prisma.projectSourceBinding.findFirst({ where: { projectId: workingCopy.projectId, repositoryId, archived: false }, include: { branchPolicy: true } });
        if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is no longer linked to this project.", 409);
        const policy = serializePolicy(binding.branchPolicy, binding.defaultBranch || repository.defaultBranch || "main");
        const branchName = cleanBranchName(workingCopy.branchName);
        const providerBranch = await input.prisma.sourceBranch.findUnique({ where: { repositoryId_name: { repositoryId, name: branchName } }, select: { protected: true } });
        if (!policy.allowDirectPush) throw createHttpError("SOURCE_PUSH_POLICY", "Direct push is disabled for this project. Use the studio review workflow instead.", 409);
        if (providerBranch?.protected || branchProtected(policy, branchName, binding.defaultBranch || repository.defaultBranch || "main")) throw createHttpError("SOURCE_PROTECTED_BRANCH", `Direct push to ${branchName} is blocked because the branch is protected.`, 409);
        if (policy.requireLinkedWorkItem) {
          const headCommit = workingCopy.headRevision ? await input.prisma.sourceCommit.findFirst({ where: { repositoryId, revision: workingCopy.headRevision }, select: { id: true } }) : null;
          const linked = await input.prisma.sourceArtifactLink.findFirst({ where: { repositoryId, projectId: workingCopy.projectId, OR: [{ workingCopyId: workingCopy.id }, ...(headCommit ? [{ commitId: headCommit.id }] : [])] }, select: { id: true } });
          if (!linked) throw createHttpError("SOURCE_WORK_LINK_REQUIRED", "Link this change to project work before pushing.", 409);
        }
        await reportOperation(operationId, 20, "Checking remote branch state", reporter);
        const state = await input.gitRuntime.pushWorkingCopy({ workingCopyId: workingCopy.id, branchName, token, providerId: repository.connection?.providerId || null });
        const persisted = await persistWorkingCopyState(workingCopy.id, state);
        const now = new Date();
        await input.prisma.$transaction([
          input.prisma.sourceRepository.update({ where: { id: repositoryId }, data: { lastPushAt: now, healthState: "healthy", healthMessage: "Latest managed push completed successfully." } }),
          input.prisma.sourceBranch.upsert({ where: { repositoryId_name: { repositoryId, name: branchName } }, create: { repositoryId, name: branchName, headRevision: persisted.headRevision, upstreamName: persisted.upstreamName, isDefault: branchName === repository.defaultBranch, protected: false, aheadCount: persisted.aheadCount, behindCount: persisted.behindCount, lastCommitAt: now, lastSyncedAt: now, archived: false }, update: { headRevision: persisted.headRevision, upstreamName: persisted.upstreamName, aheadCount: persisted.aheadCount, behindCount: persisted.behindCount, lastCommitAt: now, lastSyncedAt: now, archived: false } }),
        ]);
        result = { workingCopy: serializeWorkingCopy(persisted), branchName, headRevision: persisted.headRevision, pushedAt: now.toISOString() };
        await recordWorkflowActivity({ projectId: workingCopy.projectId, userId: operation.requestedById, type: "source_branch_pushed", entityId: workingCopy.id, title: "Source branch pushed", message: branchName, metadata: { repositoryId, branchName, headRevision: persisted.headRevision } });
      } else if (operation.operationType === "merge_review") {
        const reviewId = cleanText(metadata.reviewId, 240);
        const review = await input.prisma.sourceReview.findFirst({ where: { id: reviewId, repositoryId, projectId: workingCopy.projectId, status: "open" }, include: { decisions: true } });
        if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Open source review not found.", 404);
        const eligible = await reviewEligibility(review.id, true);
        if (!eligible) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Source review not found.", 404);
        if (eligible.eligibilityState !== "ready") throw createHttpError("SOURCE_REVIEW_BLOCKED", eligible.eligibilityMessage || "Review is not ready to merge.", 409);
        const user = operation.requestedById ? await input.prisma.user.findUnique({ where: { id: operation.requestedById }, select: { username: true, displayName: true, preferredName: true, email: true } }) : null;
        await reportOperation(operationId, 20, "Rechecking review revisions", reporter);
        const mergeResult = await input.gitRuntime.mergeReview({ operationId, repositoryId, repositoryPath, remoteUrl, token, providerId: repository.connection?.providerId || null, sourceBranch: review.sourceBranch, targetBranch: review.targetBranch, expectedSourceRevision: eligible.sourceRevision, expectedTargetRevision: eligible.targetRevision, authorName: user?.preferredName || user?.displayName || user?.username || "Cluster User", authorEmail: user?.email || null, title: review.title });
        const now = new Date();
        await input.prisma.$transaction([
          input.prisma.sourceReview.update({ where: { id: review.id }, data: { status: "merged", eligibilityState: "merged", eligibilityMessage: "Merged successfully.", mergedById: operation.requestedById || null, mergedRevision: mergeResult.mergedRevision, mergedAt: now, closedAt: now } }),
          input.prisma.sourceWorkingCopy.update({ where: { id: workingCopy.id }, data: { archived: true, status: "merged", lastUsedAt: now } }),
        ]);
        await reportOperation(operationId, 75, "Refreshing repository state", reporter);
        const syncResult = await syncRepository(repository, operationId, reporter);
        result = { reviewId: review.id, mergedRevision: mergeResult.mergedRevision, sourceBranch: review.sourceBranch, targetBranch: review.targetBranch, mergedAt: now.toISOString(), synchronized: Boolean(syncResult) };
        await recordWorkflowActivity({ projectId: workingCopy.projectId, userId: operation.requestedById, type: "source_review_merged", entityId: review.id, title: "Source review merged", message: `${review.sourceBranch} → ${review.targetBranch}`, metadata: { repositoryId, reviewId: review.id, mergedRevision: mergeResult.mergedRevision, targetBranch: review.targetBranch, notifyInbox: true, notificationSignal: "release" } });
      } else {
        throw createHttpError("SOURCE_OPERATION_UNSUPPORTED", `Unsupported source-control workflow operation: ${operation.operationType}`, 400);
      }
      await input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "succeeded", progress: 100, progressMessage: "Completed", resultMetadata: JSON.stringify(result), completedAt: new Date(), lastError: null } });
      input.logger?.info?.({ repositoryId, operationId, operationType: operation.operationType }, "source-control workflow completed");
      return result;
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 1_000) || "Source-control operation failed.";
      await input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "failed", attempts: attempt, lastError: message, progressMessage: "Operation failed", completedAt: new Date() } }).catch(() => undefined);
      await input.prisma.sourceWorkingCopy.update({ where: { id: workingCopy.id }, data: { status: workingCopy.status === "preparing" ? "failed" : workingCopy.status, lastScannedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async function executeSyncJob(payload: unknown, attempt: number, reporter?: ProgressReporter) {
    const repositoryId = cleanText((payload as any)?.repositoryId, 240);
    const operationId = cleanText((payload as any)?.operationId, 240);
    if (!repositoryId || !operationId) throw new Error("Source-control sync job requires repositoryId and operationId.");
    const operation = await input.prisma.sourceOperation.findFirst({ where: { id: operationId, repositoryId } });
    if (!operation) throw createHttpError("SOURCE_OPERATION_NOT_FOUND", "Source-control operation not found.", 404);
    const repository = await requireRunnableRepository(repositoryId);
    await input.prisma.$transaction([
      input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "running", attempts: attempt, startedAt: operation.startedAt || new Date(), completedAt: null, lastError: null } }),
      input.prisma.sourceRepository.update({ where: { id: repositoryId }, data: { syncState: "syncing", healthMessage: "Repository synchronization is running." } }),
    ]);
    try {
      const result = await syncRepository(repository, operationId, reporter);
      await input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "succeeded", progress: 100, progressMessage: "Repository synchronized", resultMetadata: JSON.stringify(result), completedAt: new Date(), lastError: null } });
      input.logger?.info?.({ repositoryId, operationId, result }, "source-control repository synchronized");
      return result;
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 1_000) || "Repository synchronization failed.";
      await input.prisma.$transaction([
        input.prisma.sourceOperation.update({ where: { id: operationId }, data: { status: "failed", attempts: attempt, lastError: message, progressMessage: "Synchronization failed", completedAt: new Date() } }),
        input.prisma.sourceRepository.update({ where: { id: repositoryId }, data: { syncState: "failed", healthState: "failed", healthMessage: message } }),
      ]).catch(() => undefined);
      throw error;
    }
  }

  return { state, commitChanges, workflowState, reviewForProject, versionSuggestion, createProjectVersion, reviewEligibility, createReview, setReviewAssignments, setReviewDecision, updateBranchPolicy, ensureWorkingCopy, refreshWorkingCopy, validateArtifactLinks, requireRepository, createOperation, attachBackgroundJob, executeSyncJob, executeWorkflowJob };
}
