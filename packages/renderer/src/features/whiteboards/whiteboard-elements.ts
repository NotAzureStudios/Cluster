import type {
  WhiteboardElement,
  WhiteboardPathElement,
  WhiteboardPoint,
  WhiteboardShapeElement,
} from "../application/application-models";

export function makeWhiteboardId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function pathFromPoints(points: WhiteboardPoint[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function normalizeWhiteboardBox(element: { x: number; y: number; width: number; height: number }) {
  const x = element.width < 0 ? element.x + element.width : element.x;
  const y = element.height < 0 ? element.y + element.height : element.y;
  return { x, y, width: Math.abs(element.width), height: Math.abs(element.height) };
}

export function diamondPoints(rect: { x: number; y: number; width: number; height: number }) {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  return `${midX},${rect.y} ${rect.x + rect.width},${midY} ${midX},${rect.y + rect.height} ${rect.x},${midY}`;
}

export function cloudPath(rect: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = rect;
  const w = Math.max(width, 24);
  const h = Math.max(height, 24);
  return [
    `M ${x + w * 0.24} ${y + h * 0.68}`,
    `C ${x + w * 0.08} ${y + h * 0.68}, ${x + w * 0.04} ${y + h * 0.48}, ${x + w * 0.18} ${y + h * 0.42}`,
    `C ${x + w * 0.18} ${y + h * 0.22}, ${x + w * 0.42} ${y + h * 0.2}, ${x + w * 0.48} ${y + h * 0.34}`,
    `C ${x + w * 0.62} ${y + h * 0.16}, ${x + w * 0.88} ${y + h * 0.28}, ${x + w * 0.82} ${y + h * 0.48}`,
    `C ${x + w * 0.98} ${y + h * 0.52}, ${x + w * 0.92} ${y + h * 0.72}, ${x + w * 0.74} ${y + h * 0.72}`,
    "Z",
  ].join(" ");
}

export function calloutPoints(rect: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = rect;
  const tailX = x + width * 0.3;
  return `${x},${y} ${x + width},${y} ${x + width},${y + height * 0.78} ${x + width * 0.52},${y + height * 0.78} ${tailX},${y + height} ${x + width * 0.34},${y + height * 0.78} ${x},${y + height * 0.78}`;
}

function distanceBetween(a: WhiteboardPoint, b: WhiteboardPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point: WhiteboardPoint, start: WhiteboardPoint, end: WhiteboardPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distanceBetween(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distanceBetween(point, { x: start.x + t * dx, y: start.y + t * dy });
}

/** Clip each pen segment against the brush circle. Splitting only at actual
 * intersections preserves long, sparsely sampled strokes outside the brush. */
function erasePathElement(element: WhiteboardPathElement, point: WhiteboardPoint, radius: number): WhiteboardPathElement[] {
  const effectiveRadius = Math.max(0.5, radius + Math.max(0, element.strokeWidth) / 2);
  if (element.points.length < 2) return element.points.length && distanceBetween(element.points[0], point) > effectiveRadius ? [element] : [];
  const survivors: WhiteboardPoint[][] = [];
  let fragment: WhiteboardPoint[] = [];
  let clipped = false;
  const epsilon = 1e-6;
  const append = (p: WhiteboardPoint) => {
    const last = fragment[fragment.length - 1];
    if (!last || distanceBetween(last, p) > epsilon) fragment.push(p);
  };
  const finish = () => {
    if (fragment.length >= 2 && fragment.some((p) => distanceBetween(p, fragment[0]) > epsilon)) survivors.push(fragment);
    fragment = [];
  };
  for (let i = 1; i < element.points.length; i += 1) {
    const start = element.points[i - 1];
    const end = element.points[i];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < epsilon) continue;
    const fx = start.x - point.x;
    const fy = start.y - point.y;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - effectiveRadius * effectiveRadius;
    const discriminant = b * b - 4 * lengthSquared * c;
    const cuts = [0, 1];
    if (discriminant > 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * lengthSquared), (-b + root) / (2 * lengthSquared)]) {
        if (t > epsilon && t < 1 - epsilon) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    const interpolate = (t: number) => ({ x: start.x + dx * t, y: start.y + dy * t });
    for (let j = 1; j < cuts.length; j += 1) {
      const t0 = cuts[j - 1];
      const t1 = cuts[j];
      if (t1 - t0 < epsilon) continue;
      const midpoint = interpolate((t0 + t1) / 2);
      const inside = distanceBetween(midpoint, point) < effectiveRadius;
      if (inside) { clipped = true; finish(); }
      else { append(interpolate(t0)); append(interpolate(t1)); }
    }
  }
  if (!clipped) return [element];
  finish();
  return survivors.map((points, index) => ({ ...element, id: index === 0 ? element.id : makeWhiteboardId(), points }));
}

function whiteboardElementContainsPoint(element: WhiteboardElement, point: WhiteboardPoint, radius: number) {
  if (element.type === "path") {
    return element.points.some((pathPoint, index) => {
      const previousPoint = element.points[index - 1];
      return distanceBetween(point, pathPoint) <= radius || Boolean(previousPoint && distancePointToSegment(point, previousPoint, pathPoint) <= radius);
    });
  }
  if (element.type === "line" || element.type === "arrow") {
    return distancePointToSegment(point, { x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }) <= radius;
  }
  if (element.type === "text") {
    const width = Math.max(40, element.text.length * element.fontSize * 0.55);
    return point.x >= element.x - radius && point.x <= element.x + width + radius && point.y >= element.y - element.fontSize - radius && point.y <= element.y + radius;
  }
  if (element.type === "image" || element.type === "card") {
    return point.x >= element.x - radius && point.x <= element.x + element.width + radius && point.y >= element.y - radius && point.y <= element.y + element.height + radius;
  }
  if (isShapeElement(element)) {
    const rect = normalizeWhiteboardBox(element);
    return point.x >= rect.x - radius && point.x <= rect.x + rect.width + radius && point.y >= rect.y - radius && point.y <= rect.y + rect.height + radius;
  }
  return false;
}

/** Brush erases freehand/line geometry; Object mode deliberately deletes whole
 * diagram objects. Shapes, images, text and linked cards remain intact in Brush. */
export function eraseWhiteboardElementsAt(items: WhiteboardElement[], point: WhiteboardPoint, radius: number, mode: "brush" | "object" = "brush"): WhiteboardElement[] {
  const next: WhiteboardElement[] = [];
  for (const element of items) {
    if (element.locked) { next.push(element); continue; }
    if (mode === "brush" && element.type === "path") {
      next.push(...erasePathElement(element, point, radius));
      continue;
    }
    if (mode === "brush" && element.type === "line" && !element.fromId && !element.toId) {
      // Free-standing lines are brushable. Preserve the visible surviving spans
      // as independent paths instead of deleting the full connector.
      const fragments = erasePathElement({ id: element.id, type: "path", points: [{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }], stroke: element.stroke, strokeWidth: element.strokeWidth, opacity: element.opacity, dashed: element.dashed, categoryId: element.categoryId, labelIds: element.labelIds, locked: element.locked }, point, radius);
      if (fragments.length === 1 && fragments[0].points[0].x === element.x1 && fragments[0].points[0].y === element.y1 && fragments[0].points.at(-1)?.x === element.x2 && fragments[0].points.at(-1)?.y === element.y2) next.push(element);
      else next.push(...fragments);
      continue;
    }
    if (mode === "brush" || !whiteboardElementContainsPoint(element, point, radius)) next.push(element);
  }
  return next;
}

export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  return `${x2},${y2} ${x2 + Math.cos(left) * size},${y2 + Math.sin(left) * size} ${x2 + Math.cos(right) * size},${y2 + Math.sin(right) * size}`;
}

