type WorkflowEntity = { id: string; projectId?: string | null };

export function normalizeProjectIds(projectIds: string | string[]) {
  return Array.from(new Set((Array.isArray(projectIds) ? projectIds : [projectIds]).map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

export function recordProjectId<T extends WorkflowEntity>(record: T, projectIds: string[]) {
  const direct = String(record.projectId || (record as any).entity?.projectId || (record as any).source?.projectId || (record as any).target?.projectId || "").trim();
  if (direct) return direct;
  return projectIds.length === 1 ? projectIds[0] : "";
}

export function workflowKey(projectId: string, entityId: string) {
  return `${projectId}:${entityId}`;
}

export function stableWorkflowRecord(value: unknown) {
  return JSON.stringify(value);
}
