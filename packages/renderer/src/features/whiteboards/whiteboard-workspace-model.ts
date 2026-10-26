import type { CollaborationPresence } from "../collaboration";
import type { WhiteboardElement, WhiteboardTool } from "../application/application-models";
import { getElementText, whiteboardElementBounds } from "./whiteboard-elements";

export type WhiteboardBounds = { x: number; y: number; width: number; height: number };

export function whiteboardElementsBounds(items: WhiteboardElement[]): WhiteboardBounds | null {
  if (!items.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of items) {
    const bounds = whiteboardElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function whiteboardContentBounds(items: WhiteboardElement[], canvasWidth: number, canvasHeight: number): WhiteboardBounds {
  return whiteboardElementsBounds(items) || { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
}

export function buildWhiteboardPresenceIndex(presence: CollaborationPresence[], currentUserId?: string | null) {
  const remote = presence.filter((item) => item.userId !== currentUserId);
  const selectedElementIds = new Set<string>();
  const editorByElementId = new Map<string, CollaborationPresence>();
  const selectorByElementId = new Map<string, CollaborationPresence>();
  const cursorSignature: string[] = [];
  for (const person of remote) {
    if (person.selection?.entityType === "whiteboard-element" && person.selection.entityId) {
      selectedElementIds.add(person.selection.entityId);
      if (!selectorByElementId.has(person.selection.entityId)) selectorByElementId.set(person.selection.entityId, person);
    }
    if (person.editing?.entityType === "whiteboard-element" && person.editing.entityId && !editorByElementId.has(person.editing.entityId)) {
      editorByElementId.set(person.editing.entityId, person);
    }
    cursorSignature.push(`${person.userId}:${person.cursor?.x || 0}:${person.cursor?.y || 0}`);
  }
  return { remote, selectedElementIds, editorByElementId, selectorByElementId, cursorSignature: cursorSignature.join("|") };
}

export function buildWhiteboardOutline(
  elements: WhiteboardElement[],
  hiddenCategoryIds: Set<string>,
  query: string,
  labelFilter: string,
  toolMeta: Partial<Record<WhiteboardTool, { label: string }>>,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const rows: Array<{ element: WhiteboardElement; index: number; label: string }> = [];
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.categoryId && hiddenCategoryIds.has(element.categoryId)) continue;
    const label = getElementText(element).trim() || toolMeta[element.type as WhiteboardTool]?.label || element.type;
    if (normalizedQuery && !label.toLowerCase().includes(normalizedQuery) && !element.type.toLowerCase().includes(normalizedQuery)) continue;
    if (labelFilter && !(element.labelIds || []).includes(labelFilter)) continue;
    rows.push({ element, index, label });
  }
  return rows;
}
