import type {
  ClusterDataImportColumn,
  ClusterDataImportConflictPolicy,
  ClusterDataImportPreviewEvidence,
  ClusterDataImportPreviewRequest,
  ClusterDataImportRowAction,
  ClusterDataImportSchema,
  ClusterDataScalar,
  ClusterResourceKind,
  ClusterSemanticField,
} from "@cluster/shared";

const MAX_PREVIEW_ROWS = 250;
const MAX_APPLY_ROWS = 1000;
const MAX_IMPORT_COLUMNS = 100;

export type ClusterDataImportMutationResult = {
  action: Exclude<ClusterDataImportRowAction, "failed">;
  resourceId?: string | null;
  identity?: string | null;
  message?: string | null;
};

export type ClusterDataImportApplyContext = {
  actor: { id: string };
  row: number;
  values: Record<string, ClusterDataScalar>;
  conflictPolicy: ClusterDataImportConflictPolicy;
  sourceFingerprint: string;
  deterministicId: string;
};

export type ClusterDataImportAdapter = {
  resourceKind: ClusterResourceKind;
  label: string;
  fields: readonly ClusterSemanticField[];
  importableFieldIds: readonly string[];
  requiredFieldIds?: readonly string[];
  aliases?: Readonly<Record<string, readonly string[]>>;
  conflictPolicies?: readonly ClusterDataImportConflictPolicy[];
  /** Explain, but do not duplicate, the domain identity rules implemented by applyRow. */
  identity?: { fieldIds: readonly string[]; description: string; deterministicFallback?: boolean };
  authorize(context: { request: any; reply: any }): Promise<{ id: string } | null>;
  authorizeActor?: (actorId: string) => Promise<{ id: string } | null>;
  applyRow?: (context: ClusterDataImportApplyContext) => Promise<ClusterDataImportMutationResult>;
};

export class ClusterDataImportRegistry {
  private readonly adapters = new Map<ClusterResourceKind, ClusterDataImportAdapter>();

  register(adapter: ClusterDataImportAdapter) {
    if (this.adapters.has(adapter.resourceKind)) throw new Error(`Data import adapter already registered for ${adapter.resourceKind}.`);
    this.adapters.set(adapter.resourceKind, adapter);
    return this;
  }

  get(resourceKind: ClusterResourceKind) { return this.adapters.get(resourceKind) || null; }
  list() { return [...this.adapters.values()]; }
}

function normalizedName(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function importFields(adapter: ClusterDataImportAdapter) {
  const allowed = new Set(adapter.importableFieldIds);
  return adapter.fields.filter((field) => allowed.has(field.id));
}

export function clusterDataImportSchema(adapter: ClusterDataImportAdapter): ClusterDataImportSchema {
  const required = new Set(adapter.requiredFieldIds || []);
  return {
    resourceKind: adapter.resourceKind,
    fields: importFields(adapter).map((field) => ({
      fieldId: field.id,
      label: field.label,
      type: field.type,
      required: required.has(field.id),
      aliases: [...(adapter.aliases?.[field.id] || [])],
      ...(field.enumValues?.length ? { enumValues: [...field.enumValues] } : {}),
    })),
    conflictPolicies: [...(adapter.conflictPolicies || ["reject"])],
    identity: adapter.identity ? { fieldIds: [...adapter.identity.fieldIds], description: adapter.identity.description, deterministicFallback: Boolean(adapter.identity.deterministicFallback) } : null,
    maxPreviewRows: MAX_PREVIEW_ROWS,
    maxApplyRows: MAX_APPLY_ROWS,
    applySupported: Boolean(adapter.authorizeActor && adapter.applyRow),
  };
}

function automaticFieldId(source: string, adapter: ClusterDataImportAdapter) {
  const needle = normalizedName(source);
  if (!needle) return null;
  for (const field of importFields(adapter)) {
    const aliases = [field.id, field.label, ...(adapter.aliases?.[field.id] || [])];
    if (aliases.some((alias) => normalizedName(alias) === needle)) return field.id;
  }
  return null;
}

function coerceScalar(field: ClusterSemanticField, input: ClusterDataScalar): { value: ClusterDataScalar; error?: string } {
  if (input == null || input === "") return { value: null };
  if (["text", "resource", "person", "status", "enum", "json"].includes(field.type)) {
    const value = typeof input === "string" ? input.trim() : String(input);
    if (field.enumValues?.length && !field.enumValues.includes(value)) return { value, error: `Expected one of: ${field.enumValues.join(", ")}.` };
    return { value };
  }
  if (field.type === "number" || field.type === "duration") {
    const value = typeof input === "number" ? input : Number(String(input).trim());
    return Number.isFinite(value) ? { value } : { value: null, error: "Expected a finite number." };
  }
  if (field.type === "boolean") {
    if (typeof input === "boolean") return { value: input };
    const value = String(input).trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(value)) return { value: true };
    if (["false", "no", "0", "off"].includes(value)) return { value: false };
    return { value: null, error: "Expected true/false, yes/no, or 1/0." };
  }
  if (field.type === "date" || field.type === "datetime") {
    const date = new Date(String(input));
    if (!Number.isFinite(date.getTime())) return { value: null, error: "Expected a valid date." };
    return { value: field.type === "date" ? date.toISOString().slice(0, 10) : date.toISOString() };
  }
  return { value: input };
}

