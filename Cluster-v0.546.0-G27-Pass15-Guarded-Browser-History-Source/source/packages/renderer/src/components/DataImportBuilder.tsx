import { useEffect, useRef, useState } from "react";
import type { ClusterDataImportConflictPolicy, ClusterDataImportFormat, ClusterDataImportPreviewEvidence, ClusterDataImportQueued, ClusterDataImportSchema, ClusterResourceKind } from "@cluster/shared";
import { api } from "../core/api";
import { parseClusterImportFile, suggestClusterImportColumns, type ParsedClusterImport } from "../core/data-import-client";
import { ClusterButton } from "./ClusterButton";
import { DataImportOperationFeedback } from "./DataImportOperationFeedback";
import { ClusterInput, ClusterNativeSelect } from "./ClusterNativeControls";
import { ClusterFileButton } from "./ClusterFileButton";
import { createClusterLatestResponse } from "./cluster-action-flight";
import { useClusterActionFlight } from "./useClusterActionFlight";

export function DataImportBuilder({ resourceKind, label }: { resourceKind: ClusterResourceKind; label: string }) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState<ClusterDataImportSchema | null>(null);
  const [source, setSource] = useState<ParsedClusterImport | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [format, setFormat] = useState<ClusterDataImportFormat>("csv");
  const [conflictPolicy, setConflictPolicy] = useState<ClusterDataImportConflictPolicy>("reject");
  const [preview, setPreview] = useState<ClusterDataImportPreviewEvidence | null>(null);
  const [stageConfirmed, setStageConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const { pending, begin, finish, isExecuting } = useClusterActionFlight();
  const isBusy = busy || Boolean(pending);
  const fileGeneration = useRef(createClusterLatestResponse());
  const previewGeneration = useRef(createClusterLatestResponse());
  const schemaGeneration = useRef(createClusterLatestResponse());
  const schemaLoading = useRef(false);
  useEffect(() => () => {
    fileGeneration.current.invalidate();
    previewGeneration.current.invalidate();
    schemaGeneration.current.invalidate();
  }, []);

  async function openBuilder() {
    if (isExecuting()) return;
    const next = !open;
    setOpen(next);
    if (!next) { schemaGeneration.current.invalidate(); schemaLoading.current = false; return; }
    if (schema || schemaLoading.current) return;
    const generation = schemaGeneration.current.next();
    schemaLoading.current = true;
    setStatus("Loading import schema…");
    try {
      const loaded = await api<ClusterDataImportSchema>(`/api/data-imports/${encodeURIComponent(resourceKind)}/schema`);
      if (!schemaGeneration.current.isCurrent(generation)) return;
      setSchema(loaded);
      setSource((current) => current ? { ...current, columns: suggestClusterImportColumns(current.columns, loaded) } : current);
      setConflictPolicy(loaded.conflictPolicies[0] || "reject");
      setStatus("");
    } catch (error) { if (schemaGeneration.current.isCurrent(generation)) setStatus(error instanceof Error ? error.message : "Import schema could not be loaded."); }
    finally { if (schemaGeneration.current.isCurrent(generation)) schemaLoading.current = false; }
  }

  async function loadFile(file: File | null) {
    if (isBusy || isExecuting()) return;
    const generation = fileGeneration.current.next();
    previewGeneration.current.invalidate();
    setPreview(null); setStageConfirmed(false);
    setJobId(null);
    setSourceFile(file);
    setSourceName(file?.name || "");
    setSource(null);
    if (!file) { setStatus(""); return; }
    setStatus("Reading import file…");
    try {
      const parsed = await parseClusterImportFile(file);
      if (!fileGeneration.current.isCurrent(generation)) return;
      setFormat(parsed.format);
      const columns = schema ? suggestClusterImportColumns(parsed.columns, schema) : parsed.columns;
      setSource({ ...parsed, columns });
      setStatus(`${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} loaded for validation.`);
    } catch (error) { if (fileGeneration.current.isCurrent(generation)) { setSource(null); setStatus(error instanceof Error ? error.message : "The import file could not be parsed."); } }
  }


  async function selectWorksheet(name: string) {
    if (!sourceFile || !source?.workbook || source.workbook.selectedWorksheet === name || isBusy || !begin("worksheet")) return;
    const generation = fileGeneration.current.next();
    previewGeneration.current.invalidate();
    setBusy(true); setPreview(null); setStageConfirmed(false); setJobId(null); setStatus(`Loading worksheet ${name}…`);
    try {
      const parsed = await parseClusterImportFile(sourceFile, name);
      if (!fileGeneration.current.isCurrent(generation)) return;
      const columns = schema ? suggestClusterImportColumns(parsed.columns, schema) : parsed.columns;
      setSource({ ...parsed, columns });
      setStatus(`${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} loaded from ${name}.`);
    } catch (error) { if (fileGeneration.current.isCurrent(generation)) setStatus(error instanceof Error ? error.message : "The worksheet could not be loaded."); }
    finally { setBusy(false); finish("worksheet"); }
  }

  function updateColumn(sourceColumn: string, fieldId: string) {
    if (isBusy || isExecuting()) return;
    previewGeneration.current.invalidate();
    setPreview(null); setStageConfirmed(false);
    setJobId(null);
    setSource((current) => current ? { ...current, columns: current.columns.map((column) => column.source === sourceColumn ? { ...column, fieldId: fieldId || null } : column) } : current);
  }

  async function validate() {
    if (!source || isBusy || !begin("validate")) return;
    const generation = previewGeneration.current.next();
    setBusy(true); setPreview(null); setStageConfirmed(false); setJobId(null); setStatus("Validating dry run…");
    try {
      const result = await api<ClusterDataImportPreviewEvidence>(`/api/data-imports/${encodeURIComponent(resourceKind)}/preview`, { method: "POST", body: JSON.stringify({ format, conflictPolicy, columns: source.columns, rows: source.rows, sourceName: sourceName || null }) });
      if (!previewGeneration.current.isCurrent(generation)) return;
      setPreview(result);
      setStatus(`${result.validRows} valid · ${result.invalidRows} invalid${result.truncated ? ` · preview capped at ${result.maxPreviewRows}` : ""}.`);
    } catch (error) { if (previewGeneration.current.isCurrent(generation)) setStatus(error instanceof Error ? error.message : "Import validation failed."); }
    finally { setBusy(false); finish("validate"); }
  }

  async function applyImport() {
    if (!source || !schema?.applySupported || !preview?.validRows || !preview.stage || !stageConfirmed || isBusy || !begin("apply")) return;
    setBusy(true); setStatus("Saving source and queueing import…");
    try {
      const queued = await api<ClusterDataImportQueued>(`/api/data-imports/${encodeURIComponent(resourceKind)}/apply`, { method: "POST", body: JSON.stringify({ format, conflictPolicy, columns: source.columns, rows: source.rows, sourceName: sourceName || null, stageId: preview.stage.id, stageFingerprint: preview.stage.fingerprint, confirmed: true }) });
      setJobId(queued.jobId);
      setStatus("Import queued. You can leave this view; completion will also appear in Inbox.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Import could not be queued."); }
    finally { setBusy(false); finish("apply"); }
  }

  return <div className="cluster-data-import-builder-v504">
    <ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy} onClick={() => void openBuilder()}>Import</ClusterButton>
    {open ? <div className="cluster-data-import-panel-v504" role="group" aria-label={`Import ${label}`}>
      <div className="cluster-data-import-head-v504"><div><strong>Import {label}</strong><small>Validate first, then apply through a durable background job. Excel sheets use cached cell values; workbook formulas are never executed by Cluster.</small></div><ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy} onClick={() => { if (!isExecuting()) setOpen(false); }}>Close</ClusterButton></div>
      <div className="cluster-data-import-file-v504"><span>CSV, JSON, or Excel workbook</span><ClusterFileButton disabled={isBusy} label="Choose import file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void loadFile(event.target.files?.[0] || null)}>{sourceName || "Choose file"}</ClusterFileButton></div>
      {schema && source ? <>
        <div className="cluster-data-import-options-v504"><label><span>Conflict policy</span><ClusterNativeSelect value={conflictPolicy} disabled={isBusy} onChange={(event) => { if (isExecuting()) return; previewGeneration.current.invalidate(); setConflictPolicy(event.target.value as ClusterDataImportConflictPolicy); setPreview(null); setStageConfirmed(false); setJobId(null); }}>{schema.conflictPolicies.map((policy) => <option key={policy} value={policy}>{policy === "reject" ? "Reject conflicts" : policy === "skip" ? "Skip conflicts" : "Update matches"}</option>)}</ClusterNativeSelect></label><span>{source.rows.length} source rows{schema.maxApplyRows ? ` · max ${schema.maxApplyRows}` : ""}</span></div>
        {schema.identity ? <div className="cluster-data-import-identity-v504" role="note"><strong>Conflict identity</strong><span>{schema.identity.description}</span><small>{schema.identity.fieldIds.length ? `Identity fields: ${schema.identity.fieldIds.map((fieldId) => schema.fields.find((field) => field.fieldId === fieldId)?.label || fieldId).join(", ")}.` : "No source identity fields."}{schema.identity.deterministicFallback ? " Rerun-safe deterministic identity is used when the domain allows it." : ""}</small></div> : null}
        {source.workbook ? <div className="cluster-data-import-workbook-v504">
          <label><span>Worksheet</span><ClusterNativeSelect value={source.workbook.selectedWorksheet} disabled={isBusy} onChange={(event) => void selectWorksheet(event.target.value)}>{source.workbook.worksheets.map((sheet) => <option key={sheet.path} value={sheet.name}>{sheet.name}</option>)}</ClusterNativeSelect></label>
          <span>{source.workbook.worksheets.length} sheet{source.workbook.worksheets.length === 1 ? "" : "s"} · {source.workbook.sourceRows} source rows{source.workbook.truncated ? " · staged first 1,000" : ""}{source.workbook.formulaCells ? ` · ${source.workbook.formulaCells} cached formula cell${source.workbook.formulaCells === 1 ? "" : "s"}` : ""}</span>
        </div> : null}
        <div className="cluster-data-import-map-v504" role="group" aria-label="Import column mapping">{source.columns.map((column) => <label key={column.source}><span>{column.source}</span><ClusterNativeSelect disabled={isBusy} value={column.fieldId || ""} onChange={(event) => updateColumn(column.source, event.target.value)}><option value="">Ignore</option>{schema.fields.map((field) => <option key={field.fieldId} value={field.fieldId}>{field.label}{field.required ? " *" : ""}</option>)}</ClusterNativeSelect></label>)}</div>
        <div className="button-row"><ClusterButton type="button" size="compact" disabled={isBusy || !source.rows.length} onClick={() => void validate()}>{isBusy ? "Working…" : "Validate dry run"}</ClusterButton>{schema.applySupported && preview?.validRows ? <ClusterButton type="button" size="compact" disabled={isBusy || Boolean(jobId) || !stageConfirmed || !preview.stage} onClick={() => void applyImport()}>{jobId ? "Import queued" : preview.invalidRows ? "Apply approved valid rows" : "Apply approved import"}</ClusterButton> : null}</div>
      </> : null}
      {status ? <p className="muted" aria-live="polite">{status}</p> : null}
      {preview ? <div className="cluster-data-import-evidence-v504"><div><strong>{preview.validRows}</strong><span>valid</span></div><div><strong>{preview.invalidRows}</strong><span>invalid</span></div><div><strong>{preview.mappedFieldIds.length}</strong><span>mapped fields</span></div>{preview.stage ? <div className="cluster-data-import-stage-v504"><strong>Change Set preview</strong><p>{preview.stage.changeSet.impact.summary}</p><small>Row-atomic · rollback unavailable · rerun-safe recovery</small><label><ClusterInput type="checkbox" disabled={isBusy} checked={stageConfirmed} onChange={(event) => { if (!isExecuting()) setStageConfirmed(event.target.checked); }} /><span>I reviewed this staged change and approve queueing it.</span></label></div> : null}{preview.issues.length ? <ul>{preview.issues.slice(0, 8).map((issue, index) => <li key={`${issue.row}:${issue.fieldId || issue.source}:${index}`}>{issue.row ? `Row ${issue.row}: ` : "Mapping: "}{issue.message}</li>)}</ul> : <p>No validation issues in the preview.</p>}</div> : null}
      <DataImportOperationFeedback jobId={jobId} onDismiss={() => setJobId(null)} />
    </div> : null}
  </div>;
}
