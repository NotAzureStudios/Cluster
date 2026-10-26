import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { serverDomainCatalogSnapshot } from "../../app/server-domain-catalog.js";
import type { DurableDomainEventRuntime } from "../../core/domain-events.js";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";

export function registerServerArchitectureRoutes(input: {
  app: FastifyInstance;
  events: DurableDomainEventRuntime;
  jobQueue: BackgroundJobQueue;
  jobWorker: DurableJobWorker;
  jobRuntime?: { snapshot: () => unknown };
  coordination?: { snapshot: () => unknown };
  acceleration?: { snapshot: () => unknown };
  concurrentWorkLimiter?: { stats: () => unknown };
  storageRuntime?: { snapshot: () => Promise<unknown> };
  databaseResourceBudget?: unknown;
  projectReadModels?: { snapshot: () => unknown };
  notificationSummaryCache?: { summaryCacheSnapshot: () => unknown };
  uploadPressure?: () => Promise<unknown>;
  efficiencyMetrics?: () => Promise<unknown>;
  requireAdminUserForRequest: (request: FastifyRequest, reply: FastifyReply) => Promise<any | null>;
}) {
  input.app.get("/api/admin/architecture/domains", async (request, reply) => {
    const admin = await input.requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      architecture: serverDomainCatalogSnapshot(),
      events: input.events.snapshot(),
      jobs: {
        counts: await input.jobQueue.counts(),
        workspacePressure: await input.jobQueue.workspacePressure(),
        worker: input.jobWorker.snapshot(),
        runtime: input.jobRuntime?.snapshot?.() || null,
      },
      scale: {
        coordination: input.coordination?.snapshot?.() || null,
        acceleration: input.acceleration?.snapshot?.() || null,
        requestWork: input.concurrentWorkLimiter?.stats?.() || null,
        databaseBudget: input.databaseResourceBudget || null,
        storage: input.storageRuntime ? await input.storageRuntime.snapshot() : null,
        projectReadModels: input.projectReadModels?.snapshot?.() || null,
        notificationSummaryCache: input.notificationSummaryCache?.summaryCacheSnapshot?.() || null,
        uploadPressure: input.uploadPressure ? await input.uploadPressure() : null,
        efficiency: input.efficiencyMetrics ? await input.efficiencyMetrics() : null,
      },
    };
  });
}
