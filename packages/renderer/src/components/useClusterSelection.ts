import { useCallback, useMemo, useRef } from "react";

export type ClusterSelectionIntent = {
  additive?: boolean;
  range?: boolean;
  selected?: boolean;
};

export function useClusterSelection({
  keys,
  selectedKeys,
  onSelectionChange,
}: {
  keys: readonly string[];
  selectedKeys: ReadonlySet<string>;
  onSelectionChange: (keys: Set<string>) => void;
}) {
  const anchorKeyRef = useRef<string | null>(null);
  const keySet = useMemo(() => new Set(keys), [keys]);
  const visibleSelectedCount = useMemo(() => keys.filter((key) => selectedKeys.has(key)).length, [keys, selectedKeys]);

  const clear = useCallback(() => {
    anchorKeyRef.current = null;
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  const selectAll = useCallback(() => {
    const next = new Set(selectedKeys);
    for (const key of keys) next.add(key);
    if (keys.length) anchorKeyRef.current = keys[0] || null;
    onSelectionChange(next);
  }, [keys, onSelectionChange, selectedKeys]);

  const clearVisible = useCallback(() => {
    const next = new Set(selectedKeys);
    for (const key of keys) next.delete(key);
    onSelectionChange(next);
  }, [keys, onSelectionChange, selectedKeys]);

  const invertVisible = useCallback(() => {
    const next = new Set(selectedKeys);
    for (const key of keys) {
      if (next.has(key)) next.delete(key);
      else next.add(key);
    }
    onSelectionChange(next);
  }, [keys, onSelectionChange, selectedKeys]);

  const selectKey = useCallback((key: string, intent: ClusterSelectionIntent = {}) => {
    if (!keySet.has(key)) return;
    const range = Boolean(intent.range && anchorKeyRef.current && keySet.has(anchorKeyRef.current));
    const additive = Boolean(intent.additive);
    const next = additive ? new Set(selectedKeys) : new Set<string>();

    if (range) {
      const anchorIndex = keys.indexOf(anchorKeyRef.current!);
      const keyIndex = keys.indexOf(key);
      const start = Math.min(anchorIndex, keyIndex);
      const end = Math.max(anchorIndex, keyIndex);
      for (let index = start; index <= end; index += 1) {
        const rangeKey = keys[index];
        if (rangeKey) next.add(rangeKey);
      }
    } else {
      const shouldSelect = intent.selected ?? (additive ? !selectedKeys.has(key) : true);
      if (shouldSelect) next.add(key);
      else if (additive) next.delete(key);
      anchorKeyRef.current = key;
    }

    onSelectionChange(next);
  }, [keySet, keys, onSelectionChange, selectedKeys]);

  const replace = useCallback((nextKeys: Iterable<string>) => {
    const next = new Set(Array.from(nextKeys).filter((key) => keySet.has(key)));
    anchorKeyRef.current = next.values().next().value || null;
    onSelectionChange(next);
  }, [keySet, onSelectionChange]);

  return {
    anchorKey: anchorKeyRef.current,
    visibleSelectedCount,
    allVisibleSelected: keys.length > 0 && visibleSelectedCount === keys.length,
    someVisibleSelected: visibleSelectedCount > 0 && visibleSelectedCount < keys.length,
    clear,
    selectAll,
    clearVisible,
    invertVisible,
    selectKey,
    replace,
  };
}
