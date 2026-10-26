import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import { createHttpError } from "../../core/http-errors.js";
import type { SourceProviderService } from "./source-provider-service.js";
import { createExternalEntityLinkService } from "../integrations/external-entity-link-service.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";

type ArtifactLinkInput = { targetType: string; targetId: string; linkRole?: string | null };

type SourceControlService = {
  state: (repositoryId: string) => Promise<any>;
  commitChanges: (repositoryId: string, commitId: string) => Promise<any>;
  reviewForProject: (projectId: string, repositoryId: string, reviewId: string) => Promise<any | null>;
  workflowState: (repositoryId: string, projectId: string, ownerUserId: string | null, bindingId: string) => Promise<any>;
  createProjectVersion: (projectId: string, repositoryId: string, requestedById: string | null, bumpOverride?: "auto" | "major" | "minor" | "patch") => Promise<any>;
  createReview: (input: { projectId: string; repositoryId: string; workingCopyId: string; createdById: string | null; title: string; description?: string | null; targetBranch: string; reviewerIds?: string[]; reviewerTeamIds?: string[] }) => Promise<any>;
  setReviewAssignments: (reviewId: string, projectId: string, actorUserId: string | null, reviewerIds: string[], reviewerTeamIds: string[]) => Promise<any>;
  reviewEligibility: (reviewId: string, refreshSnapshots?: boolean) => Promise<any>;
  setReviewDecision: (reviewId: string, projectId: string, userId: string, decision: "approved" | "changes_requested" | "commented", comment?: string | null) => Promise<any>;
  updateBranchPolicy: (bindingId: string, defaultBranch: string, input: { protectedPatterns?: string[]; branchPrefixes?: string[]; allowDirectPush?: boolean; requireLinkedWorkItem?: boolean; requiredApprovals?: number; requireQa?: boolean; requireBuild?: boolean }) => Promise<any>;
  ensureWorkingCopy: (input: { repositoryId: string; projectId: string; ownerUserId: string | null; branchName: string; baseBranch: string; createBranch: boolean }) => Promise<any>;
  refreshWorkingCopy: (workingCopyId: string, projectId: string, ownerUserId: string | null) => Promise<any>;
  validateArtifactLinks: (projectId: string, links: ArtifactLinkInput[]) => Promise<ArtifactLinkInput[]>;
  requireRepository: (repositoryId: string) => Promise<any>;
  createOperation: (repositoryId: string, input: { operationType: "sync" | "fetch" | "clone" | "workspace_prepare" | "branch_create" | "commit" | "push" | "merge_review"; requestedById?: string | null; workingCopyId?: string | null; branchName?: string | null; targetBranch?: string | null; requestKey?: string | null; inputMetadata?: Record<string, unknown> }) => Promise<{ repository: any; operation: any; reused?: boolean }>;
  attachBackgroundJob: (operationId: string, backgroundJobId: string) => Promise<any>;
};

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  queue: BackgroundJobQueue;
  sourceControl: SourceControlService;
  sourceProvider: SourceProviderService;
  authorization: {
    requireTool: (request: FastifyRequest, reply: FastifyReply, tool: string, minimum?: string) => Promise<any | null>;
    requireCard: (request: FastifyRequest, reply: FastifyReply, cardId: string, minimum?: string) => Promise<boolean>;
    identityForRequest: (request: FastifyRequest) => Promise<{ user: any | null; decorated: any | null; role: string | null }>;
    hasTargetAccess: (user: any, role: string | null | undefined, targetKind: string, targetId: string, project: any, rules: any[], min?: string) => boolean;
    authorize: (actor: any, action: string, resource: any, context?: any) => Promise<any>;
  };
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: any) => Promise<void>;
};

const workspaceBody = z.object({
  branchName: z.string().trim().min(1).max(200),
  baseBranch: z.string().trim().min(1).max(200).optional(),
  createBranch: z.boolean().default(false),
});

const linkBody = z.object({
  targetType: z.enum(["card", "ticket", "timeline", "control", "project_version", "build", "qa_plan", "qa_session", "release"]),
  targetId: z.string().trim().min(1).max(240),
  linkRole: z.string().trim().min(1).max(80).optional(),
});

const commitBody = z.object({
  message: z.string().trim().min(1).max(8_000),
  links: z.array(linkBody).max(12).default([]),
});

const versionBody = z.object({
  bump: z.enum(["auto", "major", "minor", "patch"]).default("auto"),
});

const policyBody = z.object({
  protectedPatterns: z.array(z.string().trim().min(1).max(200)).max(32).default([]),
  branchPrefixes: z.array(z.string().trim().min(1).max(80)).max(32).default(["feature/", "fix/", "hotfix/", "release/"]),
  allowDirectPush: z.boolean().default(true),
  requireLinkedWorkItem: z.boolean().default(false),
  requiredApprovals: z.number().int().min(0).max(12).default(1),
  requireQa: z.boolean().default(false),
  requireBuild: z.boolean().default(false),
});

