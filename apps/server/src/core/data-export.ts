import type {
  ClusterDataExportDelivery,
  ClusterDataExportEvidence,
  ClusterDataExportFormat,
  ClusterDataExportScope,
  ClusterDataQuery,
  ClusterResourceKind,
  ClusterSemanticField,
} from "@cluster/shared";
import { clusterDataDerivedSemanticFields, materializeClusterDataDerivedRow, planClusterDataDerivedFields } from "@cluster/shared";

const MAX_IMMEDIATE_EXPORT_ROWS = 250;
const MAX_BACKGROUND_EXPORT_ROWS = 10_000;
const MAX_SELECTED_EXPORT_ROWS = 500;
const SAFE_SENSITIVITIES = new Set(["standard", "internal"]);

export type ClusterDataExportAdapterContext = {
  request?: unknown;
  reply?: unknown;
  actor: { id: string };
};

export type ClusterDataExportAdapter = {
  resourceKind: ClusterResourceKind;
  label: string;
  fields: readonly ClusterSemanticField[];
  authorize(context: { request: any; reply: any }): Promise<{ id: string } | null>;
  authorizeActor?: (actorId: string) => Promise<{ id: string } | null>;
  loadRows(input: {
    context: ClusterDataExportAdapterContext;
    query: ClusterDataQuery;
    selectedIds: readonly string[];
    limit: number;
  }): Promise<{ rows: readonly Record<string, unknown>[]; truncated?: boolean }>;
};

export class ClusterDataExportRegistry {
  private readonly adapters = new Map<ClusterResourceKind, ClusterDataExportAdapter>();

  register(adapter: ClusterDataExportAdapter) {
    if (this.adapters.has(adapter.resourceKind)) throw new Error(`Data export adapter already registered for ${adapter.resourceKind}.`);
    this.adapters.set(adapter.resourceKind, adapter);
    return this;
  }

  get(resourceKind: ClusterResourceKind) { return this.adapters.get(resourceKind) || null; }
  list() { return [...this.adapters.values()]; }
}

export function normalizeClusterExportFileName(value: unknown, fallback: string, format: ClusterDataExportFormat) {
  const base = String(value || fallback).trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
  const withoutExtension = base.replace(/\.(csv|json|xlsx)$/i, "");
  return `${withoutExtension}.${format}`;
}

function neutralizeSpreadsheetFormula(value: string) {
  const trimmed = value.replace(/^\s+/, "");
  return /^[=+\-@]/.test(trimmed) ? `'${value}` : value;
}

function csvCell(value: unknown) {
  if (value == null) return "";
  const raw = typeof value === "string" ? neutralizeSpreadsheetFormula(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function safeJsonValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function selectClusterExportFields(fields: readonly ClusterSemanticField[], requestedFieldIds?: readonly string[]) {
  const allowed = fields.filter((field) => field.exportable !== false && SAFE_SENSITIVITIES.has(field.sensitivity || "standard"));
  const requested = requestedFieldIds?.length ? new Set(requestedFieldIds) : null;
  const selected = requested ? allowed.filter((field) => requested.has(field.id)) : allowed;
  const selectedIds = new Set(selected.map((field) => field.id));
  const omittedFieldIds = fields.filter((field) => !selectedIds.has(field.id)).map((field) => field.id);
  return { selected, omittedFieldIds };
}


export function prepareClusterDerivedExport(input: {
  baseFields: readonly ClusterSemanticField[];
  query: ClusterDataQuery;
  rows: readonly Record<string, unknown>[];
}) {
  const plan = planClusterDataDerivedFields(input.query.derivedFields || [], input.baseFields, 12);
  const fields = [...input.baseFields, ...clusterDataDerivedSemanticFields(plan.fields)];
  const rows = plan.fields.length ? input.rows.map((row) => {
    const materialized = materializeClusterDataDerivedRow(row, plan.fields, input.baseFields);
    const { plan: _plan, ...values } = materialized;
    return values;
  }) : [...input.rows];
  return { fields, rows, plan };
}

export function prepareClusterDataExport(input: {
  resourceKind: ClusterResourceKind;
  adapterLabel: string;
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery?: ClusterDataExportDelivery;
  fields: readonly ClusterSemanticField[];
  requestedFieldIds?: readonly string[];
  rows: readonly Record<string, unknown>[];
  truncated?: boolean;
  fileName?: string | null;
  maxRows?: number;
}) {
  const { selected, omittedFieldIds } = selectClusterExportFields(input.fields, input.requestedFieldIds);
  if (!selected.length) throw Object.assign(new Error("No exportable fields were selected."), { code: "DATA_EXPORT_FIELDS_REQUIRED", statusCode: 400 });
  const rows = input.rows.map((row) => Object.fromEntries(selected.map((field) => [field.id, safeJsonValue(row[field.id])])));
  const evidence: ClusterDataExportEvidence = {
    resourceKind: input.resourceKind,
    format: input.format,
    scope: input.scope,
    ...(input.delivery ? { delivery: input.delivery } : {}),
    rowCount: rows.length,
    fieldIds: selected.map((field) => field.id),
    omittedFieldIds,
    generatedAt: new Date().toISOString(),
    truncated: Boolean(input.truncated),
    maxRows: Math.max(1, Math.round(input.maxRows || (input.scope === "selection" ? MAX_SELECTED_EXPORT_ROWS : MAX_IMMEDIATE_EXPORT_ROWS))),
  };
  const fileName = normalizeClusterExportFileName(input.fileName, input.adapterLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"), input.format);
  return { fileName, fields: selected, rows, evidence };
}

export function renderClusterDataExport(input: Parameters<typeof prepareClusterDataExport>[0]) {
  if (input.format === "xlsx") throw Object.assign(new Error("XLSX exports are generated through the background export runtime."), { code: "DATA_EXPORT_BACKGROUND_REQUIRED", statusCode: 400 });
  const prepared = prepareClusterDataExport(input);
  if (input.format === "json") {
    return { fileName: prepared.fileName, contentType: "application/json; charset=utf-8", body: JSON.stringify({ evidence: prepared.evidence, rows: prepared.rows }, null, 2), evidence: prepared.evidence };
  }
  const header = prepared.fields.map((field) => csvCell(field.label)).join(",");
  const bodyRows = prepared.rows.map((row) => prepared.fields.map((field) => csvCell(row[field.id])).join(","));
  return { fileName: prepared.fileName, contentType: "text/csv; charset=utf-8", body: `\uFEFF${[header, ...bodyRows].join("\r\n")}`, evidence: prepared.evidence };
}

export const CLUSTER_DATA_EXPORT_LIMITS = {
  immediateRows: MAX_IMMEDIATE_EXPORT_ROWS,
  backgroundRows: MAX_BACKGROUND_EXPORT_ROWS,
  selectedRows: MAX_SELECTED_EXPORT_ROWS,
} as const;
