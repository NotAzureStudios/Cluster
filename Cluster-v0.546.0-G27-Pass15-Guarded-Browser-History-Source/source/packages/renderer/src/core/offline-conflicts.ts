import { api } from "./api";
import {
  rebaseOfflineMutation,
  removeOfflineMutation,
  listOfflineMutations,
  type OfflineMutationRecord,
} from "./offline-storage";

export type OfflineConflictAction = "keep_mine" | "keep_server" | "merge" | "restore" | "duplicate" | "discard";
export type OfflineConflictFieldChoice = "local" | "server";
export type OfflineConflictField = {
  key: string;
  localValue: unknown;
  serverValue: unknown;
  choice: OfflineConflictFieldChoice;
  changedLocally: boolean;
};

type ConflictEnvelope = {
  current?: Record<string, unknown> | null;
  serverPayload?: unknown;
  allowedActions?: OfflineConflictAction[];
  classification?: string;
  conflictId?: string;
  id?: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function conflictEnvelope(record: OfflineMutationRecord): ConflictEnvelope {
  return objectValue(record.conflictPayload) as ConflictEnvelope;
}

export function offlineConflictServerSnapshot(record: OfflineMutationRecord) {
  const envelope = conflictEnvelope(record);
  const serverPayload = objectValue(envelope.serverPayload);
  return objectValue(envelope.current || serverPayload.current || serverPayload.entity || serverPayload.record || envelope.serverPayload);
}

export function offlineConflictLocalSnapshot(record: OfflineMutationRecord) {
  return objectValue(record.localSnapshot || record.body);
}

export function offlineConflictAllowedActions(record: OfflineMutationRecord): OfflineConflictAction[] {
  const envelope = conflictEnvelope(record);
  const values = Array.isArray(envelope.allowedActions) ? envelope.allowedActions : [];
  // Fail closed if the server did not authorize an action. The only locally
  // supported fallback is a user-requested discard of an unregistered conflict.
  if (!record.conflictId && !envelope.conflictId && !envelope.id) return ["discard"];
  return values.filter((action): action is OfflineConflictAction =>
    ["keep_mine", "keep_server", "merge", "restore", "duplicate", "discard"].includes(action));
}

function comparable(value: unknown) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function buildOfflineConflictFields(record: OfflineMutationRecord): OfflineConflictField[] {
  const submitted = objectValue(record.body);
  const local = submitted;
  const server = offlineConflictServerSnapshot(record);
  // Only fields the original queued mutation intended to write may be merged.
  // A server snapshot may include private metadata, IDs, ownership or unrelated fields.
  const ignored = new Set(["expectedRevision", "revision", "updatedAt", "createdAt", "id", "userId", "projectId", "boardId", "ownerId"]);
  const keys = new Set(Object.keys(submitted).filter((key) => !ignored.has(key)));
  return [...keys]
    .filter((key) => !ignored.has(key))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({
      key,
      localValue: local[key],
      serverValue: server[key],
      changedLocally: (record.changedFields || Object.keys(submitted)).includes(key),
      choice: (record.changedFields || Object.keys(submitted)).includes(key) ? "local" : "server",
    }));
}

export function mergeOfflineConflictFields(record: OfflineMutationRecord, choices: Record<string, OfflineConflictFieldChoice>) {
  const local = objectValue(record.body);
  const server = offlineConflictServerSnapshot(record);
  const merged: Record<string, unknown> = { ...local };
  for (const field of buildOfflineConflictFields(record)) {
    const choice = choices[field.key] || field.choice;
    const value = choice === "local" ? local[field.key] : server[field.key];
    if (value === undefined) delete merged[field.key];
    else merged[field.key] = value;
  }
  delete merged.revision;
  delete merged.createdAt;
  delete merged.updatedAt;
  return merged;
}

function serverRevision(record: OfflineMutationRecord) {
  const snapshot = offlineConflictServerSnapshot(record);
  return Number(snapshot.revision || snapshot.version || 0) || null;
}

