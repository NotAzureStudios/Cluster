import { createHttpError } from "../../core/http-errors.js";
import {
  deliveryBuildInputSchema,
  deliveryBuildPatchSchema,
  deliveryQaPlanInputSchema,
  deliveryQaSessionInputSchema,
  deliveryReleaseInputSchema,
  type DeliveryBuildRecord,
  type DeliveryChangeSummary,
  type DeliveryQaPlanRecord,
  type DeliveryQaSessionRecord,
  type DeliveryRecordKind,
  type DeliveryReleaseRecord,
  type DeliverySourceProvenance,
} from "@cluster/shared";

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function parseArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function iso(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanString(value: unknown, fallback = "") { return String(value ?? fallback).trim(); }

function serializeCommit(commit: any) {
  return {
    id: commit.id,
    revision: commit.revision,
    shortRevision: commit.shortRevision || String(commit.revision || "").slice(0, 12),
    message: commit.message || "",
    authorName: commit.authorName || null,
    committedAt: iso(commit.committedAt),
    additions: commit.additions ?? null,
    deletions: commit.deletions ?? null,
    filesChanged: commit.filesChanged ?? null,
  };
}

async function buildChangeSummary(prisma: any, currentCommit: any, previousBuild: any | null): Promise<DeliveryChangeSummary> {
  const previousSnapshot = previousBuild ? parseObject(previousBuild.sourceSnapshot) : {};
  const previousRevision = previousBuild?.sourceRevision || previousSnapshot.revision || null;
  const base: DeliveryChangeSummary = {
    previousBuildId: previousBuild?.id || null,
    previousVersion: previousBuild?.version || null,
    fromRevision: previousRevision,
    toRevision: currentCommit.revision,
    commitCount: 0,
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    commits: [],
  };
  if (!previousRevision || previousBuild?.sourceRepositoryId !== currentCommit.repositoryId) {
    const single = serializeCommit(currentCommit);
    return { ...base, commitCount: 1, additions: Number(currentCommit.additions || 0), deletions: Number(currentCommit.deletions || 0), filesChanged: Number(currentCommit.filesChanged || 0), commits: [single] };
  }
  if (previousRevision === currentCommit.revision) return base;

  const rows = await prisma.sourceCommit.findMany({
    where: { repositoryId: currentCommit.repositoryId },
    select: { id: true, revision: true, shortRevision: true, message: true, authorName: true, committedAt: true, createdAt: true, additions: true, deletions: true, filesChanged: true, parentRevisions: true },
    orderBy: [{ committedAt: "desc" }, { createdAt: "desc" }],
    take: 4000,
  });
  const byRevision = new Map<string, any>(rows.map((row: any) => [String(row.revision), row]));
  const visited = new Set<string>();
  const queue = [currentCommit.revision];
  const commits: any[] = [];
  let reachedPrevious = false;
  while (queue.length && visited.size < 2000) {
    const revision = queue.shift()!;
    if (visited.has(revision)) continue;
    visited.add(revision);
    if (revision === previousRevision) { reachedPrevious = true; continue; }
    const row = byRevision.get(revision);
    if (!row) continue;
    commits.push(row);
    for (const parent of parseArray<string>(row.parentRevisions)) if (!visited.has(parent)) queue.push(parent);
  }
  const selected = reachedPrevious ? commits : commits.filter((row) => {
    const currentAt = new Date(currentCommit.committedAt || currentCommit.createdAt || 0).getTime();
    const previousAt = new Date(previousBuild?.createdAt || 0).getTime();
    const rowAt = new Date(row.committedAt || row.createdAt || 0).getTime();
    return rowAt <= currentAt && rowAt > previousAt;
  });
  selected.sort((a, b) => new Date(a.committedAt || a.createdAt || 0).getTime() - new Date(b.committedAt || b.createdAt || 0).getTime());
  return {
    ...base,
    commitCount: selected.length,
    additions: selected.reduce((sum, row) => sum + Number(row.additions || 0), 0),
    deletions: selected.reduce((sum, row) => sum + Number(row.deletions || 0), 0),
    filesChanged: selected.reduce((sum, row) => sum + Number(row.filesChanged || 0), 0),
    commits: selected.slice(-120).map(serializeCommit),
  };
}

function serializeBuild(row: any): DeliveryBuildRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    version: row.version,
    lane: row.lane,
    platform: row.platform,
    sourceRepositoryId: row.sourceRepositoryId,
    sourceCommitId: row.sourceCommitId,
    sourceReviewId: row.sourceReviewId || null,
    sourceBranch: row.sourceBranch,
    sourceRevision: row.sourceRevision,
    provenance: parseObject(row.sourceSnapshot) as DeliverySourceProvenance,
    previousBuildId: row.previousBuildId || null,
    changes: parseObject(row.changeSummary) as DeliveryChangeSummary,
    artifactUrl: row.artifactUrl || "",
    changelog: row.changelog || "",
    qaStatus: row.qaStatus,
    approval: row.approval,
    channel: row.channel,
    buildNumber: row.buildNumber || "",
    createdBy: row.createdBy || "",
    createdById: row.createdById || null,
    ownerId: row.ownerId || null,
    reviewerIds: parseArray<string>(row.reviewerIds),
    fileSize: row.fileSize || "",
    checksum: row.checksum || "",
    signed: Boolean(row.signed),
    pinned: Boolean(row.pinned),
    promotedAt: iso(row.promotedAt),
    testedPlatforms: parseArray<string>(row.testedPlatforms),
    expiresAt: iso(row.expiresAt),
    platformKey: row.platformKey || "",
    metadata: parseObject(row.metadata) as Record<string, string>,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    revision: Number(row.revision || 1),
  };
}

