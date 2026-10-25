import type { ClusterProjectTypeDefinition } from "@cluster/shared";
import type { TypeWorkspaceRecord } from "./project-type-workspace-state";
import { typeWorkspaceRecordClosed } from "./project-type-workspace-state";

const CATEGORY_FOCUS: Record<string, string[]> = {
  game: ["feature", "system", "level", "playtest", "release"],
  software: ["release", "deployment", "incident", "change_request", "environment"],
  creative: ["concept", "asset", "iteration", "review_round", "approval", "deliverable"],
  marketing: ["campaign", "deliverable", "channel", "activation", "performance_report"],
  event: ["session", "run_item", "resource", "booking", "event_issue"],
  operations: ["service_request", "recurring_run", "incident", "procedure", "improvement"],
};

const CATEGORY_LABEL: Record<string, string> = {
  game: "Production focus",
  software: "Delivery focus",
  creative: "Studio focus",
  marketing: "Campaign focus",
  event: "Show focus",
  operations: "Operating focus",
};

export function deriveProjectTypeOperatingLens(type: ClusterProjectTypeDefinition, records: TypeWorkspaceRecord[], now = Date.now()) {
  const definitions = new Map((type.workspaceEntities || []).map((entity) => [entity.id, entity]));
  const configured = CATEGORY_FOCUS[type.category || ""] || (type.workspaceEntities || []).map((entity) => entity.id);
  const ids = configured.filter((id) => definitions.has(id));
  for (const entity of type.workspaceEntities || []) if (!ids.includes(entity.id)) ids.push(entity.id);
  const buckets = new Map<string, { total: number; open: number; overdue: number; unowned: number; highRisk: number }>();
  for (const id of ids) buckets.set(id, { total: 0, open: 0, overdue: 0, unowned: 0, highRisk: 0 });
  for (const record of records) {
    const bucket = buckets.get(record.entityKind);
    if (!bucket) continue;
    bucket.total += 1;
    if (typeWorkspaceRecordClosed(record.status)) continue;
    bucket.open += 1;
    if (!record.ownerId) bucket.unowned += 1;
    if (record.dueDate && new Date(record.dueDate).getTime() < now) bucket.overdue += 1;
    if (["high", "urgent"].includes(String(record.priority || "").toLowerCase())) bucket.highRisk += 1;
  }
  return {
    title: CATEGORY_LABEL[type.category || ""] || `${type.label} focus`,
    items: ids.map((id) => {
      const definition = definitions.get(id)!;
      const counts = buckets.get(id)!;
      const attention = counts.overdue + counts.unowned + counts.highRisk;
      return { id, label: definition.plural || definition.label, description: definition.description || "", ...counts, attention };
    }),
  };
}