const reviewBody = z.object({
  workingCopyId: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(8_000).optional().nullable(),
  targetBranch: z.string().trim().min(1).max(200),
  reviewerIds: z.array(z.string().trim().min(1).max(240)).max(50).optional().default([]),
  reviewerTeamIds: z.array(z.string().trim().min(1).max(240)).max(25).optional().default([]),
});

const reviewDecisionBody = z.object({
  decision: z.enum(["approved", "changes_requested", "commented"]),
  comment: z.string().trim().max(4_000).optional().nullable(),
}).superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.comment?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "Explain the changes requested." });
  }
});


const sourceIssueStateBody = z.object({ state: z.enum(["open", "closed"]) });
const sourceIssueLinkBody = z.object({ issueId: z.union([z.string().trim().min(1).max(240), z.number().int().positive()]) });
const sourceIssueCreateBody = z.object({ extraBody: z.string().trim().max(12_000).optional().nullable() });
const sourceIssueCommentBody = z.object({ body: z.string().trim().min(1).max(8_000) });

function sourceIssueMetadata(issue: any, repository: any) {
  return {
    repositoryId: repository.id,
    providerId: repository.connection?.providerId || null,
    number: issue.number ?? null,
    title: issue.title || "",
    state: issue.state || "open",
    labels: Array.isArray(issue.labels) ? issue.labels : [],
    assignee: issue.assignee || null,
    updatedAt: issue.updatedAt || null,
  };
}

function requireSourceIssueProvider(repository: any) {
  const connection = repository?.connection || null;
  if (!connection) {
    throw createHttpError(
      "SOURCE_ISSUE_PROVIDER_UNAVAILABLE",
      "This repository is managed by Cluster and has no external issue provider configured. Configure an optional Source Control remote/provider to use external issue linking.",
      409,
    );
  }
  return connection;
}

