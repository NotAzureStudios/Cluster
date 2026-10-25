import { useMemo, useState } from "react";
import type { ClusterDataExportDelivery, ClusterDataExportFormat, ClusterDataExportScope, ClusterSemanticField } from "@cluster/shared";
import { ClusterButton } from "./ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "./ClusterNativeControls";
import { useClusterActionFlight } from "./useClusterActionFlight";

type DataExportBuilderValue = {
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery: ClusterDataExportDelivery;
  fieldIds: string[];
};

export function DataExportBuilder({ fields, visibleFieldIds, selectionCount, busy = false, onExport }: {
  fields: readonly ClusterSemanticField[];
  visibleFieldIds?: readonly string[];
  selectionCount: number;
  busy?: boolean;
  onExport: (value: DataExportBuilderValue) => void | Promise<void>;
}) {
  const exportable = useMemo(() => fields.filter((field) => field.exportable !== false && ["standard", "internal"].includes(field.sensitivity || "standard")), [fields]);
  const defaults = useMemo(() => {
    const visible = new Set(visibleFieldIds || []);
    const ids = exportable.filter((field) => !visible.size || visible.has(field.id)).map((field) => field.id);
    return ids.length ? ids : exportable.map((field) => field.id);
  }, [exportable, visibleFieldIds]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const { pending, begin, finish, isExecuting } = useClusterActionFlight();
  const isBusy = busy || Boolean(pending);
  const [format, setFormat] = useState<ClusterDataExportFormat>("csv");
  const [scope, setScope] = useState<ClusterDataExportScope>(selectionCount ? "selection" : "view");
  const [delivery, setDelivery] = useState<ClusterDataExportDelivery>("download");
  const [fieldIds, setFieldIds] = useState<string[]>(defaults);
  const effectiveScope = scope === "selection" && !selectionCount ? "view" : scope;
  const effectiveDelivery: ClusterDataExportDelivery = format === "xlsx" ? "library" : delivery;
  const selected = new Set(fieldIds);

  async function submitExport() {
    // Rendered busy flags are not synchronous locks: reject a second intent now.
    if (busy || !fieldIds.length || !begin("export")) return;
    setError("");
    try {
      await onExport({ format, scope: effectiveScope, delivery: effectiveDelivery, fieldIds: [...fieldIds] });
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export could not be started.");
    } finally {
      finish("export");
    }
  }

  function toggleField(fieldId: string) { if (isExecuting()) return; setFieldIds((current) => current.includes(fieldId) ? current.filter((id) => id !== fieldId) : [...current, fieldId]); }
  return <div className="cluster-data-export-builder-v504">
    <ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy || !exportable.length} onClick={() => { if (isExecuting()) return; if (!open && !fieldIds.length) setFieldIds(defaults); setError(""); setOpen((value) => !value); }}>{isBusy ? "Exporting…" : "Export"}</ClusterButton>
    {open ? <div className="cluster-data-export-panel-v504" role="group" aria-label="Export data">
      <div className="cluster-data-export-options-v504">
        <label><span>Format</span><ClusterNativeSelect disabled={isBusy} value={format} onChange={(event) => { if (!isExecuting()) setFormat(event.target.value as ClusterDataExportFormat); }}><option value="csv">CSV</option><option value="json">JSON</option><option value="xlsx">Excel (.xlsx)</option></ClusterNativeSelect></label>
        <label><span>Rows</span><ClusterNativeSelect disabled={isBusy} value={effectiveScope} onChange={(event) => { if (!isExecuting()) setScope(event.target.value as ClusterDataExportScope); }}><option value="view">Current view</option>{selectionCount ? <option value="selection">Selected rows ({selectionCount})</option> : null}</ClusterNativeSelect></label>
        <label><span>Delivery</span><ClusterNativeSelect value={effectiveDelivery} onChange={(event) => { if (!isExecuting()) setDelivery(event.target.value as ClusterDataExportDelivery); }} disabled={isBusy || format === "xlsx"}><option value="download">Download now</option><option value="library">Save to Library</option></ClusterNativeSelect></label>
      </div>
      <div className="cluster-data-export-fields-v504" role="group" aria-label="Export fields">
        <div><strong>Fields</strong><ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy} onClick={() => setFieldIds(exportable.map((field) => field.id))}>All</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy} onClick={() => setFieldIds(defaults)}>Visible</ClusterButton></div>
        {exportable.map((field) => <label key={field.id}><ClusterInput type="checkbox" disabled={isBusy} checked={selected.has(field.id)} onChange={() => toggleField(field.id)} /><span>{field.label}</span></label>)}
      </div>
      <small className="cluster-data-export-note-v504">Restricted fields are excluded by the server export policy. Current-view exports preserve the active semantic query. Library delivery runs as durable background work; XLSX always uses that path.</small>
      {error ? <p className="cluster-data-export-error-v504" role="alert">{error}</p> : null}
      {pending ? <span role="status" aria-live="polite">Preparing export…</span> : null}
      <div className="button-row"><ClusterButton type="button" size="compact" busy={isBusy} disabled={isBusy || !fieldIds.length} onClick={() => void submitExport()}>{effectiveDelivery === "library" ? "Queue export" : `Export ${effectiveScope === "selection" ? selectionCount : "view"}`}</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" disabled={isBusy} onClick={() => { if (!isExecuting()) setOpen(false); }}>Close</ClusterButton></div>
    </div> : null}
  </div>;
}
