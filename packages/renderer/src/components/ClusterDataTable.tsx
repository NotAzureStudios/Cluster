import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { ClusterDataGroup, ClusterDataGroupSummaryResult, ClusterDataScalar, ClusterDataSort, ClusterDataViewLayout } from "@cluster/shared";
import { normalizeClusterDataSorts } from "@cluster/shared";
import { readPreferenceStorage, writePreferenceStorage } from "../core/privacy-consent";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterInput, ClusterNativeSelect } from "./ClusterNativeControls";
import { ClusterSelectionControl } from "./ClusterSelectionControl";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterToolbar } from "./ClusterToolbar";
import { ClusterBulkActionBar } from "./ClusterContextActions";
import { ClusterResizeHandle } from "./ClusterResizeHandle";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { useClusterSelection } from "./useClusterSelection";
import { useClusterRowWindow } from "./useClusterRowWindow";
import { copyClusterText } from "../core/clipboard";


const EMPTY_SELECTED_KEYS: ReadonlySet<string> = new Set<string>();
const NOOP_SELECTION_CHANGE = (_keys: Set<string>) => undefined;

export type ClusterDataTableSummaryScope = "visible" | "selected" | "dataset";

export type ClusterDataTableSummaryRow = {
  key: string;
  label: ReactNode;
  scope: ClusterDataTableSummaryScope;
  values: Readonly<Record<string, ReactNode>>;
};

export type ClusterDataTableGroupMetric<T> = {
  id: string;
  label: string;
  /** Optional target column when group summaries render as explicit subtotal rows. */
  columnId?: string;
  /** Canonical server aggregation ID when exact authorized group evidence is available. */
  aggregationId?: string;
  value: (rows: readonly T[]) => ReactNode;
  formatExact?: (value: number | null, count: number) => ReactNode;
};

export type ClusterDataTableVirtualization = {
  rowHeight?: number;
  maxHeight?: number;
  minimumRows?: number;
  overscan?: number;
};

export type ClusterDataTableIncremental = {
  hasMore: boolean;
  loading?: boolean;
  prefetchRows?: number;
  loadLabel?: string;
  onLoadMore: () => void;
};


export type ClusterDataTableCellEditor<T> = {
  kind: "text" | "number" | "select";
  value: (row: T) => string | number | null | undefined;
  options?: readonly { value: string; label: string }[];
  commit: (row: T, value: string) => void | Promise<void>;
  validate?: (value: string, row: T) => string | null | undefined;
};

export type ClusterDataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | boolean | Date | null | undefined;
  groupValue?: (row: T) => string | number | boolean | Date | null | undefined;
  /** Optional canonical scalar used only to reconcile a displayed group with server-authoritative summary evidence. */
  groupSummaryValue?: (row: T) => string | number | boolean | Date | null | undefined;
  /** Plain scalar used for clipboard copy. Falls back to sortValue when omitted. */
  copyValue?: (row: T) => string | number | boolean | Date | null | undefined;
  /** Optional safe inline editor. Domains still own authorization and mutation. */
  editor?: ClusterDataTableCellEditor<T>;
  hideable?: boolean;
  hiddenByDefault?: boolean;
  pinnable?: boolean;
  resizable?: boolean;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function ClusterColumnManager<T>({ label, columns, orderedColumns, visibleColumnIds, pinnedColumnIds, widthForColumn, onVisibleColumnsChange, onMoveColumn, onTogglePinned, onResizeColumn, onReset }: { label: string; columns: readonly ClusterDataTableColumn<T>[]; orderedColumns: readonly ClusterDataTableColumn<T>[]; visibleColumnIds: readonly string[]; pinnedColumnIds: ReadonlySet<string>; widthForColumn: (column: ClusterDataTableColumn<T>) => number; onVisibleColumnsChange: (values: string[]) => void; onMoveColumn: (id: string, delta: -1 | 1) => void; onTogglePinned: (id: string) => void; onResizeColumn: (column: ClusterDataTableColumn<T>, delta: number) => void; onReset: () => void; }) {
  const [open, setOpen] = useState(false); const triggerRef = useRef<HTMLButtonElement | null>(null); const visibleSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]); const visibleOrderedColumns = orderedColumns.filter((column) => column.hideable === false || visibleSet.has(column.id));
  return <div className="cluster-column-manager-v535"><ClusterButton ref={triggerRef} size="compact" variant="quiet" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog"><ClusterIcon name="list" /> Display <ClusterStatus compact>{visibleOrderedColumns.length}/{columns.length}</ClusterStatus></ClusterButton><ClusterFloatingSurface open={open} anchorRef={triggerRef} label={`${label} display options`} role="dialog" placement="bottom-end" mobileMode="sheet" autoFocus="first" onDismiss={() => setOpen(false)} className="cluster-column-manager-panel-v535"><div className="cluster-column-manager-head-v535"><div><strong>Columns</strong><small>Visibility, order, pinning, and width</small></div><ClusterButton size="compact" variant="quiet" onClick={onReset}>Reset</ClusterButton></div><ClusterMultiSelect values={visibleColumnIds} onChange={onVisibleColumnsChange} ariaLabel={`${label} visible columns`} placeholder="Visible columns" searchPlaceholder="Search columns" options={columns.map((column) => ({ value: column.id, label: columnLabel(column), disabled: column.hideable === false }))} /><div className="cluster-column-manager-list-v535">{visibleOrderedColumns.map((column, index) => { const width = widthForColumn(column); return <div className="cluster-column-manager-row-v535" key={column.id}><strong title={columnLabel(column)}>{columnLabel(column)}</strong><div className="cluster-column-manager-actions-v535"><ClusterIconButton size="compact" variant="quiet" disabled={index === 0} label={`Move ${columnLabel(column)} earlier`} onClick={() => onMoveColumn(column.id,-1)}><ClusterIcon name="chevron-up" /></ClusterIconButton><ClusterIconButton size="compact" variant="quiet" disabled={index === visibleOrderedColumns.length - 1} label={`Move ${columnLabel(column)} later`} onClick={() => onMoveColumn(column.id,1)}><ClusterIcon name="chevron-down" /></ClusterIconButton>{column.pinnable !== false ? <ClusterIconButton size="compact" variant="quiet" selected={pinnedColumnIds.has(column.id)} label={`${pinnedColumnIds.has(column.id)?"Unpin":"Pin"} ${columnLabel(column)}`} onClick={() => onTogglePinned(column.id)}><ClusterIcon name="pin" /></ClusterIconButton>:null}{column.resizable !== false ? <><ClusterIconButton size="compact" variant="quiet" label={`Narrow ${columnLabel(column)}`} onClick={() => onResizeColumn(column,-24)}><ClusterIcon name="minus" /></ClusterIconButton><span className="cluster-column-width-v535">{width}px</span><ClusterIconButton size="compact" variant="quiet" label={`Widen ${columnLabel(column)}`} onClick={() => onResizeColumn(column,24)}><ClusterIcon name="plus" /></ClusterIconButton></>:null}</div></div>; })}</div></ClusterFloatingSurface></div>;
}

