import type { ClusterDataFilterCondition, ClusterDataFilterGroup, ClusterDataScalar, ClusterSemanticField } from "@cluster/shared";

export type PrismaSemanticFieldAdapter = {
  field: ClusterSemanticField;
  /** Prisma scalar field for ordinary filtering/grouping. */
  prismaField?: string;
  /** Optional wrapper for relation-backed scalar filters. */
  wrapWhere?: (scalarWhere: Record<string, unknown>) => Record<string, unknown>;
  /** Domain-owned condition compiler for computed or relation semantics. */
  condition?: (condition: ClusterDataFilterCondition) => Record<string, unknown> | null;
};

function asArray(value: unknown): ClusterDataScalar[] {
  if (Array.isArray(value)) return value as ClusterDataScalar[];
  return [value as ClusterDataScalar];
}

function normalizeScalar(value: unknown, field: ClusterSemanticField): unknown {
  if (value == null) return value;
  if (field.type === "number" || field.type === "duration") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    return value;
  }
  if (field.type === "date" || field.type === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : value;
  }
  return value;
}

function directScalarWhere(adapter: PrismaSemanticFieldAdapter, condition: ClusterDataFilterCondition): Record<string, unknown> | null {
  const prismaField = adapter.prismaField;
  if (!prismaField) return null;
  const field = adapter.field;
  const value = condition.value as ClusterDataScalar | undefined;
  const normalized = normalizeScalar(value, field);
  const list = asArray(condition.value).map((entry) => normalizeScalar(entry, field));
  const text = field.type === "text" || field.type === "json" || field.type === "resource" || field.type === "person" || field.type === "status" || field.type === "enum";
  let scalarWhere: Record<string, unknown>;

  switch (condition.operator) {
    case "equals": scalarWhere = { [prismaField]: normalized }; break;
    case "not_equals": scalarWhere = { [prismaField]: { not: normalized } }; break;
    case "contains": scalarWhere = { [prismaField]: { contains: String(value ?? ""), ...(text ? { mode: "insensitive" } : {}) } }; break;
    case "not_contains": scalarWhere = { NOT: { [prismaField]: { contains: String(value ?? ""), ...(text ? { mode: "insensitive" } : {}) } } }; break;
    case "starts_with": scalarWhere = { [prismaField]: { startsWith: String(value ?? ""), ...(text ? { mode: "insensitive" } : {}) } }; break;
    case "ends_with": scalarWhere = { [prismaField]: { endsWith: String(value ?? ""), ...(text ? { mode: "insensitive" } : {}) } }; break;
    case "greater_than": scalarWhere = { [prismaField]: { gt: normalized } }; break;
    case "greater_or_equal": scalarWhere = { [prismaField]: { gte: normalized } }; break;
    case "less_than": scalarWhere = { [prismaField]: { lt: normalized } }; break;
    case "less_or_equal": scalarWhere = { [prismaField]: { lte: normalized } }; break;
    case "between": {
      const range = condition.value && typeof condition.value === "object" && !Array.isArray(condition.value) ? condition.value as { from?: ClusterDataScalar; to?: ClusterDataScalar } : {};
      const bounds: Record<string, unknown> = {};
      if (range.from != null) bounds.gte = normalizeScalar(range.from, field);
      if (range.to != null) bounds.lte = normalizeScalar(range.to, field);
      scalarWhere = { [prismaField]: bounds };
      break;
    }
    case "in": scalarWhere = { [prismaField]: { in: list } }; break;
    case "not_in": scalarWhere = { [prismaField]: { notIn: list } }; break;
    case "is_empty": scalarWhere = text ? { OR: [{ [prismaField]: null }, { [prismaField]: "" }] } : { [prismaField]: null }; break;
    case "is_not_empty": scalarWhere = text ? { AND: [{ [prismaField]: { not: null } }, { [prismaField]: { not: "" } }] } : { [prismaField]: { not: null } }; break;
    default: return null;
  }
  return adapter.wrapWhere ? adapter.wrapWhere(scalarWhere) : scalarWhere;
}

export function compilePrismaDataFilterGroup(group: ClusterDataFilterGroup | null | undefined, adapters: ReadonlyMap<string, PrismaSemanticFieldAdapter>): Record<string, unknown> | null {
  if (!group) return null;
  const compiledConditions = (group.conditions || []).flatMap((condition) => {
    const adapter = adapters.get(condition.fieldId);
    if (!adapter) return [];
    const compiled = adapter.condition?.(condition) ?? directScalarWhere(adapter, condition);
    return compiled ? [compiled] : [];
  });
  const compiledGroups = (group.groups || []).flatMap((child) => {
    const compiled = compilePrismaDataFilterGroup(child, adapters);
    return compiled ? [compiled] : [];
  });
  const terms = [...compiledConditions, ...compiledGroups];
  if (!terms.length) return null;
  return group.logic === "or" ? { OR: terms } : { AND: terms };
}

export function createPrismaSemanticAdapters(fields: readonly ClusterSemanticField[], overrides: Record<string, Partial<PrismaSemanticFieldAdapter>> = {}) {
  return new Map(fields.map((field) => {
    const override = overrides[field.id] || {};
    return [field.id, { field, prismaField: field.id, ...override } as PrismaSemanticFieldAdapter] as const;
  }));
}