export async function resolveOfflineConflict(
  record: OfflineMutationRecord,
  action: OfflineConflictAction,
  choices: Record<string, OfflineConflictFieldChoice> = {},
) {
  const envelope = conflictEnvelope(record);
  if (record.status !== "conflict") throw new Error("This change is no longer awaiting conflict review. Refresh Sync Center.");
  if (!offlineConflictAllowedActions(record).includes(action)) throw new Error("The server has not authorized that conflict resolution. Refresh Sync Center.");
  const conflictId = record.conflictId || envelope.conflictId || envelope.id || null;
  if (["restore", "duplicate"].includes(action)) throw new Error("This recovery action requires an explicit resource-specific workflow.");
  const revision = serverRevision(record);
  if ((action === "merge" || action === "keep_mine") && (record.method === "PUT" || record.method === "PATCH" || record.method === "DELETE") && !revision)
    throw new Error("The server did not provide a current revision. Open the resource and review it before replay.");
  if (action === "merge" && (!buildOfflineConflictFields(record).length || !Object.keys(offlineConflictServerSnapshot(record)).length))
    throw new Error("Field-level merge needs a complete server record and writable queued fields.");
  // Do not mark a server-side conflict resolved for a queue entry that has
  // already disappeared or changed in another tab. The user must re-open Sync Center.
  const current = (await listOfflineMutations()).find((item) => item.id === record.id);
  if (!current || current.status !== "conflict" || current.conflictId !== record.conflictId || current.updatedAt !== record.updatedAt)
    throw new Error("The queued edit changed in another window. Refresh Sync Center before resolving it.");
  const mergedBody = action === "merge" ? mergeOfflineConflictFields(record, choices) : undefined;
  if (conflictId) {
    await api(`/api/sync/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, mergedBody, fieldChoices: choices }),
      skipCacheInvalidation: true,
    });
  }
  if (action === "keep_server" || action === "discard") {
    await removeOfflineMutation(record.id);
    return { removed: true, retried: false };
  }
  const body = action === "merge" ? mergedBody : record.body;
  const rebased = await rebaseOfflineMutation(record.id, revision, body);
  if (!rebased) throw new Error("The server accepted the conflict decision but the local queued edit is missing. Refresh Sync Center; replay was not confirmed.");
  return { removed: false, retried: true };
}


export function offlineConflictExplanation(record: OfflineMutationRecord) {
  const envelope = conflictEnvelope(record);
  const classification = String(envelope.classification || record.conflictKind || "unknown").toUpperCase();
  if (classification.includes("REMOTE_DELETED") || classification.includes("DELETED")) return "The server no longer has this item. Restore or duplicate your local work only if the deletion was not intentional.";
  if (classification.includes("DEPENDENCY")) return "This queued change depends on an earlier change that did not complete. Resolve the prerequisite before replaying it.";
  if (classification.includes("SCHEMA")) return "This queued change was created by an incompatible client schema. Refresh the item before recreating the change.";
  if (classification.includes("PERMISSION") || classification.includes("AUTH")) return "Your current permissions no longer allow this change. Cluster will not replay it until access is restored or the change is discarded.";
  if (classification.includes("REVISION") || classification.includes("DIVERGED")) return "This item changed on the server after your local edit. Review the changed fields before deciding which version wins.";
  if (classification.includes("VALIDATION") || classification.includes("REJECTED")) return "The server rejected this queued change under the current validation rules. Refresh the item before retrying.";
  return "Cluster could not safely replay this change automatically. Review the local and server versions before continuing.";
}

export function offlineConflictValuesDiffer(field: OfflineConflictField) {
  return comparable(field.localValue) !== comparable(field.serverValue);
}

export function formatOfflineConflictValue(value: unknown) {
  if (value === undefined) return "Not set";
  if (value === null) return "None";
  if (typeof value === "string") return value || "Empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
