/** Pure role-directory projection. All inputs must already be authorized by the
 * Studio settings and admin role-catalog endpoints. It never grants permissions. */
export type RoleDirectoryFilter = "all" | "enabled" | "disabled" | "assigned" | "unassigned";

type RoleDirectoryRecord = {
  id: string;
  label: string;
  departmentId?: string | null;
  enabled?: boolean;
};

export function filterRoleDirectory<T extends RoleDirectoryRecord>(
  roles: readonly T[],
  options: {
    search: string;
    filter: RoleDirectoryFilter;
    departmentLabels: Readonly<Record<string, string>>;
    memberCounts: Readonly<Record<string, number>> | null;
  },
): T[] {
  const search = options.search.trim().toLocaleLowerCase();
  return roles.filter((role) => {
    if (options.filter === "enabled" && role.enabled === false) return false;
    if (options.filter === "disabled" && role.enabled !== false) return false;
    if (options.filter === "assigned" || options.filter === "unassigned") {
      const count = options.memberCounts?.[role.id];
      // Never mistake an unavailable member count for zero assignments.
      if (count === undefined || !Number.isSafeInteger(count) || count < 0) return false;
      if (options.filter === "assigned" && count === 0) return false;
      if (options.filter === "unassigned" && count !== 0) return false;
    }
    if (!search) return true;
    const department = options.departmentLabels[role.departmentId || ""] || "";
    return `${role.label} ${role.id} ${department}`.toLocaleLowerCase().includes(search);
  });
}
