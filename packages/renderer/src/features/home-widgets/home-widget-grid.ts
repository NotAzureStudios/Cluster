/* Home grid engine. Widgets sit on a 12-column grid at an explicit x/y and
   take one of four fixed footprints, like iOS widgets: small 3×2, medium 6×2,
   large 6×4 and extra large 12×4. Placement is free — a widget stays where it
   was put — and anything it lands on is pushed down out of the way. Packing
   (closing every gap, reading order kept) only happens when asked. */

export const HOME_GRID_COLUMNS = 12;

export type HomeWidgetSize = "small" | "medium" | "large" | "xlarge";

export const HOME_WIDGET_SIZES: Record<HomeWidgetSize, { w: number; h: number; label: string }> = {
  small: { w: 3, h: 2, label: "Small" },
  medium: { w: 6, h: 2, label: "Medium" },
  large: { w: 6, h: 4, label: "Large" },
  xlarge: { w: 12, h: 4, label: "Extra large" },
};

export const HOME_WIDGET_SIZE_ORDER: HomeWidgetSize[] = ["small", "medium", "large", "xlarge"];

export function isHomeWidgetSize(value: unknown): value is HomeWidgetSize {
  return typeof value === "string" && value in HOME_WIDGET_SIZES;
}

export type GridItem = { id: string; x: number; y: number; size: HomeWidgetSize };
type Rect = { x: number; y: number; w: number; h: number };

export function gridRect(item: Pick<GridItem, "x" | "y" | "size">): Rect {
  const { w, h } = HOME_WIDGET_SIZES[item.size];
  return { x: item.x, y: item.y, w, h };
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function clampGridX(x: number, size: HomeWidgetSize) {
  return Math.max(0, Math.min(HOME_GRID_COLUMNS - HOME_WIDGET_SIZES[size].w, Math.round(x) || 0));
}

function clampY(y: number) {
  return Math.max(0, Math.round(y) || 0);
}

export function gridRows(items: GridItem[]) {
  return items.reduce((rows, item) => Math.max(rows, item.y + HOME_WIDGET_SIZES[item.size].h), 0);
}

export function readingOrder<T extends GridItem>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

/** The highest free slot a footprint fits in, scanning rows top-down, left to right. */
export function firstFit(items: GridItem[], size: HomeWidgetSize): { x: number; y: number } {
  const { w, h } = HOME_WIDGET_SIZES[size];
  const rects = items.map(gridRect);
  const limit = gridRows(items) + 1;
  for (let y = 0; y <= limit; y += 1) {
    for (let x = 0; x + w <= HOME_GRID_COLUMNS; x += 1) {
      const candidate = { x, y, w, h };
      if (!rects.some((rect) => overlaps(rect, candidate))) return { x, y };
    }
  }
  return { x: 0, y: limit };
}

/* Keep `fixed` where it is and settle everything else around it: an item that
   collides with anything already settled drops to just below it. Items are
   settled in reading order, so the board never shuffles sideways. */
function settle<T extends GridItem>(items: T[], fixedIds: string[]): T[] {
  const fixed = items.filter((item) => fixedIds.includes(item.id));
  const placed: T[] = [...fixed];
  for (const item of readingOrder(items.filter((entry) => !fixedIds.includes(entry.id)))) {
    let y = item.y;
    for (;;) {
      const rect = { ...gridRect(item), y };
      const hits = placed.filter((other) => overlaps(rect, gridRect(other)));
      if (!hits.length) break;
      y = Math.max(...hits.map((other) => other.y + HOME_WIDGET_SIZES[other.size].h));
    }
    placed.push(y === item.y ? item : { ...item, y });
  }
  const order = new Map(items.map((item, index) => [item.id, index]));
  return placed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Put one widget at a cell. A same-size widget it lands squarely on trades
 *  places with it; anything else in the way is pushed down. */
export function moveGridItem<T extends GridItem>(items: T[], id: string, x: number, y: number): T[] {
  const moving = items.find((item) => item.id === id);
  if (!moving) return items;
  const target = { ...moving, x: clampGridX(x, moving.size), y: clampY(y) };
  if (target.x === moving.x && target.y === moving.y) return items;
  const others = items.filter((item) => item.id !== id);
  const hits = others.filter((item) => overlaps(gridRect(item), gridRect(target)));
  if (hits.length === 1 && hits[0].size === moving.size) {
    const swapped = { ...hits[0], x: moving.x, y: moving.y };
    const rest = others.filter((item) => item.id !== swapped.id);
    if (!rest.some((item) => overlaps(gridRect(item), gridRect(swapped)))) {
      return items.map((item) => item.id === id ? target : item.id === swapped.id ? swapped : item);
    }
  }
  return settle(items.map((item) => item.id === id ? target : item), [id]);
}

/** Change a widget's footprint in place; it shifts left if it would overhang. */
export function resizeGridItem<T extends GridItem>(items: T[], id: string, size: HomeWidgetSize): T[] {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.size === size) return items;
  const next = { ...item, size, x: clampGridX(item.x, size) };
  return settle(items.map((entry) => entry.id === id ? next : entry), [id]);
}

/** Add a widget in the first gap that fits it. */
export function addGridItem<T extends GridItem>(items: T[], item: Omit<T, "x" | "y">): T[] {
  const slot = firstFit(items, item.size);
  return [...items, { ...item, ...slot } as T];
}

/** Close every gap, keeping reading order: each widget takes the first slot that fits. */
export function packGrid<T extends GridItem>(items: T[]): T[] {
  const placed: T[] = [];
  for (const item of readingOrder(items)) placed.push({ ...item, ...firstFit(placed, item.size) });
  const order = new Map(items.map((item, index) => [item.id, index]));
  return placed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Clamp to the grid and push apart anything overlapping, in reading order. */
export function sanitizeGrid<T extends GridItem>(items: T[]): T[] {
  const clamped = items.map((item) => ({ ...item, x: clampGridX(item.x, item.size), y: clampY(item.y) }));
  return settle(clamped, []);
}

/** Pick the footprint nearest a pointer-sized box, among those a widget allows. */
export function nearestSize(w: number, h: number, allowed: HomeWidgetSize[]): HomeWidgetSize {
  let best = allowed[0] || "small";
  let bestScore = Infinity;
  for (const size of allowed) {
    const dims = HOME_WIDGET_SIZES[size];
    const score = (w - dims.w) ** 2 + ((h - dims.h) * 1.5) ** 2;
    if (score < bestScore) { best = size; bestScore = score; }
  }
  return best;
}
