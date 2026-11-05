/**
 * UI-only hierarchy projection over the already authorized department rows.
 * No permission decisions, server writes or claims of valid server topology.
 */
export type DepartmentHierarchyRecord = {
  id: string;
  name: string;
  parentId?: string | null;
  description?: string | null;
};

export type DepartmentHierarchyEntry<T extends DepartmentHierarchyRecord> = {
  row: T;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  matchesSearch: boolean;
  ancestorNames: string[];
  orphanedParent: boolean;
};

export type DepartmentHierarchyResult<T extends DepartmentHierarchyRecord> = {
  entries: DepartmentHierarchyEntry<T>[];
  total: number;
  matches: number;
  rootCount: number;
  expandableIds: string[];
};

type ParentGraph<T extends DepartmentHierarchyRecord> = {
  byId: Map<string, T>;
  parentById: Map<string, string | null>;
  orphaned: Set<string>;
};

/** Treat missing, self-referential and cyclic parents as detached roots.
 * This display fallback does not authorize saving a malformed hierarchy.
 */
function createGraph<T extends DepartmentHierarchyRecord>(rows: readonly T[]): ParentGraph<T> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parentById = new Map<string, string | null>();
  const orphaned = new Set<string>();
  for (const row of byId.values()) {
    const raw = row.parentId?.trim() || "";
    if (!raw) { parentById.set(row.id, null); continue; }
    let cursor = raw;
    const visited = new Set([row.id]);
    let invalid = false;
    while (cursor) {
      if (visited.has(cursor) || !byId.has(cursor)) { invalid = true; break; }
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId?.trim() || "";
    }
    if (invalid) {
      parentById.set(row.id, null);
      orphaned.add(row.id);
    } else parentById.set(row.id, raw);
  }
  return { byId, parentById, orphaned };
}

export function departmentAncestorIds<T extends DepartmentHierarchyRecord>(
  rows: readonly T[], id: string,
): string[] {
  const graph = createGraph(rows);
  const ancestors: string[] = [];
  let parent = graph.parentById.get(id) || null;
  while (parent && graph.byId.has(parent) && ancestors.length < graph.byId.size) {
    ancestors.push(parent);
    parent = graph.parentById.get(parent) || null;
  }
  return ancestors;
}

export function projectDepartmentHierarchy<T extends DepartmentHierarchyRecord>(
  rows: readonly T[],
  search: string,
  collapsedIds: ReadonlySet<string>,
): DepartmentHierarchyResult<T> {
  const { byId, parentById, orphaned } = createGraph(rows);
  const compare = (a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const children = new Map<string, T[]>();
  for (const row of byId.values()) {
    const parentId = parentById.get(row.id) || "";
    const siblings = children.get(parentId) || [];
    siblings.push(row);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compare);

  const needle = search.trim().toLocaleLowerCase();
  const matches = [...byId.values()].filter((row) =>
    !needle || `${row.name} ${row.description || ""}`.toLocaleLowerCase().includes(needle));
  const retained = new Set<string>();
  for (const row of matches) {
    retained.add(row.id);
    let parent = parentById.get(row.id);
    while (parent && !retained.has(parent)) {
      retained.add(parent);
      parent = parentById.get(parent) || null;
    }
  }

  const entries: DepartmentHierarchyEntry<T>[] = [];
  function visit(row: T, ancestorNames: string[]) {
    if (!retained.has(row.id)) return;
    const descendants = children.get(row.id) || [];
    const hasChildren = descendants.length > 0;
    const expanded = Boolean(needle) || !collapsedIds.has(row.id);
    entries.push({
      row,
      depth: ancestorNames.length,
      hasChildren,
      expanded: hasChildren && expanded,
      matchesSearch: !needle || `${row.name} ${row.description || ""}`.toLocaleLowerCase().includes(needle),
      ancestorNames,
      orphanedParent: orphaned.has(row.id),
    });
    if (expanded) for (const child of descendants) visit(child, [...ancestorNames, row.name]);
  }
  for (const root of children.get("") || []) visit(root, []);
  return {
    entries,
    total: byId.size,
    matches: needle ? matches.length : byId.size,
    rootCount: (children.get("") || []).length,
    expandableIds: [...byId.values()].filter((row) => (children.get(row.id) || []).length > 0).map((row) => row.id),
  };
}
