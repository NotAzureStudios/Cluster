import { CLUSTER_DOMAIN_EVENTS, CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE, clusterResourceAddressFromEntity, type ClusterAssignmentChange } from "@cluster/shared";
import { createClusterDomainEvent } from "../../core/domain-events.js";
import { createActivityRepository } from "./activity-repository.js";
import { buildCursorPage } from "../../core/cursor-pagination.js";

export type ActivityRecordInput = {
  userId?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  whiteboardId?: string | null;
  cardId?: string | null;
  type: string;
  entityType: string;
  entityId?: string | null;
  title: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
};

export function createActivityService(deps: any) {
  const repository = createActivityRepository(deps.prisma);
  const events = deps.events;
  const logger = deps.logger;

  // Strict transactional activity writer: callers that mutate important shared work
  // can commit state + Activity + domain outbox together or roll back everything.
  async function recordInTransaction(tx: any, input: ActivityRecordInput) {
    const txRepository = createActivityRepository(tx);
      const row = await txRepository.create(input);
      await events.appendInTransaction(tx, createClusterDomainEvent(CLUSTER_DOMAIN_EVENTS.activityRecorded, {
        occurredAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
        actorUserId: row.userId ?? input.userId ?? null,
        projectId: row.projectId ?? input.projectId ?? null,
        resource: clusterResourceAddressFromEntity({
          entityType: row.entityType ?? input.entityType,
          entityId: row.entityId ?? input.entityId ?? row.projectId ?? input.projectId,
          projectId: row.projectId ?? input.projectId,
        }),
        payload: row,
      }));
      if (input.type === CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE) {
        const assignment = input.metadata?.assignment as ClusterAssignmentChange | undefined;
        if (assignment?.resource?.kind && assignment.resource.id) {
          const resource = clusterResourceAddressFromEntity({
            entityType: assignment.resource.kind,
            entityId: assignment.resource.id,
            projectId: assignment.resource.projectId ?? assignment.projectId ?? row.projectId ?? input.projectId,
          });
          if (!resource) throw new Error("Work assignment has no canonical resource address.");
          await events.appendInTransaction(tx, createClusterDomainEvent(CLUSTER_DOMAIN_EVENTS.assignmentChanged, {
            actorUserId: assignment.actorUserId ?? row.userId ?? input.userId ?? null,
            projectId: assignment.resource.projectId ?? assignment.projectId ?? row.projectId ?? input.projectId ?? null,
            resource,
            // Non-Project resources (for example Packet knowledge) can be
            // mentioned from a Project activity; contextual projectId
            // cannot become part of their canonical assignment identity.
            payload: { ...assignment, resource },
          }));
        }
      }
      return row;
  }

  return {
    recordInTransaction,
    wakeCommittedActivity() { events.wake(); },
    async record(input: ActivityRecordInput) {
      try {
        const created = await deps.prisma.$transaction((tx: any) => recordInTransaction(tx, input));
        events.wake();
        return created;
      } catch (error) {
        logger.warn(error, "activity record transaction failed");
        return null;
      }
    },
    async list(query: any, authorization: { userId?: string | null; admin?: boolean } = {}) {
      return buildCursorPage(await repository.list(query, authorization), query.limit, "createdAt");
    },
    userSummaries(limit: number, includeActivitySummary = false) {
      return repository.userSummaries(limit, includeActivitySummary);
    },
  };
}
