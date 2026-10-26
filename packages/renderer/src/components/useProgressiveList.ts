import { useCallback, useEffect, useMemo, useState } from "react";

export type ProgressiveListOptions = {
  initial: number;
  step?: number;
  resetKey?: string;
};

export function useProgressiveList<T>(items: readonly T[], options: ProgressiveListOptions) {
  const initial = Math.max(1, Math.floor(options.initial));
  const step = Math.max(1, Math.floor(options.step ?? initial));
  const [limit, setLimit] = useState(initial);

  useEffect(() => {
    setLimit(initial);
  }, [initial, options.resetKey]);

  const visibleItems = useMemo(() => items.slice(0, limit), [items, limit]);
  const remaining = Math.max(0, items.length - visibleItems.length);
  const showMore = useCallback(() => setLimit((current) => Math.min(items.length, current + step)), [items.length, step]);

  return {
    visibleItems,
    visibleCount: visibleItems.length,
    totalCount: items.length,
    remaining,
    hasMore: remaining > 0,
    showMore,
  };
}
