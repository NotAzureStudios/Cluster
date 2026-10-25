import type { SyncConflictAction } from "./sync-control-repository.js";
import { buildCursorPage, decodeCursor } from "../../core/cursor-pagination.js";

const MUTATION_SCHEMA_VERSION = 1;

function inferEntity(path: string) {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const apiIndex = segments.indexOf("api");
  const domain = segments[apiIndex + 1] || null;
  const id = segments[apiIndex + 2] || null;
  const singular: Record<string, string> = {
    projects: "project", boards: "board", lists: "list", cards: "card", whiteboards: "whiteboard",
    timeline: "timeline_item", calendar: "calendar_event", users: "user",
  };
  return { entityType: domain ? singular[domain] || domain.replace(/s$/, "") : null, entityId: id };
}

export function classifySyncConflict(statusCode: number, payload: any, path: string) {
  const code = String(payload?.code || "").toUpperCase();
  const deleted = code.includes("NOT_FOUND") || statusCode === 404;
  const revision = code.includes("REVISION") || code.includes("VERSION") || statusCode === 409;
  const classification = deleted ? "REMOTE_DELETED" : revision ? "REVISION_DIVERGED" : "MUTATION_REJECTED";
  const allowedActions: SyncConflictAction[] = deleted
    ? ["restore", "duplicate", "discard"]
    : revision
      ? ["keep_mine", "keep_server", "merge", "duplicate"]
      : ["keep_server", "discard"];
  return { ...inferEntity(path), classification, allowedActions };
}

export function createSyncControlService(repository: any) {
  return {
    mutationSchemaVersion: MUTATION_SCHEMA_VERSION,
    registerDevice: repository.registerDevice,
    acknowledge: repository.acknowledge,
    receipt: repository.receipt,
    recordReceipt: repository.recordReceipt,
    activeConflict: repository.activeConflict,
    createConflict: repository.createConflict,
    status: repository.status,
    async listConflicts(input: any) {
      const cursor = decodeCursor(input.cursor);
      const rows = await repository.listConflicts({ ...input, cursor });
      return buildCursorPage(rows, input.limit, "createdAt");
    },
    resolveConflict: repository.resolveConflict,
  };
}
