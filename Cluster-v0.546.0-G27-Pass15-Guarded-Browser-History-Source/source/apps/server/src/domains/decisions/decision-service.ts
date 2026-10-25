import { CLUSTER_DECISION_LIFECYCLE } from "@cluster/shared";
import type {
  ClusterDecisionOutcome,
  ClusterDecisionRequest,
  ClusterDecisionRequestInput,
  ClusterResourceAddress,
} from "@cluster/shared";
import { assertLifecycleTransition } from "../../core/state-machine.js";

function parseObject(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resourceFromRecord(record: any, payload: Record<string, any>): ClusterResourceAddress | null {
  const kind = String(payload.resourceKind || record.entityType || payload.targetType || "").trim();
  const id = String(payload.resourceId || record.entityId || payload.targetId || "").trim();
  if (!kind || !id) return null;
  return { kind: kind as any, id, ...(record.projectId || payload.projectId ? { projectId: String(record.projectId || payload.projectId) } : {}) };
}

export function serializeDecisionRequest(record: any): ClusterDecisionRequest {
  const payload = parseObject(record.payload);
  const reviewedAt = payload.reviewedAt || null;
  return {
    id: String(record.id),
    type: String(payload.type || "other"),
    title: String(record.title || "Approval request"),
    status: String(record.status || "pending") as ClusterDecisionRequest["status"],
    projectId: record.projectId || payload.projectId || null,
    resource: resourceFromRecord(record, payload),
    requestedById: record.userId || payload.requestedById || null,
    requestedByName: payload.requestedByName || null,
    reason: payload.reason || null,
    note: payload.note || null,
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
    payload,
    sourceKey: record.sourceKey || null,
    createdAt: record.createdAt?.toISOString?.() || String(record.createdAt || ""),
    updatedAt: record.updatedAt?.toISOString?.() || String(record.updatedAt || ""),
    decidedAt: reviewedAt,
    decidedById: payload.reviewedById || record.ownerId || null,
    decisionNote: payload.reviewNote || null,
  };
}

export function createDecisionService(prisma: any) {
  return {
    async request(input: ClusterDecisionRequestInput) {
      const payload = {
        ...(input.payload || {}),
        type: input.type,
        reason: input.reason ?? input.payload?.reason ?? null,
        requestedById: input.requestedById ?? input.payload?.requestedById ?? null,
        requestedByName: input.requestedByName ?? input.payload?.requestedByName ?? null,
        projectId: input.projectId ?? input.payload?.projectId ?? null,
        resourceKind: input.resource?.kind ?? input.payload?.resourceKind ?? null,
        resourceId: input.resource?.id ?? input.payload?.resourceId ?? null,
        targetType: input.resource?.kind ?? input.payload?.targetType ?? null,
        targetId: input.resource?.id ?? input.payload?.targetId ?? null,
      };
      const data: any = {
        kind: "approvalRequest",
        title: input.title,
        projectId: input.projectId || input.resource?.projectId || null,
        entityType: input.resource?.kind || null,
        entityId: input.resource?.id || null,
        userId: input.requestedById || null,
        status: "pending",
        sourceKey: input.sourceKey || null,
        payload: JSON.stringify(payload),
        archived: false,
        deletedAt: null,
        syncedAt: new Date(),
        ...(input.storageData || {}),
      };
      const record = input.id && input.upsert
        ? await prisma.clusterPersistenceRecord.upsert({
            where: { id: input.id },
            create: { id: input.id, ...data, revision: 1 },
            update: { ...data, ownerId: null, revision: { increment: 1 } },
          })
        : await prisma.clusterPersistenceRecord.create({ data: { ...(input.id ? { id: input.id } : {}), ...data } });
      return serializeDecisionRequest(record);
    },

    async findPending(input: { resource?: ClusterResourceAddress | null; type?: string | null; sourceKey?: string | null }) {
      const record = await prisma.clusterPersistenceRecord.findFirst({
        where: {
          kind: "approvalRequest",
          status: "pending",
          archived: false,
          ...(input.resource ? { entityType: input.resource.kind, entityId: input.resource.id } : {}),
          ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      if (!record) return null;
      const view = serializeDecisionRequest(record);
      return input.type && view.type !== input.type ? null : view;
    },

    async list(input: { status?: string | null; limit?: number } = {}) {
      const records = await prisma.clusterPersistenceRecord.findMany({
        where: { kind: "approvalRequest", archived: false, ...(input.status && input.status !== "all" ? { status: input.status } : {}) },
        orderBy: { createdAt: "desc" },
        take: Math.min(Math.max(Number(input.limit || 200), 1), 500),
      });
      return records.map(serializeDecisionRequest);
    },

    async get(id: string) {
      const record = await prisma.clusterPersistenceRecord.findUnique({ where: { id } });
      return record?.kind === "approvalRequest" ? serializeDecisionRequest(record) : null;
    },

    async decide(input: {
      id: string;
      decision: ClusterDecisionOutcome;
      actorId: string;
      note?: string | null;
      apply?: (tx: any, request: ClusterDecisionRequest) => Promise<void> | void;
    }) {
      return prisma.$transaction(async (tx: any) => {
        const record = await tx.clusterPersistenceRecord.findUnique({ where: { id: input.id } });
        if (!record || record.kind !== "approvalRequest") throw Object.assign(new Error("Approval request not found."), { statusCode: 404 });
        if (record.status !== "pending") throw Object.assign(new Error("This request has already been reviewed."), { statusCode: 409 });
        assertLifecycleTransition(CLUSTER_DECISION_LIFECYCLE, "pending", input.decision);
        const request = serializeDecisionRequest(record);
        if (input.apply) await input.apply(tx, request);
        const nextPayload = {
          ...request.payload,
          reviewedById: input.actorId,
          reviewedAt: new Date().toISOString(),
          reviewNote: input.note || null,
        };
        const updated = await tx.clusterPersistenceRecord.update({
          where: { id: input.id },
          data: { status: input.decision, ownerId: input.actorId, payload: JSON.stringify(nextPayload), syncedAt: new Date(), revision: { increment: 1 } },
        });
        return serializeDecisionRequest(updated);
      });
    },
  };
}