function serializeQaPlan(row: any): DeliveryQaPlanRecord {
  return {
    id: row.id, projectId: row.projectId, title: row.title, buildId: row.buildId,
    platform: row.platform,
    configuration: row.configuration || "default", suite: row.suite || "general", environment: row.environment || "",
    dueDate: iso(row.dueDate), template: row.template || "custom", owner: row.owner || "", ownerId: row.ownerId || null,
    testerIds: parseArray<string>(row.testerIds), status: row.status, cases: parseArray(row.cases),
    createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, revision: Number(row.revision || 1),
  };
}

function serializeQaSession(row: any): DeliveryQaSessionRecord {
  const build = row.build || {};
  return {
    id: row.id, projectId: row.projectId, buildId: row.buildId, planId: row.planId || null,
    retestOfSessionId: row.retestOfSessionId || null, regressionBaseBuildId: row.regressionBaseBuildId || null,
    build: build.version || "", platform: row.platform || build.platform || "", configuration: row.configuration || "default", suite: row.suite || "general",
    environment: row.environment, scope: row.scope, owner: row.owner || "", ownerId: row.ownerId || null,
    testerIds: parseArray<string>(row.testerIds), status: row.status, decision: row.decision,
    passed: Number(row.passed || 0), failed: Number(row.failed || 0), blocked: Number(row.blocked || 0), skipped: Number(row.skipped || 0),
    notes: row.notes || "", startedAt: iso(row.startedAt)!, completedAt: iso(row.completedAt), signedOffBy: row.signedOffBy || null,
    signedOffById: row.signedOffById || null, signedOffAt: iso(row.signedOffAt), sourceRevision: build.sourceRevision || "",
    sourceRepositoryId: build.sourceRepositoryId || "", sourceReviewId: build.sourceReviewId || null,
    createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, revision: Number(row.revision || 1),
  };
}

function serializeRelease(row: any): DeliveryReleaseRecord {
  const build = row.build || {};
  return {
    id: row.id, projectId: row.projectId, title: row.title, buildId: row.buildId,
    buildVersion: build.version || "", platform: build.platform || "", qaStatus: build.qaStatus || "untested",
    features: parseArray<string>(row.features), fixes: parseArray<string>(row.fixes), knownIssues: parseArray<string>(row.knownIssues),
    body: row.body || "", status: row.status, publishedAt: iso(row.publishedAt), sourceRevision: build.sourceRevision || "",
    sourceRepositoryId: build.sourceRepositoryId || "", sourceReviewId: build.sourceReviewId || null,
    createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, revision: Number(row.revision || 1),
  };
}

