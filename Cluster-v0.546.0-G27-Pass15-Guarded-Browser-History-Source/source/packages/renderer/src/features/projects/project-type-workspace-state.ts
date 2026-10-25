import type { ClusterProjectTypeDefinition } from "@cluster/shared";
import type { ProjectControlRecord } from "./project-control-model";

export type TypeWorkspaceRecord = ProjectControlRecord & { entityKind: string; stage?: string | null };
export type TypeWorkspaceSummary = {
  total: number;
  open: number;
  complete: number;
  unsupported: number;
  unowned: number;
  stages: Array<{ stage: string; count: number; owners: string[] }>;
};
export type TypeWorkspacePayload = {
  projectId: string;
  type: ClusterProjectTypeDefinition;
  records: TypeWorkspaceRecord[];
  summary: TypeWorkspaceSummary;
};

const CLOSED = new Set(["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"]);
export function typeWorkspaceRecordClosed(status: string) { return CLOSED.has(String(status || "").toLowerCase()); }

export function summarizeTypeWorkspaceRecords(type: ClusterProjectTypeDefinition, records: TypeWorkspaceRecord[]): TypeWorkspaceSummary {
  const supported = new Set((type.workspaceEntities || []).map((entity) => entity.id));
  const stageCounts = new Map((type.deliveryStages || []).map((stage) => [stage, 0]));
  let open = 0;
  let complete = 0;
  let unsupported = 0;
  let unowned = 0;
  for (const record of records) {
    const isClosed = typeWorkspaceRecordClosed(record.status);
    if (isClosed) complete += 1;
    else {
      open += 1;
      if (!record.ownerId) unowned += 1;
    }
    if (!supported.has(record.entityKind)) unsupported += 1;
    if (record.stage && stageCounts.has(record.stage)) stageCounts.set(record.stage, (stageCounts.get(record.stage) || 0) + 1);
  }
  return {
    total: records.length,
    open,
    complete,
    unsupported,
    unowned,
    stages: (type.deliveryStages || []).map((stage) => ({ stage, count: stageCounts.get(stage) || 0, owners: type.stageOwnership?.[stage] || [] })),
  };
}

export function upsertTypeWorkspaceRecord(payload: TypeWorkspacePayload, record: TypeWorkspaceRecord, remove = false): TypeWorkspacePayload {
  const index = payload.records.findIndex((item) => item.id === record.id);
  let records: TypeWorkspaceRecord[];
  if (remove) records = index < 0 ? payload.records : [...payload.records.slice(0, index), ...payload.records.slice(index + 1)];
  else if (index < 0) records = [record, ...payload.records];
  else {
    records = payload.records.slice();
    records[index] = record;
  }
  return { ...payload, records, summary: summarizeTypeWorkspaceRecords(payload.type, records) };
}

export function mergeTypeWorkspaceRecords(payload: TypeWorkspacePayload, incoming: TypeWorkspaceRecord[]) {
  if (!incoming.length) return payload;
  const incomingMap = new Map(incoming.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const existingIds = new Set(payload.records.map((record) => record.id));
  const records: TypeWorkspaceRecord[] = [];
  for (const record of payload.records) {
    const replacement = incomingMap.get(record.id);
    if (replacement) { records.push(replacement); seen.add(record.id); }
    else records.push(record);
  }
  for (const record of incoming) if (!seen.has(record.id) && !existingIds.has(record.id)) records.unshift(record);
  return { ...payload, records, summary: summarizeTypeWorkspaceRecords(payload.type, records) };
}
