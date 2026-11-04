/**
 * Read-only Company Graph projection from the canonical workforce context.
 * Departments, employment, team membership and reporting lines keep their
 * separate authorities; this model never persists another copy of them.
 */
export type CompanyGraphDepartment = { id: string; name: string; parentId?: string | null; leadUserId?: string | null; description?: string | null; color?: string | null; iconId?: string | null };
export type CompanyGraphTeam = { id: string; name: string; departmentId?: string | null; leadUserId?: string | null; members: Array<{ userId: string }> };
export type CompanyGraphPerson = { id: string; displayName?: string | null; preferredName?: string | null; username?: string; employment?: { departmentId?: string | null; managerUserId?: string | null; active?: boolean; jobRole?: { name: string } | null } | null };
export type CompanyGraphNode = { id: string; kind: "department" | "team" | "person"; sourceId: string; label: string; parentId: string | null; depth: number; detail: string };
export type CompanyGraphEdge = { from: string; to: string; kind: "department" | "team" | "employment" | "reports_to" | "team_member" | "lead" };
export type CompanyGraph = { nodes: CompanyGraphNode[]; edges: CompanyGraphEdge[]; warnings: string[]; roots: string[] };

export function buildCompanyGraph(input: { departments: CompanyGraphDepartment[]; teams: CompanyGraphTeam[]; people: CompanyGraphPerson[] }): CompanyGraph {
  const departments = new Map(input.departments.map((department) => [department.id, department]));
  const people = new Map(input.people.filter((person) => person.employment?.active !== false).map((person) => [person.id, person]));
  const warnings: string[] = [];
  const resolvedParents = new Map<string, string | null>();
  // A damaged/cyclic organization must render safely, even before an admin
  // repairs the hierarchy. New writes are independently validated on server.
  for (const department of departments.values()) {
    const parentId = department.parentId || null;
    if (!parentId) { resolvedParents.set(department.id, null); continue; }
    if (!departments.has(parentId)) { warnings.push(`Missing parent for ${department.name}`); resolvedParents.set(department.id, null); continue; }
    const seen = new Set([department.id]);
    let cursor: string | null = parentId;
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor)) { cyclic = true; break; }
      seen.add(cursor);
      cursor = departments.get(cursor)?.parentId || null;
      if (cursor && !departments.has(cursor)) break;
    }
    if (cyclic) warnings.push(`Circular department hierarchy: ${department.name}`);
    resolvedParents.set(department.id, cyclic ? null : parentId);
  }
  const deptNode = (id: string) => `department:${id}`;
  const teamNode = (id: string) => `team:${id}`;
  const personNode = (id: string) => `person:${id}`;
  const nodes: CompanyGraphNode[] = [];
  const edges: CompanyGraphEdge[] = [];
  const depthCache = new Map<string, number>();
  function departmentDepth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const parent = resolvedParents.get(id);
    const depth = parent ? Math.min(12, departmentDepth(parent) + 1) : 0;
    depthCache.set(id, depth);
    return depth;
  }
  for (const department of departments.values()) {
    const parentId = resolvedParents.get(department.id) || null;
    nodes.push({ id: deptNode(department.id), kind: "department", sourceId: department.id, label: department.name, parentId: parentId ? deptNode(parentId) : null, depth: departmentDepth(department.id), detail: department.description || "Department" });
    if (parentId) edges.push({ from: deptNode(parentId), to: deptNode(department.id), kind: "department" });
    if (department.leadUserId && people.has(department.leadUserId)) edges.push({ from: personNode(department.leadUserId), to: deptNode(department.id), kind: "lead" });
  }
  for (const team of input.teams) {
    const parent = team.departmentId && departments.has(team.departmentId) ? deptNode(team.departmentId) : null;
    nodes.push({ id: teamNode(team.id), kind: "team", sourceId: team.id, label: team.name, parentId: parent, depth: parent ? departmentDepth(team.departmentId!) + 1 : 0, detail: `${team.members.length} members` });
    if (parent) edges.push({ from: parent, to: teamNode(team.id), kind: "team" });
    if (team.leadUserId && people.has(team.leadUserId)) edges.push({ from: personNode(team.leadUserId), to: teamNode(team.id), kind: "lead" });
    for (const member of team.members) if (people.has(member.userId)) edges.push({ from: teamNode(team.id), to: personNode(member.userId), kind: "team_member" });
  }
  for (const person of people.values()) {
    const departmentId = person.employment?.departmentId;
    const parent = departmentId && departments.has(departmentId) ? deptNode(departmentId) : null;
    nodes.push({ id: personNode(person.id), kind: "person", sourceId: person.id, label: person.preferredName || person.displayName || person.username || person.id, parentId: parent, depth: parent ? departmentDepth(departmentId!) + 1 : 0, detail: person.employment?.jobRole?.name || "Person" });
    if (parent) edges.push({ from: parent, to: personNode(person.id), kind: "employment" });
    if (person.employment?.managerUserId && people.has(person.employment.managerUserId) && person.id !== person.employment.managerUserId) edges.push({ from: personNode(person.employment.managerUserId), to: personNode(person.id), kind: "reports_to" });
  }
  // Keep each department directly next to its descendants. Sorting all nodes
  // alphabetically made the tree indentation misleading when a child title
  // happened to precede the parent alphabetically.
  const departmentNodes = nodes.filter((node) => node.kind === "department");
  const ordered: CompanyGraphNode[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const node of departmentNodes.filter((candidate) => candidate.parentId === parentId).sort((a, b) => a.label.localeCompare(b.label))) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      ordered.push(node);
      walk(node.id);
    }
  };
  walk(null);
  for (const node of departmentNodes) if (!visited.has(node.id)) ordered.push(node);
  const remaining = nodes.filter((node) => node.kind !== "department").sort((a, b) =>
    a.kind.localeCompare(b.kind) || (a.parentId || "").localeCompare(b.parentId || "") || a.label.localeCompare(b.label));
  ordered.push(...remaining);
  return { nodes: ordered, edges, warnings, roots: ordered.filter((node) => !node.parentId).map((node) => node.id) };
}
