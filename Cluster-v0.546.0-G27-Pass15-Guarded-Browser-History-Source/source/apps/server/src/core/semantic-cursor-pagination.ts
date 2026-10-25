import type { ClusterDataSort } from "@cluster/shared";

export type SemanticCursorValueType = "string" | "number" | "boolean" | "datetime";

export type SemanticCursorField = {
  fieldId: string;
  prismaField: string;
  valueType: SemanticCursorValueType;
  nullable?: boolean;
};

export type ResolvedSemanticCursor = SemanticCursorField & {
  direction: "asc" | "desc";
  nulls: "first" | "last";
};

export type SemanticCursorPosition = {
  fieldId: string;
  direction: "asc" | "desc";
  value: string | number | boolean | Date | null;
  id: string;
};

function serializedValue(value: unknown, type: SemanticCursorValueType) {
  if (value == null) return null;
  if (type === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new Error("Cannot encode an invalid semantic cursor timestamp.");
    return date.toISOString();
  }
  if (type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error("Cannot encode an invalid semantic cursor number.");
    return numeric;
  }
  if (type === "boolean") return Boolean(value);
  return String(value);
}

function parsedValue(value: unknown, type: SemanticCursorValueType) {
  if (value == null) return null;
  if (type === "datetime") {
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : undefined;
  }
  if (type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  if (type === "boolean") return typeof value === "boolean" ? value : undefined;
  return typeof value === "string" ? value : undefined;
}

export function resolveSemanticCursor(
  sorts: readonly ClusterDataSort[] | null | undefined,
  fields: readonly SemanticCursorField[],
  fallback: { fieldId: string; direction: "asc" | "desc" },
): { cursor: ResolvedSemanticCursor; requestedSortApplied: boolean } {
  const byId = new Map(fields.map((field) => [field.fieldId, field] as const));
  const requested = (sorts || []).length === 1 ? (sorts || [])[0] : null;
  const selected = requested ? byId.get(requested.fieldId) : null;
  const field = selected || byId.get(fallback.fieldId);
  if (!field) throw new Error(`Semantic cursor fallback field ${fallback.fieldId} is not registered.`);
  const direction = selected ? requested!.direction : fallback.direction;
  return {
    cursor: {
      ...field,
      direction,
      // Fixed null policy makes ordering portable and cursor continuation explicit.
      nulls: direction === "asc" ? "first" : "last",
    },
    requestedSortApplied: Boolean(selected),
  };
}

export function encodeSemanticCursor(position: { spec: ResolvedSemanticCursor; value: unknown; id: string }) {
  return Buffer.from(JSON.stringify({
    v: 2,
    fieldId: position.spec.fieldId,
    direction: position.spec.direction,
    nulls: position.spec.nulls,
    valueType: position.spec.valueType,
    value: serializedValue(position.value, position.spec.valueType),
    id: String(position.id),
  }), "utf8").toString("base64url");
}

export function decodeSemanticCursor(value: string | null | undefined, spec: ResolvedSemanticCursor): SemanticCursorPosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Number(parsed?.v) !== 2) return null;
    if (String(parsed?.fieldId || "") !== spec.fieldId || String(parsed?.direction || "") !== spec.direction || String(parsed?.nulls || "") !== spec.nulls || String(parsed?.valueType || "") !== spec.valueType) return null;
    const id = String(parsed?.id || "");
    if (!id) return null;
    const scalar = parsedValue(parsed?.value, spec.valueType);
    if (scalar === undefined || (scalar === null && !spec.nullable)) return null;
    return { fieldId: spec.fieldId, direction: spec.direction, value: scalar, id };
  } catch {
    return null;
  }
}

export function semanticCursorWhere(position: SemanticCursorPosition | null, spec: ResolvedSemanticCursor): Record<string, unknown> | undefined {
  if (!position) return undefined;
  const comparison = spec.direction === "desc" ? "lt" : "gt";
  const idComparison = spec.direction === "desc" ? "lt" : "gt";
  const field = spec.prismaField;

  if (position.value === null) {
    const remainingNulls = { AND: [{ [field]: null }, { id: { [idComparison]: position.id } }] };
    // Nulls-first order must advance into the non-null partition after the final
    // null row. Nulls-last has no partition after nulls.
    return spec.nulls === "first" ? { OR: [remainingNulls, { [field]: { not: null } }] } : remainingNulls;
  }

  const sameValueTail = { AND: [{ [field]: position.value }, { id: { [idComparison]: position.id } }] };
  const orderedTail = { [field]: { [comparison]: position.value } };
  if (!spec.nullable) return { OR: [orderedTail, sameValueTail] };

  // With nulls first, nulls were already consumed once the cursor has a value.
  // With nulls last, nulls remain after every non-null value.
  return spec.nulls === "last"
    ? { OR: [orderedTail, sameValueTail, { [field]: null }] }
    : { OR: [orderedTail, sameValueTail] };
}

export function semanticCursorOrderBy(spec: ResolvedSemanticCursor): Record<string, unknown>[] {
  const primary = spec.nullable
    ? { [spec.prismaField]: { sort: spec.direction, nulls: spec.nulls } }
    : { [spec.prismaField]: spec.direction };
  return [primary, { id: spec.direction }];
}

export function buildSemanticCursorPage<T extends Record<string, any>>(records: T[], limit: number, spec: ResolvedSemanticCursor) {
  const hasMore = records.length > limit;
  const items = hasMore ? records.slice(0, limit) : records;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeSemanticCursor({ spec, value: last[spec.prismaField], id: String(last.id) }) : null,
  };
}

export function semanticContinuationSort(spec: ResolvedSemanticCursor): ClusterDataSort[] {
  return [{ fieldId: spec.fieldId, direction: spec.direction }];
}
