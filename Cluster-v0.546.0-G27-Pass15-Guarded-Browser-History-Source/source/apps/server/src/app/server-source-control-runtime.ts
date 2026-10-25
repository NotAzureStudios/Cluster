import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import type { DurableJobWorker } from "../domains/jobs/job-worker.js";
import { registerSourceControlRoutes } from "../domains/source-control/source-control-routes.js";
import { createSourceControlService } from "../domains/source-control/source-control-service.js";
import { createGitRepositoryRuntime } from "../domains/source-control/git-repository-runtime.js";
import { createSourceProviderService } from "../domains/source-control/source-provider-service.js";
import { projectCapsuleLayout, projectStorageDirectory, type ClusterDataLayout } from "../core/data-layout.js";


export function createServerSourceControlRuntime(input: {
  app: FastifyInstance;
  prisma: any;
  queue: BackgroundJobQueue;
  worker: DurableJobWorker;
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number, policy?: Record<string, unknown>) => Promise<Response>;
  authorization: {
    requireTool: (request: FastifyRequest, reply: FastifyReply, tool: string, minimum?: string) => Promise<any | null>;
    requireCard: (request: FastifyRequest, reply: FastifyReply, cardId: string, minimum?: string) => Promise<boolean>;
    identityForRequest: (request: FastifyRequest) => Promise<{ user: any | null; decorated: any | null; role: string | null }>;
    hasTargetAccess: (user: any, role: string | null | undefined, targetKind: string, targetId: string, project: any, rules: any[], min?: string) => boolean;
    authorize: (actor: any, action: string, resource: any, context?: any) => Promise<any>;
  };
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  repositoriesRoot: string;
  sourceWorkspacesRoot: string;
  dataLayout: ClusterDataLayout;
  logActivity: (input: any) => Promise<void>;
}) {
  const gitRuntime = createGitRepositoryRuntime({ repositoriesRoot: input.repositoriesRoot, workspacesRoot: input.sourceWorkspacesRoot });
  const sourceProvider = createSourceProviderService({ prisma: input.prisma, fetchWithTimeout: input.fetchWithTimeout, logger: { warn: (payload, message) => input.app.log.warn(payload, message) } });
  const sourceControl = createSourceControlService({
    prisma: input.prisma,
    providerService: sourceProvider,
    gitRuntime,
    resolveManagedRepositoryPath: async (repository: any) => {
      if (repository?.hostingMode !== "cluster") return null;
      const metadata = (() => { try { return JSON.parse(String(repository?.metadata || "{}")); } catch { return {}; } })();
      if (metadata.storageKind !== "project-capsule") return null;
      const binding = await input.prisma.projectSourceBinding.findFirst({ where: { repositoryId: repository.id, archived: false }, select: { projectId: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
      if (!binding?.projectId) return null;
      const directory = await projectStorageDirectory(input.prisma, input.dataLayout, binding.projectId);
      return projectCapsuleLayout(directory).repositoryRoot;
    },
    logActivity: input.logActivity,
    logger: {
      info: (payload, message) => input.app.log.info(payload, message),
      warn: (payload, message) => input.app.log.warn(payload, message),
    },
  });

  input.worker.register("source.repository-sync", async ({ payload, job, updateProgress, cancellationRequested }) => {
    if (await cancellationRequested()) return { cancelled: true };
    const result = await sourceControl.executeSyncJob(payload, job.attempts, updateProgress);
    return { synchronized: true, result };
  });

  input.worker.register("source.workflow", async ({ payload, job, updateProgress, cancellationRequested }) => {
    if (await cancellationRequested()) return { cancelled: true };
    const result = await sourceControl.executeWorkflowJob(payload, job.attempts, updateProgress);
    return { completed: true, result };
  });

  registerSourceControlRoutes({
    app: input.app,
    prisma: input.prisma,
    queue: input.queue,
    sourceControl,
    sourceProvider,
    authorization: input.authorization,
    getCurrentUser: input.getCurrentUser,
    enforceTargetAccess: input.enforceTargetAccess,
    logActivity: input.logActivity,
  });

  return { sourceControl, sourceProvider, gitRuntime };
}