export function previewClusterDataImport(adapter: ClusterDataImportAdapter, request: ClusterDataImportPreviewRequest, options: { maxRows?: number } = {}): ClusterDataImportPreviewEvidence {
  const schema = clusterDataImportSchema(adapter);
  const allowedFields = new Map(importFields(adapter).map((field) => [field.id, field] as const));
  const required = new Set(adapter.requiredFieldIds || []);
  const requestedPolicy = request.conflictPolicy || schema.conflictPolicies[0] || "reject";
  const conflictPolicy = schema.conflictPolicies.includes(requestedPolicy) ? requestedPolicy : schema.conflictPolicies[0] || "reject";
  const issues: ClusterDataImportPreviewEvidence["issues"] = [];
  const columns: ClusterDataImportColumn[] = [];
  const usedFields = new Set<string>();

  for (const [index, column] of (request.columns || []).slice(0, MAX_IMPORT_COLUMNS).entries()) {
    const source = String(column?.source || "").trim().slice(0, 240);
    if (!source) continue;
    const fieldId = column.fieldId ? String(column.fieldId) : automaticFieldId(source, adapter);
    if (fieldId && !allowedFields.has(fieldId)) {
      issues.push({ row: 0, source, fieldId, code: "IMPORT_FIELD_NOT_ALLOWED", message: `Column ${source} cannot map to ${fieldId}.` });
      columns.push({ source, fieldId: null });
      continue;
    }
    if (fieldId && usedFields.has(fieldId)) {
      issues.push({ row: 0, source, fieldId, code: "IMPORT_FIELD_DUPLICATE", message: `${fieldId} is mapped more than once.` });
      columns.push({ source, fieldId: null });
      continue;
    }
    if (fieldId) usedFields.add(fieldId);
    columns.push({ source, fieldId: fieldId || null });
    if (index >= MAX_IMPORT_COLUMNS - 1) break;
  }

  for (const fieldId of required) {
    if (!usedFields.has(fieldId)) issues.push({ row: 0, source: "", fieldId, code: "IMPORT_REQUIRED_MAPPING", message: `${allowedFields.get(fieldId)?.label || fieldId} must be mapped.` });
  }

  const sourceRows = Array.isArray(request.rows) ? request.rows : [];
  const maximumRows = Math.max(1, Math.min(MAX_APPLY_ROWS, Math.round(options.maxRows || MAX_PREVIEW_ROWS)));
  const previewRows = sourceRows.slice(0, maximumRows);
  const rows = previewRows.map((sourceRow, rowIndex) => {
    const values: Record<string, ClusterDataScalar> = {};
    let valid = true;
    for (const column of columns) {
      if (!column.fieldId) continue;
      const field = allowedFields.get(column.fieldId);
      if (!field) continue;
      const coerced = coerceScalar(field, sourceRow?.[column.source] ?? null);
      values[column.fieldId] = coerced.value;
      if (coerced.error) {
        valid = false;
        issues.push({ row: rowIndex + 1, source: column.source, fieldId: column.fieldId, code: "IMPORT_VALUE_INVALID", message: coerced.error });
      }
    }
    for (const fieldId of required) {
      const value = values[fieldId];
      if (value == null || value === "") {
        valid = false;
        issues.push({ row: rowIndex + 1, source: columns.find((column) => column.fieldId === fieldId)?.source || "", fieldId, code: "IMPORT_REQUIRED_VALUE", message: `${allowedFields.get(fieldId)?.label || fieldId} is required.` });
      }
    }
    return { row: rowIndex + 1, values, valid };
  });
  const globalMappingInvalid = issues.some((issue) => issue.row === 0 && ["IMPORT_FIELD_NOT_ALLOWED", "IMPORT_FIELD_DUPLICATE", "IMPORT_REQUIRED_MAPPING"].includes(issue.code));
  if (globalMappingInvalid) for (const row of rows) row.valid = false;
  const validRows = rows.filter((row) => row.valid).length;

  return {
    resourceKind: adapter.resourceKind,
    format: request.format,
    conflictPolicy,
    sourceRowCount: sourceRows.length,
    columns,
    mappedFieldIds: columns.flatMap((column) => column.fieldId ? [column.fieldId] : []),
    ignoredColumns: columns.filter((column) => !column.fieldId).map((column) => column.source),
    validRows,
    invalidRows: rows.length - validRows,
    rows,
    issues: issues.slice(0, 500),
    dryRun: true,
    truncated: sourceRows.length > maximumRows,
    maxPreviewRows: maximumRows,
  };
}

export const CLUSTER_DATA_IMPORT_LIMITS = { previewRows: MAX_PREVIEW_ROWS, applyRows: MAX_APPLY_ROWS, columns: MAX_IMPORT_COLUMNS } as const;
