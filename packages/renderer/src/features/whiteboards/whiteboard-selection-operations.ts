import type { WhiteboardConnectorElement, WhiteboardElement } from "../application/application-models";
import {
  isShapeElement,
  makeWhiteboardId,
  moveWhiteboardElement,
  reflowWhiteboardConnectors,
  updateWhiteboardElementStyle,
  whiteboardElementBounds,
} from "./whiteboard-elements";
import { whiteboardElementsBounds } from "./whiteboard-workspace-model";

export type WhiteboardAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type WhiteboardDistributionAxis = "horizontal" | "vertical";

export type WhiteboardSelectionStyle = {
  stroke: string;
  fill: string;
  fillEnabled: boolean;
  textColor: string;
  strokeWidth: number;
  fontSize: number;
  labelText: string;
  opacity: number;
  dashed: boolean;
  shadow: boolean;
};

export function removeWhiteboardSelection(elements: WhiteboardElement[], selectedIds: ReadonlySet<string>) {
  return elements.filter(
    (element) =>
      !selectedIds.has(element.id) &&
      !(
        (element.type === "line" || element.type === "arrow") &&
        ((element.fromId && selectedIds.has(element.fromId)) || (element.toId && selectedIds.has(element.toId)))
      ),
  );
}

export function duplicateWhiteboardSelection(selectedElements: WhiteboardElement[]) {
  const groupMap = new Map<string, string>();
  const idMap = new Map(selectedElements.map((element) => [element.id, makeWhiteboardId()]));
  return selectedElements.map((element) => {
    let groupId = element.groupId || null;
    if (groupId) {
      if (!groupMap.has(groupId)) groupMap.set(groupId, `whiteboard-group-${Date.now()}-${groupMap.size + 1}`);
      groupId = groupMap.get(groupId) || null;
    }
    const copied = { ...element, id: idMap.get(element.id)!, locked: false, groupId } as WhiteboardElement;
    if (copied.type === "line" || copied.type === "arrow") {
      copied.fromId = copied.fromId ? idMap.get(copied.fromId) || null : null;
      copied.toId = copied.toId ? idMap.get(copied.toId) || null : null;
    }
    return moveWhiteboardElement(copied, 28, 28);
  });
}

export function setWhiteboardSelectionGroup(elements: WhiteboardElement[], selectedIds: ReadonlySet<string>, groupId: string | null, groupIds?: ReadonlySet<string>) {
  return elements.map((element) => {
    if (groupIds) return element.groupId && groupIds.has(element.groupId) ? { ...element, groupId: null } : element;
    return selectedIds.has(element.id) ? { ...element, groupId } : element;
  });
}

export function createWhiteboardSelectionConnector(
  targets: WhiteboardElement[],
  options: { stroke: string; strokeWidth: number; opacity: number; dashed: boolean; categoryId?: string | null; labelId?: string | null },
): WhiteboardConnectorElement {
  return {
    id: makeWhiteboardId(),
    type: "arrow",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    text: "",
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    opacity: options.opacity,
    dashed: options.dashed,
    fromId: targets[0].id,
    toId: targets[1].id,
    categoryId: options.categoryId || null,
    labelIds: options.labelId ? [options.labelId] : [],
    locked: false,
  };
}

export function applyWhiteboardSelectionStyle(elements: WhiteboardElement[], selectedIds: ReadonlySet<string>, style: WhiteboardSelectionStyle) {
  return elements.map((element) => (selectedIds.has(element.id) ? updateWhiteboardElementStyle(element, style) : element));
}