const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 96;
const MAX_COLUMN_WIDTH = 560;
const SELECT_COLUMN_WIDTH = 44;

function compareValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left instanceof Date || right instanceof Date) return new Date(left as never).getTime() - new Date(right as never).getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function defaultVisibleColumnIds<T>(columns: readonly ClusterDataTableColumn<T>[]) { return columns.filter((column) => !column.hiddenByDefault).map((column) => column.id); }
function defaultOrder<T>(columns: readonly ClusterDataTableColumn<T>[]) { return columns.map((column) => column.id); }
function fallbackLayout<T>(columns: readonly ClusterDataTableColumn<T>[]): ClusterDataViewLayout { return { visibleFieldIds: defaultVisibleColumnIds(columns), fieldOrder: defaultOrder(columns), pinnedFieldIds: [], fieldWidths: {}, collapsedGroupKeys: [] }; }
function columnLabel<T>(column: ClusterDataTableColumn<T>) { return typeof column.header === "string" ? column.header : column.id; }
function clampWidth<T>(column: ClusterDataTableColumn<T>, value: number) { return Math.max(column.minWidth || MIN_COLUMN_WIDTH, Math.min(column.maxWidth || MAX_COLUMN_WIDTH, Math.round(value))); }
function columnWidth<T>(column: ClusterDataTableColumn<T>, layout: ClusterDataViewLayout) { return clampWidth(column, layout.fieldWidths[column.id] || column.defaultWidth || DEFAULT_COLUMN_WIDTH); }

function normalizeLayout<T>(candidate: Partial<ClusterDataViewLayout>, columns: readonly ClusterDataTableColumn<T>[]): ClusterDataViewLayout {
  const fallback = fallbackLayout(columns);
  const known = new Set(columns.map((column) => column.id));
  const retainedOrder = Array.isArray(candidate.fieldOrder) ? candidate.fieldOrder.filter((id) => known.has(id)) : [];
  const missingOrder = columns.map((column) => column.id).filter((id) => !retainedOrder.includes(id));
  const visible = Array.isArray(candidate.visibleFieldIds) ? candidate.visibleFieldIds.filter((id) => known.has(id)) : fallback.visibleFieldIds;
  const required = columns.filter((column) => column.hideable === false).map((column) => column.id);
  const visibleFieldIds = Array.from(new Set([...(visible.length ? visible : fallback.visibleFieldIds), ...required]));
  const pinnedFieldIds = Array.isArray(candidate.pinnedFieldIds) ? candidate.pinnedFieldIds.filter((id) => known.has(id) && visibleFieldIds.includes(id) && columns.find((column) => column.id === id)?.pinnable !== false) : [];
  const fieldWidths: Record<string, number> = {};
  for (const column of columns) {
    const raw = candidate.fieldWidths?.[column.id];
    if (Number.isFinite(raw)) fieldWidths[column.id] = clampWidth(column, Number(raw));
  }
  const collapsedGroupKeys = Array.isArray(candidate.collapsedGroupKeys) ? [...new Set(candidate.collapsedGroupKeys.filter((key) => typeof key === "string" && key.length <= 600))].slice(0, 200) : [];
  return { visibleFieldIds, fieldOrder: [...retainedOrder, ...missingOrder], pinnedFieldIds, fieldWidths, collapsedGroupKeys };
}


