import { ProjectReadModelRuntime } from "../core/project-read-model-runtime.js";
import { createNotificationService } from "../domains/notifications/notification-service.js";

export function createServerReadModelRuntime(input: {
  prisma: any;
  events: any;
  coordination: any;
  logger: any;
  acceleration?: any;
}) {
  const projectReadModels = new ProjectReadModelRuntime(input.acceleration);

  input.coordination.subscribe("project.read-model.invalidate", async (payload: any) => {
    await projectReadModels.invalidate(payload?.projectId);
  });

  input.events.subscribe("*", "projects.read-model-invalidation", async (event: any) => {
    const projectId = event.projectId || event.resource?.projectId || null;
    if (!projectId) return;
    await projectReadModels.invalidate(projectId);
    await input.coordination.publish("project.read-model.invalidate", { projectId });
  });

  const notificationService = createNotificationService({
    prisma: input.prisma,
    events: input.events,
    logger: input.logger,
    publishSummaryInvalidation: async (userId) => {
      await input.coordination.publish("notifications.summary.invalidate", { userId });
    },
  });

  input.coordination.subscribe("notifications.summary.invalidate", (payload: any) => {
    notificationService.invalidateSummary(payload?.userId || null);
  });

  return { projectReadModels, notificationService };
}