export function reorderWhiteboardElement(elements: WhiteboardElement[], selectedId: string, direction: "forward" | "backward") {
  const index = elements.findIndex((element) => element.id === selectedId);
  if (index < 0) return elements;
  const target = direction === "forward" ? index + 1 : index - 1;
  if (target < 0 || target >= elements.length) return elements;
  const next = [...elements];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function alignWhiteboardSelection(
  elements: WhiteboardElement[],
  selectedIds: ReadonlySet<string>,
  selectedElements: WhiteboardElement[],
  mode: WhiteboardAlignment,
  canvasWidth: number,
  canvasHeight: number,
) {
  const groupBounds = whiteboardElementsBounds(selectedElements);
  if (!groupBounds) return elements;
  return reflowWhiteboardConnectors(
    elements.map((element) => {
      if (!selectedIds.has(element.id)) return element;
      const bounds = whiteboardElementBounds(element);
      let dx = 0;
      let dy = 0;
      if (selectedElements.length > 1) {
        if (mode === "left") dx = groupBounds.x - bounds.x;
        if (mode === "center") dx = groupBounds.x + groupBounds.width / 2 - (bounds.x + bounds.width / 2);
        if (mode === "right") dx = groupBounds.x + groupBounds.width - (bounds.x + bounds.width);
        if (mode === "top") dy = groupBounds.y - bounds.y;
        if (mode === "middle") dy = groupBounds.y + groupBounds.height / 2 - (bounds.y + bounds.height / 2);
        if (mode === "bottom") dy = groupBounds.y + groupBounds.height - (bounds.y + bounds.height);
      } else {
        if (mode === "left") dx = 80 - bounds.x;
        if (mode === "center") dx = canvasWidth / 2 - (bounds.x + bounds.width / 2);
        if (mode === "right") dx = canvasWidth - 80 - (bounds.x + bounds.width);
        if (mode === "top") dy = 80 - bounds.y;
        if (mode === "middle") dy = canvasHeight / 2 - (bounds.y + bounds.height / 2);
        if (mode === "bottom") dy = canvasHeight - 80 - (bounds.y + bounds.height);
      }
      return moveWhiteboardElement(element, Math.round(dx), Math.round(dy));
    }),
  );
}

export function distributeWhiteboardSelection(elements: WhiteboardElement[], selectedElements: WhiteboardElement[], axis: WhiteboardDistributionAxis) {
  const targets = selectedElements.filter((element) => element.type !== "line" && element.type !== "arrow");
  if (targets.length < 3) return elements;
  const ordered = [...targets].sort((left, right) => {
    const a = whiteboardElementBounds(left);
    const b = whiteboardElementBounds(right);
    return axis === "horizontal" ? a.x - b.x : a.y - b.y;
  });
  const first = whiteboardElementBounds(ordered[0]);
  const last = whiteboardElementBounds(ordered[ordered.length - 1]);
  const firstCenter = axis === "horizontal" ? first.x + first.width / 2 : first.y + first.height / 2;
  const lastCenter = axis === "horizontal" ? last.x + last.width / 2 : last.y + last.height / 2;
  const step = (lastCenter - firstCenter) / (ordered.length - 1);
  const targetCenter = new Map(ordered.map((element, index) => [element.id, firstCenter + step * index]));
  return reflowWhiteboardConnectors(
    elements.map((element) => {
      const center = targetCenter.get(element.id);
      if (center === undefined) return element;
      const bounds = whiteboardElementBounds(element);
      const currentCenter = axis === "horizontal" ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2;
      return moveWhiteboardElement(
        element,
        axis === "horizontal" ? Math.round(center - currentCenter) : 0,
        axis === "vertical" ? Math.round(center - currentCenter) : 0,
      );
    }),
  );
}

export function snapWhiteboardSelectionToGrid(elements: WhiteboardElement[], selectedIds: ReadonlySet<string>, gridSize: number) {
  return reflowWhiteboardConnectors(
    elements.map((element) => {
      if (!selectedIds.has(element.id)) return element;
      if (isShapeElement(element)) {
        return {
          ...element,
          x: Math.round(element.x / gridSize) * gridSize,
          y: Math.round(element.y / gridSize) * gridSize,
          width: Math.max(gridSize, Math.round(element.width / gridSize) * gridSize),
          height: Math.max(gridSize, Math.round(element.height / gridSize) * gridSize),
        };
      }
      if (element.type === "text" || element.type === "image" || element.type === "card") {
        return { ...element, x: Math.round(element.x / gridSize) * gridSize, y: Math.round(element.y / gridSize) * gridSize };
      }
      if (element.type === "line" || element.type === "arrow") {
        return {
          ...element,
          x1: Math.round(element.x1 / gridSize) * gridSize,
          y1: Math.round(element.y1 / gridSize) * gridSize,
          x2: Math.round(element.x2 / gridSize) * gridSize,
          y2: Math.round(element.y2 / gridSize) * gridSize,
        };
      }
      return element;
    }),
  );
}

export function resizeWhiteboardSelection(
  elements: WhiteboardElement[],
  selectedIds: ReadonlySet<string>,
  selectedElements: WhiteboardElement[],
  dimension: "width" | "height",
  value: number,
) {
  const bounds = whiteboardElementsBounds(selectedElements);
  if (!bounds) return elements;
  const currentSize = dimension === "width" ? bounds.width : bounds.height;
  if (!Number.isFinite(value) || currentSize <= 0) return elements;
  const scale = Math.max(0.05, Math.min(20, value / currentSize));
  const origin = dimension === "width" ? bounds.x : bounds.y;
  const scaleCoordinate = (coordinate: number) => origin + (coordinate - origin) * scale;
  return reflowWhiteboardConnectors(elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;
    if (element.type === "path") {
      return { ...element, points: element.points.map((point) => dimension === "width" ? { ...point, x: scaleCoordinate(point.x) } : { ...point, y: scaleCoordinate(point.y) }) };
    }
    if (element.type === "line" || element.type === "arrow") {
      return dimension === "width"
        ? { ...element, x1: scaleCoordinate(element.x1), x2: scaleCoordinate(element.x2) }
        : { ...element, y1: scaleCoordinate(element.y1), y2: scaleCoordinate(element.y2) };
    }
    if (element.type === "text") {
      const fontSize = Math.max(8, Math.min(240, Math.round(element.fontSize * scale)));
      return dimension === "width"
        ? { ...element, x: scaleCoordinate(element.x), fontSize }
        : { ...element, y: scaleCoordinate(element.y), fontSize };
    }
    if (element.type === "image" || element.type === "card") {
      return dimension === "width"
        ? { ...element, x: scaleCoordinate(element.x), width: Math.max(24, element.width * scale) }
        : { ...element, y: scaleCoordinate(element.y), height: Math.max(24, element.height * scale) };
    }
    if (isShapeElement(element)) {
      return dimension === "width"
        ? { ...element, x: scaleCoordinate(element.x), width: Math.max(24, element.width * scale) }
        : { ...element, y: scaleCoordinate(element.y), height: Math.max(24, element.height * scale) };
    }
    return element;
  }));
}