function groupDisplayValue(value: unknown) {
  if (value == null || value === "") return "Empty";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toLocaleString() : "Invalid date";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

type ClusterDataTableGroupPath = { fieldId: string; value: ClusterDataScalar; label: string };
type ClusterGroupedTableEntry<T> =
  | { kind: "group"; key: string; label: string; depth: number; count: number; collapsed: boolean; rows: readonly T[]; path: readonly ClusterDataTableGroupPath[] }
  | { kind: "row"; key: string; row: T };

function tableGroupScalar(value: unknown): ClusterDataScalar {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as ClusterDataScalar;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return String(value);
}

function groupedEntries<T>(rows: readonly T[], groups: readonly ClusterDataGroup[], columns: readonly ClusterDataTableColumn<T>[], rowKey: (row: T) => string, collapsedGroupKeys: ReadonlySet<string>, depth = 0, path: string[] = [], valuePath: ClusterDataTableGroupPath[] = []): ClusterGroupedTableEntry<T>[] {
  if (depth >= groups.length) return rows.map((row) => ({ kind: "row" as const, key: `row:${rowKey(row)}`, row }));
  const group = groups[depth];
  const column = columns.find((candidate) => candidate.id === group.fieldId && candidate.groupValue);
  if (!column?.groupValue) return groupedEntries(rows, groups, columns, rowKey, collapsedGroupKeys, depth + 1, path, valuePath);
  const buckets = new Map<string, { label: string; rows: T[] }>();
  for (const row of rows) {
    const value = column.groupValue(row);
    const label = groupDisplayValue(value);
    const key = `${typeof value}:${label}`;
    const bucket = buckets.get(key) || { label, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }
  const ordered = [...buckets.entries()].sort((left, right) => left[1].label.localeCompare(right[1].label, undefined, { numeric: true, sensitivity: "base" }) * (group.direction === "desc" ? -1 : 1));
  return ordered.flatMap(([bucketKey, bucket]) => {
    const nextPath = [...path, `${group.fieldId}:${bucketKey}`];
    const firstRow = bucket.rows[0];
    const rawValue = firstRow ? tableGroupScalar(column.groupSummaryValue ? column.groupSummaryValue(firstRow) : column.groupValue?.(firstRow)) : null;
    const nextValuePath = [...valuePath, { fieldId: group.fieldId, value: rawValue, label: bucket.label }];
    const key = `group:${nextPath.join("|")}`;
    const collapsed = collapsedGroupKeys.has(key);
    return [
      { kind: "group" as const, key, label: bucket.label, depth, count: bucket.rows.length, collapsed, rows: bucket.rows, path: nextValuePath },
      ...(collapsed ? [] : groupedEntries(bucket.rows, groups, columns, rowKey, collapsedGroupKeys, depth + 1, nextPath, nextValuePath)),
    ];
  });
}

function loadLayout<T>(persistKey: string | undefined, columns: readonly ClusterDataTableColumn<T>[]): ClusterDataViewLayout {
  const fallback = fallbackLayout(columns);
  if (!persistKey) return fallback;
  const raw = readPreferenceStorage(`cluster.data-view.${persistKey}.v1`);
  if (!raw) return fallback;
  try { return normalizeLayout(JSON.parse(raw) as Partial<ClusterDataViewLayout>, columns); } catch { return fallback; }
}

export function ClusterDataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  selectedKeys,
  onSelectionChange,
  sorts,
  onSortsChange,
  groups,
  groupMetrics,
  groupSubtotalMode = "header",
  groupSummaries,
  groupSummaryFieldMap,
  summaryRows,
  renderExpandedRow,
  onRowActivate,
  rowLabel,
  bulkActions,
  empty,
  configurableColumns = false,
  persistKey,
  controlledLayout,
  onLayoutChange,
  virtualization,
  incremental,
  className = "",
}: {
  rows: readonly T[];
  columns: readonly ClusterDataTableColumn<T>[];
  rowKey: (row: T) => string;
  label: string;
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  sorts?: readonly ClusterDataSort[];
  onSortsChange?: (sorts: ClusterDataSort[]) => void;
  groups?: readonly ClusterDataGroup[];
  groupMetrics?: readonly ClusterDataTableGroupMetric<T>[];
  groupSubtotalMode?: "header" | "row";
  groupSummaries?: readonly ClusterDataGroupSummaryResult[];
  groupSummaryFieldMap?: Readonly<Record<string, string>>;
  summaryRows?: readonly ClusterDataTableSummaryRow[];
  /** Optional row-detail renderer. Expanded state is local interaction state and disables row virtualization while available. */
  renderExpandedRow?: (row: T) => ReactNode;
  onRowActivate?: (row: T) => void;
  rowLabel?: (row: T) => string;
  bulkActions?: ReactNode;
  empty?: ReactNode;
  configurableColumns?: boolean;
  persistKey?: string;
  controlledLayout?: ClusterDataViewLayout;
  onLayoutChange?: (layout: ClusterDataViewLayout) => void;
  virtualization?: ClusterDataTableVirtualization;
  incremental?: ClusterDataTableIncremental;
  className?: string;
}) {
  const selectable = Boolean(selectedKeys && onSelectionChange);
  const [layout, setLayout] = useState<ClusterDataViewLayout>(() => normalizeLayout(controlledLayout || loadLayout(persistKey, columns), columns));
  const [editingCell, setEditingCell] = useState<{ rowKey: string; columnId: string; value: string; saving: boolean; error: string } | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState("");
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => { setLayout((current) => normalizeLayout(controlledLayout || current, columns)); }, [columns, controlledLayout]);
  useEffect(() => {
    if (persistKey) writePreferenceStorage(`cluster.data-view.${persistKey}.v1`, JSON.stringify(layout));
    onLayoutChange?.(layout);
  }, [layout, persistKey, onLayoutChange]);
  function updateLayout(updater: (current: ClusterDataViewLayout) => ClusterDataViewLayout) {
    setLayout((current) => normalizeLayout(updater(current), columns));
  }

  const rowKeyRef = useRef(rowKey);
  rowKeyRef.current = rowKey;
  const stableRowKeyRef = useRef<((row: T) => string) | null>(null);
  if (!stableRowKeyRef.current) stableRowKeyRef.current = (row: T) => rowKeyRef.current(row);
  const stableRowKey = stableRowKeyRef.current!;
  const visibleColumnSet = useMemo(() => new Set(layout.visibleFieldIds), [layout.visibleFieldIds]);
  const orderedColumns = useMemo(() => layout.fieldOrder.map((id) => columns.find((column) => column.id === id)).filter(Boolean) as ClusterDataTableColumn<T>[], [columns, layout.fieldOrder]);
  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => column.hideable === false || visibleColumnSet.has(column.id)),
    [orderedColumns, visibleColumnSet],
  );
  const pinnedSet = useMemo(() => new Set(layout.pinnedFieldIds), [layout.pinnedFieldIds]);
  const renderedColumns = useMemo(
    () => [...visibleColumns.filter((column) => pinnedSet.has(column.id)), ...visibleColumns.filter((column) => !pinnedSet.has(column.id))],
    [visibleColumns, pinnedSet],
  );
  const pinnedOffsets = useMemo(() => {
    let offset = selectable ? SELECT_COLUMN_WIDTH : 0;
    const values = new Map<string, number>();
    for (const column of renderedColumns) if (pinnedSet.has(column.id)) { values.set(column.id, offset); offset += columnWidth(column, layout); }
    return values;
  }, [renderedColumns, pinnedSet, layout, selectable]);
  const normalizedSorts = useMemo(() => normalizeClusterDataSorts(sorts, new Set(columns.filter((column) => Boolean(column.sortValue)).map((column) => column.id))), [sorts, columns]);
  const sortedRows = useMemo(() => {
    if (!normalizedSorts.length) return [...rows];
    const sortColumns = normalizedSorts
      .map((sort) => ({ sort, column: columns.find((candidate) => candidate.id === sort.fieldId) }))
      .filter((entry): entry is { sort: ClusterDataSort; column: ClusterDataTableColumn<T> } => Boolean(entry.column?.sortValue));
    if (!sortColumns.length) return [...rows];
    return [...rows].sort((left, right) => {
      for (const { sort, column } of sortColumns) {
        const direction = sort.direction === "asc" ? 1 : -1;
        const comparison = compareValues(column.sortValue?.(left), column.sortValue?.(right));
        if (comparison) return comparison * direction;
      }
      return 0;
    });
  }, [rows, columns, normalizedSorts]);
  const normalizedGroups = useMemo(() => (groups || []).filter((group) => columns.some((column) => column.id === group.fieldId && Boolean(column.groupValue))).slice(0, 4), [groups, columns]);
  const collapsedGroupKeys = useMemo(() => new Set(layout.collapsedGroupKeys || []), [layout.collapsedGroupKeys]);
  const tableEntries = useMemo(() => groupedEntries(sortedRows, normalizedGroups, columns, stableRowKey, collapsedGroupKeys), [sortedRows, normalizedGroups, columns, stableRowKey, collapsedGroupKeys]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const virtualScrollRowRef = useRef(0);
  const [phoneViewport, setPhoneViewport] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.rendererViewport === "phone");
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => setPhoneViewport(root.dataset.rendererViewport === "phone");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-renderer-viewport"] });
    return () => observer.disconnect();
  }, []);
  const virtualRowHeight = Math.max(36, Math.round(virtualization?.rowHeight || 52));
  useEffect(() => { virtualScrollRowRef.current = Math.floor(virtualScrollTop / virtualRowHeight); }, [virtualRowHeight]);
  function updateVirtualScroll(scrollTop: number) {
    const rowIndex = Math.max(0, Math.floor(scrollTop / virtualRowHeight));
    if (rowIndex === virtualScrollRowRef.current) return;
    virtualScrollRowRef.current = rowIndex;
    setVirtualScrollTop(scrollTop);
  }
  const virtualMinimumRows = Math.max(20, Math.round(virtualization?.minimumRows || 120));
  const virtualized = Boolean(virtualization && !renderExpandedRow && !phoneViewport && normalizedGroups.length === 0 && tableEntries.length >= virtualMinimumRows);
  const virtualViewportHeight = Math.min(Math.max(virtualRowHeight * 4, Math.round(virtualization?.maxHeight || 720)), Math.max(virtualRowHeight * 4, tableEntries.length * virtualRowHeight));
  const rowWindow = useClusterRowWindow({ itemCount: tableEntries.length, rowHeight: virtualRowHeight, viewportHeight: virtualViewportHeight, scrollTop: virtualScrollTop, overscan: virtualization?.overscan ?? 10 });
  const renderedTableEntries = virtualized ? tableEntries.slice(rowWindow.start, rowWindow.end) : tableEntries;
  const incrementalRequestLengthRef = useRef(-1);
  useEffect(() => {
    if (!incremental?.hasMore || incremental.loading || !virtualized) return;
    const prefetchRows = Math.max(4, Math.round(incremental.prefetchRows || Math.max(12, rowWindow.overscan * 2)));
    if (tableEntries.length - rowWindow.end > prefetchRows) return;
    if (incrementalRequestLengthRef.current === tableEntries.length) return;
    incrementalRequestLengthRef.current = tableEntries.length;
    incremental.onLoadMore();
  }, [incremental, virtualized, tableEntries.length, rowWindow.end, rowWindow.overscan]);
  useEffect(() => {
    if (!incremental?.hasMore) incrementalRequestLengthRef.current = -1;
  }, [incremental?.hasMore]);
  // Large read-only tables should not key and index every row for selection
  // handlers that are never offered. Virtual scrolling now retains stable
  // column and selection identities across row-window updates.
  const visibleKeys = useMemo(() => selectable ? sortedRows.map(stableRowKey) : [], [selectable, sortedRows, stableRowKey]);
  const selection = useClusterSelection({
    keys: visibleKeys,
    selectedKeys: selectedKeys || EMPTY_SELECTED_KEYS,
    onSelectionChange: onSelectionChange || NOOP_SELECTION_CHANGE,
  });
  const selectedCount = selectable ? selection.visibleSelectedCount : 0;
  const allSelected = selectable && selection.allVisibleSelected;

  function replaceSelection(keys: Iterable<string>) { if (selectable) selection.replace(keys); }
  function toggleRow(key: string, checked: boolean, event?: ReactMouseEvent<HTMLInputElement>) {
    if (!selectable) return;
    selection.selectKey(key, { selected: checked, additive: true, range: Boolean(event?.shiftKey) });
  }
  function toggleSort(column: ClusterDataTableColumn<T>, additive = false) {
    if (!column.sortValue || !onSortsChange) return;
    const existing = normalizedSorts.find((sort) => sort.fieldId === column.id);
    const others = normalizedSorts.filter((sort) => sort.fieldId !== column.id);
    if (!existing) onSortsChange(additive ? [...others, { fieldId: column.id, direction: "asc" }] : [{ fieldId: column.id, direction: "asc" }]);
    else if (existing.direction === "asc") onSortsChange(additive ? [...others, { fieldId: column.id, direction: "desc" }] : [{ fieldId: column.id, direction: "desc" }]);
    else onSortsChange(others);
  }
  function updateVisibleColumns(ids: string[]) {
    const required = columns.filter((column) => column.hideable === false).map((column) => column.id);
    const nextVisible = Array.from(new Set([...ids, ...required]));
    if (nextVisible.length) updateLayout((current) => ({ ...current, visibleFieldIds: nextVisible, pinnedFieldIds: current.pinnedFieldIds.filter((id) => nextVisible.includes(id)) }));
  }
  function moveColumn(id: string, direction: -1 | 1) {
    updateLayout((current) => {
      const index = current.fieldOrder.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.fieldOrder.length) return current;
      const fieldOrder = [...current.fieldOrder];
      [fieldOrder[index], fieldOrder[nextIndex]] = [fieldOrder[nextIndex], fieldOrder[index]];
      return { ...current, fieldOrder };
    });
  }
  function togglePinned(id: string) {
    updateLayout((current) => ({ ...current, pinnedFieldIds: current.pinnedFieldIds.includes(id) ? current.pinnedFieldIds.filter((item) => item !== id) : [...current.pinnedFieldIds, id] }));
  }
  function resizeColumn(column: ClusterDataTableColumn<T>, delta: number) {
    updateLayout((current) => ({ ...current, fieldWidths: { ...current.fieldWidths, [column.id]: clampWidth(column, columnWidth(column, current) + delta) } }));
  }
  function resetLayout() { updateLayout(() => fallbackLayout(columns)); }
  function authoritativeGrandTotal() {
    if (!groupSummaries?.length) return null;
    const summary = groupSummaries.find((candidate) => candidate.complete && candidate.grandTotal);
    return summary?.grandTotal || null;
  }
  function exactGroupSummary(entry: Extract<ClusterGroupedTableEntry<T>, { kind: "group" }>) {
    if (!groupSummaries?.length) return null;
    const dimensions = entry.path.map((part) => groupSummaryFieldMap?.[part.fieldId] || part.fieldId);
    const summary = groupSummaries.find((candidate) => candidate.complete && candidate.dimensions.length === dimensions.length && candidate.dimensions.every((fieldId, index) => fieldId === dimensions[index]));
    if (!summary) return null;
    const row = summary.rows.find((candidate) => candidate.keys.length === entry.path.length && candidate.keys.every((value, index) => `${typeof value}:${String(value ?? "")}` === `${typeof entry.path[index].value}:${String(entry.path[index].value ?? "")}`));
    return row || null;
  }

  function toggleGroupCollapsed(key: string) {
    updateLayout((current) => {
      const collapsed = new Set(current.collapsedGroupKeys || []);
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      return { ...current, collapsedGroupKeys: [...collapsed].slice(0, 200) };
    });
  }
  function cellStyle(column: ClusterDataTableColumn<T>, header = false) {
    const width = columnWidth(column, layout);
    const pinned = pinnedSet.has(column.id);
    return runtimeStyle({
      minWidth: `${width}px`,
      width: `${width}px`,
      ...(pinned ? { position: "sticky", left: `${pinnedOffsets.get(column.id) || 0}px`, zIndex: header ? 4 : 2, backgroundColor: "var(--panel)" } : {}),
    });
  }
  const selectionCellStyle = runtimeStyle({ minWidth: `${SELECT_COLUMN_WIDTH}px`, width: `${SELECT_COLUMN_WIDTH}px`, position: "sticky", left: "0px", zIndex: 5, backgroundColor: "var(--panel)" });

  function cellClipboardValue(column: ClusterDataTableColumn<T>, row: T) {
    const raw = column.copyValue ? column.copyValue(row) : column.sortValue ? column.sortValue(row) : "";
    if (raw == null) return "";
    if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.toISOString() : "";
    return String(raw).replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }
  async function copySelectedRows() {
    if (!selectable || !selectedKeys?.size) return;
    const selectedRows = sortedRows.filter((row) => selectedKeys.has(rowKey(row)));
    const headers = renderedColumns.map(columnLabel);
    const lines = [headers.join("\t"), ...selectedRows.map((row) => renderedColumns.map((column) => cellClipboardValue(column, row)).join("\t"))];
    const copied = await copyClusterText(lines.join("\n"));
    setClipboardStatus(copied ? `Copied ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"} as tab-separated values.` : "Clipboard copy failed. Select and copy the table values manually.");
  }
  function moveCellFocus(current: HTMLElement, direction: "left" | "right" | "up" | "down") {
    const cells = [...(shellRef.current?.querySelectorAll<HTMLElement>('[data-cluster-data-cell="true"]') || [])];
    const index = cells.indexOf(current);
    if (index < 0) return;
    const columnCount = Math.max(1, renderedColumns.length);
    const delta = direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -columnCount : columnCount;
    const target = cells[index + delta];
    if (target) { target.focus(); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function beginCellEdit(row: T, column: ClusterDataTableColumn<T>) {
    if (!column.editor) return;
    const value = column.editor.value(row);
    setEditingCell({ rowKey: rowKey(row), columnId: column.id, value: value == null ? "" : String(value), saving: false, error: "" });
  }
  async function commitCellEdit(row: T, column: ClusterDataTableColumn<T>) {
    if (!column.editor || !editingCell || editingCell.rowKey !== rowKey(row) || editingCell.columnId !== column.id) return;
    const error = column.editor.validate?.(editingCell.value, row) || "";
    if (error) { setEditingCell({ ...editingCell, error }); return; }
    setEditingCell({ ...editingCell, saving: true, error: "" });
    try { await column.editor.commit(row, editingCell.value); setEditingCell(null); }
    catch (errorValue) { setEditingCell({ ...editingCell, saving: false, error: errorValue instanceof Error ? errorValue.message : "Update failed." }); }
  }
  function pasteCellValue(row: T, column: ClusterDataTableColumn<T>, text: string) {
    if (!column.editor) return;
    const value = String(text || "").split(/\r?\n/, 1)[0].split("\t", 1)[0];
    const error = column.editor.validate?.(value, row) || "";
    setEditingCell({ rowKey: rowKey(row), columnId: column.id, value, saving: false, error });
    setClipboardStatus(`Pasted into ${columnLabel(column)}. Review and save the inline edit.`);
  }
  function toggleExpandedRow(row: T) {
    const key = rowKey(row);
    setExpandedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function renderDataCell(row: T, column: ClusterDataTableColumn<T>, columnIndex: number) {
    const key = rowKey(row);
    const editing = editingCell?.rowKey === key && editingCell.columnId === column.id;
    const editor = column.editor;
    return <td key={column.id} style={cellStyle(column)} data-pinned={pinnedSet.has(column.id) || undefined} data-label={columnLabel(column)} data-cluster-data-cell="true" data-column-index={columnIndex} tabIndex={0} onDoubleClick={() => beginCellEdit(row, column)} onPaste={(event) => { if (!editor || editing) return; event.preventDefault(); event.stopPropagation(); pasteCellValue(row, column, event.clipboardData.getData("text/plain")); }} onKeyDown={(event) => {
      if (editing) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveCellFocus(event.currentTarget, event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : event.key === "ArrowUp" ? "up" : "down"); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); void copyClusterText(cellClipboardValue(column, row)).then((copied) => setClipboardStatus(copied ? `Copied ${columnLabel(column)}.` : `Could not copy ${columnLabel(column)}. Use manual selection.`)); return; }
      if (editor && (event.key === "F2" || event.key === "Enter")) { event.preventDefault(); event.stopPropagation(); beginCellEdit(row, column); }
    }}>
      {editing && editor ? <div className="cluster-data-cell-editor-v504" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditingCell(null); } else if (event.key === "Enter") { event.preventDefault(); void commitCellEdit(row, column); } }}>
        {editor.kind === "select" ? <ClusterNativeSelect value={editingCell.value} disabled={editingCell.saving} onChange={(event) => setEditingCell({ ...editingCell, value: event.target.value, error: "" })} aria-label={`Edit ${columnLabel(column)}`}>{(editor.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ClusterNativeSelect> : <ClusterInput type={editor.kind === "number" ? "number" : "text"} value={editingCell.value} disabled={editingCell.saving} onChange={(event) => setEditingCell({ ...editingCell, value: event.target.value, error: "" })} aria-label={`Edit ${columnLabel(column)}`} />}
        <ClusterIconButton size="compact" variant="quiet" label={`Save ${columnLabel(column)}`} disabled={editingCell.saving} onClick={() => void commitCellEdit(row, column)}><ClusterIcon name="check" /></ClusterIconButton>
        <ClusterIconButton size="compact" variant="quiet" label={`Cancel ${columnLabel(column)} edit`} disabled={editingCell.saving} onClick={() => setEditingCell(null)}><ClusterIcon name="close" /></ClusterIconButton>
        {editingCell.error ? <small role="alert">{editingCell.error}</small> : null}
      </div> : <div className="cluster-data-cell-content-v504">{columnIndex === 0 && renderExpandedRow ? <ClusterIconButton size="compact" variant="quiet" label={`${expandedRowKeys.has(key) ? "Collapse" : "Expand"} ${rowLabel?.(row) || key}`} aria-expanded={expandedRowKeys.has(key)} onClick={(event) => { event.stopPropagation(); toggleExpandedRow(row); }}><ClusterIcon name={expandedRowKeys.has(key) ? "chevron-down" : "chevron-right"} /></ClusterIconButton> : null}<span className="cluster-data-cell-value-v504">{column.cell(row)}</span></div>}
    </td>;
  }

  return (
    <section className={className} aria-label={label}>
      {configurableColumns ? <div className="cluster-data-table-display-tools-v535"><ClusterColumnManager label={label} columns={columns} orderedColumns={orderedColumns} visibleColumnIds={visibleColumns.map((column) => column.id)} pinnedColumnIds={pinnedSet} widthForColumn={(column) => columnWidth(column, layout)} onVisibleColumnsChange={updateVisibleColumns} onMoveColumn={moveColumn} onTogglePinned={togglePinned} onResizeColumn={resizeColumn} onReset={resetLayout} /></div> : null}
      {selectable && selectedCount > 0 ? (
        <ClusterBulkActionBar selectionCount={selectedCount} label={`${label} selection`} onClear={selection.clear}>
          <span className="muted">Bulk actions apply only to selected rows you can modify.</span>
          {bulkActions}
          <ClusterButton size="compact" variant="quiet" onClick={() => void copySelectedRows()}>Copy selected TSV</ClusterButton>
          <ClusterButton size="compact" variant="quiet" onClick={selection.invertVisible}>Invert visible</ClusterButton>
        </ClusterBulkActionBar>
      ) : null}
      {clipboardStatus ? <span className="sr-only-v204" aria-live="polite">{clipboardStatus}</span> : null}
      {virtualized ? <span className="sr-only-v204" aria-live="polite">Showing rows {rowWindow.start + 1} through {rowWindow.end} of {rowWindow.count}. The table uses row-window virtualization.</span> : null}
      <div ref={shellRef} className="data-table-shell" data-virtualized={virtualized || undefined} style={virtualized ? runtimeStyle({ maxHeight: `${virtualViewportHeight}px`, overflowY: "auto", overscrollBehavior: "contain" }) : undefined} onScroll={virtualized ? (event) => updateVirtualScroll(event.currentTarget.scrollTop) : undefined}>
        <table aria-rowcount={virtualized ? sortedRows.length + 1 : undefined}>
          <caption className="sr-only-v204">{label}</caption>
          <thead>
            <tr aria-rowindex={virtualized ? 1 : undefined}>
              {selectable ? (
                <th scope="col" style={selectionCellStyle}>
                  <ClusterSelectionControl aria-label={allSelected ? "Clear visible row selection" : "Select all visible rows"} checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} onChange={(event) => {
                    if (event.target.checked) selection.selectAll();
                    else selection.clearVisible();
                  }} />
                </th>
              ) : null}
              {renderedColumns.map((column) => {
                const width = columnWidth(column, layout);
                const activeSort = normalizedSorts.find((sort) => sort.fieldId === column.id);
                const sortPriority = normalizedSorts.findIndex((sort) => sort.fieldId === column.id);
                return <th key={column.id} scope="col" style={cellStyle(column, true)} data-pinned={pinnedSet.has(column.id) || undefined} aria-sort={activeSort ? (activeSort.direction === "asc" ? "ascending" : "descending") : undefined}>
                  {column.sortValue && onSortsChange ? <ClusterButton size="compact" variant="quiet" onClick={(event) => toggleSort(column, event.shiftKey)} aria-label={`${columnLabel(column)}${activeSort ? ` sorted ${activeSort.direction === "asc" ? "ascending" : "descending"}${normalizedSorts.length > 1 ? `, priority ${sortPriority + 1}` : ""}` : ", not sorted"}. Shift-click to add to a multi-column sort.`}>{column.header}{activeSort ? <><ClusterIcon name={activeSort.direction === "asc" ? "chevron-up" : "chevron-down"} aria-hidden="true" />{normalizedSorts.length > 1 ? <span className="muted" aria-hidden="true">{sortPriority + 1}</span> : null}</> : null}</ClusterButton> : column.header}
                  {configurableColumns && column.resizable !== false ? <ClusterResizeHandle label={`Resize ${columnLabel(column)} column`} value={width} min={column.minWidth || MIN_COLUMN_WIDTH} max={column.maxWidth || MAX_COLUMN_WIDTH} step={24} onChange={(value) => updateLayout((current) => ({ ...current, fieldWidths: { ...current.fieldWidths, [column.id]: clampWidth(column, value) } }))} /> : null}
                </th>;
              })}
            </tr>
          </thead>
          <tbody>
            {virtualized && rowWindow.beforeHeight > 0 ? <tr aria-hidden="true" className="cluster-data-virtual-spacer-v504"><td colSpan={renderedColumns.length + (selectable ? 1 : 0)} style={runtimeStyle({ height: `${rowWindow.beforeHeight}px`, padding: "0px", border: "0px" })} /></tr> : null}
            {renderedTableEntries.map((entry, entryIndex) => {
              if (entry.kind === "group") return <Fragment key={entry.key}><tr className="cluster-data-group-row-v504" data-depth={entry.depth} data-collapsed={entry.collapsed || undefined}><th colSpan={renderedColumns.length + (selectable ? 1 : 0)} scope="rowgroup"><ClusterButton size="compact" variant="quiet" className="cluster-data-group-toggle-v504" onClick={() => toggleGroupCollapsed(entry.key)} aria-expanded={!entry.collapsed}><ClusterIcon name={entry.collapsed ? "chevron-right" : "chevron-down"} /><span>{entry.label}</span><small>{(exactGroupSummary(entry)?.count ?? entry.count)} row{(exactGroupSummary(entry)?.count ?? entry.count) === 1 ? "" : "s"}{exactGroupSummary(entry) ? " · full query" : ""}</small>{groupSubtotalMode === "header" && groupMetrics?.length ? <span className="cluster-data-group-metrics-v504" aria-label={exactGroupSummary(entry) ? "Full-query group summary" : "Loaded group summary"}>{groupMetrics.map((metric) => { const exact = exactGroupSummary(entry); const exactValue = exact && metric.aggregationId ? exact.values[metric.aggregationId] : undefined; return <small key={metric.id}><b>{metric.label}</b> {exact && metric.aggregationId ? (metric.formatExact ? metric.formatExact(exactValue ?? null, exact.count) : String(exactValue ?? "—")) : metric.value(entry.rows)}</small>; })}</span> : null}</ClusterButton></th></tr>{groupSubtotalMode === "row" && groupMetrics?.length ? <tr className="cluster-data-group-subtotal-v504" data-depth={entry.depth}>{selectable ? <td style={selectionCellStyle} /> : null}{renderedColumns.map((column, index) => { const metrics = groupMetrics.filter((metric) => metric.columnId === column.id || (!metric.columnId && index === 0)); return <td key={column.id} style={cellStyle(column)} data-pinned={pinnedSet.has(column.id) || undefined} data-label={columnLabel(column)}>{index === 0 ? <span className="cluster-data-summary-label-v504"><strong>{entry.label} subtotal</strong><small>{exactGroupSummary(entry) ? "full authorized query" : "loaded group"}</small></span> : null}{metrics.map((metric) => { const exact = exactGroupSummary(entry); const exactValue = exact && metric.aggregationId ? exact.values[metric.aggregationId] : undefined; return <span key={metric.id} className="cluster-data-summary-value-v504"><b>{metric.label}</b> {exact && metric.aggregationId ? (metric.formatExact ? metric.formatExact(exactValue ?? null, exact.count) : String(exactValue ?? "—")) : metric.value(entry.rows)}</span>; })}</td>; })}</tr> : null}</Fragment>;
              const row = entry.row;
              const key = stableRowKey(row);
              const itemLabel = rowLabel?.(row) || key;
              const absoluteRowIndex = virtualized ? rowWindow.start + entryIndex + 2 : undefined;
              return <Fragment key={entry.key}><tr aria-rowindex={absoluteRowIndex} style={virtualized ? runtimeStyle({ height: `${virtualRowHeight}px` }) : undefined} data-selected={selectedKeys?.has(key) || undefined} data-activatable={onRowActivate ? "true" : undefined} tabIndex={onRowActivate ? 0 : undefined} aria-label={onRowActivate ? itemLabel : undefined} onDoubleClick={onRowActivate ? () => onRowActivate(row) : undefined} onKeyDown={onRowActivate ? (event) => { if (event.key === "Enter") { event.preventDefault(); onRowActivate(row); } } : undefined}>
                {selectable ? <td style={selectionCellStyle} data-cluster-table-selection="true" data-label="Selection"><ClusterSelectionControl aria-label={`Select ${itemLabel}`} checked={selectedKeys!.has(key)} onClick={(event) => toggleRow(key, !selectedKeys!.has(key), event)} onChange={() => undefined} /></td> : null}
                {renderedColumns.map((column, columnIndex) => renderDataCell(row, column, columnIndex))}
              </tr>{renderExpandedRow && expandedRowKeys.has(key) ? <tr className="cluster-data-expanded-row-v504"><td colSpan={renderedColumns.length + (selectable ? 1 : 0)}>{renderExpandedRow(row)}</td></tr> : null}</Fragment>;
            })}
            {virtualized && rowWindow.afterHeight > 0 ? <tr aria-hidden="true" className="cluster-data-virtual-spacer-v504"><td colSpan={renderedColumns.length + (selectable ? 1 : 0)} style={runtimeStyle({ height: `${rowWindow.afterHeight}px`, padding: "0px", border: "0px" })} /></tr> : null}
          </tbody>
          {(summaryRows?.length || (groupMetrics?.length && authoritativeGrandTotal())) ? <tfoot className="cluster-data-summary-footer-v504">
            {summaryRows?.map((summary) => <tr key={summary.key} data-scope={summary.scope}>{selectable ? <td style={selectionCellStyle} /> : null}{renderedColumns.map((column, index) => <td key={column.id} style={cellStyle(column)} data-pinned={pinnedSet.has(column.id) || undefined} data-label={columnLabel(column)}>{index === 0 ? <span className="cluster-data-summary-label-v504"><strong>{summary.label}</strong><small>{summary.scope}</small></span> : null}{summary.values[column.id] != null ? <span className="cluster-data-summary-value-v504">{summary.values[column.id]}</span> : null}</td>)}</tr>)}
            {groupMetrics?.length && authoritativeGrandTotal() ? <tr key="authorized-grand-total" data-scope="dataset">{selectable ? <td style={selectionCellStyle} /> : null}{renderedColumns.map((column, index) => { const total = authoritativeGrandTotal()!; const metrics = groupMetrics.filter((metric) => metric.columnId === column.id || (!metric.columnId && index === 0)); return <td key={column.id} style={cellStyle(column)} data-pinned={pinnedSet.has(column.id) || undefined} data-label={columnLabel(column)}>{index === 0 ? <span className="cluster-data-summary-label-v504"><strong>Grand total</strong><small>full authorized query · {total.count} rows</small></span> : null}{metrics.map((metric) => { const value = metric.aggregationId ? total.values[metric.aggregationId] : undefined; return metric.aggregationId ? <span key={metric.id} className="cluster-data-summary-value-v504"><b>{metric.label}</b> {metric.formatExact ? metric.formatExact(value ?? null, total.count) : String(value ?? "—")}</span> : null; })}</td>; })}</tr> : null}
          </tfoot> : null}
        </table>
        {!sortedRows.length ? empty || <div className="empty-state">No rows to show.</div> : null}
      </div>
      {incremental?.hasMore ? <div className="cluster-data-incremental-v504"><ClusterButton variant="quiet" size="compact" disabled={incremental.loading} onClick={incremental.onLoadMore}>{incremental.loading ? "Loading more…" : incremental.loadLabel || "Load more rows"}</ClusterButton></div> : null}
    </section>
  );
}
