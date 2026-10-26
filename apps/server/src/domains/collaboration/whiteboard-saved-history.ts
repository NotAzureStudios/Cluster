/** Durable, actor-scoped Whiteboard history. These helpers do not authorize writes.
 * The route owns authorization, compare-and-swap and atomic sequence allocation.
 */
export type WhiteboardHistoryElement = Record<string, unknown> & { id: string };
export type WhiteboardHistoryCapture = { before: string; after: string; targets: string[] } | null;
const REVERSIBLE = new Set(["element.move", "element.resize", "element.patch", "group.set", "batch.transform"]);
const MAX_HISTORY_BYTES = 65536;
const MAX_TARGETS = 100;

export function captureWhiteboardHistory(
  kind: string, targets: string[], beforeElements: unknown[], afterElements: unknown[],
): WhiteboardHistoryCapture {
  if (!REVERSIBLE.has(kind) || !targets.length || targets.length > MAX_TARGETS || new Set(targets).size !== targets.length) return null;
  const pick = (elements: unknown[]) => targets.map((target) =>
    elements.find((entry: any) => entry && typeof entry === "object" && entry.id === target));
  const before = pick(beforeElements), after = pick(afterElements);
  if (before.some((item) => !item || typeof item !== "object") || after.some((item) => !item || typeof item !== "object")) return null;
  const beforeJson = JSON.stringify({ elements: before });
  const afterJson = JSON.stringify({ elements: after });
  if (Buffer.byteLength(beforeJson, "utf8") > MAX_HISTORY_BYTES || Buffer.byteLength(afterJson, "utf8") > MAX_HISTORY_BYTES || beforeJson === afterJson) return null;
  return { before: beforeJson, after: afterJson, targets };
}

export function ensureWhiteboardHistoryNoCollision(
  targetIds: string[], intervening: Array<{ sequence: number; targets: unknown; kind: string }>,
) {
  const targets = new Set(targetIds);
  return intervening.find((row) => {
    const values = Array.isArray(row.targets) ? row.targets : (() => {
      try { const v = JSON.parse(String(row.targets || "[]")); return Array.isArray(v) ? v : []; } catch { return ["$document"]; }
    })();
    return values.some((value: unknown) => value === "$document" || targets.has(String(value)));
  }) || null;
}

/** Internal-only operation. The normal operation batch schema never admits it. */
export function restoreWhiteboardHistoryElements(elements: any[], payload: unknown, canManage: boolean) {
  const replacements = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as any).elements : null;
  if (!Array.isArray(replacements) || !replacements.length || replacements.length > MAX_TARGETS) throw new Error("Invalid saved Whiteboard history payload.");
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_HISTORY_BYTES) throw new Error("Saved Whiteboard history payload exceeds the size limit.");
  const seen = new Set<string>();
  for (const replacement of replacements) {
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement) || !String(replacement.id || "").trim()) throw new Error("Saved Whiteboard history has an invalid element.");
    const id = String(replacement.id);
    if (seen.has(id)) throw new Error("Saved Whiteboard history contains a duplicate element.");
    seen.add(id);
    const index = elements.findIndex((element) => element && String(element.id || "") === id);
    if (index < 0) throw new Error("The target Whiteboard element is missing.");
    if (elements[index].locked && !canManage) throw new Error("A locked Whiteboard element requires manage access.");
    elements[index] = { ...replacement, id };
  }
}
