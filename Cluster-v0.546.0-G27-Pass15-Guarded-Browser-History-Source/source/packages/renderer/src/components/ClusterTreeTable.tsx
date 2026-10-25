import { useMemo, type ReactNode } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterIconButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";

export type ClusterTreeTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
};

type FlatTreeRow<T> = { row: T; key: string; level: number; parentKey: string | null; childCount: number; position: number; siblingCount: number };

export function ClusterTreeTable<T>({
  roots,
  childrenOf,
  rowKey,
  columns,
  expandedKeys,
  onExpandedChange,
  label,
  rowLabel,
  empty,
  className = "",
}: {
  roots: readonly T[];
  childrenOf: (row: T) => readonly T[];
  rowKey: (row: T) => string;
  columns: readonly ClusterTreeTableColumn<T>[];
  expandedKeys: ReadonlySet<string>;
  onExpandedChange: (keys: Set<string>) => void;
  label: string;
  rowLabel?: (row: T) => string;
  empty?: ReactNode;
  className?: string;
}) {
  const flattened = useMemo(() => {
    const rows: FlatTreeRow<T>[] = [];
    const visit = (items: readonly T[], level: number, parentKey: string | null) => {
      items.forEach((row, index) => {
        const key = rowKey(row);
        const children = childrenOf(row);
        rows.push({ row, key, level, parentKey, childCount: children.length, position: index + 1, siblingCount: items.length });
        if (children.length && expandedKeys.has(key)) visit(children, level + 1, key);
      });
    };
    visit(roots, 1, null);
    return rows;
  }, [roots, childrenOf, rowKey, expandedKeys]);

  function setExpanded(key: string, expanded: boolean) {
    const next = new Set(expandedKeys);
    if (expanded) next.add(key); else next.delete(key);
    onExpandedChange(next);
  }

  return <section className={className} aria-label={label}>
    <div className="data-table-shell">
      <table role="treegrid" aria-label={label}>
        <caption className="sr-only-v204">{label}</caption>
        <thead><tr>{columns.map((column) => <th key={column.id} scope="col">{column.header}</th>)}</tr></thead>
        <tbody>
          {flattened.map((item) => {
            const expanded = item.childCount ? expandedKeys.has(item.key) : undefined;
            const labelText = rowLabel?.(item.row) || item.key;
            return <tr key={item.key} role="row" aria-level={item.level} aria-posinset={item.position} aria-setsize={item.siblingCount} aria-expanded={expanded} aria-label={labelText}>
              {columns.map((column, columnIndex) => <td key={column.id} role="gridcell">
                {columnIndex === 0 ? <span className="cluster-action-group-v425" style={runtimeStyle({ paddingLeft: `${Math.max(0, item.level - 1) * 18}px` })}>
                  {item.childCount ? <ClusterIconButton label={`${expanded ? "Collapse" : "Expand"} ${labelText}`} size="compact" variant="quiet" onClick={() => setExpanded(item.key, !expanded)} onKeyDown={(event) => {
                    if (event.key === "ArrowRight" && !expanded) { event.preventDefault(); setExpanded(item.key, true); }
                    if (event.key === "ArrowLeft" && expanded) { event.preventDefault(); setExpanded(item.key, false); }
                  }}><ClusterIcon name={expanded ? "chevron-down" : "chevron-right"} /></ClusterIconButton> : <span aria-hidden="true">·</span>}
                  <span>{column.cell(item.row)}</span>
                </span> : column.cell(item.row)}
              </td>)}
            </tr>;
          })}
        </tbody>
      </table>
      {!flattened.length ? empty || <div className="empty-state">No rows to show.</div> : null}
    </div>
  </section>;
}
