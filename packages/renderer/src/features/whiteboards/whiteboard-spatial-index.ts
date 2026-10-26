import type { WhiteboardElement } from "../application/application-models";
import { whiteboardElementBounds } from "./whiteboard-elements";

export type WhiteboardSpatialViewport = { x: number; y: number; width: number; height: number };

type SpatialEntry = { element: WhiteboardElement; minCellX: number; maxCellX: number; minCellY: number; maxCellY: number };

export type WhiteboardSpatialIndex = {
  readonly cellSize: number;
  readonly elementCount: number;
  readonly buckets: ReadonlyMap<string, readonly WhiteboardElement[]>;
  readonly entries: readonly SpatialEntry[];
};

function cellKey(x: number, y: number) {
  return `${x}:${y}`;
}

function cellRange(value: number, size: number, cellSize: number) {
  const start = Math.floor(value / cellSize);
  const end = Math.floor((value + Math.max(1, size)) / cellSize);
  return [start, end] as const;
}

export function buildWhiteboardSpatialIndex(elements: WhiteboardElement[], cellSize = 512): WhiteboardSpatialIndex {
  const safeCellSize = Math.max(128, Math.min(2048, Math.round(cellSize)));
  const buckets = new Map<string, WhiteboardElement[]>();
  const entries: SpatialEntry[] = [];
  for (const element of elements) {
    const bounds = whiteboardElementBounds(element);
    const [minCellX, maxCellX] = cellRange(bounds.x, bounds.width, safeCellSize);
    const [minCellY, maxCellY] = cellRange(bounds.y, bounds.height, safeCellSize);
    entries.push({ element, minCellX, maxCellX, minCellY, maxCellY });
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        const key = cellKey(x, y);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(element); else buckets.set(key, [element]);
      }
    }
  }
  return { cellSize: safeCellSize, elementCount: elements.length, buckets, entries };
}

export function queryWhiteboardSpatialIndex(index: WhiteboardSpatialIndex, viewport: WhiteboardSpatialViewport, overscan = 160) {
  const padded = {
    x: viewport.x - overscan,
    y: viewport.y - overscan,
    width: viewport.width + overscan * 2,
    height: viewport.height + overscan * 2,
  };
  const [minCellX, maxCellX] = cellRange(padded.x, padded.width, index.cellSize);
  const [minCellY, maxCellY] = cellRange(padded.y, padded.height, index.cellSize);
  const seen = new Set<string>();
  const result: WhiteboardElement[] = [];
  for (let x = minCellX; x <= maxCellX; x += 1) {
    for (let y = minCellY; y <= maxCellY; y += 1) {
      for (const element of index.buckets.get(cellKey(x, y)) || []) {
        if (seen.has(element.id)) continue;
        seen.add(element.id);
        result.push(element);
      }
    }
  }
  return result;
}
