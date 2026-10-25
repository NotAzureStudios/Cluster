import {
  CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE,
  type ClusterAssignmentChange,
  type ClusterAssignmentSubject,
  type ClusterWorkSource,
} from "@cluster/shared";
import type { ActivityRecordInput } from "../activity/activity-service.js";

function userSubject(userId: string | null): ClusterAssignmentSubject | null {
  return userId ? { kind: "user", id: userId } : null;
}

export function workAssignmentActivity(input: {
  actorUserId?: string | null;
  source: ClusterWorkSource;
  previousAssigneeId?: string | null;
  assigneeId?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  cardId?: string | null;
  startsAt?: string | Date | null;
  dueAt?: string | Date | null;
}): ActivityRecordInput | null {
  const previousAssigneeId = input.previousAssigneeId || null;
  const assigneeId = input.assigneeId || null;
  if (previousAssigneeId === assigneeId) return null;
  const recipients = [...new Set([previousAssigneeId, assigneeId].filter(Boolean))] as string[];
  const title = assigneeId ? (previousAssigneeId ? "Work reassigned" : "Work assigned") : "Work unassigned";
  const projectId = input.projectId || input.source.projectId || null;
  const assignment: ClusterAssignmentChange = {
    resource: { kind: input.source.kind, id: input.source.id, ...(projectId ? { projectId } : {}) },
    kind: "assignee",
    subject: userSubject(assigneeId),
    previousSubject: userSubject(previousAssigneeId),
    projectId,
    startsAt: input.startsAt instanceof Date ? input.startsAt.toISOString() : input.startsAt || null,
    dueAt: input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt || null,
    actorUserId: input.actorUserId || null,
    sourceLabel: input.source.label || null,
  };
  return {
    userId: input.actorUserId || null,
    projectId,
    boardId: input.boardId || null,
    cardId: input.cardId || null,
    type: CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE,
    entityType: input.source.kind,
    entityId: input.source.id,
    title,
    message: input.source.label || null,
    metadata: {
      source: input.source,
      assignment,
      assigneeId,
      previousAssigneeId,
      targetUserId: assigneeId,
      userIds: recipients,
      startsAt: assignment.startsAt || null,
      dueAt: assignment.dueAt || null,
      notifyInbox: recipients.length > 0,
    },
  };
}
