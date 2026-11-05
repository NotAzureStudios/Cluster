import type { ClusterEntityOption } from "../../components/ClusterEntityPicker";

export type DepartmentAssignmentRow = {
  id: string;
  name: string;
  parentId?: string | null;
};
export type DepartmentLeadOption = { id: string; label: string; username: string };

/** Use only already-authorized directory rows, never background-search all users. */
export function departmentLeadChoices(
  rows: readonly DepartmentLeadOption[],
  assignedId: string,
): ClusterEntityOption[] {
  const choices: ClusterEntityOption[] = rows.map((person) => ({
    id: person.id, label: person.label, meta: person.label === person.username ? undefined : "@" + person.username,
    kind: "person", icon: "user",
  }));
  if (assignedId && !rows.some((person) => person.id === assignedId)) {
    // Preserve an existing assignment on a scoped/failed directory read.
    // The caller must choose an authorized replacement or explicitly clear it.
    choices.unshift({ id: assignedId, label: "Existing lead unavailable", meta: "Cannot select this person again", disabled: true, kind: "person" });
  }
  return choices;
}

/** The server still checks cycles and revision concurrency on every write. */
export function departmentParentChoices(
  rows: readonly DepartmentAssignmentRow[],
  forbiddenIds: ReadonlySet<string>,
  assignedId: string,
): ClusterEntityOption[] {
  const choices: ClusterEntityOption[] = rows.filter((row) => !forbiddenIds.has(row.id)).map((row) => ({
    id: row.id, label: row.name, kind: "department", icon: "users",
  }));
  if (assignedId && !choices.some((row) => row.id === assignedId)) {
    choices.unshift({ id: assignedId, label: "Existing parent unavailable", meta: "Review the department hierarchy", disabled: true, kind: "department" });
  }
  return choices;
}
