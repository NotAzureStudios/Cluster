import type { Whiteboard, WhiteboardElement } from "../application/application-models";

export type WhiteboardOperationKind = "element.create" | "element.move" | "element.resize" | "element.patch" | "element.delete" | "group.set" | "batch.transform" | "settings.patch" | "snapshot.restore" | "history.restore";
export type WhiteboardOperation = { id: string; kind: WhiteboardOperationKind; payload: Record<string, unknown>; sequence?: number; targets?: string[] };
export type WhiteboardOperationBatchResult = { ok: boolean; reused?: boolean; currentSequence: number; applied: Array<{ id: string; kind: WhiteboardOperationKind; sequence: number }>; whiteboard: Whiteboard };
export type WhiteboardOperationFeed = { ok: boolean; currentSequence: number; revision: number; updatedAt?: string; resetRequired: boolean; snapshot?: unknown; operations: WhiteboardOperation[]; hasMore?: boolean; returnedThroughSequence?: number };

/** Never apply a partial or non-contiguous operation feed as a complete remote state.
 * The server's watermark may be newer than the page of operations it returned.
 * Reload the authoritative Whiteboard for any gap, truncation or racing read.
 */
export function planWhiteboardFeedSync(
  localSequence: number, localRevision: number, feed: WhiteboardOperationFeed,
): { action: "none" | "apply" | "refresh"; reason: string } {
  if (!feed || !feed.ok || feed.resetRequired) return { action: "refresh", reason: "reset" };
  const remoteSequence = feed.currentSequence;
  if (![localSequence, localRevision, remoteSequence, feed.revision].every((value) => Number.isSafeInteger(value) && value >= 0)
      || !Array.isArray(feed.operations) || remoteSequence < localSequence) return { action: "refresh", reason: "invalid-sequence" };
  if (feed.operations.length === 0) {
    if (remoteSequence !== localSequence || feed.revision > localRevision || feed.hasMore) return { action: "refresh", reason: "missing-or-metadata" };
    return { action: "none", reason: "current" };
  }
  const complete = !feed.hasMore
    && feed.operations.length === remoteSequence - localSequence
    && feed.operations.every((operation, index) => operation.sequence === localSequence + index + 1)
    && (feed.returnedThroughSequence === undefined || feed.returnedThroughSequence === remoteSequence);
  return complete ? { action: "apply", reason: "contiguous" } : { action: "refresh", reason: "incomplete-feed" };
}


function operationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `wbop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function changedKeys(base: Record<string, any>, next: Record<string, any>) {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  return [...keys].filter((key) => key !== "id" && !jsonEqual(base[key], next[key]));
}

function elementOperation(base: WhiteboardElement, next: WhiteboardElement): WhiteboardOperation | null {
  const changes = changedKeys(base as Record<string, any>, next as Record<string, any>);
  if (!changes.length) return null;
  const moveOnly = changes.every((key) => key === "x" || key === "y");
  if (moveOnly) return { id: operationId(), kind: "element.move", payload: { id: next.id, x: (next as any).x, y: (next as any).y } };
  const resizeOnly = changes.every((key) => ["x", "y", "width", "height"].includes(key));
  if (resizeOnly) return { id: operationId(), kind: "element.resize", payload: { id: next.id, x: (next as any).x, y: (next as any).y, width: (next as any).width, height: (next as any).height } };
  const patch = Object.fromEntries(changes.map((key) => [key, (next as any)[key]]));
  return { id: operationId(), kind: "element.patch", payload: { id: next.id, patch } };
}

export function buildWhiteboardOperations(base: Whiteboard, draft: Whiteboard): WhiteboardOperation[] {
  const operations: WhiteboardOperation[] = [];
  const baseById = new Map((base.elements || []).map((element) => [element.id, element]));
  const nextById = new Map((draft.elements || []).map((element) => [element.id, element]));
  for (const element of base.elements || []) if (!nextById.has(element.id)) operations.push({ id: operationId(), kind: "element.delete", payload: { id: element.id } });

  const changedExisting = (draft.elements || []).flatMap((element) => {
    const previous = baseById.get(element.id);
    if (!previous) {
      operations.push({ id: operationId(), kind: "element.create", payload: { element } });
      return [];
    }
    const changes = changedKeys(previous as Record<string, any>, element as Record<string, any>);
    return changes.length ? [{ previous, element, changes }] : [];
  });

  // Group/ungroup is a single semantic operation so collaborators do not observe a
  // selection half inside and half outside a group while an offline batch replays.
  const groupBuckets = new Map<string, string[]>();
  const remaining = changedExisting.filter(({ element, changes }) => {
    if (changes.length !== 1 || changes[0] !== "groupId") return true;
    const groupId = (element as any).groupId == null ? null : String((element as any).groupId);
    const bucketKey = groupId == null ? "$ungroup" : groupId;
    const ids = groupBuckets.get(bucketKey) || [];
    ids.push(element.id);
    groupBuckets.set(bucketKey, ids);
    return false;
  });
  for (const [bucketKey, ids] of groupBuckets) operations.push({ id: operationId(), kind: "group.set", payload: { ids, groupId: bucketKey === "$ungroup" ? null : bucketKey } });

  // A drag of a multi-selection should remain one transform in the sequenced log.
  // This keeps conflict targets granular while avoiding N independent move events.
  const transformBuckets = new Map<string, { ids: string[]; dx: number; dy: number }>();
  const nonTransformChanges = remaining.filter(({ previous, element, changes }) => {
    if (!changes.length || !changes.every((key) => key === "x" || key === "y")) return true;
    const dx = Number((element as any).x || 0) - Number((previous as any).x || 0);
    const dy = Number((element as any).y || 0) - Number((previous as any).y || 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return true;
    const key = `${dx}:${dy}`;
    const bucket = transformBuckets.get(key) || { ids: [], dx, dy };
    bucket.ids.push(element.id);
    transformBuckets.set(key, bucket);
    return false;
  });
  for (const bucket of transformBuckets.values()) {
    if (bucket.ids.length > 1) operations.push({ id: operationId(), kind: "batch.transform", payload: { ids: bucket.ids, dx: bucket.dx, dy: bucket.dy } });
    else {
      const element = nextById.get(bucket.ids[0]);
      if (element) operations.push({ id: operationId(), kind: "element.move", payload: { id: element.id, x: (element as any).x, y: (element as any).y } });
    }
  }

  for (const { previous, element } of nonTransformChanges) {
    const operation = elementOperation(previous, element);
    if (operation) operations.push(operation);
  }

  const settingsPatch: Record<string, unknown> = {};
  const settings: Array<keyof Whiteboard> = ["name", "description", "projectId", "categories", "labels", "productionLinks", "backgroundColor", "gridColor", "gridStyle", "canvasWidth", "canvasHeight"];
  for (const key of settings) if (!jsonEqual(base[key], draft[key])) settingsPatch[key] = draft[key] ?? null;
  if (Object.keys(settingsPatch).length) operations.push({ id: operationId(), kind: "settings.patch", payload: { patch: settingsPatch } });
  return operations;
}

function applyOne(elements: WhiteboardElement[], settings: Record<string, any>, operation: WhiteboardOperation) {
  const payload = operation.payload || {};
  const id = String(payload.id || "");
  const index = id ? elements.findIndex((element) => element.id === id) : -1;
  if (operation.kind === "element.create") {
    const element = payload.element as WhiteboardElement | undefined;
    if (element && !elements.some((candidate) => candidate.id === element.id)) elements.push(element);
  } else if (operation.kind === "element.delete" && index >= 0) elements.splice(index, 1);
  else if (operation.kind === "element.move" && index >= 0) elements[index] = { ...elements[index], x: Number(payload.x ?? (elements[index] as any).x), y: Number(payload.y ?? (elements[index] as any).y) } as WhiteboardElement;
  else if (operation.kind === "element.resize" && index >= 0) elements[index] = { ...elements[index], ...Object.fromEntries(["x", "y", "width", "height"].filter((key) => payload[key] !== undefined).map((key) => [key, Number(payload[key])])) } as WhiteboardElement;
  else if (operation.kind === "element.patch" && index >= 0) elements[index] = { ...elements[index], ...((payload.patch && typeof payload.patch === "object") ? payload.patch as Record<string, unknown> : {}), id } as WhiteboardElement;
  else if (operation.kind === "group.set") {
    const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(String) : []); const groupId = payload.groupId == null ? null : String(payload.groupId);
    for (let i = 0; i < elements.length; i += 1) if (ids.has(elements[i].id)) elements[i] = { ...elements[i], groupId } as WhiteboardElement;
  } else if (operation.kind === "batch.transform") {
    const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(String) : []); const dx = Number(payload.dx || 0); const dy = Number(payload.dy || 0);
    for (let i = 0; i < elements.length; i += 1) if (ids.has(elements[i].id)) elements[i] = { ...elements[i], x: Number((elements[i] as any).x || 0) + dx, y: Number((elements[i] as any).y || 0) + dy } as WhiteboardElement;
  } else if (operation.kind === "history.restore") {
    const replacements = Array.isArray(payload.elements) ? payload.elements as WhiteboardElement[] : [];
    for (const replacement of replacements) {
      const targetIndex = elements.findIndex((element) => element.id === replacement.id);
      if (targetIndex >= 0) elements[targetIndex] = { ...replacement };
    }
  } else if (operation.kind === "settings.patch" && payload.patch && typeof payload.patch === "object") Object.assign(settings, payload.patch);
  else if (operation.kind === "snapshot.restore" && payload.snapshot && typeof payload.snapshot === "object") {
    const snapshot = payload.snapshot as Record<string, any>;
    elements.splice(0, elements.length, ...(Array.isArray(snapshot.elements) ? snapshot.elements as WhiteboardElement[] : []));
    if (snapshot.settings && typeof snapshot.settings === "object" && !Array.isArray(snapshot.settings)) Object.assign(settings, snapshot.settings as Record<string, unknown>);
    settings.categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
    settings.labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
    settings.productionLinks = snapshot.productionLinks && typeof snapshot.productionLinks === "object" && !Array.isArray(snapshot.productionLinks) ? snapshot.productionLinks : {};
  }
}

export function applyWhiteboardOperations(base: Whiteboard, operations: WhiteboardOperation[], currentSequence?: number, revision?: number): Whiteboard {
  const elements = (base.elements || []).map((element) => ({ ...element })) as WhiteboardElement[];
  const settings: Record<string, any> = {
    name: base.name, description: base.description, projectId: base.projectId || null, categories: base.categories || [], labels: base.labels || [], productionLinks: base.productionLinks || {},
    backgroundColor: base.backgroundColor, gridColor: base.gridColor, gridStyle: base.gridStyle, canvasWidth: base.canvasWidth, canvasHeight: base.canvasHeight,
  };
  for (const operation of operations) applyOne(elements, settings, operation);
  return { ...base, ...settings, elements, operationSequence: currentSequence ?? base.operationSequence ?? 0, revision: revision ?? base.revision };
}

export function whiteboardOperationTargets(operation: WhiteboardOperation) {
  if (Array.isArray(operation.targets)) return operation.targets.map(String);
  if (operation.kind === "settings.patch") return ["$settings"];
  if (operation.kind === "snapshot.restore") return ["$document"];
  const payload = operation.payload || {};
  if (operation.kind === "history.restore") return Array.isArray(payload.elements) ? payload.elements.map((item: any) => String(item?.id || "")).filter(Boolean) : [];
  if (operation.kind === "element.create") return [(payload.element as any)?.id].filter(Boolean).map(String);
  if (["element.move", "element.resize", "element.patch", "element.delete"].includes(operation.kind)) return [payload.id].filter(Boolean).map(String);
  if (operation.kind === "group.set" || operation.kind === "batch.transform") return Array.isArray(payload.ids) ? payload.ids.map(String) : [];
  return [];
}

export function whiteboardDraftTargets(base: Whiteboard, draft: Whiteboard) {
  return new Set(buildWhiteboardOperations(base, draft).flatMap(whiteboardOperationTargets));
}
