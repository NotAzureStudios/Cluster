function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compareScalar(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === "boolean" || typeof right === "boolean") return Number(Boolean(left)) - Number(Boolean(right));
  const leftNumber = typeof left === "number" ? left : Number.NaN;
  const rightNumber = typeof right === "number" ? right : Number.NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function conditionMatches(row: Record<string, any>, condition: any) {
  const value = row[condition.fieldId];
  const expected = condition.value;
  const text = String(value ?? "").toLocaleLowerCase();
  const expectedText = String(expected ?? "").toLocaleLowerCase();
  if (condition.operator === "is_empty") return value == null || value === "";
  if (condition.operator === "is_not_empty") return value != null && value !== "";
  if (condition.operator === "equals") return compareScalar(value, expected) === 0;
  if (condition.operator === "not_equals") return compareScalar(value, expected) !== 0;
  if (condition.operator === "contains") return text.includes(expectedText);
  if (condition.operator === "not_contains") return !text.includes(expectedText);
  if (condition.operator === "starts_with") return text.startsWith(expectedText);
  if (condition.operator === "ends_with") return text.endsWith(expectedText);
  if (condition.operator === "in") return Array.isArray(expected) && expected.some((item) => compareScalar(value, item) === 0);
  if (condition.operator === "not_in") return Array.isArray(expected) && !expected.some((item) => compareScalar(value, item) === 0);
  if (condition.operator === "greater_than") return compareScalar(value, expected) > 0;
  if (condition.operator === "greater_or_equal") return compareScalar(value, expected) >= 0;
  if (condition.operator === "less_than") return compareScalar(value, expected) < 0;
  if (condition.operator === "less_or_equal") return compareScalar(value, expected) <= 0;
  if (condition.operator === "between" && expected && typeof expected === "object" && !Array.isArray(expected)) {
    const from = (expected as any).from;
    const to = (expected as any).to;
    return (from == null || compareScalar(value, from) >= 0) && (to == null || compareScalar(value, to) <= 0);
  }
  return true;
}

function filterGroupMatches(row: Record<string, any>, group: any): boolean {
  if (!group) return true;
  const matches = [
    ...(group.conditions || []).map((condition: any) => conditionMatches(row, condition)),
    ...(group.groups || []).map((child: any) => filterGroupMatches(row, child)),
  ];
  return group.logic === "or" ? matches.some(Boolean) : matches.every(Boolean);
}

export async function studioKnowledgeComplianceRows(prisma: any, resourceKind: "packet" | "policy") {
  const assignments = await prisma.studioKnowledgeAssignment.findMany({
    where: { resourceKind },
    include: { user: { select: { id: true, username: true, displayName: true, preferredName: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20_000,
  });
  const resourceIds = [...new Set(assignments.map((row: any) => String(row.resourceId)).filter(Boolean))];
  const titles = new Map<string, string>();
  if (resourceKind === "packet" && resourceIds.length) {
    const definitions = await prisma.packetDefinition.findMany({ where: { libraryFolderId: { in: resourceIds } }, include: { libraryFolder: { select: { id: true, title: true } } } });
    for (const definition of definitions) titles.set(String(definition.libraryFolderId), String(definition.libraryFolder?.title || "Packet"));
  } else if (resourceKind === "policy" && resourceIds.length) {
    const policies = await prisma.studioPolicy.findMany({ where: { id: { in: resourceIds } }, select: { id: true, title: true } });
    for (const policy of policies) titles.set(String(policy.id), String(policy.title || "Policy"));
  }
  const now = Date.now();
  return assignments.map((assignment: any) => ({
    id: assignment.id,
    resourceTitle: titles.get(String(assignment.resourceId)) || (resourceKind === "packet" ? "Packet" : "Policy"),
    resourceId: assignment.resourceId,
    person: assignment.user?.preferredName || assignment.user?.displayName || assignment.user?.username || "Unknown user",
    userId: assignment.userId,
    username: assignment.user?.username || "",
    version: assignment.versionKey,
    state: assignment.state,
    overdue: assignment.state === "active" && Boolean(assignment.dueAt) && new Date(assignment.dueAt).getTime() < now,
    cycleStartedAt: iso(assignment.cycleStartedAt),
    dueAt: iso(assignment.dueAt),
    satisfiedAt: iso(assignment.satisfiedAt),
    nextRequiredAt: iso(assignment.nextRequiredAt),
    evidenceId: assignment.evidenceId,
    updatedAt: iso(assignment.updatedAt),
  }));
}

export function applyStudioKnowledgeComplianceQuery(rows: Record<string, any>[], query: any, limit: number) {
  const search = String(query?.search || "").trim().toLocaleLowerCase();
  let filtered = rows.filter((row) => filterGroupMatches(row, query?.filters));
  if (search) filtered = filtered.filter((row) => [row.resourceTitle, row.person, row.username, row.version, row.state].some((value) => String(value || "").toLocaleLowerCase().includes(search)));
  const sorts = query?.sorts?.length ? query.sorts : [{ fieldId: "updatedAt", direction: "desc" }];
  filtered.sort((left, right) => {
    for (const sort of sorts) {
      const compared = compareScalar(left[sort.fieldId], right[sort.fieldId]);
      if (compared) return sort.direction === "asc" ? compared : -compared;
    }
    return String(left.id).localeCompare(String(right.id));
  });
  return { rows: filtered.slice(0, limit), total: filtered.length, truncated: filtered.length > limit };
}
