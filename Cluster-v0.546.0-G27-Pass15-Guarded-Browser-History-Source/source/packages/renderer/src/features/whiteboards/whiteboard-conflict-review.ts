import type { Whiteboard, WhiteboardElement } from "../application/application-models";

/**
 * Field-level three-way review against the exact Whiteboard snapshot last edited.
 * The returned document is a local draft only: it is NEVER a server write.
 * The normal operation batch must still pass the server's baseSequence guard.
 */
export type WhiteboardConflictChoice = "mine" | "server";
export type WhiteboardConflict = {
  key: string;
  label: string;
  scope: "element" | "settings";
  minePreview: string;
  serverPreview: string;
};
export type WhiteboardConflictReview = {
  conflicts: WhiteboardConflict[];
  /** Applying this document still requires authorization and a fresh revisioned commit. */
  resolve: (choices: Readonly<Record<string, WhiteboardConflictChoice>>) => Whiteboard | null;
  localChanges: number;
  remoteChanges: number;
};

const SETTINGS: ReadonlyArray<keyof Whiteboard> = [
  "name", "description", "projectId", "canvasWidth", "canvasHeight",
  "backgroundColor", "gridColor", "gridStyle", "categories", "labels", "productionLinks",
];
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fieldKey = (elementId: string, field: string) => `element:${encodeURIComponent(elementId)}:${encodeURIComponent(field)}`;
const settingKey = (field: string) => `settings:${field}`;
function preview(value: unknown): string {
  if (value === undefined) return "Not set / removed";
  if (value === null) return "None";
  if (value === "") return "(empty text)";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) return "Not set";
  return raw.length > 160 ? `${raw.slice(0, 156)}… (${raw.length} chars)` : raw;
}

export function reviewWhiteboardConflict(base: Whiteboard, mine: Whiteboard, server: Whiteboard): WhiteboardConflictReview {
  if (base.id !== mine.id || base.id !== server.id) throw new Error("Whiteboard identities must match for conflict review.");
  const baseElements = new Map((base.elements || []).map((item) => [item.id, item]));
  const mineElements = new Map((mine.elements || []).map((item) => [item.id, item]));
  const serverElements = new Map((server.elements || []).map((item) => [item.id, item]));
  // Don't allow duplicate IDs to turn a merge into an implicit delete/replace.
  if ([base, mine, server].some((doc) => new Set((doc.elements || []).map((item) => item.id)).size !== (doc.elements || []).length)) {
    throw new Error("Whiteboard with duplicate element IDs cannot be merged safely.");
  }
  const conflicts: WhiteboardConflict[] = [];
  const conflictKeys = new Set<string>();
  let collecting = true;
  let localChanges = 0;
  let remoteChanges = 0;
  const select = (key: string, label: string, scope: WhiteboardConflict["scope"], before: unknown, local: unknown, latest: unknown, choices: Readonly<Record<string, WhiteboardConflictChoice>>): unknown => {
    const localChanged = !equal(before, local);
    const remoteChanged = !equal(before, latest);
    if (collecting && localChanged) localChanges += 1;
    if (collecting && remoteChanged) remoteChanges += 1;
    if (!localChanged) return latest;
    if (!remoteChanged || equal(local, latest)) return local;
    // Collect conflicts during the first pass, and resolve during a second pass.
    if (!conflictKeys.has(key)) { conflictKeys.add(key); conflicts.push({ key, label, scope, minePreview: preview(local), serverPreview: preview(latest) }); }
    return choices[key] === "mine" ? local : latest;
  };
  const build = (choices: Readonly<Record<string, WhiteboardConflictChoice>>): Whiteboard => {
    const result: Whiteboard = { ...server, elements: [] };
    for (const field of SETTINGS) {
      const picked = select(settingKey(String(field)), String(field), "settings", base[field], mine[field], server[field], choices);
      (result as unknown as Record<string, unknown>)[field] = picked;
    }
    const ids = [...new Set([...(server.elements || []).map((e) => e.id), ...(mine.elements || []).map((e) => e.id), ...(base.elements || []).map((e) => e.id)])];
    const elements: WhiteboardElement[] = [];
    for (const id of ids) {
      const before = baseElements.get(id);
      const local = mineElements.get(id);
      const latest = serverElements.get(id);
      // A concurrent creation/deletion of the same identity needs an explicit
      // whole-object choice, never silent resurrection or discarded deletion.
      if (!before || !local || !latest) {
        const selected = select(fieldKey(id, "$presence"), `Object ${id}: existence or deletion`, "element", before, local, latest, choices) as WhiteboardElement | undefined;
        if (selected) elements.push(selected);
        continue;
      }
      const element: Record<string, unknown> = { ...latest };
      const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(latest)]);
      for (const field of keys) {
        if (field === "id") continue;
        const selected = select(fieldKey(id, field), `Object ${id}: ${field}`, "element", (before as unknown as Record<string, unknown>)[field], (local as unknown as Record<string, unknown>)[field], (latest as unknown as Record<string, unknown>)[field], choices);
        if (selected === undefined) delete element[field];
        else element[field] = selected;
      }
      elements.push(element as unknown as WhiteboardElement);
    }
    result.elements = elements;
    return result;
  };
  // Assess once. Counts describe the current comparison, not how many times
  // the caller tries different choices in the review UI.
  build({});
  const computedLocal = localChanges;
  const computedRemote = remoteChanges;
  collecting = false;
  return {
    conflicts,
    localChanges: computedLocal,
    remoteChanges: computedRemote,
    resolve(choices) {
      if (conflicts.some(({ key }) => choices[key] !== "mine" && choices[key] !== "server")) return null;
      return build(choices);
    },
  };
}