export function createProjectDeliveryService(prisma: any) {
  async function ensureProject(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, archived: true } });
    if (!project || project.archived) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    return project;
  }

  async function resolveBuildSource(projectId: string, input: any) {
    const binding = await prisma.projectSourceBinding.findFirst({ where: { projectId, repositoryId: input.sourceRepositoryId, archived: false }, select: { id: true, repository: { select: { id: true, name: true, slug: true, archived: true } } } });
    if (!binding?.repository || binding.repository.archived) throw createHttpError("DELIVERY_SOURCE_REPOSITORY_INVALID", "Select a repository linked to this project.", 409);
    const commit = await prisma.sourceCommit.findUnique({ where: { repositoryId_revision: { repositoryId: input.sourceRepositoryId, revision: input.sourceRevision } }, select: { id: true, repositoryId: true, revision: true, shortRevision: true, message: true, webUrl: true, branchNames: true, parentRevisions: true, committedAt: true, createdAt: true, additions: true, deletions: true, filesChanged: true } });
    if (!commit) throw createHttpError("DELIVERY_SOURCE_REVISION_INVALID", "The selected source revision is not synchronized in Cluster.", 409);
    const branch = await prisma.sourceBranch.findFirst({ where: { repositoryId: input.sourceRepositoryId, name: input.sourceBranch, archived: false }, select: { name: true } });
    if (!branch) throw createHttpError("DELIVERY_SOURCE_BRANCH_INVALID", "The selected source branch is not synchronized in Cluster.", 409);
    const commitBranches = parseArray<string>(commit.branchNames);
    if (commitBranches.length && !commitBranches.includes(input.sourceBranch)) throw createHttpError("DELIVERY_SOURCE_BRANCH_REVISION_MISMATCH", "The selected source revision is not synchronized on the selected branch.", 409);
    let review: any = null;
    if (input.sourceReviewId) {
      review = await prisma.sourceReview.findFirst({ where: { id: input.sourceReviewId, projectId, repositoryId: input.sourceRepositoryId }, select: { id: true, title: true, status: true, sourceBranch: true, targetBranch: true, sourceRevision: true, mergedRevision: true } });
      if (!review) throw createHttpError("DELIVERY_SOURCE_REVIEW_INVALID", "The selected source review does not belong to this project/repository.", 409);
      const allowed = new Set([review.sourceRevision, review.mergedRevision].filter(Boolean));
      if (allowed.size && !allowed.has(input.sourceRevision)) throw createHttpError("DELIVERY_SOURCE_REVIEW_REVISION_MISMATCH", "The build revision must match the selected review source or merged revision.", 409);
    }
    const capturedAt = new Date().toISOString();
    const provenance: DeliverySourceProvenance = {
      repositoryId: binding.repository.id,
      repositoryName: binding.repository.name,
      repositorySlug: binding.repository.slug || null,
      branch: branch.name,
      revision: commit.revision,
      shortRevision: commit.shortRevision || commit.revision.slice(0, 12),
      commitId: commit.id,
      commitMessage: commit.message || "",
      commitUrl: commit.webUrl || null,
      reviewId: review?.id || null,
      reviewTitle: review?.title || null,
      reviewStatus: review?.status || null,
      reviewSourceBranch: review?.sourceBranch || null,
      reviewTargetBranch: review?.targetBranch || null,
      capturedAt,
    };
    return { binding, commit, branch, review, provenance };
  }

  const qaSessionBuildSelect = { version: true, platform: true, sourceRevision: true, sourceRepositoryId: true, sourceReviewId: true } as const;
  const releaseBuildSelect = { version: true, platform: true, qaStatus: true, sourceRevision: true, sourceRepositoryId: true, sourceReviewId: true } as const;

  async function list(projectIds: string[], kind: DeliveryRecordKind, limit?: number) {
    const ids = [...new Set(projectIds.filter(Boolean))];
    if (!ids.length) return [];
    const take = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(5_000, Math.floor(Number(limit)))) : undefined;
    if (kind === "build") return (await prisma.deliveryBuild.findMany({ where: { projectId: { in: ids }, archived: false }, orderBy: { createdAt: "desc" }, ...(take ? { take } : {}) })).map(serializeBuild);
    // QA plans do not serialize any Build fields. Avoid joining the Build table for every row.
    if (kind === "qa-plan") return (await prisma.deliveryQaPlan.findMany({ where: { projectId: { in: ids }, archived: false }, orderBy: { updatedAt: "desc" }, ...(take ? { take } : {}) })).map(serializeQaPlan);
    if (kind === "qa-session") return (await prisma.deliveryQaSession.findMany({ where: { projectId: { in: ids }, archived: false }, select: { id: true, projectId: true, buildId: true, planId: true, retestOfSessionId: true, regressionBaseBuildId: true, platform: true, configuration: true, suite: true, environment: true, scope: true, owner: true, ownerId: true, testerIds: true, status: true, decision: true, passed: true, failed: true, blocked: true, skipped: true, notes: true, startedAt: true, completedAt: true, signedOffBy: true, signedOffById: true, signedOffAt: true, createdAt: true, updatedAt: true, revision: true, build: { select: qaSessionBuildSelect } }, orderBy: { updatedAt: "desc" }, ...(take ? { take } : {}) })).map(serializeQaSession);
    return (await prisma.deliveryRelease.findMany({ where: { projectId: { in: ids }, archived: false }, select: { id: true, projectId: true, title: true, buildId: true, features: true, fixes: true, knownIssues: true, body: true, status: true, publishedAt: true, createdAt: true, updatedAt: true, revision: true, build: { select: releaseBuildSelect } }, orderBy: { updatedAt: "desc" }, ...(take ? { take } : {}) })).map(serializeRelease);
  }

  async function find(projectId: string, kind: DeliveryRecordKind, id: string) {
    // Detail lookups used to materialize the entire project collection and then
    // search it in memory. Fetch the requested row directly instead.
    if (kind === "build") {
      const row = await prisma.deliveryBuild.findFirst({ where: { id, projectId, archived: false } });
      return row ? serializeBuild(row) : null;
    }
    if (kind === "qa-plan") {
      const row = await prisma.deliveryQaPlan.findFirst({ where: { id, projectId, archived: false } });
      return row ? serializeQaPlan(row) : null;
    }
    if (kind === "qa-session") {
      const row = await prisma.deliveryQaSession.findFirst({ where: { id, projectId, archived: false }, select: { id: true, projectId: true, buildId: true, planId: true, retestOfSessionId: true, regressionBaseBuildId: true, platform: true, configuration: true, suite: true, environment: true, scope: true, owner: true, ownerId: true, testerIds: true, status: true, decision: true, passed: true, failed: true, blocked: true, skipped: true, notes: true, startedAt: true, completedAt: true, signedOffBy: true, signedOffById: true, signedOffAt: true, createdAt: true, updatedAt: true, revision: true, build: { select: qaSessionBuildSelect } } });
      return row ? serializeQaSession(row) : null;
    }
    const row = await prisma.deliveryRelease.findFirst({ where: { id, projectId, archived: false }, select: { id: true, projectId: true, title: true, buildId: true, features: true, fixes: true, knownIssues: true, body: true, status: true, publishedAt: true, createdAt: true, updatedAt: true, revision: true, build: { select: releaseBuildSelect } } });
    return row ? serializeRelease(row) : null;
  }

  async function putBuild(projectId: string, id: string, raw: unknown, expectedRevision?: number, actorId?: string | null) {
    await ensureProject(projectId);
    const existing = await prisma.deliveryBuild.findFirst({ where: { id, projectId } });
    if (existing) {
      if (expectedRevision && Number(existing.revision) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This build changed on the server.", 409);
      const patch = deliveryBuildPatchSchema.parse(raw);
      const update: any = { ...patch, reviewerIds: patch.reviewerIds ? JSON.stringify(patch.reviewerIds) : undefined, testedPlatforms: patch.testedPlatforms ? JSON.stringify(patch.testedPlatforms) : undefined, metadata: patch.metadata ? JSON.stringify(patch.metadata) : undefined, promotedAt: patch.promotedAt ? new Date(patch.promotedAt) : patch.promotedAt, expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : patch.expiresAt, revision: { increment: 1 } };
      Object.keys(update).forEach((key) => update[key] === undefined && delete update[key]);
      return serializeBuild(await prisma.deliveryBuild.update({ where: { id }, data: update }));
    }
    const input = deliveryBuildInputSchema.parse(raw);
    const source = await resolveBuildSource(projectId, input);
    const previous = await prisma.deliveryBuild.findFirst({ where: { projectId, platform: input.platform, sourceRepositoryId: input.sourceRepositoryId, sourceBranch: input.sourceBranch, archived: false }, select: { id: true, version: true, sourceSnapshot: true, sourceRevision: true, sourceRepositoryId: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const changes = await buildChangeSummary(prisma, source.commit, previous);
    const row = await prisma.deliveryBuild.create({ data: {
      id, projectId, title: input.title, version: input.version, lane: input.lane, platform: input.platform, channel: input.channel, buildNumber: input.buildNumber || null,
      sourceRepositoryId: input.sourceRepositoryId, sourceCommitId: source.commit.id, sourceReviewId: source.review?.id || null, sourceBranch: input.sourceBranch, sourceRevision: input.sourceRevision,
      sourceSnapshot: JSON.stringify(source.provenance), previousBuildId: previous?.id || null, changeSummary: JSON.stringify(changes), artifactUrl: input.artifactUrl, changelog: input.changelog,
      qaStatus: "untested", approval: "draft", createdBy: input.createdBy || null, createdById: actorId || null, ownerId: input.ownerId || null,
      reviewerIds: JSON.stringify(input.reviewerIds), fileSize: input.fileSize || null, checksum: input.checksum || null, signed: input.signed, pinned: input.pinned,
      promotedAt: input.promotedAt ? new Date(input.promotedAt) : null, testedPlatforms: JSON.stringify(input.testedPlatforms), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      platformKey: input.platformKey || null, metadata: JSON.stringify(input.metadata),
    } });
    return serializeBuild(row);
  }

  async function putQaPlan(projectId: string, id: string, raw: unknown, expectedRevision?: number) {
    await ensureProject(projectId);
    const input = deliveryQaPlanInputSchema.parse(raw);
    const build = await prisma.deliveryBuild.findFirst({ where: { id: input.buildId, projectId, archived: false }, select: { id: true } });
    if (!build) throw createHttpError("DELIVERY_BUILD_NOT_FOUND", "QA plans must target a first-class build in this project.", 409);
    const existing = await prisma.deliveryQaPlan.findFirst({ where: { id, projectId }, select: { id: true, revision: true, buildId: true } });
    if (expectedRevision && existing && Number(existing.revision) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This QA plan changed on the server.", 409);
    if (existing && existing.buildId !== input.buildId) throw createHttpError("DELIVERY_QA_PLAN_BUILD_IMMUTABLE", "A QA plan cannot be moved to a different Build. Create a new plan for different provenance.", 409);
    const data: any = { ...input, buildId: input.buildId, dueDate: input.dueDate ? new Date(input.dueDate) : null, testerIds: JSON.stringify(input.testerIds), cases: JSON.stringify(input.cases) };
    return serializeQaPlan(existing
      ? await prisma.deliveryQaPlan.update({ where: { id }, data: { ...data, revision: { increment: 1 } } })
      : await prisma.deliveryQaPlan.create({ data: { id, projectId, ...data } }));
  }

  async function refreshBuildQaStatus(buildId: string) {
    const sessions = await prisma.deliveryQaSession.findMany({ where: { buildId, archived: false }, select: { status: true, decision: true, failed: true, blocked: true } });
    const next = sessions.some((row: any) => ["failed", "blocked"].includes(row.status) || row.decision === "no-go" || Number(row.failed || 0) > 0 || Number(row.blocked || 0) > 0) ? "failed"
      : sessions.some((row: any) => ["planned", "running"].includes(row.status)) ? "testing"
      : sessions.some((row: any) => row.status === "passed") ? "passed" : "untested";
    await prisma.deliveryBuild.updateMany({ where: { id: buildId, archived: false, NOT: { qaStatus: next } }, data: { qaStatus: next, revision: { increment: 1 } } });
  }

  async function putQaSession(projectId: string, id: string, raw: unknown, expectedRevision?: number) {
    await ensureProject(projectId);
    const input = deliveryQaSessionInputSchema.parse(raw);
    if ((input.status === "passed" || input.decision === "go") && (input.failed > 0 || input.blocked > 0 || input.status !== "passed" || input.decision === "no-go"))
      throw createHttpError("DELIVERY_QA_EVIDENCE_CONFLICT", "Passing QA cannot contain failed or blocked cases, a no-go decision, or an incomplete session.", 409);
    if (input.status === "passed" && input.decision === "no-go")
      throw createHttpError("DELIVERY_QA_EVIDENCE_CONFLICT", "Passing QA cannot have a no-go release decision.", 409);
    const build = await prisma.deliveryBuild.findFirst({ where: { id: input.buildId, projectId, archived: false }, select: { id: true, platform: true } });
    if (!build) throw createHttpError("DELIVERY_BUILD_NOT_FOUND", "QA sessions must target a first-class build in this project.", 409);
    if (input.planId) {
      const plan = await prisma.deliveryQaPlan.findFirst({ where: { id: input.planId, projectId, archived: false }, select: { buildId: true } });
      if (!plan) throw createHttpError("DELIVERY_QA_PLAN_NOT_FOUND", "The linked QA plan does not exist.", 409);
      if (plan.buildId !== input.buildId) throw createHttpError("DELIVERY_QA_PLAN_BUILD_MISMATCH", "A QA session must use the same Build as its QA plan.", 409);
    }
    if (input.retestOfSessionId === id) throw createHttpError("DELIVERY_QA_RETEST_INVALID", "A QA session cannot retest itself.", 409);
    if (input.retestOfSessionId) {
      const parent = await prisma.deliveryQaSession.findFirst({ where: { id: input.retestOfSessionId, projectId, archived: false }, select: { buildId: true } });
      if (!parent) throw createHttpError("DELIVERY_QA_RETEST_INVALID", "The retest parent session does not exist.", 409);
      if (parent.buildId !== input.buildId) throw createHttpError("DELIVERY_QA_RETEST_BUILD_MISMATCH", "A retest must stay on the same Build. Use regression baseline lineage when comparing Builds.", 409);
    }
    if (input.regressionBaseBuildId) {
      if (input.regressionBaseBuildId === input.buildId) throw createHttpError("DELIVERY_QA_REGRESSION_BASE_INVALID", "The regression baseline must be a different Build.", 409);
      if (!(await prisma.deliveryBuild.findFirst({ where: { id: input.regressionBaseBuildId, projectId, archived: false }, select: { id: true } }))) throw createHttpError("DELIVERY_QA_REGRESSION_BASE_INVALID", "The regression baseline build does not exist.", 409);
    }
    const existing = await prisma.deliveryQaSession.findFirst({ where: { id, projectId }, select: { id: true, revision: true, buildId: true, planId: true, retestOfSessionId: true, regressionBaseBuildId: true } });
    if (expectedRevision && existing && Number(existing.revision) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This QA session changed on the server.", 409);
    if (existing && existing.buildId !== input.buildId) throw createHttpError("DELIVERY_QA_BUILD_IMMUTABLE", "A QA session cannot be moved to a different build. Start a retest instead.", 409);
    if (existing && (existing.planId || null) !== (input.planId || null)) throw createHttpError("DELIVERY_QA_LINEAGE_IMMUTABLE", "A QA session plan link is immutable. Start a new session instead.", 409);
    if (existing && (existing.retestOfSessionId || null) !== (input.retestOfSessionId || null)) throw createHttpError("DELIVERY_QA_LINEAGE_IMMUTABLE", "QA retest lineage is immutable. Start a new session instead.", 409);
    if (existing && (existing.regressionBaseBuildId || null) !== (input.regressionBaseBuildId || null)) throw createHttpError("DELIVERY_QA_LINEAGE_IMMUTABLE", "QA regression baseline lineage is immutable. Start a new session instead.", 409);
    const data: any = { ...input, planId: input.planId || null, retestOfSessionId: input.retestOfSessionId || null, regressionBaseBuildId: input.regressionBaseBuildId || null, platform: input.platform || build.platform, testerIds: JSON.stringify(input.testerIds), startedAt: new Date(input.startedAt), completedAt: input.completedAt ? new Date(input.completedAt) : null, signedOffAt: input.signedOffAt ? new Date(input.signedOffAt) : null };
    const row = existing
      ? await prisma.deliveryQaSession.update({ where: { id }, data: { ...data, revision: { increment: 1 } }, include: { build: { select: qaSessionBuildSelect } } })
      : await prisma.deliveryQaSession.create({ data: { id, projectId, ...data }, include: { build: { select: qaSessionBuildSelect } } });
    await refreshBuildQaStatus(build.id);
    return serializeQaSession(row);
  }

  async function putRelease(projectId: string, id: string, raw: unknown, expectedRevision?: number) {
    await ensureProject(projectId);
    const input = deliveryReleaseInputSchema.parse(raw);
    const build = await prisma.deliveryBuild.findFirst({ where: { id: input.buildId, projectId, archived: false }, select: { id: true, qaStatus: true, approval: true } });
    if (!build) throw createHttpError("DELIVERY_BUILD_NOT_FOUND", "Releases must target a first-class build in this project.", 409);
    if (input.status === "published") {
      if (build.qaStatus !== "passed") throw createHttpError("DELIVERY_RELEASE_QA_BLOCKED", "The build must pass QA before publishing a release.", 409);
      if (build.approval !== "approved") throw createHttpError("DELIVERY_RELEASE_APPROVAL_BLOCKED", "The build must be approved before publishing a release.", 409);
      const blocker = await prisma.deliveryQaSession.findFirst({ where: { buildId: build.id, archived: false, OR: [{ status: { in: ["failed", "blocked"] } }, { decision: "no-go" }, { failed: { gt: 0 } }, { blocked: { gt: 0 } }] }, select: { id: true } });
      if (blocker) throw createHttpError("DELIVERY_RELEASE_QA_BLOCKED", "A failed or no-go QA session still blocks this release.", 409);
      // A release cannot bypass the linked Board fixes, Whiteboard/QA handoff history,
      // regression rebuilds, reviewer decisions, project holds, or channel-specific gates.
      // Load on publication only; regular edit/list paths keep their lightweight behavior.
      const { createProjectDeliveryLifecycleService } = await import("./project-delivery-lifecycle-service.js");
      const readiness = await createProjectDeliveryLifecycleService(prisma).snapshot(projectId, input.buildId);
      if (!readiness || readiness.latestBuild?.id !== input.buildId || !readiness.releaseReady) {
        const blockers = (readiness?.readiness?.gates || []).filter((gate: any) => gate.required && !gate.passed);
        const summary = blockers.slice(0, 4).map((gate: any) => gate.label).join(", ");
        throw createHttpError("DELIVERY_RELEASE_GATES_BLOCKED", summary
          ? `Resolve required delivery gates before publication: ${summary}.`
          : "The target build is missing or its delivery readiness could not be verified.", 409);
      }
    }
    const existing = await prisma.deliveryRelease.findFirst({ where: { id, projectId }, select: { id: true, revision: true, status: true, buildId: true } });
    if (expectedRevision && existing && Number(existing.revision) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This release changed on the server.", 409);
    if (!existing && input.status !== "draft") throw createHttpError("DELIVERY_RELEASE_REVIEW_REQUIRED", "Create a release as a draft before sending it to review or publishing it.", 409);
    if (existing?.status === "published") throw createHttpError("DELIVERY_RELEASE_IMMUTABLE", "Published releases are immutable. Create a new release record for a correction or superseding release.", 409);
    if (existing && existing.buildId !== input.buildId) throw createHttpError("DELIVERY_RELEASE_BUILD_IMMUTABLE", "A release cannot be moved to another build. Create a new release for different provenance.", 409);
    if (existing?.status === "draft" && input.status === "published") throw createHttpError("DELIVERY_RELEASE_REVIEW_REQUIRED", "Send the release to review before publishing it.", 409);
    const data: any = { ...input, features: JSON.stringify(input.features), fixes: JSON.stringify(input.fixes), knownIssues: JSON.stringify(input.knownIssues), publishedAt: input.status === "published" ? new Date() : null };
    const row = existing
      ? await prisma.deliveryRelease.update({ where: { id }, data: { ...data, revision: { increment: 1 } }, include: { build: { select: releaseBuildSelect } } })
      : await prisma.deliveryRelease.create({ data: { id, projectId, ...data }, include: { build: { select: releaseBuildSelect } } });
    return serializeRelease(row);
  }

  async function put(projectId: string, kind: DeliveryRecordKind, id: string, raw: unknown, expectedRevision?: number, actorId?: string | null) {
    if (kind === "build") return putBuild(projectId, id, raw, expectedRevision, actorId);
    if (kind === "qa-plan") return putQaPlan(projectId, id, raw, expectedRevision);
    if (kind === "qa-session") return putQaSession(projectId, id, raw, expectedRevision);
    return putRelease(projectId, id, raw, expectedRevision);
  }

  async function archive(projectId: string, kind: DeliveryRecordKind, id: string, expectedRevision?: number) {
    const model = kind === "build" ? prisma.deliveryBuild : kind === "qa-plan" ? prisma.deliveryQaPlan : kind === "qa-session" ? prisma.deliveryQaSession : prisma.deliveryRelease;
    const existing = await model.findFirst({ where: { id, projectId } });
    if (!existing || existing.archived) return { ok: true, archived: true, revision: existing?.revision || null };
    if (expectedRevision && Number(existing.revision) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This delivery record changed on the server.", 409);
    if (kind === "build") {
      const [qaCount, releaseCount] = await Promise.all([
        prisma.deliveryQaSession.count({ where: { buildId: id, archived: false } }),
        prisma.deliveryRelease.count({ where: { buildId: id, archived: false } }),
      ]);
      if (qaCount || releaseCount) throw createHttpError("DELIVERY_BUILD_IN_USE", "Archive linked QA sessions/releases before removing this build.", 409);
    }
    if (kind === "qa-plan" && await prisma.deliveryQaSession.count({ where: { planId: id, archived: false } })) throw createHttpError("DELIVERY_QA_PLAN_IN_USE", "This QA plan still has active sessions.", 409);
    if (kind === "qa-session" && await prisma.deliveryQaSession.count({ where: { retestOfSessionId: id, archived: false } })) throw createHttpError("DELIVERY_QA_SESSION_IN_USE", "This QA session has retest descendants.", 409);
    const row = await model.update({ where: { id }, data: { archived: true, revision: { increment: 1 } } });
    if (kind === "qa-session") await refreshBuildQaStatus(existing.buildId);
    return { ok: true, archived: true, revision: row.revision };
  }

  return { list, find, put, archive, serializeBuild, serializeQaPlan, serializeQaSession, serializeRelease };
}