export function isShapeElement(element: WhiteboardElement): element is WhiteboardShapeElement {
  return element.type === "box" || element.type === "ellipse" || element.type === "diamond" || element.type === "sticky" || element.type === "process" || element.type === "terminator" || element.type === "database" || element.type === "cloud" || element.type === "actor" || element.type === "frame" || element.type === "callout" || element.type === "swimlane";
}

export function moveWhiteboardElement(element: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  if (element.type === "path") return { ...element, points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  if (element.type === "line" || element.type === "arrow") return { ...element, x1: element.x1 + dx, y1: element.y1 + dy, x2: element.x2 + dx, y2: element.y2 + dy };
  if (element.type === "text" || element.type === "image" || element.type === "card") return { ...element, x: element.x + dx, y: element.y + dy };
  if (isShapeElement(element)) return { ...element, x: element.x + dx, y: element.y + dy };
  return element;
}

export function updateWhiteboardElementStyle(
  element: WhiteboardElement,
  options: {
    stroke: string;
    fill: string;
    fillEnabled: boolean;
    textColor: string;
    strokeWidth: number;
    fontSize: number;
    labelText: string;
    opacity?: number;
    dashed?: boolean;
    shadow?: boolean;
  },
): WhiteboardElement {
  if (element.type === "path") return { ...element, stroke: options.stroke, strokeWidth: options.strokeWidth, opacity: options.opacity, dashed: options.dashed };
  if (element.type === "line" || element.type === "arrow") return { ...element, stroke: options.stroke, strokeWidth: options.strokeWidth, text: options.labelText, opacity: options.opacity, dashed: options.dashed };
  if (element.type === "text") return { ...element, stroke: options.stroke, fontSize: options.fontSize, text: options.labelText || element.text };
  if (element.type === "image") return { ...element, alt: options.labelText.trim() || element.alt, opacity: options.opacity };
  if (element.type === "card") {
    const [title, ...body] = options.labelText.split("\n");
    return { ...element, title: title || element.title, text: body.join("\n") || element.text, accent: options.stroke, fill: options.fillEnabled ? options.fill : element.fill, textColor: options.textColor, opacity: options.opacity };
  }
  if (isShapeElement(element)) {
    return {
      ...element,
      stroke: options.stroke,
      strokeWidth: options.strokeWidth,
      fill: options.fillEnabled ? options.fill : "transparent",
      textColor: options.textColor,
      text: options.labelText,
      opacity: options.opacity,
      dashed: options.dashed,
      shadow: options.shadow,
    };
  }
  return element;
}

export function getElementText(element?: WhiteboardElement | null) {
  if (!element || element.type === "path") return "";
  if (element.type === "image") return element.alt || element.originalName || "Image";
  if (element.type === "card") return [element.title, element.text].filter(Boolean).join("\n");
  return element.text || "";
}

export function whiteboardElementBounds(element: WhiteboardElement) {
  if (element.type === "path") {
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    const minX = Math.min(...xs, 0);
    const minY = Math.min(...ys, 0);
    return { x: minX, y: minY, width: Math.max(12, Math.max(...xs, 0) - minX), height: Math.max(12, Math.max(...ys, 0) - minY) };
  }
  if (element.type === "line" || element.type === "arrow") {
    return { x: Math.min(element.x1, element.x2), y: Math.min(element.y1, element.y2), width: Math.max(12, Math.abs(element.x2 - element.x1)), height: Math.max(12, Math.abs(element.y2 - element.y1)) };
  }
  if (element.type === "text") return { x: element.x - 6, y: element.y - (element.fontSize || 20), width: Math.max(70, element.text.length * (element.fontSize || 20) * 0.55), height: (element.fontSize || 20) + 12 };
  if (element.type === "image" || element.type === "card") return { x: element.x, y: element.y, width: element.width, height: element.height };
  if (isShapeElement(element)) return normalizeWhiteboardBox(element);
  return { x: 0, y: 0, width: 1, height: 1 };
}


function whiteboardBoundsCenter(bounds: { x: number; y: number; width: number; height: number }) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function whiteboardConnectorAnchor(bounds: { x: number; y: number; width: number; height: number }, toward: WhiteboardPoint) {
  const center = whiteboardBoundsCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const halfWidth = Math.max(1, bounds.width / 2);
  const halfHeight = Math.max(1, bounds.height / 2);
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 1e-6);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** Re-anchor smart connectors after their source or target elements move. */
export function reflowWhiteboardConnectors(items: WhiteboardElement[]): WhiteboardElement[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((element) => {
    if ((element.type !== "line" && element.type !== "arrow") || (!element.fromId && !element.toId)) return element;
    const from = element.fromId ? byId.get(element.fromId) : null;
    const to = element.toId ? byId.get(element.toId) : null;
    if (!from && !to) return element;
    const fromBounds = from ? whiteboardElementBounds(from) : null;
    const toBounds = to ? whiteboardElementBounds(to) : null;
    const fromCenter = fromBounds ? whiteboardBoundsCenter(fromBounds) : { x: element.x1, y: element.y1 };
    const toCenter = toBounds ? whiteboardBoundsCenter(toBounds) : { x: element.x2, y: element.y2 };
    const start = fromBounds ? whiteboardConnectorAnchor(fromBounds, toCenter) : { x: element.x1, y: element.y1 };
    const end = toBounds ? whiteboardConnectorAnchor(toBounds, fromCenter) : { x: element.x2, y: element.y2 };
    return { ...element, x1: Math.round(start.x), y1: Math.round(start.y), x2: Math.round(end.x), y2: Math.round(end.y) };
  });
}