async function cardSourceContext(deps: Dependencies, request: FastifyRequest, reply: FastifyReply, cardId: string, minimum: "view" | "contribute" | "manage") {
  if (!(await deps.authorization.requireCard(request, reply, cardId, minimum))) return null;
  const card = await deps.prisma.card.findUnique({
    where: { id: cardId },
    include: {
      list: { include: { board: { include: { project: { include: { sourceBindings: { where: { archived: false }, include: { repository: { include: { connection: true } } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } } } } } },
    },
  });
  if (!card) throw createHttpError("CARD_NOT_FOUND", "Card not found.", 404);
  const project = card.list?.board?.project;
  const binding = project?.sourceBindings?.[0] || null;
  if (!project || !binding?.repository) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository to this project first.", 409);
  return { card, project, binding, repository: binding.repository };
}

function requestKey(request: FastifyRequest, operationType: string) {
  const value = String(request.headers["x-idempotency-key"] || "").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 180);
  return value ? `${operationType}:${value}` : null;
}

async function projectSourceContext(deps: Dependencies, request: FastifyRequest, reply: FastifyReply, projectId: string, minimum: "view" | "contribute" | "manage") {
  const project = await deps.prisma.project.findUnique({
    where: { id: projectId },
    include: {
      sourceBindings: {
        where: { archived: false },
        include: { repository: { include: { connection: true } }, branchPolicy: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  if (!(await deps.enforceTargetAccess(request, reply, "project", project.id, project, minimum))) return null;
  return { project, binding: project.sourceBindings[0] || null };
}

async function queueSync(deps: Dependencies, repositoryId: string, workspaceId: string, userId?: string | null, authorization?: { action: "contribute" | "manage"; resource: { kind: "project"; projectId: string } | { kind: "tool"; tool: string }; minimum: "contribute" | "manage"; tool?: string }) {
  const active = await deps.prisma.sourceOperation.findFirst({
    where: { repositoryId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { operation: active, jobId: active.backgroundJobId || null, reused: true };
  const { operation } = await deps.sourceControl.createOperation(repositoryId, { operationType: "fetch", requestedById: userId || null });
  try {
    const job = await deps.queue.enqueue({
      type: "source.repository-sync",
      workspaceId,
      createdById: userId || null,
      priority: 15,
      costUnits: 2,
      maxAttempts: 5,
      dedupeKey: `repository-sync:${repositoryId}`,
      authorization: authorization && userId ? { actorUserId: userId, ...authorization } : null,
      payload: { repositoryId, operationId: operation.id },
    });
    await deps.sourceControl.attachBackgroundJob(operation.id, job.id);
    return { operation: { ...operation, backgroundJobId: job.id }, jobId: job.id };
  } catch (error) {
    await deps.prisma.sourceOperation.update({
      where: { id: operation.id },
      data: { status: "failed", lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unable to queue repository synchronization.", completedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}

async function queueWorkflow(deps: Dependencies, input: { repositoryId: string; workspaceId: string; projectId: string; workingCopyId: string; operationType: "workspace_prepare" | "branch_create" | "commit" | "push" | "merge_review"; userId?: string | null; branchName?: string | null; requestKey?: string | null; inputMetadata?: Record<string, unknown> }) {
  const active = await deps.prisma.sourceOperation.findFirst({ where: { workingCopyId: input.workingCopyId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
  if (active) return { operation: active, jobId: active.backgroundJobId || null, reused: true };
  const created = await deps.sourceControl.createOperation(input.repositoryId, {
    operationType: input.operationType,
    requestedById: input.userId || null,
    workingCopyId: input.workingCopyId,
    branchName: input.branchName || null,
    requestKey: input.requestKey || null,
    inputMetadata: input.inputMetadata || {},
  });
  if (created.reused && created.operation.backgroundJobId) return { operation: created.operation, jobId: created.operation.backgroundJobId, reused: true };
  try {
    const job = await deps.queue.enqueue({
      type: "source.workflow",
      workspaceId: input.workspaceId,
      createdById: input.userId || null,
      priority: input.operationType === "merge_review" ? 10 : input.operationType === "push" ? 12 : 14,
      costUnits: input.operationType === "merge_review" ? 4 : input.operationType === "push" ? 2 : 3,
      maxAttempts: input.operationType === "workspace_prepare" ? 3 : 1,
      dedupeKey: `source-workflow:${created.operation.id}`,
      authorization: input.userId ? {
        actorUserId: input.userId,
        action: input.operationType === "merge_review" ? "manage" : "contribute",
        resource: { kind: "project", projectId: input.projectId },
        minimum: input.operationType === "merge_review" ? "manage" : "contribute",
        tool: "sourceControl",
      } : null,
      payload: { repositoryId: input.repositoryId, operationId: created.operation.id },
    });
    await deps.sourceControl.attachBackgroundJob(created.operation.id, job.id);
    return { operation: { ...created.operation, backgroundJobId: job.id }, jobId: job.id, reused: Boolean(created.reused) };
  } catch (error) {
    await deps.prisma.sourceOperation.update({ where: { id: created.operation.id }, data: { status: "failed", lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unable to queue source-control operation.", completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}

export function registerSourceControlRoutes(deps: Dependencies) {
  const externalLinks = createExternalEntityLinkService(deps.prisma);

  async function linkedSourceIssue(cardId: string, repositoryId: string) {
    const links = await externalLinks.listForEntity("card", cardId);
    return links.find((link: any) => link.providerEntityType === "source_issue" && String(link.metadata?.repositoryId || "") === repositoryId) || null;
  }

  async function storeSourceIssue(context: any, issue: any) {
    const connection = requireSourceIssueProvider(context.repository);
    const link = await externalLinks.replaceProviderEntity({
      workspaceId: context.project.workspaceId,
      projectId: context.project.id,
      connectionId: connection.id,
      entityType: "card",
      entityId: context.card.id,
      providerEntityType: "source_issue",
      providerEntityId: String(issue.id || issue.number),
      providerUrl: issue.url || null,
      metadata: sourceIssueMetadata(issue, context.repository),
    });
    return { link, issue };
  }

  deps.app.get("/api/projects/:projectId/source-control/issues", async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const query = z.object({ state: z.enum(["all", "open", "closed"]).default("all") }).parse(request.query || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    if (!context.binding?.repository) return { ok: true, repositoryId: null, providerAvailable: false, providerId: null, issues: [] };
    const connection = context.binding.repository.connection || null;
    if (!connection) return { ok: true, repositoryId: context.binding.repositoryId, providerAvailable: false, providerId: null, issues: [] };
    return { ok: true, repositoryId: context.binding.repositoryId, providerAvailable: true, providerId: connection.providerId, issues: await deps.sourceProvider.listIssues(context.binding.repository, query.state) };
  });

  deps.app.get("/api/cards/:cardId/source-issue", async (request, reply) => {
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const context = await cardSourceContext(deps, request, reply, cardId, "view");
    if (!context) return;
    const link = await linkedSourceIssue(cardId, context.repository.id);
    return { ok: true, repositoryId: context.repository.id, providerAvailable: Boolean(context.repository.connection), providerId: context.repository.connection?.providerId || null, link };
  });

  deps.app.post("/api/cards/:cardId/source-issue/link", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const body = sourceIssueLinkBody.parse(request.body || {});
    const context = await cardSourceContext(deps, request, reply, cardId, "contribute");
    if (!context) return;
    const connection = requireSourceIssueProvider(context.repository);
    const issue = await deps.sourceProvider.getIssue(context.repository, body.issueId);
    const result = await storeSourceIssue(context, issue);
    const message = `Linked Source Control issue ${issue.number ? `#${issue.number}` : issue.id}`;
    await deps.prisma.cardActivity.create({ data: { cardId, type: "source_linked", message } });
    await deps.logActivity({ userId: user?.id || null, projectId: context.project.id, type: "source_issue_linked", entityType: "card", entityId: cardId, title: "Source Control issue linked", message, metadata: { repositoryId: context.repository.id, providerId: connection.providerId, providerEntityId: String(issue.id || issue.number) } });
    return { ok: true, ...result, actorId: user?.id || null };
  });

  deps.app.post("/api/cards/:cardId/source-issue/create", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const body = sourceIssueCreateBody.parse(request.body || {});
    const context = await cardSourceContext(deps, request, reply, cardId, "contribute");
    if (!context) return;
    const connection = requireSourceIssueProvider(context.repository);
    const issueBody = [context.card.description || "", body.extraBody || ""].filter(Boolean).join("\n\n");
    const issue = await deps.sourceProvider.createIssue(context.repository, { title: context.card.title, body: issueBody });
    const result = await storeSourceIssue(context, issue);
    const message = `Created Source Control issue ${issue.number ? `#${issue.number}` : issue.id}`;
    await deps.prisma.cardActivity.create({ data: { cardId, type: "source_created", message } });
    await deps.logActivity({ userId: user?.id || null, projectId: context.project.id, type: "source_issue_created", entityType: "card", entityId: cardId, title: "Source Control issue created", message, metadata: { repositoryId: context.repository.id, providerId: connection.providerId, providerEntityId: String(issue.id || issue.number) } });
    return reply.code(201).send({ ok: true, ...result, actorId: user?.id || null });
  });

  deps.app.post("/api/cards/:cardId/source-issue/sync", async (request, reply) => {
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const context = await cardSourceContext(deps, request, reply, cardId, "view");
    if (!context) return;
    requireSourceIssueProvider(context.repository);
    const existing = await linkedSourceIssue(cardId, context.repository.id);
    if (!existing) throw createHttpError("SOURCE_ISSUE_NOT_LINKED", "No Source Control issue is linked to this card.", 409);
    const issue = await deps.sourceProvider.getIssue(context.repository, existing.providerEntityId);
    return { ok: true, ...(await storeSourceIssue(context, issue)) };
  });

  deps.app.post("/api/cards/:cardId/source-issue/state", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const body = sourceIssueStateBody.parse(request.body || {});
    const context = await cardSourceContext(deps, request, reply, cardId, "contribute");
    if (!context) return;
    const connection = requireSourceIssueProvider(context.repository);
    const existing = await linkedSourceIssue(cardId, context.repository.id);
    if (!existing) throw createHttpError("SOURCE_ISSUE_NOT_LINKED", "No Source Control issue is linked to this card.", 409);
    const issue = await deps.sourceProvider.setIssueState(context.repository, existing.providerEntityId, body.state);
    const result = await storeSourceIssue(context, issue);
    await deps.logActivity({ userId: user?.id || null, projectId: context.project.id, type: "source_issue_state_changed", entityType: "card", entityId: cardId, title: `Source Control issue ${body.state === "closed" ? "closed" : "reopened"}`, message: issue.title || context.card.title, metadata: { repositoryId: context.repository.id, providerId: connection.providerId, providerEntityId: existing.providerEntityId, state: body.state } });
    return { ok: true, ...result };
  });

  deps.app.post("/api/cards/:cardId/source-issue/comment", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const body = sourceIssueCommentBody.parse(request.body || {});
    const context = await cardSourceContext(deps, request, reply, cardId, "contribute");
    if (!context) return;
    const connection = requireSourceIssueProvider(context.repository);
    const existing = await linkedSourceIssue(cardId, context.repository.id);
    if (!existing) throw createHttpError("SOURCE_ISSUE_NOT_LINKED", "No Source Control issue is linked to this card.", 409);
    await deps.sourceProvider.commentIssue(context.repository, existing.providerEntityId, body.body);
    await deps.logActivity({ userId: user?.id || null, projectId: context.project.id, type: "source_issue_commented", entityType: "card", entityId: cardId, title: "Source Control issue comment posted", message: context.card.title, metadata: { repositoryId: context.repository.id, providerId: connection.providerId, providerEntityId: existing.providerEntityId } });
    return { ok: true };
  });

  deps.app.delete("/api/cards/:cardId/source-issue", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(request.params);
    const context = await cardSourceContext(deps, request, reply, cardId, "contribute");
    if (!context) return;
    await externalLinks.removeProviderEntity(context.project.workspaceId, "card", cardId, "source_issue");
    await deps.logActivity({ userId: user?.id || null, projectId: context.project.id, type: "source_issue_unlinked", entityType: "card", entityId: cardId, title: "Source Control issue unlinked", message: context.card.title, metadata: { repositoryId: context.repository.id, providerId: context.repository.connection?.providerId || null } });
    return { ok: true };
  });
  deps.app.get("/api/admin/source-control/repositories/:repositoryId/state", async (request, reply) => {
    const viewer = await deps.authorization.requireTool(request, reply, "sourceControl", "view");
    if (!viewer) return;
    const { repositoryId } = z.object({ repositoryId: z.string().min(1) }).parse(request.params);
    return { ok: true, ...(await deps.sourceControl.state(repositoryId)) };
  });

  deps.app.post("/api/admin/source-control/repositories/:repositoryId/sync", async (request, reply) => {
    const admin = await deps.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const { repositoryId } = z.object({ repositoryId: z.string().min(1) }).parse(request.params);
    const repository = await deps.sourceControl.requireRepository(repositoryId);
    const queued = await queueSync(deps, repositoryId, repository.workspaceId, admin.id || null, { action: "manage", resource: { kind: "tool", tool: "sourceControl" }, minimum: "manage" });
    return reply.code(202).send({ ok: true, ...queued });
  });

  deps.app.get("/api/source-control/review-queue", async (request, reply) => {
    if (!(await deps.authorization.requireTool(request, reply, "sourceControl", "view"))) return;
    const identity = await deps.authorization.identityForRequest(request);
    if (!identity.user) throw createHttpError("AUTH_REQUIRED", "Sign in to view source reviews.", 401);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40), assignedOnly: z.coerce.boolean().optional().default(false) }).parse(request.query || {});
    const reviews = await deps.prisma.sourceReview.findMany({
      where: { status: "open" },
      select: {
        id: true, projectId: true, repositoryId: true, title: true, status: true, eligibilityState: true, eligibilityMessage: true,
        sourceBranch: true, targetBranch: true, sourceRevision: true, createdById: true, reviewerIds: true, reviewerTeamIds: true, updatedAt: true,
        project: { select: { id: true, name: true, source: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true, status: true, startsAt: true, endsAt: true } } } },
        repository: { select: { id: true, name: true } },
        decisions: { select: { userId: true, decision: true, updatedAt: true }, orderBy: { updatedAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(200, query.limit * 3),
    });
    const currentTeamIds = new Set((await deps.prisma.studioTeamMember.findMany({ where: { userId: identity.user.id, archived: false }, select: { teamId: true } }).catch(() => [])).map((row: any) => String(row.teamId)));
    const projectIds = Array.from(new Set(reviews.map((review: any) => review.projectId).filter(Boolean)));
    const rules = projectIds.length ? await deps.prisma.accessRule.findMany({
      where: { status: "active", targetKind: "project", targetId: { in: projectIds } },
      select: AUTHORIZATION_RULE_SELECT,
    }) : [];
    const visible: any[] = [];
    for (const review of reviews) {
      const decision = await deps.authorization.authorize(
        { user: identity.user, decorated: identity.decorated, role: identity.role },
        "view",
        { kind: "project", project: review.project },
        { minimum: "view", rules: rules.filter((rule: any) => rule.targetId === review.projectId), surface: "api", tool: "sourceControl" },
      );
      if (decision.allowed) {
        const direct = (() => { try { return JSON.parse(review.reviewerIds || "[]"); } catch { return []; } })() as string[];
        const teams = (() => { try { return JSON.parse(review.reviewerTeamIds || "[]"); } catch { return []; } })() as string[];
        const requestedForMe = direct.includes(identity.user.id) || teams.some((teamId) => currentTeamIds.has(String(teamId)));
        if (!query.assignedOnly || requestedForMe) visible.push({ ...review, requestedForMe });
      }
      if (visible.length >= query.limit) break;
    }
    const payload = {
      ok: true,
      reviews: visible.map((review: any) => ({
        id: review.id,
        projectId: review.projectId,
        projectName: review.project?.name || "Project",
        repositoryId: review.repositoryId,
        repositoryName: review.repository?.name || "Repository",
        title: review.title,
        status: review.status,
        eligibilityState: review.eligibilityState || "pending",
        eligibilityMessage: review.eligibilityMessage || null,
        sourceBranch: review.sourceBranch,
        targetBranch: review.targetBranch,
        sourceRevision: review.sourceRevision || null,
        createdById: review.createdById || null,
        reviewerIds: (() => { try { return JSON.parse(review.reviewerIds || "[]"); } catch { return []; } })(),
        reviewerTeamIds: (() => { try { return JSON.parse(review.reviewerTeamIds || "[]"); } catch { return []; } })(),
        requestedForMe: Boolean(review.requestedForMe),
        myDecision: review.decisions.find((decision: any) => decision.userId === identity.user.id)?.decision || null,
        approvals: review.decisions.filter((decision: any) => decision.decision === "approved").length,
        changesRequested: review.decisions.filter((decision: any) => decision.decision === "changes_requested").length,
        updatedAt: review.updatedAt,
      })),
    };
    return sendPrivateRevalidated(request, reply, payload);
  });

  // The legacy cluster://repo/<repositoryId>/commit/<revision> protocol
  // intentionally contains no Project identity. Resolve through active linked
  // Projects, never by guessing a renderer route or trusting the URI as access.
  deps.app.get("/api/source-control/resolve-commit", async (request, reply) => {
    if (!(await deps.authorization.requireTool(request, reply, "sourceControl", "view"))) return;
    const identity = await deps.authorization.identityForRequest(request);
    if (!identity.user) throw createHttpError("AUTH_REQUIRED", "Sign in to open source revisions.", 401);
    const { repositoryId, revision } = z.object({
      repositoryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
      revision: z.string().regex(/^[a-fA-F0-9]{7,64}$/),
    }).parse(request.query || {});
    const bindings = await deps.prisma.projectSourceBinding.findMany({
      where: { repositoryId, archived: false, repository: { is: { archived: false } } },
      select: {
        projectId: true,
        project: {
          select: {
            id: true, name: true, source: true,
            memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true, status: true, startsAt: true, endsAt: true } },
            sourceBindings: { where: { archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { repositoryId: true }, take: 1 },
          },
        },
      },
      take: 50,
    });
    // The Source workspace only loads the Project's primary repository.
    // A secondary binding must not resolve to a panel showing another repo.
    const candidates = bindings.filter((binding: any) => binding.project?.sourceBindings?.[0]?.repositoryId === repositoryId);
    const projectIds = candidates.map((binding: any) => binding.projectId);
    const rules = projectIds.length ? await deps.prisma.accessRule.findMany({
      where: { status: "active", targetKind: "project", targetId: { in: projectIds } }, select: AUTHORIZATION_RULE_SELECT,
    }) : [];
    const visible: string[] = [];
    for (const binding of candidates) {
      const decision = await deps.authorization.authorize(
        { user: identity.user, decorated: identity.decorated, role: identity.role },
        "view", { kind: "project", project: binding.project },
        { minimum: "view", rules: rules.filter((rule: any) => rule.targetId === binding.projectId), surface: "api", tool: "sourceControl" },
      );
      if (decision.allowed && !visible.includes(binding.projectId)) visible.push(binding.projectId);
    }
    if (!visible.length) throw createHttpError("SOURCE_COMMIT_NOT_FOUND", "Source revision not found.", 404);
    const commits = await deps.prisma.sourceCommit.findMany({
      where: { repositoryId, revision: { startsWith: revision.toLowerCase(), mode: "insensitive" } },
      select: { id: true, revision: true }, take: 2,
    });
    if (!commits.length) throw createHttpError("SOURCE_COMMIT_NOT_FOUND", "Source revision not found.", 404);
    if (commits.length > 1) throw createHttpError("SOURCE_COMMIT_AMBIGUOUS", "The abbreviated revision is ambiguous. Use the full commit revision.", 409);
    if (visible.length > 1) throw createHttpError("SOURCE_COMMIT_PROJECT_AMBIGUOUS", "The repository is linked to multiple accessible Projects. Use a Project-scoped commit link.", 409);
    return sendPrivateRevalidated(request, reply, {
      ok: true, projectId: visible[0], repositoryId, commitId: commits[0].id, revision: commits[0].revision,
    });
  });

  // Older reviews are not necessarily in the latest 30 records returned by
  // the Project workspace. Hydration stays bound to this Project and its
  // currently selected repository, with identical read authorization.
  deps.app.get("/api/projects/:projectId/source-control/reviews/:reviewId", async (request, reply) => {
    if (!(await deps.authorization.requireTool(request, reply, "sourceControl", "view"))) return;
    const { projectId, reviewId } = z.object({
      projectId: z.string().trim().min(1).max(200), reviewId: z.string().trim().min(1).max(200),
    }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    if (!context.binding) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Source review not found.", 404);
    const review = await deps.sourceControl.reviewForProject(projectId, context.binding.repositoryId, reviewId);
    if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Source review not found.", 404);
    return sendPrivateRevalidated(request, reply, { ok: true, review });
  });

  // Direct canonical commit IDs must be verified against the Project's
  // active primary binding. This also supports deep links to older commits
  // outside the bounded Recent Commits projection.
  deps.app.get("/api/projects/:projectId/source-control/commits/:commitId", async (request, reply) => {
    if (!(await deps.authorization.requireTool(request, reply, "sourceControl", "view"))) return;
    const { projectId, commitId } = z.object({
      projectId: z.string().trim().min(1).max(200), commitId: z.string().trim().min(1).max(200),
    }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    if (!context.binding) throw createHttpError("SOURCE_COMMIT_NOT_FOUND", "Source revision not found.", 404);
    const commit = await deps.prisma.sourceCommit.findFirst({
      where: { id: commitId, repositoryId: context.binding.repositoryId },
      select: { id: true, revision: true, shortRevision: true, message: true, authorName: true,
        committedAt: true, webUrl: true, additions: true, deletions: true, filesChanged: true },
    });
    if (!commit) throw createHttpError("SOURCE_COMMIT_NOT_FOUND", "Source revision not found.", 404);
    return sendPrivateRevalidated(request, reply, { ok: true, commit });
  });

  deps.app.get("/api/projects/:projectId/source-control", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) return sendPrivateRevalidated(request, reply, { ok: true, projectId, binding: null, repository: null, branches: [], commits: [], operations: [], policy: null, workingCopies: [], links: [] });
    const [state, workflow] = await Promise.all([
      deps.sourceControl.state(binding.repositoryId),
      deps.sourceControl.workflowState(binding.repositoryId, project.id, user?.id || null, binding.id),
    ]);
    return sendPrivateRevalidated(request, reply, { ok: true, projectId, binding, ...state, ...workflow });
  });

  deps.app.get("/api/projects/:projectId/source-control/commits/:commitId/changes", async (request, reply) => {
    const { projectId, commitId } = z.object({ projectId: z.string().min(1), commitId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    if (!context.binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is not linked to this project.", 409);
    const payload = await deps.sourceControl.commitChanges(context.binding.repositoryId, commitId);
    return sendPrivateRevalidated(request, reply, { ok: true, projectId, ...payload });
  });

  deps.app.post("/api/projects/:projectId/source-control/sync", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository to this project before synchronizing source control.", 409);
    const queued = await queueSync(deps, binding.repositoryId, project.workspaceId, user?.id || null, { action: "contribute", resource: { kind: "project", projectId }, minimum: "contribute", tool: "sourceControl" });
    return reply.code(202).send({ ok: true, projectId, repositoryId: binding.repositoryId, ...queued });
  });

  deps.app.patch("/api/projects/:projectId/source-control/policy", async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "manage");
    if (!context) return;
    if (!context.binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository before configuring branch policy.", 409);
    const body = policyBody.parse(request.body || {});
    const policy = await deps.sourceControl.updateBranchPolicy(context.binding.id, context.binding.defaultBranch || context.binding.repository.defaultBranch || "main", body);
    return { ok: true, projectId, policy };
  });

  deps.app.post("/api/projects/:projectId/source-control/version", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = versionBody.parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "manage");
    if (!context) return;
    if (!context.binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository before creating a source-backed project version.", 409);
    const version = await deps.sourceControl.createProjectVersion(projectId, context.binding.repositoryId, user?.id || null, body.bump);
    return reply.code(201).send({ ok: true, projectId, version });
  });

  deps.app.post("/api/projects/:projectId/source-control/reviews", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = reviewBody.parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    if (!context.binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository before opening a source review.", 409);
    const review = await deps.sourceControl.createReview({ projectId, repositoryId: context.binding.repositoryId, workingCopyId: body.workingCopyId, createdById: user?.id || null, title: body.title, description: body.description || null, targetBranch: body.targetBranch, reviewerIds: body.reviewerIds, reviewerTeamIds: body.reviewerTeamIds });
    return reply.code(201).send({ ok: true, projectId, review });
  });

  deps.app.patch("/api/projects/:projectId/source-control/reviews/:reviewId", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, reviewId } = z.object({ projectId: z.string().min(1), reviewId: z.string().min(1) }).parse(request.params);
    const body = z.object({ reviewerIds: z.array(z.string().trim().min(1).max(240)).max(50).default([]), reviewerTeamIds: z.array(z.string().trim().min(1).max(240)).max(25).default([]) }).parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    const review = await deps.sourceControl.setReviewAssignments(reviewId, projectId, user?.id || null, body.reviewerIds, body.reviewerTeamIds);
    return { ok: true, projectId, review };
  });

  deps.app.post("/api/projects/:projectId/source-control/reviews/:reviewId/refresh", async (request, reply) => {
    const { projectId, reviewId } = z.object({ projectId: z.string().min(1), reviewId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    const review = await deps.prisma.sourceReview.findFirst({ where: { id: reviewId, projectId }, select: { id: true } });
    if (!review) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Source review not found.", 404);
    return { ok: true, projectId, review: await deps.sourceControl.reviewEligibility(reviewId, true) };
  });

  deps.app.post("/api/projects/:projectId/source-control/reviews/:reviewId/decision", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, reviewId } = z.object({ projectId: z.string().min(1), reviewId: z.string().min(1) }).parse(request.params);
    const body = reviewDecisionBody.parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    if (!user?.id) throw createHttpError("AUTH_REQUIRED", "Sign in to review source changes.", 401);
    const review = await deps.sourceControl.setReviewDecision(reviewId, projectId, user.id, body.decision, body.comment || null);
    return { ok: true, projectId, review };
  });

  deps.app.post("/api/projects/:projectId/source-control/reviews/:reviewId/merge", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, reviewId } = z.object({ projectId: z.string().min(1), reviewId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "manage");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is not linked to this project.", 409);
    const review = await deps.prisma.sourceReview.findFirst({ where: { id: reviewId, projectId, repositoryId: binding.repositoryId, status: "open" } });
    if (!review || !review.workingCopyId) throw createHttpError("SOURCE_REVIEW_NOT_FOUND", "Open source review not found.", 404);
    const eligible = await deps.sourceControl.reviewEligibility(reviewId, true);
    if (eligible.eligibilityState !== "ready") throw createHttpError("SOURCE_REVIEW_BLOCKED", eligible.eligibilityMessage || "Review is not ready to merge.", 409);
    const queued = await queueWorkflow(deps, { repositoryId: binding.repositoryId, workspaceId: project.workspaceId, projectId, workingCopyId: review.workingCopyId, operationType: "merge_review", userId: user?.id || null, branchName: review.sourceBranch, requestKey: requestKey(request, "merge_review"), inputMetadata: { reviewId } });
    return reply.code(202).send({ ok: true, projectId, review: eligible, ...queued });
  });

  deps.app.post("/api/projects/:projectId/source-control/workspaces", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = workspaceBody.parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Link a repository before preparing a working copy.", 409);
    const baseBranch = body.baseBranch || binding.defaultBranch || binding.repository.defaultBranch || "main";
    const workingCopy = await deps.sourceControl.ensureWorkingCopy({ repositoryId: binding.repositoryId, projectId, ownerUserId: user?.id || null, branchName: body.branchName, baseBranch, createBranch: body.createBranch });
    const operationType = body.createBranch ? "branch_create" : "workspace_prepare";
    const queued = await queueWorkflow(deps, { repositoryId: binding.repositoryId, workspaceId: project.workspaceId, projectId, workingCopyId: workingCopy.id, operationType, userId: user?.id || null, branchName: workingCopy.branchName, requestKey: requestKey(request, operationType), inputMetadata: { baseBranch } });
    return reply.code(202).send({ ok: true, projectId, repositoryId: binding.repositoryId, workingCopy, ...queued });
  });

  deps.app.post("/api/projects/:projectId/source-control/workspaces/:workingCopyId/refresh", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, workingCopyId } = z.object({ projectId: z.string().min(1), workingCopyId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "view");
    if (!context) return;
    const workingCopy = await deps.sourceControl.refreshWorkingCopy(workingCopyId, projectId, user?.id || null);
    return { ok: true, projectId, workingCopy };
  });

  deps.app.post("/api/projects/:projectId/source-control/workspaces/:workingCopyId/commit", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, workingCopyId } = z.object({ projectId: z.string().min(1), workingCopyId: z.string().min(1) }).parse(request.params);
    const body = commitBody.parse(request.body || {});
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is not linked to this project.", 409);
    const workingCopy = await deps.prisma.sourceWorkingCopy.findFirst({ where: { id: workingCopyId, projectId, repositoryId: binding.repositoryId, ownerUserId: user?.id || null, archived: false } });
    if (!workingCopy) throw createHttpError("SOURCE_WORKING_COPY_NOT_FOUND", "Working copy not found.", 404);
    const links = await deps.sourceControl.validateArtifactLinks(projectId, body.links);
    const queued = await queueWorkflow(deps, { repositoryId: binding.repositoryId, workspaceId: project.workspaceId, projectId, workingCopyId, operationType: "commit", userId: user?.id || null, branchName: workingCopy.branchName, requestKey: requestKey(request, "commit"), inputMetadata: { message: body.message, links } });
    return reply.code(202).send({ ok: true, projectId, repositoryId: binding.repositoryId, ...queued });
  });

  deps.app.post("/api/projects/:projectId/source-control/workspaces/:workingCopyId/push", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, workingCopyId } = z.object({ projectId: z.string().min(1), workingCopyId: z.string().min(1) }).parse(request.params);
    const context = await projectSourceContext(deps, request, reply, projectId, "contribute");
    if (!context) return;
    const { project, binding } = context;
    if (!binding) throw createHttpError("PROJECT_SOURCE_NOT_LINKED", "Repository is not linked to this project.", 409);
    const workingCopy = await deps.prisma.sourceWorkingCopy.findFirst({ where: { id: workingCopyId, projectId, repositoryId: binding.repositoryId, ownerUserId: user?.id || null, archived: false } });
    if (!workingCopy) throw createHttpError("SOURCE_WORKING_COPY_NOT_FOUND", "Working copy not found.", 404);
    const queued = await queueWorkflow(deps, { repositoryId: binding.repositoryId, workspaceId: project.workspaceId, projectId, workingCopyId, operationType: "push", userId: user?.id || null, branchName: workingCopy.branchName, requestKey: requestKey(request, "push") });
    return reply.code(202).send({ ok: true, projectId, repositoryId: binding.repositoryId, ...queued });
  });
}
