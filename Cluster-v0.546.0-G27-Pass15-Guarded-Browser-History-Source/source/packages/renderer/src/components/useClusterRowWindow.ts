import { useMemo } from "react";

export type ClusterRowWindowOptions = {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
};

export type ClusterRowWindow = {
  start: number;
  end: number;
  count: number;
  totalHeight: number;
  beforeHeight: number;
  afterHeight: number;
  overscan: number;
};

/** Shared fixed-height row window used by dense lists and opt-in data tables. */
export function computeClusterRowWindow({ itemCount, rowHeight, viewportHeight, scrollTop, overscan = 8 }: ClusterRowWindowOptions): ClusterRowWindow {
  const count = Math.max(0, Math.floor(itemCount));
  const height = Math.max(1, Math.floor(rowHeight));
  const viewport = Math.max(height, Math.floor(viewportHeight));
  const maximumScroll = Math.max(0, count * height - viewport);
  const effectiveScrollTop = Math.max(0, Math.min(Number.isFinite(scrollTop) ? scrollTop : 0, maximumScroll));
  const padding = Math.max(0, Math.floor(overscan));
  const start = Math.max(0, Math.floor(effectiveScrollTop / height) - padding);
  const end = Math.min(count, Math.ceil((effectiveScrollTop + viewport) / height) + padding);
  return { start, end, count, totalHeight: count * height, beforeHeight: start * height, afterHeight: Math.max(0, (count - end) * height), overscan: padding };
}

export function useClusterRowWindow(options: ClusterRowWindowOptions) {
  return useMemo(() => computeClusterRowWindow(options), [options.itemCount, options.rowHeight, options.viewportHeight, options.scrollTop, options.overscan]);
}
